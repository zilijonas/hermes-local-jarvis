"""Worker task manager.

Executes delegated tasks outside the mediator's latency path:
  - granite: `hermes -p jarvis-voice -z <prompt> --yolo -t <toolsets>` subprocess
  - codex:   `~/ai/bin/codex-task.sh` (availability-gated, single dispatch, no retries)

Design rules (see docs/SPEC.md):
  - every state change lands in jarvis.db first, then on the event bus — a jarvisd
    restart re-attaches from the table, orphaned PIDs are reconciled on boot.
  - a task may only become `done` after validation; anything doubtful is
    `needs_review` with an honest summary. No false completion, ever.
  - pause/resume = SIGSTOP/SIGCONT on the process group; cancel = SIGTERM then SIGKILL.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

HERMES_BIN = os.path.expanduser("~/.local/bin/hermes")
CODEX_TASK = os.path.expanduser("~/ai/bin/codex-task.sh")
PROFILE = "jarvis-voice"

_ERROR_MARKERS = re.compile(
    r"(traceback \(most recent call last\)|\[error\]|fatal:|command not found|"
    r"permission denied|no such file or directory)", re.I)
# Paths a worker result may claim to have produced — checked before `done`.
_ARTIFACT_RE = re.compile(r"(?:^|[\s`'\"(])(/(?:Users|tmp|private)/[^\s`'\")\]]+)", re.M)


class WorkerManager:
    def __init__(self, db, bus, hermes_bin: str = HERMES_BIN,
                 codex_bin: str = CODEX_TASK, max_concurrent: int = 2):
        self.db = db
        self.bus = bus
        self.hermes_bin = hermes_bin
        self.codex_bin = codex_bin
        self.sem = asyncio.Semaphore(max_concurrent)
        self.procs: dict[str, subprocess.Popen] = {}
        self.on_outcome: Optional[Callable[[str, bool], None]] = None  # capability feedback
        self.on_task_event: Optional[Callable[[dict], None]] = None    # pipeline hook

    # ---------------------------------------------------------------- boot
    def reconcile_on_boot(self) -> int:
        """Mark tasks that claim to be running but whose PID is gone."""
        fixed = 0
        for t in self.db.list_tasks(status="running") + self.db.list_tasks(status="paused"):
            pid = t.get("pid")
            alive = False
            if pid:
                try:
                    os.kill(pid, 0)
                    alive = True
                except OSError:
                    alive = False
            if not alive:
                self.db.update_task(t["id"], status="needs_review",
                                    result_summary="jarvisd restarted; worker process lost. "
                                                   "Output may be incomplete — re-delegate if needed.")
                self._emit(t["id"])
                fixed += 1
        return fixed

    # ------------------------------------------------------------- public
    async def delegate(self, goal: str, kind: str, context: str = "",
                       toolsets: Optional[list[str]] = None,
                       capability_id: str = "") -> dict[str, Any]:
        task_id = uuid.uuid4().hex[:12]
        toolsets = toolsets or ["file", "terminal"]
        self.db.create_task(task_id, kind=kind, goal=goal, context=context,
                            toolsets=",".join(toolsets), status="queued",
                            metadata={"capability_id": capability_id})
        self._emit(task_id, note="queued")
        asyncio.get_running_loop().create_task(self._run(task_id))
        return {"task_id": task_id, "status": "started"}

    def status(self, task_id: str = "") -> list[dict[str, Any]]:
        if task_id:
            t = self.db.get_task(task_id)
            return [self._brief(t)] if t else []
        return [self._brief(t) for t in self.db.list_tasks(limit=5)]

    def control(self, task_id: str, action: str) -> dict[str, Any]:
        t = self.db.get_task(task_id)
        if not t:
            return {"ok": False, "error": "unknown task"}
        proc = self.procs.get(task_id)
        if action == "pause" and proc and t["status"] == "running":
            os.killpg(proc.pid, signal.SIGSTOP)
            self.db.update_task(task_id, status="paused")
        elif action == "resume" and proc and t["status"] == "paused":
            os.killpg(proc.pid, signal.SIGCONT)
            self.db.update_task(task_id, status="running")
        elif action == "cancel" and proc and t["status"] in ("running", "paused"):
            os.killpg(proc.pid, signal.SIGCONT)
            os.killpg(proc.pid, signal.SIGTERM)
            self.db.update_task(task_id, status="canceled",
                                result_summary="canceled by user")
            self._escalate_kill(proc)
        elif action == "cancel" and t["status"] == "queued":
            self.db.update_task(task_id, status="canceled",
                                result_summary="canceled before start")
        else:
            return {"ok": False, "error": f"cannot {action} task in state {t['status']}"}
        self._emit(task_id)
        return {"ok": True, "status": self.db.get_task(task_id)["status"]}

    def _escalate_kill(self, proc: subprocess.Popen) -> None:
        """SIGTERM was sent; guarantee death with SIGKILL if it's ignored."""

        async def _watch():
            for _ in range(10):
                if proc.poll() is not None:
                    return
                await asyncio.sleep(0.5)
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass

        try:
            asyncio.get_running_loop().create_task(_watch())
        except RuntimeError:  # no loop (unit test sync path): best-effort immediate check
            pass

    # ------------------------------------------------------------ internals
    async def _run(self, task_id: str) -> None:
        async with self.sem:
            t = self.db.get_task(task_id)
            if not t or t["status"] != "queued":
                return
            try:
                if t["kind"] == "codex":
                    await self._run_codex(t)
                else:
                    await self._run_granite(t)
            except Exception as e:  # noqa: BLE001 — worker crash must not kill jarvisd
                self.db.update_task(task_id, status="failed",
                                    result_summary=f"worker crashed: {e}")
                self._emit(task_id)
            finally:
                self.procs.pop(task_id, None)
                self._feedback(task_id)

    async def _run_granite(self, t: dict[str, Any]) -> None:
        task_id = t["id"]
        prompt = t["goal"] if not t["context"] else f"{t['goal']}\n\nContext:\n{t['context']}"
        usage_file = f"/tmp/jarvis-usage-{task_id}.json"
        # NB: --source is a `chat` subcommand flag, not valid with top-level -z.
        cmd = [self.hermes_bin, "-p", PROFILE, "-z", prompt, "--yolo",
               "-t", t["toolsets"], "--usage-file", usage_file]
        env = {k: v for k, v in os.environ.items()
               if not re.search(r"(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", k, re.I)}
        env["HERMES_HOME"] = os.path.expanduser(f"~/.hermes/profiles/{PROFILE}")

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, start_new_session=True, env=env)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="granite worker started")

        loop = asyncio.get_running_loop()
        out, err = await loop.run_in_executor(None, proc.communicate)
        usage = None
        try:
            usage = json.loads(Path(usage_file).read_text())
            Path(usage_file).unlink(missing_ok=True)
        except Exception:
            pass

        cur = self.db.get_task(task_id)
        if cur["status"] == "canceled":
            return
        self._finish(task_id, proc.returncode, out.strip(), err.strip(), usage)

    async def _run_codex(self, t: dict[str, Any]) -> None:
        task_id = t["id"]
        avail = subprocess.run([self.codex_bin, "status"], capture_output=True,
                               text=True, timeout=30)
        if avail.returncode != 0:
            self.db.update_task(task_id, status="failed",
                                result_summary="Codex unavailable (codex-task.sh status failed); "
                                               "not falling back to cloud. Ask the user.")
            self._emit(task_id)
            return
        prompt = t["goal"] if not t["context"] else f"{t['goal']}\n\nContext:\n{t['context']}"
        proc = subprocess.Popen([self.codex_bin, "run", prompt],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, start_new_session=True)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="codex job dispatched")
        loop = asyncio.get_running_loop()
        out, err = await loop.run_in_executor(None, proc.communicate)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        self._finish(task_id, proc.returncode, out.strip(), err.strip(), None)

    # ------------------------------------------------------------ validation
    def _finish(self, task_id: str, rc: int, out: str, err: str,
                usage: Optional[dict]) -> None:
        checks = {"exit_ok": rc == 0,
                  "output_nonempty": bool(out),
                  "no_error_markers": not _ERROR_MARKERS.search(out[-4000:] if out else "")}
        missing: list[str] = []
        for path in _ARTIFACT_RE.findall(out or "")[:8]:
            # only verify paths the result claims were created/written
            ctx = out[max(0, out.find(path) - 60):out.find(path)]
            if re.search(r"(creat|wrot|saved|generat|updat)", ctx, re.I) and not os.path.exists(path):
                missing.append(path)
        checks["artifacts_exist"] = not missing

        ok = all(checks.values())
        status = "done" if ok else ("failed" if rc != 0 else "needs_review")
        summary = self._summarize(out, err, rc, missing)
        self.db.update_task(task_id, status=status, finished=time.time(),
                            result_text=(out or "")[-20000:], result_summary=summary,
                            validation=checks, usage=usage)
        self._emit(task_id)

    @staticmethod
    def _summarize(out: str, err: str, rc: int, missing: list[str]) -> str:
        if rc != 0:
            tail = (err or out or "no output").strip().splitlines()
            return f"worker exited {rc}: {' '.join(tail[-3:])[:300]}"
        if missing:
            return f"result claims files that don't exist: {', '.join(missing[:3])} — flagged for review"
        text = (out or "").strip()
        if not text:
            return "worker produced no output — flagged for review"
        lines = [l for l in text.splitlines() if l.strip()]
        return " ".join(lines[-4:])[:400]

    def _feedback(self, task_id: str) -> None:
        t = self.db.get_task(task_id)
        if not t or not self.on_outcome:
            return
        cap = (t.get("metadata") or {}).get("capability_id")
        if cap:
            self.on_outcome(cap, t["status"] == "done")

    def _brief(self, t: dict[str, Any]) -> dict[str, Any]:
        keys = ("id", "kind", "goal", "status", "result_summary", "created", "finished")
        return {k: t.get(k) for k in keys}

    def _emit(self, task_id: str, note: str = "") -> None:
        t = self.db.get_task(task_id)
        if not t:
            return
        payload = {"t": "task.update", "id": t["id"], "status": t["status"],
                   "title": (t["goal"] or "")[:80], "kind": t["kind"],
                   "progress_note": note or None,
                   "result_summary": t.get("result_summary")}
        self.bus.publish(payload)
        if self.on_task_event and t["status"] in ("done", "failed", "needs_review"):
            try:
                self.on_task_event(payload)
            except Exception:  # noqa: BLE001 — announcement must not break task flow
                pass

    def component_status(self) -> dict[str, Any]:
        running = len([p for p in self.procs.values() if p.poll() is None])
        return {"ok": True, "detail": f"{running} running workers"}
