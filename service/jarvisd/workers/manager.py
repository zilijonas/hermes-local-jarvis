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
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional


def _which(binary: str) -> Optional[str]:
    return shutil.which(binary) if not os.path.isabs(binary) else (
        binary if os.path.exists(binary) else None)

HERMES_BIN = os.path.expanduser("~/.local/bin/hermes")
CODEX_TASK = os.path.expanduser("~/ai/bin/codex-task.sh")
CLAUDE_BIN = "claude"
PROFILE = "jarvis-voice"

# Selectable engines for complex tasks + tool calling. The user picks one; every
# delegate_task runs on it (the mediator/voice loop is unaffected).
BACKENDS = ("granite", "cloud", "codex", "claude")
_SECRET_RE = re.compile(r"(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", re.I)

_ERROR_MARKERS = re.compile(
    r"(traceback \(most recent call last\)|\[error\]|fatal:|command not found|"
    r"permission denied|no such file or directory)", re.I)
# Paths a worker result may claim to have produced — checked before `done`.
_ARTIFACT_RE = re.compile(r"(?:^|[\s`'\"(])(/(?:Users|tmp|private)/[^\s`'\")\]]+)", re.M)


class WorkerManager:
    def __init__(self, db, bus, hermes_bin: str = HERMES_BIN,
                 codex_bin: str = CODEX_TASK, max_concurrent: int = 2,
                 backend: str = "granite"):
        self.db = db
        self.bus = bus
        self.hermes_bin = hermes_bin
        self.codex_bin = codex_bin
        self.backend = backend if backend in BACKENDS else "granite"
        self.sem = asyncio.Semaphore(max_concurrent)
        try:  # constructed inside the app lifespan → the event loop is running
            self.loop = asyncio.get_running_loop()
        except RuntimeError:
            self.loop = None
        self.procs: dict[str, subprocess.Popen] = {}
        self.on_outcome: Optional[Callable[[str, bool], None]] = None  # capability feedback
        self.on_task_event: Optional[Callable[[dict], None]] = None    # pipeline hook
        # Loading granite evicts the mediator on this 24 GB box. If a worker starts
        # while a voice turn is mid-flight, gemma dies right before it must speak
        # (the "lost my train of thought" class). Pipeline sets this to an awaitable
        # that resolves when no turn is active.
        self.wait_turn_clear: Optional[Callable[[], "asyncio.Future"]] = None

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

    # ------------------------------------------------------------- backend
    def set_backend(self, name: str) -> dict[str, Any]:
        if name not in BACKENDS:
            return {"ok": False, "error": f"unknown backend {name}"}
        self.backend = name
        return {"ok": True, "backend": name}

    def availability(self) -> dict[str, bool]:
        """Cheap, no-token reachability per backend."""
        avail = {"granite": True, "cloud": True, "codex": False, "claude": False}
        # cloud: the default profile must exist and carry some credential.
        default_env = os.path.expanduser("~/.hermes/.env")
        default_auth = os.path.expanduser("~/.hermes/auth.json")
        avail["cloud"] = os.path.exists(default_auth) or os.path.exists(default_env)
        # codex: token file present + binary on PATH (mirror codex-task.sh status).
        avail["codex"] = (os.path.exists(os.path.expanduser("~/.codex/auth.json"))
                          and _which(self.codex_bin) is not None)
        # claude: binary + credentials.
        avail["claude"] = (_which(CLAUDE_BIN) is not None
                           and os.path.exists(os.path.expanduser("~/.claude/.credentials.json")))
        return avail

    # ------------------------------------------------------------- public
    async def delegate(self, goal: str, kind: str = "", context: str = "",
                       toolsets: Optional[list[str]] = None,
                       capability_id: str = "") -> dict[str, Any]:
        task_id = uuid.uuid4().hex[:12]
        toolsets = toolsets or ["file", "terminal"]
        # The user-selected backend governs every delegated task (the `kind` arg
        # is kept only for backward compat / explicit overrides in tests).
        backend = kind if kind in BACKENDS else self.backend
        self.db.create_task(task_id, kind=backend, goal=goal, context=context,
                            toolsets=",".join(toolsets), status="queued",
                            metadata={"capability_id": capability_id, "backend": backend})
        self._emit(task_id, note=f"queued · {backend}")
        asyncio.get_running_loop().create_task(self._run(task_id))
        return {"task_id": task_id, "status": "started", "backend": backend}

    def status(self, task_id: str = "") -> list[dict[str, Any]]:
        if task_id:
            t = self.db.get_task(task_id)
            return [self._brief(t)] if t else []
        return [self._brief(t) for t in self.db.list_tasks(limit=5)]

    _TERMINAL = ("done", "failed", "needs_review", "canceled")

    def control(self, task_id: str, action: str) -> dict[str, Any]:
        t = self.db.get_task(task_id)
        if not t:
            return {"ok": False, "error": "unknown task"}
        proc = self.procs.get(task_id)
        # Approve/re-delegate a reviewed-or-finished task: re-queue the same goal
        # on the current backend as a fresh task (the notice card's Approve, and
        # a resume issued against an already-terminal task, both land here).
        if action == "redelegate" or (action == "resume" and t["status"] in self._TERMINAL):
            goal = t["goal"]
            ctx = t.get("context") or ""
            toolsets = (t.get("toolsets") or "file,terminal").split(",")
            cap = (t.get("metadata") or {}).get("capability_id", "")

            def _spawn() -> None:
                self.loop.create_task(self.delegate(goal=goal, context=ctx,
                                                    toolsets=toolsets, capability_id=cap))
            if self.loop is None:
                return {"ok": False, "error": "no event loop for re-delegate"}
            self.loop.call_soon_threadsafe(_spawn)  # safe from any thread
            return {"ok": True, "status": "redelegated"}
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

    async def _stream_proc(self, task_id: str, proc: subprocess.Popen) -> str:
        """Read a worker's merged stdout live, emitting throttled progress notes so
        the user sees intermediate results — not a black box until it finishes."""
        loop = asyncio.get_running_loop()
        lines: list[str] = []
        state = {"last": 0.0}

        def reader() -> None:
            for line in iter(proc.stdout.readline, ""):
                lines.append(line)
                s = line.strip()
                now = time.time()
                if s and now - state["last"] > 2.0:
                    state["last"] = now
                    loop.call_soon_threadsafe(self._progress, task_id, s[:140])
            try:
                proc.stdout.close()
            except Exception:
                pass
            proc.wait()

        await loop.run_in_executor(None, reader)
        return "".join(lines)

    def _progress(self, task_id: str, note: str) -> None:
        t = self.db.get_task(task_id)
        if not t or t["status"] not in ("running", "paused"):
            return
        self.bus.publish({"t": "task.update", "id": task_id, "status": t["status"],
                          "title": (t["goal"] or "")[:80], "kind": t["kind"],
                          "progress_note": note, "result_summary": None})

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
            if self.wait_turn_clear is not None:
                try:  # don't stall forever if the pipeline wedges — 25 s cap
                    await asyncio.wait_for(self.wait_turn_clear(), timeout=25.0)
                except (asyncio.TimeoutError, Exception):
                    pass
                if self.db.get_task(task_id)["status"] != "queued":
                    return  # canceled while waiting
            try:
                runner = {"codex": self._run_codex, "cloud": self._run_cloud,
                          "claude": self._run_claude}.get(t["kind"], self._run_granite)
                await runner(t)
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

        workspace = os.path.expanduser(f"~/.hermes/profiles/{PROFILE}/workspace")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True, env=env,
                                cwd=workspace if os.path.isdir(workspace) else None)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="granite worker started")

        out = await self._stream_proc(task_id, proc)
        usage = None
        try:
            usage = json.loads(Path(usage_file).read_text())
            Path(usage_file).unlink(missing_ok=True)
        except Exception:
            pass

        if self.db.get_task(task_id)["status"] == "canceled":
            return
        self._finish(task_id, proc.returncode, out.strip(), "", usage)

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
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="codex job dispatched")
        out = await self._stream_proc(task_id, proc)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        self._finish(task_id, proc.returncode, out.strip(), "", None)

    async def _run_cloud(self, t: dict[str, Any]) -> None:
        """Cloud = Hermes `default` profile (its configured cloud model). Uses the
        default profile's own creds. --ignore-rules skips its delegate-everything
        skill so it answers directly instead of re-routing to Codex."""
        task_id = t["id"]
        prompt = t["goal"] if not t["context"] else f"{t['goal']}\n\nContext:\n{t['context']}"
        cmd = [self.hermes_bin, "-p", "default", "-z", prompt, "--yolo",
               "--ignore-rules", "-t", t["toolsets"]]
        # Full env: the cloud model needs its keys (user allowed blast radius).
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="cloud (default profile) started")
        out = await self._stream_proc(task_id, proc)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        self._finish(task_id, proc.returncode, out.strip(), "", None)

    async def _run_claude(self, t: dict[str, Any]) -> None:
        """Claude Code headless, full permissions (user opted into blast radius).
        Runs in the profile workspace so relative paths are predictable."""
        task_id = t["id"]
        if _which(CLAUDE_BIN) is None:
            self.db.update_task(task_id, status="failed",
                                result_summary="Claude Code CLI not on PATH.")
            self._emit(task_id)
            return
        prompt = t["goal"] if not t["context"] else f"{t['goal']}\n\nContext:\n{t['context']}"
        workspace = os.path.expanduser(f"~/.hermes/profiles/{PROFILE}/workspace")
        cmd = [CLAUDE_BIN, "-p", prompt, "--dangerously-skip-permissions",
               "--output-format", "text"]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True,
                                cwd=workspace if os.path.isdir(workspace) else None)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="claude code started")
        out = await self._stream_proc(task_id, proc)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        self._finish(task_id, proc.returncode, out.strip(), "", None)

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
