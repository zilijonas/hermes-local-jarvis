"""Tests for jarvisd.audio (VadEndpointer, StreamingSTT, StreamingTTS).

Runnable fully offline/local (no network): speech fixtures are generated
with macOS `say` + `ffmpeg`; whisper/kokoro models are expected to already
be cached/present locally (see repo docs/SPEC.md and the task environment
notes). The whole module is skipped if `say` or `ffmpeg` aren't available.

Run: service/.venv/bin/python -m pytest service/tests/test_audio.py -x
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

# Make `import jarvisd...` work regardless of invocation cwd/rootdir: insert
# service/ (this file's parent's parent) at the front of sys.path.
SERVICE_DIR = Path(__file__).resolve().parent.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from jarvisd.audio.stt import StreamingSTT  # noqa: E402
from jarvisd.audio.tts import StreamingTTS  # noqa: E402
from jarvisd.audio.vad import FRAME_BYTES, VadEndpointer  # noqa: E402

SAY_BIN = "/usr/bin/say"
FFMPEG_BIN = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
_HAVE_SAY_TOOLS = os.path.exists(SAY_BIN) and os.path.exists(FFMPEG_BIN or "")

pytestmark = pytest.mark.skipif(
    not _HAVE_SAY_TOOLS, reason="macOS `say` and/or `ffmpeg` not available"
)

SAY_TEXT = "The quick brown fox jumps over the lazy dog"

KOKORO_MODEL_PATH = os.path.expanduser("~/ai/models/kokoro/kokoro-v1.0.onnx")
KOKORO_VOICES_PATH = os.path.expanduser("~/ai/models/kokoro/voices-v1.0.bin")

MODEL_LOAD_TIMEOUT_S = 120.0


def _silence_bytes(ms: int, sample_rate: int = 16000) -> bytes:
    n_samples = sample_rate * ms // 1000
    return b"\x00\x00" * n_samples


def _pcm_ms(pcm_bytes: bytes, sample_rate: int = 16000) -> float:
    return len(pcm_bytes) / 2.0 / sample_rate * 1000.0


def _wait_ready(component, label: str) -> None:
    deadline = time.monotonic() + MODEL_LOAD_TIMEOUT_S
    while not component.ready:
        status = component.component_status()
        if not status["ok"] and "error" in status["detail"]:
            pytest.fail(f"{label} failed to load: {status}")
        if time.monotonic() > deadline:
            pytest.fail(f"{label} did not become ready within {MODEL_LOAD_TIMEOUT_S}s")
        time.sleep(0.1)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def say_audio():
    """(text, pcm_bytes) — SAY_TEXT rendered by `say` and resampled to
    16kHz mono s16le raw PCM via ffmpeg."""
    tmp_dir = tempfile.mkdtemp(prefix="jarvisd-test-say-")
    try:
        aiff_path = os.path.join(tmp_dir, "speech.aiff")
        raw16_path = os.path.join(tmp_dir, "speech16.raw")
        subprocess.run(
            [SAY_BIN, "-o", aiff_path, SAY_TEXT], check=True, capture_output=True, timeout=30
        )
        subprocess.run(
            [
                FFMPEG_BIN, "-y", "-i", aiff_path,
                "-ar", "16000", "-ac", "1", "-f", "s16le", raw16_path,
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        with open(raw16_path, "rb") as f:
            pcm = f.read()
        yield SAY_TEXT, pcm
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.fixture(scope="module")
def stt():
    s = StreamingSTT(model_size="base.en", device="cpu", compute_type="int8")
    s.load()
    _wait_ready(s, "whisper")
    return s


@pytest.fixture(scope="module")
def tts():
    if not (os.path.exists(KOKORO_MODEL_PATH) and os.path.exists(KOKORO_VOICES_PATH)):
        pytest.skip("kokoro model files not present under ~/ai/models/kokoro")
    t = StreamingTTS(KOKORO_MODEL_PATH, KOKORO_VOICES_PATH)
    t.load()
    _wait_ready(t, "kokoro")
    return t


# ---------------------------------------------------------------------------
# VAD
# ---------------------------------------------------------------------------


class TestVadEndpointer:
    def test_speech_start_and_end_within_bounds(self, say_audio):
        _text, speech_pcm = say_audio
        speech_ms = _pcm_ms(speech_pcm)
        composite = _silence_bytes(300) + speech_pcm + _silence_bytes(800)

        vad = VadEndpointer()
        events = []
        # feed in irregular, non-frame-aligned chunk sizes to exercise the
        # internal re-framing buffer
        chunk_sizes = [4001, 777, 4000, 999, 5000]
        pos = 0
        i = 0
        while pos < len(composite):
            size = chunk_sizes[i % len(chunk_sizes)]
            i += 1
            events.extend(vad.feed(composite[pos : pos + size]))
            pos += size

        types = [e[0] for e in events]
        assert "speech_start" in types
        assert "chunk" in types
        assert "speech_end" in types

        end_events = [e for e in events if e[0] == "speech_end"]
        utterance_pcm = end_events[0][1]
        assert utterance_pcm
        utterance_ms = _pcm_ms(utterance_pcm)

        assert utterance_ms >= vad.min_speech_ms
        assert utterance_ms <= _pcm_ms(composite)
        # utterance should roughly track the actual spoken duration
        # (padded by pre-roll and trailing silence kept up to the
        # endpoint threshold) — loose bounds, not an exact match.
        assert utterance_ms >= speech_ms * 0.5

    def test_chunk_frames_are_correct_length(self, say_audio):
        _text, speech_pcm = say_audio
        composite = _silence_bytes(300) + speech_pcm + _silence_bytes(800)
        vad = VadEndpointer()
        events = vad.feed(composite)
        chunk_events = [e for e in events if e[0] == "chunk"]
        assert chunk_events
        assert all(len(e[1]) == FRAME_BYTES for e in chunk_events)

    def test_reset_clears_state_for_next_utterance(self, say_audio):
        _text, speech_pcm = say_audio
        composite = _silence_bytes(300) + speech_pcm + _silence_bytes(800)
        vad = VadEndpointer()

        vad.feed(composite)
        vad.reset()
        events = vad.feed(composite)

        types = [e[0] for e in events]
        assert "speech_start" in types
        assert "speech_end" in types

    def test_min_speech_rejects_short_blip(self, say_audio):
        _text, speech_pcm = say_audio
        blip = speech_pcm[: int(0.1 * 16000) * 2]  # ~100ms of real speech
        composite = _silence_bytes(300) + blip + _silence_bytes(900)

        vad = VadEndpointer()  # default min_speech_ms=200 > blip's ~100ms
        events = vad.feed(composite)

        types = [e[0] for e in events]
        assert "speech_end" not in types

    def test_flush_drains_subframe_remainder(self):
        vad = VadEndpointer()
        # 10 bytes is well under FRAME_BYTES (640) — never processed into a frame
        remainder = b"\x01\x02" * 5
        events = vad.feed(remainder)
        assert events == []  # too small to form a frame, nothing emitted yet
        flushed = vad.flush()
        assert flushed == remainder
        # buffer is empty after flush
        assert vad.flush() == b""


# ---------------------------------------------------------------------------
# STT
# ---------------------------------------------------------------------------


class TestStreamingSTT:
    def test_transcribe_final_word_overlap(self, stt, say_audio):
        text, pcm = say_audio
        result_text, ms = stt.transcribe_final(pcm)

        assert isinstance(result_text, str) and result_text.strip()
        assert ms >= 0

        expected_words = {w.strip(".,!?").lower() for w in text.split()}
        got_words = {w.strip(".,!?").lower() for w in result_text.split()}
        overlap_ratio = len(expected_words & got_words) / len(expected_words)
        assert overlap_ratio >= 0.6, f"only {overlap_ratio:.0%} overlap: got {result_text!r}"

    def test_transcribe_partial_no_exception(self, stt, say_audio):
        _text, pcm = say_audio
        result = stt.transcribe_partial(pcm[: len(pcm) // 2])
        assert result is None or isinstance(result, str)

    def test_transcribe_partial_skips_when_lock_busy(self, stt, say_audio):
        _text, pcm = say_audio
        stt._decode_lock.acquire()
        try:
            result = stt.transcribe_partial(pcm)
            assert result is None
        finally:
            stt._decode_lock.release()

    def test_component_status_ok_when_ready(self, stt):
        status = stt.component_status()
        assert status["ok"] is True
        assert isinstance(status["detail"], str) and status["detail"]

    def test_async_final_wrapper(self, stt, say_audio):
        _text, pcm = say_audio

        async def _run():
            return await stt.final(pcm)

        result_text, ms = asyncio.run(_run())
        assert isinstance(result_text, str)
        assert ms >= 0


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------


class TestStreamingTTS:
    def test_speak_stream_produces_chunks(self, tts):
        text = "Hello there, this is a quick test."
        chunks = []
        amps = []

        result = tts.speak_stream(
            text,
            on_chunk=lambda b, n: chunks.append((b, n)),
            on_amp=lambda v: amps.append(v),
        )

        assert len(chunks) > 0
        assert all(len(b) > 0 and n > 0 for b, n in chunks)
        assert result["ms_first_chunk"] is not None
        assert result["ms_first_chunk"] >= 0
        assert result["ms_total"] >= result["ms_first_chunk"]
        assert result["chars"] == len(text)
        assert result["completed"] is True
        assert amps, "expected on_amp callbacks"
        assert all(0.0 <= v <= 1.0 for v in amps)

    def test_cancel_event_stops_stream_early(self, tts):
        text = (
            "This is a somewhat longer sentence used to test barge in "
            "cancellation behavior thoroughly and completely."
        )

        full_chunks = []
        full_result = tts.speak_stream(
            text, on_chunk=lambda b, n: full_chunks.append(b), on_amp=lambda v: None
        )
        assert len(full_chunks) > 1, "need >1 chunk for a meaningful cancel test"
        assert full_result["completed"] is True

        cancel_event = threading.Event()
        cancelled_chunks = []

        def _on_chunk(b, n):
            cancelled_chunks.append(b)
            if len(cancelled_chunks) == 1:
                cancel_event.set()

        cancelled_result = tts.speak_stream(
            text, on_chunk=_on_chunk, on_amp=lambda v: None, cancel_event=cancel_event
        )

        assert len(cancelled_chunks) < len(full_chunks)
        assert cancelled_result["completed"] is False

    def test_async_speak_wrapper(self, tts):
        chunks = []

        async def _run():
            return await tts.speak(
                "Quick async check.",
                on_chunk=lambda b, n: chunks.append(b),
                on_amp=lambda v: None,
            )

        result = asyncio.run(_run())
        assert len(chunks) > 0
        assert result["ms_total"] >= 0

    def test_say_fallback_produces_chunks(self, tts):
        text = "Fallback path check."
        chunks = []
        amps = []

        result = tts.say_fallback(
            text,
            on_chunk=lambda b, n: chunks.append(b),
            on_amp=lambda v: amps.append(v),
        )

        assert len(chunks) > 0
        assert result["chars"] == len(text)
        assert all(0.0 <= v <= 1.0 for v in amps)
