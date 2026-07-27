"""Shared fixtures/helpers for the jarvisd integration + hardening test suite
(test_integration.py, test_mediator_quality.py, and bench/run_bench.py conceptually
mirrors a subset of this).

Deliberately NOT named `conftest.py`: the existing `service/tests/conftest.py` only
does sys.path wiring + JARVISD_NO_PIPELINE=1 for the fast unit-test skeleton
(test_core.py/test_audio.py/test_memory.py). Integration tests need the opposite (a
REAL running jarvisd, full pipeline, no NO_PIPELINE override), so this module is
imported explicitly by the two test files that need it rather than auto-loaded
repo-wide.

Resolution order (per the task brief / docs/SPEC.md):
  - Prefer the live LaunchAgent-managed jarvisd on 127.0.0.1:9140 if healthy.
  - Otherwise spin up a throwaway full-pipeline instance of THIS repo's service on
    127.0.0.1:9141 (or the next free port) as a session-scoped fixture.
  - The restart-recovery test always spins up its OWN dedicated instance and never
    touches the live LaunchAgent process (see test_integration.py).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

import pytest

SERVICE_DIR = Path(__file__).resolve().parent.parent  # .../service
REPO_ROOT = SERVICE_DIR.parent
VENV_PYTHON = SERVICE_DIR / ".venv" / "bin" / "python"

HOST = "127.0.0.1"
LIVE_PORT = 9140
OWN_PORT = 9141
OLLAMA_HOST_PORT = ("127.0.0.1", 11434)

SAY_BIN = "/usr/bin/say"
FFMPEG_BIN = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
HAVE_SAY_TOOLS = os.path.exists(SAY_BIN) and bool(FFMPEG_BIN) and os.path.exists(FFMPEG_BIN)

PIPELINE_READY_TIMEOUT_S = 180.0  # whisper + kokoro + gemma warmup can be slow cold

SCRATCH_DIR = Path(tempfile.gettempdir()) / "jarvisd-itest"
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)


# NB: this module is imported by the two integration test files, not auto-loaded as a
# pytest plugin (it isn't named conftest.py -- the real service/tests/conftest.py is out
# of scope for this test suite to modify), so a `pytest_configure` hook defined here
# would never actually run. `pytest.mark.integration` is therefore left unregistered;
# it shows up as a harmless PytestUnknownMarkWarning during collection rather than a
# registered marker, but still works fine for `-m integration` selection.


# --------------------------------------------------------------------------- net/http

def ollama_reachable(timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection(OLLAMA_HOST_PORT, timeout=timeout):
            return True
    except OSError:
        return False


def http_get_json(url: str, timeout: float = 15.0) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def http_post_json(url: str, body: dict, timeout: float = 120.0) -> tuple[int, Any]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"detail": raw.decode(errors="replace")}
        return e.code, payload


def health(base_url: str, timeout: float = 3.0) -> Optional[dict]:
    try:
        return http_get_json(f"{base_url}/health", timeout=timeout)
    except Exception:
        return None


def pipeline_fully_up(h: Optional[dict]) -> bool:
    if not h:
        return False
    comps = h.get("components", {})
    required = ("stt", "tts", "mediator", "ollama", "db")
    return all(comps.get(name, {}).get("ok") for name in required)


def find_free_port(start: int) -> int:
    port = start
    while port < start + 50:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, port)) != 0:
                return port
        port += 1
    raise RuntimeError(f"no free port found starting at {start}")


# --------------------------------------------------------------------------- process mgmt

def spawn_jarvisd(port: int, log_tag: str) -> subprocess.Popen:
    """Launch `python -m jarvisd.app` with JARVISD_PORT=<port>, full pipeline (STT/TTS/
    mediator/workers all load -- JARVISD_NO_PIPELINE is explicitly NOT set). Runs in its
    own process group (start_new_session) so it -- and it alone, not any worker
    subprocess it spawns, which gets its own session too -- can be torn down cleanly.
    """
    env = dict(os.environ)
    env["JARVISD_PORT"] = str(port)
    env.pop("JARVISD_NO_PIPELINE", None)
    out_path = SCRATCH_DIR / f"jarvisd-{log_tag}.out.log"
    err_path = SCRATCH_DIR / f"jarvisd-{log_tag}.err.log"
    out_f = open(out_path, "wb")
    err_f = open(err_path, "wb")
    proc = subprocess.Popen(
        [str(VENV_PYTHON), "-m", "jarvisd.app"],
        cwd=str(SERVICE_DIR),
        env=env,
        stdout=out_f,
        stderr=err_f,
        start_new_session=True,
    )
    proc._itest_out_path = out_path  # type: ignore[attr-defined]
    proc._itest_err_path = err_path  # type: ignore[attr-defined]
    return proc


def wait_for_health(
    base_url: str, timeout_s: float = PIPELINE_READY_TIMEOUT_S, require_pipeline: bool = True
) -> dict:
    deadline = time.monotonic() + timeout_s
    last: Optional[dict] = None
    while time.monotonic() < deadline:
        last = health(base_url, timeout=3.0)
        if last is not None and (not require_pipeline or pipeline_fully_up(last)):
            return last
        time.sleep(1.0)
    raise TimeoutError(f"{base_url}/health not ready within {timeout_s}s (last={last})")


def stop_jarvisd(proc: Optional[subprocess.Popen], graceful_timeout: float = 8.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, 15)  # SIGTERM the whole group (proc + any child it spawned)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=graceful_timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            pass


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def poll_task(base_url: str, task_id: str, timeout_s: float, poll_every: float = 2.0) -> dict:
    """Poll GET /tasks/{id} until it reaches a terminal status or timeout_s elapses."""
    deadline = time.monotonic() + timeout_s
    last: Optional[dict] = None
    while time.monotonic() < deadline:
        last = http_get_json(f"{base_url}/tasks/{task_id}")
        if last.get("status") in ("done", "failed", "needs_review", "canceled"):
            return last
        time.sleep(poll_every)
    raise TimeoutError(f"task {task_id} still {last.get('status') if last else '?'} after {timeout_s}s")


def snapshot_task_ids(base_url: str, limit: int = 20) -> set[str]:
    """IDs of the `limit` most recent tasks, for before/after diffing (see find_new_task).
    """
    return {t["id"] for t in http_get_json(f"{base_url}/tasks?limit={limit}")["tasks"]}


def find_new_task(base_url: str, before_ids: set[str], limit: int = 20) -> dict:
    """The most recent task NOT present in `before_ids`.

    Matching a just-delegated task by looking for a marker substring in its `goal` field
    is NOT reliable: the mediator constructs the delegate_task tool call's `goal`
    argument itself (it's the model paraphrasing/summarizing the request, not an echo of
    the user's literal text), so a marker string placed in the *user's* input text can
    silently fail to appear in the task row at all (observed empirically -- see the
    written report). Diffing task IDs before/after the delegating call is deterministic
    regardless of what text the model chooses to write.
    """
    after = http_get_json(f"{base_url}/tasks?limit={limit}")["tasks"]  # ordered created DESC
    new = [t for t in after if t["id"] not in before_ids]
    if not new:
        raise AssertionError(
            f"no new task row appeared; before_ids={before_ids} "
            f"after_ids={[t['id'] for t in after]}"
        )
    return new[0]


# --------------------------------------------------------------------------- fixtures

@pytest.fixture(scope="session")
def service():
    """{'base_url', 'using_own', 'proc'}. Prefers the live LaunchAgent instance on
    127.0.0.1:9140 if it's fully healthy; otherwise spins up a throwaway session-scoped
    instance. Skips the whole dependent test if neither Ollama nor the live service is
    reachable at all (spinning up our own would just time out uselessly without Ollama).
    """
    live_url = f"http://{HOST}:{LIVE_PORT}"
    h = health(live_url, timeout=3.0)
    if pipeline_fully_up(h):
        yield {"base_url": live_url, "using_own": False, "proc": None}
        return

    if not ollama_reachable() and h is None:
        pytest.skip(
            f"jarvisd unreachable on {live_url} and Ollama unreachable on "
            f"{OLLAMA_HOST_PORT[0]}:{OLLAMA_HOST_PORT[1]} -- cannot run integration suite"
        )
    if not VENV_PYTHON.exists():
        pytest.skip(f"no venv python at {VENV_PYTHON} to spin up an own instance")

    port = find_free_port(OWN_PORT)
    proc = spawn_jarvisd(port, log_tag="session")
    base_url = f"http://{HOST}:{port}"
    try:
        wait_for_health(base_url, timeout_s=PIPELINE_READY_TIMEOUT_S)
    except TimeoutError as e:
        err_tail = ""
        try:
            err_tail = proc._itest_err_path.read_text()[-2000:]  # type: ignore[attr-defined]
        except Exception:
            pass
        stop_jarvisd(proc)
        pytest.skip(f"own jarvisd instance failed to become healthy: {e}\n{err_tail}")
    try:
        yield {"base_url": base_url, "using_own": True, "proc": proc}
    finally:
        stop_jarvisd(proc)


@pytest.fixture(scope="session")
def base_url(service: dict) -> str:
    return service["base_url"]


@pytest.fixture(scope="session")
def ws_base(base_url: str) -> str:
    return base_url.replace("http://", "ws://") + "/ws"


# --------------------------------------------------------------------------- audio

def say_to_pcm16k(text: str) -> bytes:
    tmp_dir = tempfile.mkdtemp(prefix="jarvisd-itest-say-")
    try:
        aiff = os.path.join(tmp_dir, "speech.aiff")
        raw = os.path.join(tmp_dir, "speech16.raw")
        subprocess.run([SAY_BIN, "-o", aiff, text], check=True, capture_output=True, timeout=30)
        subprocess.run(
            [FFMPEG_BIN, "-y", "-i", aiff, "-ar", "16000", "-ac", "1", "-f", "s16le", raw],
            check=True,
            capture_output=True,
            timeout=30,
        )
        with open(raw, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.fixture(scope="session")
def utterance_pcm() -> bytes:
    if not HAVE_SAY_TOOLS:
        pytest.skip("macOS `say` and/or ffmpeg not available")
    return say_to_pcm16k("what time is it right now")


def pcm_chunks(pcm: bytes, chunk_ms: int = 40, sample_rate: int = 16000):
    n = int(sample_rate * chunk_ms / 1000) * 2  # s16le mono
    for i in range(0, len(pcm), n):
        yield pcm[i : i + n]


# --------------------------------------------------------------------------- honesty guard

# Forward-looking language that's fine even though it contains a completion-shaped word
# ("...I'll let you know once the task is *complete*" is NOT a completion claim).
_FUTURE_MARKERS = (
    "once", "when", "as soon as", "i'll let you know", "will let you know",
    "i will let you know", "let you know once", "let you know when",
)
_COMPLETION_PATTERNS = [
    re.compile(p)
    for p in (
        r"i'?ve created", r"i have created", r"i created the file",
        r"already (created|done|finished)", r"task is (done|complete)\b",
        r"is now complete\b", r"successfully created", r"file has been created",
        r"i finished\b", r"i did it\b", r"all done\b", r"done!", r"task complete\b",
        r"has been (created|written|saved|completed)",
    )
]
_GUARD_WINDOW = 24  # chars of preceding context checked for a future/conditional marker


def claims_false_completion(text: str) -> bool:
    """True if `text` asserts (past tense / declaratively) that delegated work is
    already finished -- as opposed to merely mentioning completion in a forward-looking
    way ("I'll tell you once it's done"). Used to catch the mediator claiming work is
    done when delegate_task only ever STARTS it (docs/SPEC.md §Meta-tools)."""
    lowered = text.lower()
    for pat in _COMPLETION_PATTERNS:
        for m in pat.finditer(lowered):
            start = max(0, m.start() - _GUARD_WINDOW)
            context = lowered[start : m.start()]
            if any(marker in context for marker in _FUTURE_MARKERS):
                continue
            return True
    return False
