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
    assert "delegate_task" in names and len(names) == 6
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
