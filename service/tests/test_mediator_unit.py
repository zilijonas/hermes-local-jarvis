"""Deterministic unit tests for mediator text-handling — no model, no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jarvisd.mediator.loop import Mediator


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
