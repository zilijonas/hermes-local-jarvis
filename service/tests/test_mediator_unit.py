"""Deterministic unit tests for mediator text-handling — no model, no network."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jarvisd.mediator.loop import Mediator


def _mock_mediator(think: bool, captured: list) -> Mediator:
    """A Mediator whose httpx client is wired to a MockTransport that records
    every outgoing request body into *captured* and answers with one done=true
    NDJSON line, mirroring Ollama's /api/chat streaming shape."""

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        body = json.dumps({"message": {"role": "assistant", "content": "hi"},
                            "done": True, "done_reason": "stop"}) + "\n"
        return httpx.Response(200, content=body.encode())

    m = Mediator(ollama_url="http://127.0.0.1:11434", model="gemma4:e4b-it-qat",
                 think=think)
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return m


# ---------------------------------------------------------------------------
# Gemma4 thinking-off wiring (2026-08-02 fix): the mediator must send a
# top-level "think" field on every /api/chat call — nested inside "options"
# is a documented Ollama no-op (ollama#14820), and omitting it entirely lets
# Gemma spend num_predict on hidden reasoning instead of the spoken reply
# (verified live: content comes back "" under a tight budget without it).
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_payload_sends_think_false_by_default():
    captured: list = []
    m = _mock_mediator(think=False, captured=captured)
    async for _ in m._stream([{"role": "user", "content": "hi"}], cancel=asyncio.Event()):
        pass
    assert len(captured) == 1
    payload = captured[0]
    assert payload["think"] is False
    # Must be top-level, not nested — that shape is the Ollama no-op.
    assert "think" not in payload.get("options", {})


@pytest.mark.asyncio
async def test_stream_payload_think_true_when_opted_in():
    captured: list = []
    m = _mock_mediator(think=True, captured=captured)
    async for _ in m._stream([{"role": "user", "content": "hi"}], cancel=asyncio.Event()):
        pass
    assert captured[0]["think"] is True


@pytest.mark.asyncio
async def test_warmup_payload_sends_think():
    captured: list = []
    m = _mock_mediator(think=False, captured=captured)
    ok = await m.warmup()
    assert ok is True
    assert captured[0]["think"] is False


def test_speakable_prefix_leading_json():
    # A pure tool call → nothing speakable (it must be executed, not voiced).
    assert Mediator._speakable_prefix('{"tool": "quick_action", "args": {}}') == ""
    assert Mediator._speakable_prefix('  {"tool":"x"}') == ""


def test_speakable_prefix_trailing_json_is_stripped():
    # The JSON-leak bug: prose THEN a tool line. Only the prose may be spoken.
    buf = 'I\'m doing great, thanks!\n{"tool": "quick_action", "args": {"action_id": "x"}}'
    assert Mediator._speakable_prefix(buf) == "I'm doing great, thanks!"


def test_speakable_prefix_plain_text_untouched():
    buf = "All systems are running. Nothing in flight right now."
    assert Mediator._speakable_prefix(buf) == buf


def test_speakable_prefix_partial_json_during_stream():
    # Mid-stream a half-emitted tool line must not leak either.
    buf = "Sure thing.\n{\"tool\": \"quick_ac"
    assert Mediator._speakable_prefix(buf) == "Sure thing."


def test_parse_tool_valid_and_invalid():
    assert Mediator._parse_tool('{"tool":"memory_recall","args":{"query":"x"}}') == (
        "memory_recall", {"query": "x"})
    assert Mediator._parse_tool('{"tool":"not_a_tool","args":{}}') is None
    assert Mediator._parse_tool("not json") is None


# ---------------------------------------------------------------------------
# Native tool-schema path (2026-08-30). gpt-oss-20b puts calls on its own tool
# channel; under the JSON-line protocol it returned EMPTY replies (3/10 on the
# routing suite vs 8/10 with real schemas). These lock in the two things that
# made it work: schemas are actually sent, and a native call is re-emitted as
# the same JSON line the rest of the loop already understands.
# ---------------------------------------------------------------------------

def _native_mediator(handler):
    m = Mediator(ollama_url="http://127.0.0.1:8090", model="gpt-oss-20b-mxfp4",
                 native=True)
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return m


def _sse(*chunks: dict) -> bytes:
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks)
    return (body + "data: [DONE]\n\n").encode()


@pytest.mark.asyncio
async def test_native_stream_posts_tool_schemas_to_v1():
    captured: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append((str(request.url), json.loads(request.content)))
        return httpx.Response(200, content=_sse(
            {"choices": [{"delta": {"content": "Hello."}}]}))

    m = _native_mediator(handler)
    out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}],
                                              asyncio.Event())])
    url, body = captured[0]
    assert url.endswith("/v1/chat/completions")          # not /api/chat
    names = [t["function"]["name"] for t in body["tools"]]
    assert "delegate_task" in names and "deep_answer" in names and "set_reminder" in names and len(names) == 8
    assert "think" not in body                            # Ollama-only field
    assert out == "Hello."


@pytest.mark.asyncio
async def test_native_tool_call_is_reemitted_as_json_line():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_sse(
            {"choices": [{"delta": {"tool_calls": [
                {"function": {"name": "quick_action", "arguments": '{"action_'}}]}}]},
            {"choices": [{"delta": {"tool_calls": [
                {"function": {"arguments": 'id": "time.now"}'}}]}}]}))

    m = _native_mediator(handler)
    out = "".join([d async for d in m._stream([{"role": "user", "content": "time?"}],
                                              asyncio.Event())])
    # Split across deltas, so it must be reassembled before parsing.
    assert Mediator._parse_tool(out) == ("quick_action", {"action_id": "time.now"})
    assert Mediator._speakable_prefix(out) == ""          # never spoken aloud


@pytest.mark.asyncio
async def test_native_reasoning_deltas_are_never_spoken():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_sse(
            {"choices": [{"delta": {"reasoning_content": "The user wants the time."}}]},
            {"choices": [{"delta": {"content": "It's half past four."}}]}))

    m = _native_mediator(handler)
    out = "".join([d async for d in m._stream([{"role": "user", "content": "time?"}],
                                              asyncio.Event())])
    assert out == "It's half past four."


@pytest.mark.asyncio
async def test_native_prose_then_tool_call_keeps_json_off_the_speaker():
    """A turn that speaks AND calls: the JSON must land on its own line, or
    _speakable_prefix (which splits on a `{` at line start) would voice it."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_sse(
            {"choices": [{"delta": {"content": "One sec."}}]},
            {"choices": [{"delta": {"tool_calls": [
                {"function": {"name": "memory_recall",
                              "arguments": '{"query": "bot"}'}}]}}]}))

    m = _native_mediator(handler)
    out = "".join([d async for d in m._stream([{"role": "user", "content": "x"}],
                                              asyncio.Event())])
    assert Mediator._speakable_prefix(out) == "One sec."


# ---------------------------------------------------------------------------
# Lost-train-of-thought apology: the three-way distinction (2026-09-29).
#
# Turn t670161197 in jarvis.db fired the "Sorry, I lost my train of thought"
# fallback on a legitimate slow-but-valid stream: ms_total=29168.7, two
# memory_recall hops succeeded, but the final post-tool hop yielded no deltas
# before the hop budget ran out. The user heard an ack ("Let me check.") and
# then the apology -- the assistant contradicting itself.
#
# Three cases we now distinguish:
#   (a) slow-but-valid: any prior hop produced a delta (so the partial / ack
#       was already on the speaker). NO apology. outcome="slow_stream".
#   (b) parse-error: malformed tool line the retry couldn't fix. Short
#       apology already in the loop. Plus a structured mediator.event.
#   (c) genuine empty abort: nothing came back at all. Existing fallback
#       apology. outcome="empty_abort".
# ---------------------------------------------------------------------------

def _ollama_lines(*contents: str) -> bytes:
    """Build an Ollama /api/chat NDJSON response. Each content is the value
    of `message.content` on one streamed chunk; "" emits a yielded-empty hop."""
    out = []
    for c in contents:
        out.append(json.dumps({"message": {"role": "assistant", "content": c},
                               "done": False}) + "\n")
    out.append(json.dumps({"message": {"role": "assistant", "content": ""},
                           "done": True, "done_reason": "stop"}) + "\n")
    return "".join(out).encode()


def _ollama_mediator(handler):
    m = Mediator(ollama_url="http://127.0.0.1:11434", model="gemma4:e4b-it-qat",
                 think=False)
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return m


async def _no_tool(name, args):
    return {"result": "stub"}


def _collect_delta_deltas(m, on_delta, on_event=None, user_text="hi"):
    """Run a turn and collect (kind, payload) from on_event and (text,) from
    on_delta. Returns the dict the mediator returns."""
    deltas: list[str] = []
    events: list[tuple[str, dict]] = []

    def _d(t: str) -> None:
        on_delta(t)
        deltas.append(t)

    def _e(k: str, p: dict) -> None:
        events.append((k, p))

    res = asyncio.get_event_loop().run_until_complete(
        m.turn(user_text, tools=_no_tool, on_delta=_d,
               on_tool=lambda *a: None, cancel=asyncio.Event(),
               on_event=_e))
    return res, deltas, events


@pytest.mark.asyncio
async def test_slow_but_valid_mediator_stream_keeps_real_reply():
    """Case (a) — the regression for t670161197.

    A stream where the first hop yields a tool call (so a tool ack / partial
    already went to the speaker) but the post-tool hop yields nothing must
    NOT fire the "lost my train of thought" apology. The prior partial IS
    the real reply; appending the apology would contradict it.
    """
    # MockTransport is sync, but the loop sees each handler call as one /api/chat
    # request -- the first gets a tool line, the rest get empty. That gives us:
    #   hop 1: tool_call -> parse_tool succeeds -> continue (tool hops)
    #   hop 2..N: empty -> no deltas -> break -> empty retry path -> apology
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(200, content=_ollama_lines(
                '{"tool": "memory_recall", "args": {"query": "x"}}'))
        # Every subsequent hop (post-tool AND the retry): empty content.
        return httpx.Response(200, content=_ollama_lines(""))

    m = _ollama_mediator(handler)
    deltas: list[str] = []
    events: list[tuple[str, dict]] = []

    def _d(t: str) -> None:
        deltas.append(t)

    def _e(k: str, p: dict) -> None:
        events.append((k, p))

    res = await m.turn("hi", tools=_no_tool, on_delta=_d,
                       on_tool=lambda *a: None, cancel=asyncio.Event(),
                       on_event=_e)

    # The bug: pre-fix this fired the apology. The fix: NO apology at all
    # when a prior delta already went to the speaker.
    spoken = "".join(deltas)
    assert "lost my train of thought" not in spoken, (
        f"Apology fired on a slow-but-valid stream. deltas={deltas!r}")
    assert res["outcome"] == "slow_stream", res
    assert res["text"] == "", res
    assert res["ms_first_token"] > 0       # we DID get a token at hop 1
    assert len(res["tool_calls"]) >= 1     # the memory_recall ran

    # Structured event for postmortem ("which class of failure was this?").
    kinds = [k for k, _ in events]
    assert "slow_stream" in kinds, events
    ev = next(p for k, p in events if k == "slow_stream")
    assert ev["type"] == "slow_stream"
    assert ev["tool_calls"] >= 1
    assert ev["first_token_ms"] > 0


@pytest.mark.asyncio
async def test_parse_error_fires_short_apology_and_structured_event():
    """Case (b) — malformed tool line, retry exhausted.

    The first malformed JSON line triggers the grammar-constrained retry.
    A second malformed JSON line triggers the "Sorry, I got confused"
    apology AND a parse_error mediator.event so the three-way distinction
    is queryable from turn_events post-hoc.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        # Two malformed JSON lines. The mediator will retry once (parse-retry
        # path), get malformed again, then break out with the apology.
        return httpx.Response(200, content=_ollama_lines(
            '{"tool": "memory_recall", "args": INVALID_JSON}',
            '{"tool": "memory_recall", "args": STILL_INVALID}'))

    m = _ollama_mediator(handler)
    deltas: list[str] = []
    events: list[tuple[str, dict]] = []

    def _d(t: str) -> None:
        deltas.append(t)

    def _e(k: str, p: dict) -> None:
        events.append((k, p))

    res = await m.turn("hi", tools=_no_tool, on_delta=_d,
                       on_tool=lambda *a: None, cancel=asyncio.Event(),
                       on_event=_e)

    spoken = "".join(deltas)
    assert "got confused with a tool call" in spoken
    assert "lost my train of thought" not in spoken, (
        f"empty_abort apology fired when we meant parse_error. deltas={deltas!r}")
    assert res["text"].startswith("Sorry, I got confused")
    # The empty-abort branch never runs because spoken is non-empty after
    # the parse_error path. outcome stays "ok" (the apology is the reply).
    assert res["outcome"] == "ok", res

    kinds = [k for k, _ in events]
    assert "parse_error" in kinds, events
    ev = next(p for k, p in events if k == "parse_error")
    assert ev["type"] == "parse_error"


@pytest.mark.asyncio
async def test_genuine_empty_abort_keeps_fallback_apology():
    """Case (c) — nothing came back at all across the whole turn.

    No deltas, no tools, no cancel. Keep "Sorry, I lost my train of thought"
    as the existing fallback so the user always hears something.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        # Every hop (including the retry): no content at all.
        return httpx.Response(200, content=_ollama_lines(""))

    m = _ollama_mediator(handler)
    deltas: list[str] = []
    events: list[tuple[str, dict]] = []

    def _d(t: str) -> None:
        deltas.append(t)

    def _e(k: str, p: dict) -> None:
        events.append((k, p))

    res = await m.turn("hi", tools=_no_tool, on_delta=_d,
                       on_tool=lambda *a: None, cancel=asyncio.Event(),
                       on_event=_e)

    spoken = "".join(deltas)
    assert "lost my train of thought" in spoken
    assert res["text"].startswith("Sorry, I lost my train of thought")
    assert res["outcome"] == "empty_abort", res
    assert res["ms_first_token"] == 0      # never saw a token

    kinds = [k for k, _ in events]
    assert "empty_abort" in kinds, events
    ev = next(p for k, p in events if k == "empty_abort")
    assert ev["type"] == "empty_abort"


@pytest.mark.asyncio
async def test_outcome_is_ok_for_normal_text_reply():
    """Sanity check: a clean text reply yields outcome="ok" and no events."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_ollama_lines("All systems normal."))

    m = _ollama_mediator(handler)
    deltas: list[str] = []
    events: list[tuple[str, dict]] = []

    def _d(t: str) -> None:
        deltas.append(t)

    def _e(k: str, p: dict) -> None:
        events.append((k, p))

    res = await m.turn("hi", tools=_no_tool, on_delta=_d,
                       on_tool=lambda *a: None, cancel=asyncio.Event(),
                       on_event=_e)

    assert "".join(deltas) == "All systems normal."
    assert res["text"] == "All systems normal."
    assert res["outcome"] == "ok"
    assert events == []     # no failure-class events on a clean reply
