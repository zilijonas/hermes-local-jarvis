"""Integration + hardening tests for jarvisd (docs/SPEC.md §WebSocket, §Meta-tools,
§Worker execution, §Latency targets).

Targets the live LaunchAgent-managed jarvisd on 127.0.0.1:9140 when healthy; otherwise
spins up a throwaway full-pipeline instance (see integration_conftest.service). Run:

    service/.venv/bin/python -m pytest service/tests/test_integration.py -m integration -v

IMPORTANT — a load-bearing product bug affects most of the WebSocket-driven scenarios
below (tests 1, 2 and half of 7): `service/jarvisd/ws.py` dispatches client WS frames by
calling `pipeline.handle_audio_chunk(...)` (binary frames, ws.py:59) and looking up
`pipeline.handle_client_event` (JSON frames, ws.py:79), but `jarvisd/pipeline.py`'s
`Pipeline` class defines neither method (only `mic_start`/`mic_stop`/`feed_audio`/
`barge_in`/`run_turn`). Concretely, against the live service right now:
  - `{"t":"mic.start"}` (and mic.stop/barge_in/turn.text/task.control) is a silent no-op
    (`getattr(pipeline, "handle_client_event", None)` -> None -> nothing happens).
  - any binary (mic PCM) frame raises `AttributeError: 'Pipeline' object has no
    attribute 'handle_audio_chunk'` inside `ws.py:59`, which kills that connection
    (confirmed via the server's own error log; verified `/health` stays ok afterwards --
    it's a per-connection crash, not a process crash).
Tests 1/2 are kept written to the true SPEC contract (so they start passing the moment
this is fixed) and are EXPECTED TO FAIL until then. Test 7 splits cleanly: the malformed
*text* frame half passes today; the oversized *binary* frame half fails for the same
reason. Tests 3/4/5/6 test mediator/meta-tool/worker behavior that SPEC documents as
identical over `/converse` ("same as /converse but streamed events") and that HTTP path
does not go through the broken glue, so they exercise the real underlying logic instead
of being blocked by the same single root cause three more times.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import time
from pathlib import Path

import pytest

import jarvisd.workers.manager as worker_manager_mod

from integration_conftest import (  # noqa: F401  (fixtures used via pytest injection)
    HOST,
    PIPELINE_READY_TIMEOUT_S,
    VENV_PYTHON,
    base_url,
    claims_false_completion,
    find_free_port,
    find_new_task,
    health,
    http_get_json,
    http_post_json,
    ollama_reachable,
    pcm_chunks,
    pid_alive,
    poll_task,
    service,
    snapshot_task_ids,
    spawn_jarvisd,
    stop_jarvisd,
    utterance_pcm,
    wait_for_health,
    ws_base,
)

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None

pytestmark = pytest.mark.integration


# =============================================================================
# 1. WS voice loop: mic.start -> stream PCM -> mic.stop -> stt.final -> thinking ->
#    mediator.done -> tts binary frames -> idle.
# =============================================================================


@pytest.mark.asyncio
async def test_ws_voice_loop_full_duplex(base_url, ws_base, utterance_pcm):
    if websockets is None:
        pytest.skip("websockets package not installed")

    events: list[dict] = []
    tts_binary_count = 0
    first_binary_at = None
    got_stt_final = got_mediator_done = False

    async with websockets.connect(ws_base, open_timeout=10, max_size=2**21) as ws:
        await ws.send(json.dumps({"t": "mic.start"}))
        for chunk in pcm_chunks(utterance_pcm, chunk_ms=40):
            await ws.send(chunk)
            await asyncio.sleep(0.02)
        t_mic_stop = time.monotonic()
        await ws.send(json.dumps({"t": "mic.stop"}))

        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            if isinstance(msg, (bytes, bytearray)):
                tts_binary_count += 1
                if first_binary_at is None:
                    first_binary_at = time.monotonic()
                continue
            ev = json.loads(msg)
            events.append(ev)
            if ev.get("t") == "stt.final":
                got_stt_final = True
            elif ev.get("t") == "mediator.done":
                got_mediator_done = True
            elif ev.get("t") == "state" and ev.get("value") == "idle" and got_mediator_done:
                break

    types_seen = [e.get("t") for e in events]
    state_values = [e.get("value") for e in events if e.get("t") == "state"]

    assert got_stt_final, f"never saw stt.final; event types={types_seen}"
    stt_final_ev = next(e for e in events if e.get("t") == "stt.final")
    assert stt_final_ev.get("text", "").strip(), "stt.final carried empty text"

    assert "thinking" in state_values, f"never entered 'thinking' state; states={state_values}"
    assert got_mediator_done, f"never saw mediator.done; event types={types_seen}"
    assert any(e.get("t") == "tts.chunk_hdr" for e in events), "no tts.chunk_hdr before tts audio"
    assert tts_binary_count >= 1, "no binary tts audio frames received"
    assert "idle" in state_values, f"never returned to idle; states={state_values}"

    if first_binary_at is not None:
        e2e_ms = (first_binary_at - t_mic_stop) * 1000
        print(f"\n[measured] mic.stop -> first tts binary frame: {e2e_ms:.0f} ms")


# =============================================================================
# 2. Barge-in: /say a long announcement, then WS {"t":"barge_in"} should produce
#    tts.end within 500ms and state interrupted/idle. /health must stay ok regardless.
# =============================================================================


@pytest.mark.asyncio
async def test_barge_in_stops_speech_within_500ms(base_url, ws_base):
    if websockets is None:
        pytest.skip("websockets package not installed")

    long_text = "This is a long announcement made purely to keep speech going. " * 8
    say_task = None

    try:
        async with websockets.connect(ws_base, open_timeout=10) as ws:
            # Round-trip a ping first so we know the server has already subscribed us to
            # the bus (ws.py subscribes before entering its message loop) before we kick
            # off /say -- otherwise a state=speaking event published between our socket
            # connecting and the subscribe() call landing would be silently missed
            # (EventBus.publish only fans out to currently-subscribed queues).
            await ws.send(json.dumps({"t": "ping"}))
            await asyncio.wait_for(ws.recv(), timeout=5.0)

            say_task = asyncio.create_task(
                asyncio.to_thread(http_post_json, f"{base_url}/say", {"text": long_text, "interrupt": False}, 60.0)
            )

            deadline = time.monotonic() + 10.0
            speaking_seen = False
            while time.monotonic() < deadline:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                if isinstance(msg, (bytes, bytearray)):
                    continue
                ev = json.loads(msg)
                if ev.get("t") == "state" and ev.get("value") == "speaking":
                    speaking_seen = True
                    break
            assert speaking_seen, "never observed state=speaking after POST /say"

            t_barge = time.monotonic()
            await ws.send(json.dumps({"t": "barge_in"}))

            got_tts_end = False
            final_state = None
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=max(0.01, deadline - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                if isinstance(msg, (bytes, bytearray)):
                    continue
                ev = json.loads(msg)
                if ev.get("t") == "tts.end":
                    got_tts_end = True
                if ev.get("t") == "state":
                    final_state = ev.get("value")

            elapsed_ms = (time.monotonic() - t_barge) * 1000
            assert got_tts_end, f"no tts.end within 500ms of barge_in (waited {elapsed_ms:.0f}ms)"
            assert final_state in ("interrupted", "idle"), f"unexpected final state after barge-in: {final_state}"
    finally:
        # Best-effort drain so the (likely still-speaking, given the bug) announcement
        # doesn't bleed timing/state into whichever test runs next. Deliberately doesn't
        # assert here: if the block above already failed, we want THAT assertion surfaced,
        # not a finally-block failure masking it.
        if say_task is not None:
            try:
                await asyncio.wait_for(say_task, timeout=30.0)
            except Exception:
                say_task.cancel()
        health_after = health(base_url)
        if not (health_after and health_after.get("ok")):
            print(f"\n[warning] health degraded after barge-in attempt: {health_after}")

    assert health_after and health_after.get("ok"), "health degraded after barge-in attempt"


# =============================================================================
# 3. Typed turn quick action ("what time is it?").
# SPEC: turn.text is "the same as /converse but streamed events" -- routed via the HTTP
# twin since WS turn.text dispatch is currently a no-op (see module docstring).
# =============================================================================


def test_typed_turn_quick_action_time(base_url):
    code, body = http_post_json(f"{base_url}/converse", {"text": "what time is it?"}, timeout=90.0)
    assert code == 200, body
    reply = body.get("reply_text", "")
    actions = body.get("actions", [])

    assert reply.strip(), "empty reply"
    assert len(actions) <= 3, f"too many tool hops for a simple time question: {actions}"
    assert not actions or "quick_action" in actions, f"unexpected non-quick_action tool use: {actions}"
    assert not claims_false_completion(reply), f"unexpected completion-claim language: {reply!r}"

    hours = [int(n) for n in re.findall(r"\b(\d{1,2})\b", reply)]
    assert any(0 <= n <= 23 for n in hours), f"reply doesn't mention a plausible hour: {reply!r}"


# =============================================================================
# 4. Memory turn: expect memory_recall meta-tool + non-empty honest reply.
# =============================================================================


def test_typed_turn_memory_recall(base_url):
    text = "what do you know about the hermes gateway staleness problem"
    code, body = http_post_json(f"{base_url}/converse", {"text": text}, timeout=90.0)
    assert code == 200, body
    reply = body.get("reply_text", "")
    actions = body.get("actions", [])

    assert reply.strip(), "empty reply"
    assert "memory_recall" in actions, f"expected memory_recall meta-tool, got actions={actions}"
    assert len(actions) <= 3, f"too many tool hops: {actions}"

    lowered = reply.lower()
    assert "i delegated" not in lowered, f"hallucinated delegation on a memory-only turn: {reply!r}"
    assert not claims_false_completion(reply), f"unexpected completion-claim language: {reply!r}"


# =============================================================================
# 5. Delegation honest-start: delegate_task must only ever START work; the reply must
# not claim completion; the task must actually reach done with the real artifact.
# =============================================================================


def test_delegation_honest_start_then_completes(base_url):
    marker_path = "/tmp/jarvis-itest.txt"
    if os.path.exists(marker_path):
        os.remove(marker_path)
    text = f"create a file {marker_path} with content itest-ok"

    try:
        before_ids = snapshot_task_ids(base_url)
        code, body = http_post_json(f"{base_url}/converse", {"text": text}, timeout=90.0)
        assert code == 200, body
        reply = body.get("reply_text", "")
        actions = body.get("actions", [])

        assert "delegate_task" in actions, f"expected delegate_task meta-tool, got actions={actions}"
        assert len(actions) <= 3, f"too many tool hops: {actions}"
        assert not claims_false_completion(reply), (
            f"reply claims completion before the task actually finished: {reply!r}"
        )

        # NB: matching by a marker substring in the task's `goal` field is unreliable --
        # the mediator paraphrases/summarizes when it constructs the delegate_task tool
        # call, it doesn't echo the user's literal text (see find_new_task's docstring
        # and the written report). Diff task IDs before/after instead.
        task_id = find_new_task(base_url, before_ids)["id"]

        final = poll_task(base_url, task_id, timeout_s=120.0)
        assert final["status"] == "done", f"task did not complete cleanly: {final}"
        assert os.path.exists(marker_path), "worker reported done but did not create the file"
        content = Path(marker_path).read_text()
        assert "itest-ok" in content, f"unexpected file content: {content!r}"
    finally:
        if os.path.exists(marker_path):
            os.remove(marker_path)


# =============================================================================
# 6. Task control: delegate a slow task, wait for it to be running, cancel it via HTTP,
# assert it settles to canceled and the worker process is actually gone.
# =============================================================================


def test_task_control_cancel_running_task(base_url):
    goal = "run `sleep 20` in the terminal, then say finished"
    before_ids = snapshot_task_ids(base_url)
    code, body = http_post_json(f"{base_url}/converse", {"text": goal}, timeout=90.0)
    assert code == 200, body
    actions = body.get("actions", [])
    assert "delegate_task" in actions, f"expected delegate_task, got actions={actions}"

    task_id = find_new_task(base_url, before_ids)["id"]

    deadline = time.monotonic() + 30.0
    status = pid = None
    while time.monotonic() < deadline:
        t = http_get_json(f"{base_url}/tasks/{task_id}")
        status, pid = t["status"], t.get("pid")
        if status == "running" and pid:
            break
        if status in ("done", "failed", "needs_review", "canceled"):
            break
        time.sleep(1.0)
    assert status == "running" and pid, f"task never reached running with a pid: status={status} pid={pid}"

    code, body = http_post_json(f"{base_url}/tasks/{task_id}/control", {"action": "cancel"}, timeout=15.0)
    assert code == 200, body
    assert body.get("status") == "canceled", body

    # NB: the DB row flips to "canceled" synchronously inside the control() handler,
    # *before* the OS process has necessarily reacted to the SIGTERM manager.py just sent
    # it (workers/manager.py's cancel path is SIGCONT-then-SIGTERM with no forced SIGKILL
    # escalation if that's ignored/slow) -- so "status settled" and "pid actually gone"
    # are two different events with their own grace periods; check each on its own clock.
    deadline = time.monotonic() + 5.0
    final_status = body.get("status")
    while time.monotonic() < deadline:
        t = http_get_json(f"{base_url}/tasks/{task_id}")
        final_status = t["status"]
        if final_status == "canceled":
            break
        time.sleep(0.5)
    assert final_status == "canceled", f"status did not settle to canceled within 5s: {final_status}"

    pid_deadline = time.monotonic() + 10.0
    still_alive = pid_alive(pid)
    while still_alive and time.monotonic() < pid_deadline:
        time.sleep(0.5)
        still_alive = pid_alive(pid)
    assert not still_alive, (
        f"worker pid {pid} still alive 10s after cancel -- workers/manager.py's cancel path "
        f"(WorkerManager.control, SIGCONT+SIGTERM, no SIGKILL escalation) may not reliably "
        f"terminate the worker"
    )


# =============================================================================
# 7. Malformed WS frames: connection must survive a corrupt JSON text frame AND an
# oversized (1MB) binary frame while idle. /health must stay ok afterwards.
# =============================================================================


@pytest.mark.asyncio
async def test_malformed_ws_frames_dont_kill_connection(base_url, ws_base):
    if websockets is None:
        pytest.skip("websockets package not installed")

    async with websockets.connect(ws_base, open_timeout=10, max_size=2**21) as ws:
        # -- corrupt JSON text frame: ws.py already catches this explicitly (ws.py:66-69)
        await ws.send("{not valid json")
        msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
        ev = json.loads(msg)
        assert ev.get("t") == "error"
        assert ev.get("recoverable") is True

        await ws.send(json.dumps({"t": "ping"}))
        pong = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert json.loads(pong) == {"t": "pong"}

        # -- oversized binary frame while idle: goes through the SAME broken glue as
        # test_ws_voice_loop_full_duplex (ws.py:59 -> pipeline.handle_audio_chunk, which
        # doesn't exist) -- expected to raise ConnectionClosed here until that's fixed.
        oversized = b"\x00" * (1024 * 1024)
        await ws.send(oversized)
        await ws.send(json.dumps({"t": "ping"}))
        pong2 = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert json.loads(pong2) == {"t": "pong"}, "connection should survive an oversized binary frame"

    h = health(base_url)
    assert h and h.get("ok"), "health degraded after malformed-frame test"


# =============================================================================
# 8. Restart recovery: only ever against a dedicated, throwaway instance -- never the
# live LaunchAgent-managed jarvisd (killing -9 that would disrupt the real assistant and
# race its KeepAlive auto-restart).
#
# Note on method: manager.reconcile_on_boot() checks liveness of the TASK's own recorded
# `pid` (the delegated worker subprocess, launched with start_new_session=True -- its own
# process session, independent of jarvisd's), not jarvisd's pid. Killing only the
# jarvisd process leaves that worker subprocess running as an orphan (still alive), which
# reconcile_on_boot would then correctly leave alone (not "orphaned" by its own
# definition) -- so this test kills jarvisd's process FIRST (stopping its executor thread
# from reacting to the worker's eventual exit and marking the task normally) and THEN
# kills the worker's own pid (guaranteeing it's actually gone by the time we restart),
# which is what actually exercises the "orphaned PID -> needs_review" path the SPEC and
# manager.py's own docstring describe.
# =============================================================================


def test_restart_recovery_reconciles_orphaned_task():
    if not VENV_PYTHON.exists():
        pytest.skip("no venv python available to spin up a dedicated instance")
    if not ollama_reachable():
        pytest.skip("Ollama unreachable -- a dedicated instance could never become healthy")

    port = find_free_port(9151)
    proc = spawn_jarvisd(port, log_tag="restart-recovery")
    base = f"http://{HOST}:{port}"
    try:
        wait_for_health(base, timeout_s=PIPELINE_READY_TIMEOUT_S)

        goal = "run `sleep 25` in the terminal"
        before_ids = snapshot_task_ids(base)
        code, body = http_post_json(f"{base}/converse", {"text": goal}, timeout=90.0)
        assert code == 200, body
        assert "delegate_task" in body.get("actions", []), body

        task_id = find_new_task(base, before_ids)["id"]

        deadline = time.monotonic() + 30.0
        worker_pid = None
        while time.monotonic() < deadline:
            t = http_get_json(f"{base}/tasks/{task_id}")
            if t["status"] == "running" and t.get("pid"):
                worker_pid = t["pid"]
                break
            time.sleep(1.0)
        assert worker_pid, "task never reached running with a worker pid"

        # jarvisd first (stops it reacting to the worker's death), then the worker.
        os.kill(proc.pid, signal.SIGKILL)
        proc.wait(timeout=10)
        assert proc.poll() is not None
        try:
            os.kill(worker_pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

        proc = spawn_jarvisd(port, log_tag="restart-recovery-reboot")
        wait_for_health(base, timeout_s=PIPELINE_READY_TIMEOUT_S)

        t = http_get_json(f"{base}/tasks/{task_id}")
        assert t["status"] == "needs_review", f"expected needs_review after reconcile_on_boot, got {t}"

        listing = http_get_json(f"{base}/tasks?limit=20")["tasks"]
        assert any(x["id"] == task_id and x["status"] == "needs_review" for x in listing)
    finally:
        stop_jarvisd(proc)


# =============================================================================
# 9. Secret redaction guard: delegated worker env-building must strip API_KEY/TOKEN/
# SECRET-shaped vars. Pure unit-level -- no running service needed.
# =============================================================================


def _build_worker_env(source_env: dict) -> dict:
    """Verbatim regex from jarvisd/workers/manager.py:141 (_run_granite), extracted here
    since that filter is inlined rather than a standalone helper we could import."""
    return {k: v for k, v in source_env.items() if not re.search(r"(API_KEY|TOKEN|SECRET)", k)}


def test_worker_env_strips_secret_like_vars(monkeypatch):
    monkeypatch.setenv("FAKE_API_KEY", "shh-do-not-leak")
    monkeypatch.setenv("SOME_TOKEN", "shh2")
    monkeypatch.setenv("MY_SECRET_VALUE", "shh3")
    monkeypatch.setenv("HARMLESS_VAR", "fine")

    env = _build_worker_env(dict(os.environ))
    assert "FAKE_API_KEY" not in env
    assert "SOME_TOKEN" not in env
    assert "MY_SECRET_VALUE" not in env
    assert env.get("HARMLESS_VAR") == "fine"

    # Grep-guard: if the real filter's shape ever changes, fail loudly instead of
    # silently testing a stale copy of the regex.
    manager_src = Path(worker_manager_mod.__file__).read_text()
    assert 'r"(API_KEY|TOKEN|SECRET)"' in manager_src, (
        "the secret-filter regex in jarvisd/workers/manager.py changed shape "
        "-- update _build_worker_env() above to match"
    )

    # Bonus hardening probe (not part of the literal ask): the real regex has no
    # re.IGNORECASE, so a lowercase-named secret is NOT stripped. This documents the gap
    # rather than asserting it away -- see the written report.
    lowercase_leak = _build_worker_env({"api_key": "would-leak-if-lowercase"})
    if "api_key" in lowercase_leak:
        print("\n[finding] lowercase-named secret env vars (e.g. api_key) are NOT "
              "stripped by workers/manager.py's case-sensitive filter")
