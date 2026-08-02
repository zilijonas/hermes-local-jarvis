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
