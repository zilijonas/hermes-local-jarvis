"""Worker task manager.

Executes delegated tasks outside the mediator's latency path:
  - cloud:   `hermes -p default -z <prompt> --yolo --ignore-rules -t <toolsets>`
             subprocess (Hermes "codecloud" = OpenCode Go + jev-router). The
             DEFAULT backend: measured 2026-09-28 at 5.4s for a task the local
             backend took 30-60s for, with a correct answer either way.
  - local:   `hermes -z <prompt> --yolo -t <toolsets>` subprocess with
             HERMES_HOME pointed at the lean jarvis-voice home (config
             `paths.worker_home`) -- gpt-oss-20b via the same model router the
             mediator uses. Also the automatic fallback target if cloud fails
             for an infrastructure reason (rate limit, quota, network, 5xx, or
             the hermes binary itself missing).
  - codex:   `~/ai/bin/codex-task.sh` (availability-gated, single dispatch, no retries)
  - claude:  `claude -p <prompt> --dangerously-skip-permissions` headless

Design rules (see docs/SPEC.md):
  - every state change lands in jarvis.db first, then on the event bus — a jarvisd
    restart re-attaches from the table, orphaned PIDs are reconciled on boot.
  - a task may only become `done` after validation; anything doubtful is
    `needs_review` with an honest summary. No false completion, ever.
  - pause/resume = SIGSTOP/SIGCONT on the process group; cancel = SIGTERM then SIGKILL.
  - every task gets a hard wall-clock timeout (config `worker.timeout_s`); on
    expiry the process group is killed and the task is marked `failed` with an
    honest summary -- never left running or silently truncated.
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

DEFAULT_WORKER_HOME = os.path.expanduser("~/ai/state/jarvis-voice/hermes-home")
DEFAULT_TIMEOUT_S = 900.0
DEFAULT_CLOUD_TOOLSETS: list[str] = []  # [] = default profile's own toolsets (see config.py)

# Selectable engines for complex tasks + tool calling. The user picks one; every
# delegate_task runs on it (the mediator/voice loop is unaffected).
BACKENDS = ("local", "cloud", "codex", "claude")
_SECRET_RE = re.compile(r"(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", re.I)

_ERROR_MARKERS = re.compile(
    r"(traceback \(most recent call last\)|\[error\]|fatal:|command not found|"
    r"permission denied|no such file or directory)", re.I)
# The worker's own words admitting it did not do the job ("I could not find any
# mail tools..."): exit 0, but not `done`. Checked on the final paragraph only.
_ADMITTED_FAILURE = re.compile(
    r"^\W*(i\s+(could\s*n[o']t|can\s*n[o']t|cannot|was\s+unable|am\s+unable|was\s+not\s+able)"
    r"|unable\s+to|no\s+\w+(\s+\w+)?\s+(is|are|was|were)\s+(accessible|available))", re.I)
def _worker_question(out: str) -> str:
    """The worker's 'QUESTION: ...' line (it needs the user), or ''."""
    for line in reversed((out or "").strip().splitlines()[-6:]):
        m = re.match(r"\s*\**\s*QUESTION\s*:\s*\**\s*(.+)", line, re.I)
        if m:
            return m.group(1).strip().strip("*").strip()[:300]
    return ""


# Paths a worker result may claim to have produced — checked before `done`.
_ARTIFACT_RE = re.compile(r"(?:^|[\s`'\"(])(/(?:Users|tmp|private)/[^\s`'\")\]]+)", re.M)

# Cloud-run failures worth ONE automatic retry on the local backend, rather
# than surfacing straight to the user: rate limiting, quota, transient network
# errors, and the hermes binary/provider simply not being reachable.
_INFRA_FAILURE_RE = re.compile(
    r"(\b429\b|\b5\d\d\b|rate.?limit|quota|connection refused|connection reset|"
    r"econnrefused|timed?.?out|dns|no route to host|network is unreachable|"
    r"could not resolve host)", re.I)

# Markdown that must never be read aloud: bold/code markers, headings, list
# bullets/numbering, table rows.
_BULLET_LINE_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.M)
_HEADING_RE = re.compile(r"^\s*#+\s*", re.M)
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$", re.M)


def _sanitize_speakable(text: str) -> str:
    """Strip markdown so a summary is safe to read aloud, collapse whitespace,
    and cap it to roughly 400 characters."""
    text = _TABLE_ROW_RE.sub(" ", text)
    text = _HEADING_RE.sub("", text)
    text = _BULLET_LINE_RE.sub("", text)
    text = text.replace("**", "").replace("`", "").replace("#", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:400]


WORKER_PREAMBLE = (
    "This is a background task for the Jarvis voice assistant. There is no "
    "user present to answer questions or approve anything -- never ask a "
    "clarifying question and never wait for confirmation. Do the task "
    "completely yourself using reasonable defaults. When you finish, end "
    "your final message with a 1-3 sentence plain-English summary of the "
    "result suitable to be read aloud: the key facts and numbers, no "
    "markdown, no tables, no headings, no bullet lists. Never block waiting "
    "(no sleep or timers longer than a few seconds) and never open GUI dialogs; "
    "anything that must happen later goes through the cronjob tool. You have full "
    "permission for normal work on this Mac (read, search, run commands, create and "
    "edit the user's files, browse, draft); do it without asking. Truly dangerous or "
    "irreversible actions (deleting or overwriting data, sending messages or email to "
    "other people, payments or trades, system settings, installing or removing "
    "software, secrets) need the user's yes: do them only if the task says "
    "'confirmed by user', otherwise ask with QUESTION as below. If a detail "
    "you need is missing and there is no sensible default (guessing would change "
    "the result), do NOT guess: stop and make your final message exactly one line "
    "starting with 'QUESTION:' followed by one short question for the user."
)



def _signal_tree(pid: int, sig: int) -> list[int]:
    """Signal a worker's whole process TREE, not just its process group.

    Hermes' terminal tool starts commands in their own sessions, so killpg() on the
    worker misses them: a canceled task left `sleep 180; osascript ...` children
    running (seen 2026-09-28). Descendants are listed BEFORE the parent is signalled
    (once it dies they re-parent to launchd and can't be found). Returns the pids hit."""
    pids = [pid]
    try:
        import psutil

        pids += [c.pid for c in psutil.Process(pid).children(recursive=True)]
    except Exception:  # noqa: BLE001 — psutil missing or process gone: group only
        pass
    try:
        os.killpg(pid, sig)
    except OSError:
        pass
    for p in pids:
        try:
            os.kill(p, sig)
        except OSError:
            pass
    return pids


def _kill_pids(pids: list[int], sig: int) -> None:
    for p in pids:
        try:
            os.kill(p, sig)
        except OSError:
            pass

class WorkerManager:
    def __init__(self, db, bus, hermes_bin: str = HERMES_BIN,
                 codex_bin: str = CODEX_TASK, max_concurrent: int = 2,
                 backend: str = "cloud", worker_home: str = DEFAULT_WORKER_HOME,
                 cloud_toolsets: Optional[list[str]] = None,
                 timeout_s: float = DEFAULT_TIMEOUT_S):
        self.db = db
        self.bus = bus
        self.hermes_bin = hermes_bin
        self.codex_bin = codex_bin
        self.backend = backend if backend in BACKENDS else "cloud"
        # Lean, profile-free Hermes home for the local backend (the jarvis-voice
        # Hermes *profile* is going away -- see module docstring / config.py).
        self.worker_home = os.path.expanduser(worker_home)
        self.cloud_toolsets = list(cloud_toolsets) if cloud_toolsets else list(DEFAULT_CLOUD_TOOLSETS)
        self.timeout_s = float(timeout_s) if timeout_s else DEFAULT_TIMEOUT_S
        self.sem = asyncio.Semaphore(max_concurrent)
        try:  # constructed inside the app lifespan → the event loop is running
            self.loop = asyncio.get_running_loop()
        except RuntimeError:
            self.loop = None
        self.procs: dict[str, subprocess.Popen] = {}
        self.on_outcome: Optional[Callable[[str, bool], None]] = None  # capability feedback
        self.on_task_event: Optional[Callable[[dict], None]] = None    # pipeline hook
        # Worker and mediator now share one model, so a worker start no longer evicts
        # anything. This gate is still worth keeping: a worker's prefill competes with
        # a voice turn for the GPU, and starting one mid-utterance makes the reply
        # stutter. Pipeline sets this to an awaitable that resolves when no turn is
        # active. (The router runs 2 slots, so a turn issued *during* a worker task
        # still answers in ~1.6s instead of waiting ~37s for it to finish.)
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
        avail = {"local": True, "cloud": True, "codex": False, "claude": False}
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
            _signal_tree(proc.pid, signal.SIGSTOP)
            self.db.update_task(task_id, status="paused")
        elif action == "resume" and proc and t["status"] == "paused":
            _signal_tree(proc.pid, signal.SIGCONT)
            self.db.update_task(task_id, status="running")
        elif action == "cancel" and proc and t["status"] in ("running", "paused"):
            _signal_tree(proc.pid, signal.SIGCONT)
            tree = _signal_tree(proc.pid, signal.SIGTERM)
            self.db.update_task(task_id, status="canceled",
                                result_summary="canceled by user")
            self._escalate_kill(proc, tree)
        elif action == "cancel" and t["status"] == "queued":
            self.db.update_task(task_id, status="canceled",
                                result_summary="canceled before start")
        else:
            return {"ok": False, "error": f"cannot {action} task in state {t['status']}"}
        self._emit(task_id)
        return {"ok": True, "status": self.db.get_task(task_id)["status"]}

    def _build_prompt(self, t: dict[str, Any]) -> str:
        """Prepend the background-task preamble (no user present, never ask,
        finish completely, end with a spoken-aloud summary) to the goal, so
        every backend gets the same honesty/summary contract."""
        prompt = f"{WORKER_PREAMBLE}\n\nTask: {t['goal']}"
        if t.get("context"):
            prompt += f"\n\nContext:\n{t['context']}"
        return prompt

    async def _stream_proc(self, task_id: str, proc: subprocess.Popen,
                           timeout_s: Optional[float] = None) -> tuple[str, bool]:
        """Read a worker's merged stdout live, emitting throttled progress notes so
        the user sees intermediate results — not a black box until it finishes.

        If `timeout_s` elapses before the process exits, the process GROUP is
        killed (SIGTERM, escalating to SIGKILL) so the blocking readline() in
        the executor thread unblocks on its own (stdout closes) -- this does
        NOT rely on cancelling the executor future, which can't be interrupted
        once running. Returns (output_so_far, timed_out).
        """
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

        read_future = loop.run_in_executor(None, reader)
        if not timeout_s:
            await read_future
            return "".join(lines), False

        done, _pending = await asyncio.wait({read_future}, timeout=timeout_s)
        if read_future in done:
            return "".join(lines), False

        tree = _signal_tree(proc.pid, signal.SIGTERM)
        self._escalate_kill(proc, tree)
        await read_future  # process is dying/dead -> stdout closes -> reader ends
        return "".join(lines), True

    def _mark_timed_out(self, task_id: str) -> None:
        self.db.update_task(task_id, status="failed", finished=time.time(),
                            result_summary=f"worker exceeded the {int(self.timeout_s)}s "
                                           "time limit and was stopped.")
        self._emit(task_id)

    def _progress(self, task_id: str, note: str) -> None:
        t = self.db.get_task(task_id)
        if not t or t["status"] not in ("running", "paused"):
            return
        self.bus.publish({"t": "task.update", "id": task_id, "status": t["status"],
                          "title": (t["goal"] or "")[:80], "kind": t["kind"],
                          "progress_note": note, "result_summary": None})

    def _escalate_kill(self, proc: subprocess.Popen, tree: Optional[list[int]] = None) -> None:
        """SIGTERM was sent; guarantee death of the whole tree with SIGKILL."""

        async def _watch():
            for _ in range(10):
                if proc.poll() is not None:
                    break
                await asyncio.sleep(0.5)
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            _kill_pids(tree or [], signal.SIGKILL)

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
                          "claude": self._run_claude}.get(t["kind"], self._run_local)
                await runner(t)
            except Exception as e:  # noqa: BLE001 — worker crash must not kill jarvisd
                self.db.update_task(task_id, status="failed",
                                    result_summary=f"worker crashed: {e}")
                self._emit(task_id)
            finally:
                self.procs.pop(task_id, None)
                self._feedback(task_id)

    async def _run_local(self, t: dict[str, Any], fallback_note: str = "") -> None:
        task_id = t["id"]
        prompt = self._build_prompt(t)
        usage_file = f"/tmp/jarvis-usage-{task_id}.json"
        # NB: --source is a `chat` subcommand flag, not valid with top-level -z.
        # No -p profile: the jarvis-voice Hermes *profile* is gone, HERMES_HOME
        # below points straight at its lean, profile-free home instead.
        cmd = [self.hermes_bin, "-z", prompt, "--yolo",
               "-t", t["toolsets"], "--usage-file", usage_file]
        env = {k: v for k, v in os.environ.items()
               if not re.search(r"(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", k, re.I)}
        env["HERMES_HOME"] = self.worker_home

        workspace = os.path.join(self.worker_home, "workspace")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True, env=env,
                                cwd=workspace if os.path.isdir(workspace) else None)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="local worker started")

        out, timed_out = await self._stream_proc(task_id, proc, timeout_s=self.timeout_s)
        usage = None
        try:
            usage = json.loads(Path(usage_file).read_text())
            Path(usage_file).unlink(missing_ok=True)
        except Exception:
            pass

        if self.db.get_task(task_id)["status"] == "canceled":
            return
        if timed_out:
            self._mark_timed_out(task_id)
            return
        self._finish(task_id, proc.returncode, out.strip(), "", usage, note_suffix=fallback_note)

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
        prompt = self._build_prompt(t)
        proc = subprocess.Popen([self.codex_bin, "run", prompt],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="codex job dispatched")
        out, timed_out = await self._stream_proc(task_id, proc, timeout_s=self.timeout_s)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        if timed_out:
            self._mark_timed_out(task_id)
            return
        self._finish(task_id, proc.returncode, out.strip(), "", None)

    async def _run_cloud(self, t: dict[str, Any]) -> None:
        """Cloud = Hermes `default` profile (codecloud: OpenCode Go + jev-router).
        Uses the default profile's own creds. --ignore-rules skips its
        delegate-everything skill so it answers directly instead of re-routing
        to Codex. Gets the BROAD toolset diet (worker.cloud_toolsets), not the
        capability manifest's small-model diet -- that's for the local backend.

        Infrastructure failures (rate limit/quota/network/5xx, or the hermes
        binary itself missing) get exactly ONE automatic retry on the local
        backend, noted in the final summary -- anything else (a real task
        failure) is reported as-is, never silently retried.
        """
        task_id = t["id"]
        if _which(self.hermes_bin) is None:
            await self._fallback_to_local(t, "hermes binary not found")
            return
        prompt = self._build_prompt(t)
        # Empty cloud_toolsets = the default profile's own toolsets. That is the
        # useful setting: `-t` in oneshot mode only knows built-in toolsets and
        # silently drops plugin ones (mail, signal-engine) — measured 2026-09-28.
        cmd = [self.hermes_bin, "-p", "default", "-z", prompt, "--yolo", "--ignore-rules"]
        if self.cloud_toolsets:
            cmd += ["-t", ",".join(self.cloud_toolsets)]
        # Full env: the cloud model needs its keys (user allowed blast radius).
        # cwd = the worker workspace, never jarvisd's own cwd (the repo): relative
        # paths a task writes must not land in the service checkout.
        workspace = os.path.join(self.worker_home, "workspace")
        os.makedirs(workspace, exist_ok=True)
        # Without HERMES_HOME: jarvisd's own points at the local worker home, and
        # `-p default` then resolves plugins from there, so mail_* & co. vanish.
        env = {k: v for k, v in os.environ.items() if k != "HERMES_HOME"}
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True, cwd=workspace, env=env)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="cloud (codecloud) started")
        out, timed_out = await self._stream_proc(task_id, proc, timeout_s=self.timeout_s)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        if timed_out:
            self._mark_timed_out(task_id)
            return
        rc = proc.returncode
        if rc != 0 and _INFRA_FAILURE_RE.search((out or "")[-2000:]):
            await self._fallback_to_local(t, f"cloud exited {rc}: infrastructure failure")
            return
        self._finish(task_id, rc, out.strip(), "", None)

    async def _fallback_to_local(self, t: dict[str, Any], reason: str) -> None:
        task_id = t["id"]
        self._emit(task_id, note=f"cloud failed ({reason}); falling back to local")
        await self._run_local(t, fallback_note="(fell back to local)")

    async def _run_claude(self, t: dict[str, Any]) -> None:
        """Claude Code headless, full permissions (user opted into blast radius).
        Runs in the worker workspace so relative paths are predictable."""
        task_id = t["id"]
        if _which(CLAUDE_BIN) is None:
            self.db.update_task(task_id, status="failed",
                                result_summary="Claude Code CLI not on PATH.")
            self._emit(task_id)
            return
        prompt = self._build_prompt(t)
        workspace = os.path.join(self.worker_home, "workspace")
        cmd = [CLAUDE_BIN, "-p", prompt, "--dangerously-skip-permissions",
               "--output-format", "text"]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True,
                                cwd=workspace if os.path.isdir(workspace) else None)
        self.procs[task_id] = proc
        self.db.update_task(task_id, status="running", started=time.time(), pid=proc.pid)
        self._emit(task_id, note="claude code started")
        out, timed_out = await self._stream_proc(task_id, proc, timeout_s=self.timeout_s)
        if self.db.get_task(task_id)["status"] == "canceled":
            return
        if timed_out:
            self._mark_timed_out(task_id)
            return
        self._finish(task_id, proc.returncode, out.strip(), "", None)

    # ------------------------------------------------------------ validation
    def _finish(self, task_id: str, rc: int, out: str, err: str,
                usage: Optional[dict], note_suffix: str = "") -> None:
        checks = {"exit_ok": rc == 0,
                  "output_nonempty": bool(out),
                  "no_error_markers": not _ERROR_MARKERS.search(out[-4000:] if out else ""),
                  "not_admitted_failure": not _ADMITTED_FAILURE.search(
                      (re.split(r"\n\s*\n", out.strip())[-1] if out and out.strip() else ""))}
        missing: list[str] = []
        for path in _ARTIFACT_RE.findall(out or "")[:8]:
            # only verify paths the result claims were created/written
            ctx = out[max(0, out.find(path) - 60):out.find(path)]
            if re.search(r"(creat|wrot|saved|generat|updat)", ctx, re.I) and not os.path.exists(path):
                missing.append(path)
        checks["artifacts_exist"] = not missing

        question = _worker_question(out)
        if question:
            # Not a failure and not done: the worker is blocked on the user.
            self.db.update_task(task_id, status="needs_review", finished=time.time(),
                                result_text=(out or "")[-20000:],
                                result_summary=f"Question: {question}",
                                validation={**checks, "needs_input": True}, usage=usage)
            self._emit(task_id)
            return
        ok = all(checks.values())
        status = "done" if ok else ("failed" if rc != 0 else "needs_review")
        summary = self._summarize(out, err, rc, missing)
        if note_suffix:
            summary = f"{summary} {note_suffix}".strip()
        self.db.update_task(task_id, status=status, finished=time.time(),
                            result_text=(out or "")[-20000:], result_summary=summary,
                            validation=checks, usage=usage)
        self._emit(task_id)

    @staticmethod
    def _summarize(out: str, err: str, rc: int, missing: list[str]) -> str:
        if rc != 0:
            tail = (err or out or "no output").strip().splitlines()
            return f"worker exited {rc}: {_sanitize_speakable(' '.join(tail[-3:]))}"[:300]
        if missing:
            return _sanitize_speakable(
                f"result claims files that don't exist: {', '.join(missing[:3])} "
                "— flagged for review")
        # Drop CLI chatter ("hermes -z: ignoring ...", HF hub warnings): not results.
        text = "\n".join(l for l in (out or "").splitlines()
                         if not re.match(r"\s*(hermes( -z)?:|warning:)", l, re.I)).strip()
        if not text:
            return "worker produced no output — flagged for review"
        # Prefer the worker's FINAL paragraph (blank-line-separated block) --
        # that's where the preamble asks it to put a plain-English summary.
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        final = paragraphs[-1] if paragraphs else text
        return _sanitize_speakable(final)

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
