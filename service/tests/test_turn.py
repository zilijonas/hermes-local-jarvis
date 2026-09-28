"""Silero + Smart Turn endpointer and the Parakeet STT engine, on real models.

Skipped when the model files are absent (fresh checkout without ~/ai/models)."""
import os
import shutil
import subprocess
import tempfile

import numpy as np
import pytest

from jarvisd.audio.turn import DEFAULT_SILERO, DEFAULT_SMART_TURN, TurnEndpointer, build_endpointer

HAVE_MODELS = os.path.exists(os.path.expanduser(DEFAULT_SILERO)) and \
    os.path.exists(os.path.expanduser(DEFAULT_SMART_TURN))
pytestmark = pytest.mark.skipif(not HAVE_MODELS or shutil.which("say") is None
                                or shutil.which("ffmpeg") is None,
                                reason="needs silero/smart-turn models, say and ffmpeg")


def _say(text: str) -> bytes:
    d = tempfile.mkdtemp()
    try:
        subprocess.run(["say", "-o", f"{d}/a.aiff", text], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{d}/a.aiff", "-ar", "16000",
                        "-ac", "1", "-f", "s16le", f"{d}/a.raw"], check=True)
        return open(f"{d}/a.raw", "rb").read()
    finally:
        shutil.rmtree(d, ignore_errors=True)


def _sil(ms: int) -> bytes:
    return b"\x00\x00" * (16 * ms)


def _run(ep, stream: bytes):
    out = []
    for i in range(0, len(stream), 1280):
        out += [e for e, _ in ep.feed(stream[i:i + 1280]) if e != "chunk"]
    return out


@pytest.fixture(scope="module")
def ep():
    e, label = build_endpointer({})
    assert isinstance(e, TurnEndpointer) and "smart-turn" in label
    return e


def test_complete_sentence_ends_once(ep):
    ep.reset()
    events = _run(ep, _sil(300) + _say("check how much disk space is free on this mac") + _sil(2500))
    assert events.count("speech_start") == 1 and events.count("speech_end") == 1


def test_silence_and_noise_do_not_open_a_turn(ep):
    ep.reset()
    rng = np.random.default_rng(1)
    noise = (rng.normal(0, 300, 16000 * 2)).astype(np.int16).tobytes()
    assert _run(ep, _sil(1000) + noise + _sil(500)) == []


def test_max_pause_closes_even_when_unsure(ep):
    ep.reset()
    ep_events = _run(ep, _sil(200) + _say("so I was thinking about") + _sil(ep.max_pause_ms + 600))
    assert ep_events[-1] == "speech_end"


def test_parakeet_engine_transcribes():
    pytest.importorskip("parakeet_mlx")
    from jarvisd.audio.stt import StreamingSTT

    stt = StreamingSTT(engine="parakeet")
    stt.load()
    text, ms = stt.transcribe_final(_say("what time is it"))
    assert "time" in text.lower(), text
    assert stt.engine_name == "parakeet" and ms < 3000
    assert stt.transcribe_partial(_say("hello there")) is not None
