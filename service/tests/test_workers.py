"""Unit tests for WorkerManager (SPEC §Worker execution): cloud command
construction, the shared background-task preamble, per-task wall-clock
timeout, cloud->local infra-failure fallback, and speakable-summary
sanitizing. Cloud/codex/claude subprocesses are faked (no real hermes/codex/
claude calls); the timeout test uses a REAL short-lived subprocess so the
actual process-group kill path is exercised end to end.
"""
from __future__ import annotations

import stat
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jarvisd import workers as workers_pkg  # noqa: F401 -- ensures package importable
from jarvisd.workers import manager as manager_mod
from jarvisd.workers.manager import DEFAULT_CLOUD_TOOLSETS, WORKER_PREAMBLE, WorkerManager
from jarvisd.db import Database
from jarvisd.bus import EventBus


class _FakeStdout:
    def __init__(self, text: str = ""):
        self._lines = iter(text.splitlines(keepends=True))

    def readline(self) -> str:
        return next(self._lines, "")

    def close(self) -> None:
        pass


class _FakeProc:
    def __init__(self, text: str = "", pid: int = 4321, returncode: int = 0):
        self.pid = pid
        self.returncode = returncode
        self.stdout = _FakeStdout(text)

    def wait(self) -> None:
        pass

    def poll(self):
        return self.returncode


def _wm(tmp_path, **kwargs):
    db = Database(tmp_path / "jarvis.db")
    bus = EventBus(db)
    kwargs.setdefault("hermes_bin", "/usr/bin/true")
    kwargs.setdefault("worker_home", str(tmp_path / "worker_home"))
    return db, WorkerManager(db, bus, **kwargs)


# ---------------------------------------------------------------------------
# defaults
# ---------------------------------------------------------------------------


def test_default_backend_is_cloud(tmp_path):
    _, wm = _wm(tmp_path)
    assert wm.backend == "cloud"
    assert wm.cloud_toolsets == DEFAULT_CLOUD_TOOLSETS
    assert wm.timeout_s == 900.0


# ---------------------------------------------------------------------------
# _build_prompt / preamble
# ---------------------------------------------------------------------------


def test_build_prompt_includes_preamble_goal_and_context(tmp_path):
    _, wm = _wm(tmp_path)
    prompt = wm._build_prompt({"goal": "check disk space", "context": "user said 'quickly'"})
    assert WORKER_PREAMBLE in prompt
    assert "check disk space" in prompt
    assert "user said 'quickly'" in prompt
    assert "no markdown" in prompt.lower()
    assert "never ask" in prompt.lower()


# ---------------------------------------------------------------------------
# cloud command construction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_cloud_uses_default_profile_broad_toolsets_and_preamble(tmp_path, monkeypatch):
    db, wm = _wm(tmp_path)
    captured = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        return _FakeProc(text="Working on it...\n\nDisk is 61% full, 400GB free.", returncode=0)

    monkeypatch.setattr(manager_mod.subprocess, "Popen", fake_popen)
    task = db.create_task(kind="cloud", goal="check disk space", toolsets="file,terminal")

    await wm._run_cloud(task)

    cmd = captured["cmd"]
    assert cmd[0] == "/usr/bin/true"
    assert cmd[cmd.index("-p") + 1] == "default"
    assert "--ignore-rules" in cmd
    assert "-t" not in cmd  # default: the profile's own toolsets (plugins like mail need that)
    prompt = cmd[cmd.index("-z") + 1]
    assert WORKER_PREAMBLE in prompt
    assert "check disk space" in prompt

    updated = db.get_task(task["id"])
    assert updated["status"] == "done"
    assert "61" in updated["result_summary"] and "400" in updated["result_summary"]


@pytest.mark.asyncio
async def test_run_local_keeps_manifest_toolsets_no_profile_flag_and_uses_worker_home(tmp_path, monkeypatch):
    db, wm = _wm(tmp_path)
    captured = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs.get("env")
        return _FakeProc(text="All done.\n\nEverything looks fine.", returncode=0)

    monkeypatch.setattr(manager_mod.subprocess, "Popen", fake_popen)
    task = db.create_task(kind="local", goal="say hi", toolsets="file")

    await wm._run_local(task)

    cmd = captured["cmd"]
    assert "-p" not in cmd  # no more `-p jarvis-voice` -- the profile is gone
    assert cmd[cmd.index("-t") + 1] == "file"  # manifest's small diet, untouched
    assert captured["env"]["HERMES_HOME"] == wm.worker_home
    updated = db.get_task(task["id"])
    assert updated["status"] == "done"


# ---------------------------------------------------------------------------
# cloud -> local infra-failure fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cloud_infra_failure_falls_back_to_local_once(tmp_path, monkeypatch):
    db, wm = _wm(tmp_path)
    calls = []

    def fake_popen(cmd, **kwargs):
        calls.append(cmd)
        if len(calls) == 1:
            return _FakeProc(text="Error: HTTP 429 rate limited by provider", returncode=1)
        return _FakeProc(text="Fallback run complete.\n\nDisk has 300GB free.", returncode=0)

    monkeypatch.setattr(manager_mod.subprocess, "Popen", fake_popen)
    task = db.create_task(kind="cloud", goal="check disk space", toolsets="file,terminal")

    await wm._run_cloud(task)

    assert len(calls) == 2
    assert "default" in calls[0]         # first attempt: cloud (default profile)
    assert "default" not in calls[1]     # fallback attempt: bare local hermes
    updated = db.get_task(task["id"])
    assert updated["status"] == "done"
    assert "(fell back to local)" in updated["result_summary"]


@pytest.mark.asyncio
async def test_cloud_non_infra_failure_does_not_fall_back(tmp_path, monkeypatch):
    db, wm = _wm(tmp_path)
    calls = []

    def fake_popen(cmd, **kwargs):
        calls.append(cmd)
        return _FakeProc(text="the goal doesn't make sense, refusing", returncode=1)

    monkeypatch.setattr(manager_mod.subprocess, "Popen", fake_popen)
    task = db.create_task(kind="cloud", goal="do something impossible", toolsets="file")

    await wm._run_cloud(task)

    assert len(calls) == 1  # no fallback attempt for a genuine task failure
    updated = db.get_task(task["id"])
    assert updated["status"] == "failed"


@pytest.mark.asyncio
async def test_cloud_missing_hermes_binary_falls_back_to_local(tmp_path, monkeypatch):
    db, wm = _wm(tmp_path, hermes_bin=str(tmp_path / "no-such-hermes-binary"))
    calls = []

    def fake_popen(cmd, **kwargs):
        calls.append(cmd)
        return _FakeProc(text="Fallback ran.\n\nAll good.", returncode=0)

    monkeypatch.setattr(manager_mod.subprocess, "Popen", fake_popen)
    task = db.create_task(kind="cloud", goal="check disk space", toolsets="file")

    await wm._run_cloud(task)

    assert len(calls) == 1  # only the local fallback ever spawns a process
    updated = db.get_task(task["id"])
    assert "(fell back to local)" in updated["result_summary"]


# ---------------------------------------------------------------------------
# per-task wall-clock timeout (real subprocess + real process-group kill)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_task_exceeding_timeout_is_killed_and_marked_failed(tmp_path):
    script = tmp_path / "hangs.sh"
    script.write_text("#!/bin/bash\necho starting\nsleep 30\necho should-not-print\n")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)

    db, wm = _wm(tmp_path, hermes_bin=str(script), timeout_s=0.3)
    task = db.create_task(kind="local", goal="hang forever", toolsets="file")

    t0 = time.monotonic()
    await wm._run_local(task)
    elapsed = time.monotonic() - t0

    assert elapsed < 5.0  # killed well before the script's own 30s sleep
    updated = db.get_task(task["id"])
    assert updated["status"] == "failed"
    assert "time limit" in updated["result_summary"]


# ---------------------------------------------------------------------------
# speakable summary sanitizing
# ---------------------------------------------------------------------------


def test_summarize_prefers_final_paragraph_and_strips_markdown():
    out = (
        "Some intermediate reasoning about the task.\n\n"
        "**Summary:** Disk is `61%` full with 400GB free.\n"
        "- extra bullet\n"
        "# a heading\n"
        "| col1 | col2 |\n"
    )
    text = WorkerManager._summarize(out, "", 0, [])
    assert "**" not in text and "`" not in text and "#" not in text and "|" not in text
    assert "61" in text and "400" in text
    assert "\n" not in text
    assert len(text) <= 400


def test_summarize_nonzero_exit_is_sanitized_and_capped():
    out = "**Traceback** (most recent call last):\n`ValueError: bad thing`"
    text = WorkerManager._summarize(out, "", 1, [])
    assert text.startswith("worker exited 1")
    assert "**" not in text and "`" not in text
    assert len(text) <= 300


def test_summarize_empty_output_flags_for_review():
    text = WorkerManager._summarize("", "", 0, [])
    assert "no output" in text.lower()


def test_signal_tree_kills_grandchildren_in_their_own_session():
    """Regression 2026-09-28: cancel left `sleep 180` grandchildren alive because the
    Hermes terminal tool starts them in a new session (killpg can't reach them)."""
    import signal as _signal
    import subprocess as _sp
    import sys as _sys
    import time as _time

    import psutil

    from jarvisd.workers.manager import _signal_tree

    code = ("import subprocess,time;"
            "subprocess.Popen(['sleep','60'], start_new_session=True);time.sleep(60)")
    parent = _sp.Popen([_sys.executable, "-c", code], start_new_session=True)
    try:
        for _ in range(50):
            kids = psutil.Process(parent.pid).children(recursive=True)
            if kids:
                break
            _time.sleep(0.05)
        assert kids, "grandchild never started"
        grandchild = kids[0].pid
        _signal_tree(parent.pid, _signal.SIGKILL)
        _time.sleep(0.3)
        parent.wait(timeout=5)
        assert not psutil.pid_exists(grandchild) or \
            psutil.Process(grandchild).status() == psutil.STATUS_ZOMBIE
    finally:
        if parent.poll() is None:
            parent.kill()


def test_admitted_failure_is_not_done():
    from jarvisd.workers.manager import _ADMITTED_FAILURE

    assert _ADMITTED_FAILURE.search("I could not find any mail_* tools or configured email accounts.")
    assert _ADMITTED_FAILURE.search("I cannot access Linas's email inbox from this environment.")
    assert not _ADMITTED_FAILURE.search("The current temperature in Vilnius is 11 C.")
    assert not _ADMITTED_FAILURE.search("Done. I couldn't find any duplicates, so nothing changed.")


def test_worker_question_is_extracted():
    from jarvisd.workers.manager import _worker_question

    assert _worker_question("Looked around.\n\nQUESTION: Which folder should I back up?") == \
        "Which folder should I back up?"
    assert _worker_question("**QUESTION:** Which account, persoscan or nimbas?") == \
        "Which account, persoscan or nimbas?"
    assert _worker_question("All done, 3 files moved.") == ""
