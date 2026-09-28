"""Streaming text-to-speech: kokoro-onnx primary engine, `say` fallback.

Both `speak_stream()` (kokoro) and `say_fallback()` (macOS `say` + ffmpeg)
push audio to the caller incrementally via two plain callables:
    on_chunk(pcm_s16le_bytes, n_samples)  -- ~120ms of 24kHz mono audio
    on_amp(rms_0_to_1)                    -- ~30Hz (one call per ~33ms window)
and both check `cancel_event` between chunks *and* between sentences, so
barge-in can stop playback within one chunk's worth of audio (~120ms).

kokoro-onnx model load (persistent Kokoro instance) happens lazily in a
background thread, same pattern as StreamingSTT — `ready` /
`component_status()` for /health, `load()` to warm proactively.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Callable, List, Optional

import numpy as np
from kokoro_onnx import Kokoro

SAMPLE_RATE = 24000
SAMPLE_WIDTH = 2  # bytes, s16le
CHUNK_MS = 120
AMP_WINDOW_MS = 33
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_MS // 1000  # 2880
AMP_WINDOW_SAMPLES = SAMPLE_RATE * AMP_WINDOW_MS // 1000  # 792

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# ---------------------------------------------------------------- speakable text
# Kokoro reads what it is given. Markdown, symbols and "$64,250" come out as noise
# ("dollar one sixty-four..."), so every sentence goes through speakable() first.
_MD_LINK = re.compile(r"\[([^\]]+)\]\((?:[^)]+)\)")
_URL = re.compile(r"https?://([^/\s]+)\S*")
_BULLET = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+", re.M)
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]")
_CURRENCY = {"$": "dollars", "\u20ac": "euros", "\u00a3": "pounds"}
_CUR_RE = re.compile(r"([$\u20ac\u00a3])\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)([kKmMbB]n?)?(?![A-Za-z])")
_SCALE = {"k": "thousand", "m": "million", "b": "billion", "bn": "billion"}
_ABBREV = [(re.compile(r"\be\.g\.", re.I), "for example"), (re.compile(r"\bi\.e\.", re.I), "that is"),
           (re.compile(r"\bvs\.?(?=\s)", re.I), "versus"), (re.compile(r"\betc\."), "and so on"),
           (re.compile(r"\s&\s"), " and "), (re.compile(r"\u00b0\s?C\b"), " degrees Celsius"),
           (re.compile(r"\u00b0\s?F\b"), " degrees Fahrenheit"), (re.compile(r"\u00b0"), " degrees")]


def _money(m: "re.Match") -> str:
    amount, scale = m.group(2), (m.group(3) or "").lower()
    word = _CURRENCY[m.group(1)]
    return f"{amount} {_SCALE[scale]} {word}" if scale else f"{amount} {word}"


def plain_typography(text: str) -> str:
    """Display text without the typography Linas bans in anything he reads (em/en
    dashes, arrows, ellipsis characters). Enforced in code, not by prompt."""
    t = re.sub(r"\s*\u2014\s*", ", ", text or "")
    t = re.sub(r"(?<=\d)\u2013(?=\d)", "-", t)
    t = re.sub(r"\s*\u2013\s*", ", ", t)
    t = t.replace("\u2192", " to ").replace("\u2026", ".")
    return re.sub(r",\s*,", ",", t)


def speakable(text: str) -> str:
    """Turn model output into text a TTS voice can read without garbage."""
    t = re.sub(r"[\u00a0\u202f\u2009]", " ", text or "")        # nbsp / narrow nbsp
    t = _MD_LINK.sub(r"\1", t)
    t = _URL.sub(lambda m: m.group(1).removeprefix("www."), t)
    t = _BULLET.sub("", t)
    t = re.sub(r"[*_`#>|~]+", "", t)
    t = _EMOJI.sub("", t)
    t = re.sub(r"\s*[\u2014\u2013]\s*", ", ", t)          # em/en dash -> pause
    t = t.replace("\u2026", "...").replace("\u2192", " to ")
    t = _CUR_RE.sub(_money, t)
    t = re.sub(r"\b(\d{1,2}):00\b", r"\1", t)               # 5:00 PM -> 5 PM
    t = re.sub(r"\b(\d{1,2}):0(\d)\b", r"\1 oh \2", t)      # 9:05 -> 9 oh 5
    t = re.sub(r"\b(\d{1,2}):(\d{2})\b", r"\1 \2", t)       # 9:30 -> 9 30
    for rx, rep in _ABBREV:
        t = rx.sub(rep, t)
    t = re.sub(r"\s+([,.!?;:])", r"\1", t)
    t = re.sub(r"([,;:])(?=[,;:])", "", t)
    return re.sub(r"\s{2,}", " ", t).strip(" ,;")


OnChunk = Callable[[bytes, int], None]
OnAmp = Callable[[float], None]


def _split_sentences(text: str) -> List[str]:
    """Split on ./!/? boundaries; merge fragments under 3 words into a
    neighbor so kokoro never synthesizes a lone "Ok." as its own call."""
    raw = [s.strip() for s in _SENTENCE_SPLIT_RE.split(text.strip()) if s.strip()]
    if not raw:
        return []
    out: List[str] = [raw[0]]
    for s in raw[1:]:
        if len(s.split()) < 3 or len(out[-1].split()) < 3:
            out[-1] = f"{out[-1]} {s}"
        else:
            out.append(s)
    return out


def _float32_to_pcm16(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16).tobytes()


def _pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    if not pcm_bytes:
        return np.zeros(0, dtype=np.float32)
    audio_i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    return audio_i16.astype(np.float32) / 32768.0


def _stream_audio(
    audio_f32: np.ndarray,
    on_chunk: OnChunk,
    on_amp: OnAmp,
    cancel_event: Optional[threading.Event],
    timing: dict,
) -> bool:
    """Stream one contiguous buffer of 24kHz float32 audio out in ~120ms
    chunks, firing on_amp every ~33ms. Returns False if cancelled."""
    n = audio_f32.shape[0]
    pos = 0
    pending: List[np.ndarray] = []
    pending_samples = 0

    if n == 0:
        return True

    while pos < n:
        if cancel_event is not None and cancel_event.is_set():
            return False

        window = audio_f32[pos : pos + AMP_WINDOW_SAMPLES]
        pos += window.shape[0]
        rms = float(np.sqrt(np.mean(np.square(window)))) if window.size else 0.0
        on_amp(min(1.0, rms))

        pending.append(window)
        pending_samples += window.shape[0]

        if pending_samples >= CHUNK_SAMPLES or pos >= n:
            chunk_f32 = pending[0] if len(pending) == 1 else np.concatenate(pending)
            chunk_bytes = _float32_to_pcm16(chunk_f32)
            if timing.get("first_chunk_ms") is None:
                timing["first_chunk_ms"] = (time.monotonic() - timing["t_start"]) * 1000.0
            on_chunk(chunk_bytes, chunk_f32.shape[0])
            pending = []
            pending_samples = 0

            if cancel_event is not None and cancel_event.is_set():
                return False

    return True


class StreamingTTS:
    """Persistent kokoro-onnx instance + `say` fallback, both streaming.

    speak_stream()/speak() raise if kokoro isn't ready and failed to load;
    callers should catch that and fall back to say_fallback(). (`ready`
    can also be checked up front to route to the fallback pre-emptively.)
    """

    def __init__(
        self,
        model_path: str,
        voices_path: str,
        default_voice: str = "am_michael",
        default_speed: float = 1.1,
    ) -> None:
        self.model_path = model_path
        self.voices_path = voices_path
        self.default_voice = default_voice
        self.default_speed = default_speed

        self._kokoro: Optional[Kokoro] = None
        self._load_lock = threading.Lock()
        self._load_thread: Optional[threading.Thread] = None
        self._load_error: Optional[str] = None

    @property
    def ready(self) -> bool:
        return self._kokoro is not None

    def load(self) -> None:
        """Idempotently kick off a background kokoro load. Non-blocking."""
        with self._load_lock:
            if self._kokoro is not None or self._load_thread is not None:
                return
            self._load_thread = threading.Thread(
                target=self._load_blocking, daemon=True, name="tts-load"
            )
            self._load_thread.start()

    def _load_blocking(self) -> None:
        try:
            self._kokoro = Kokoro(self.model_path, self.voices_path)
            self._load_error = None
        except Exception as exc:  # pragma: no cover - defensive
            self._load_error = f"{type(exc).__name__}: {exc}"

    def _ensure_loaded_blocking(self, timeout_s: float = 120.0) -> None:
        self.load()
        deadline = time.monotonic() + timeout_s
        while self._kokoro is None and self._load_error is None:
            if time.monotonic() > deadline:
                raise TimeoutError(f"kokoro model load exceeded {timeout_s}s")
            time.sleep(0.05)
        if self._load_error is not None:
            raise RuntimeError(f"kokoro failed to load: {self._load_error}")

    def component_status(self) -> dict:
        if self._load_error is not None:
            return {"ok": False, "detail": f"load error: {self._load_error}"}
        if self._kokoro is not None:
            return {"ok": True, "detail": "kokoro resident"}
        if self._load_thread is not None:
            return {"ok": False, "detail": "loading"}
        return {"ok": False, "detail": "not loaded"}

    def speak_stream(
        self,
        text: str,
        on_chunk: OnChunk,
        on_amp: OnAmp,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict:
        """Blocking. Synthesize `text` sentence-by-sentence with kokoro and
        stream it via on_chunk/on_amp. Checks cancel_event between chunks
        AND between sentences for fast barge-in.

        Returns {ms_first_chunk, ms_total, chars, completed}.
        """
        self._ensure_loaded_blocking()
        voice = voice or self.default_voice
        speed = self.default_speed if speed is None else speed
        timing = {"t_start": time.monotonic(), "first_chunk_ms": None}
        sentences = _split_sentences(text)
        completed = True

        for sentence in sentences:
            if cancel_event is not None and cancel_event.is_set():
                completed = False
                break
            audio_f32, _sr = self._kokoro.create(sentence, voice=voice, speed=speed)
            if not _stream_audio(audio_f32, on_chunk, on_amp, cancel_event, timing):
                completed = False
                break

        ms_total = (time.monotonic() - timing["t_start"]) * 1000.0
        return {
            "ms_first_chunk": timing["first_chunk_ms"],
            "ms_total": ms_total,
            "chars": len(text),
            "completed": completed,
        }

    async def speak(
        self,
        text: str,
        on_chunk: OnChunk,
        on_amp: OnAmp,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict:
        """Async wrapper: runs speak_stream() in the default executor.

        IMPORTANT for callers (ws layer): on_chunk/on_amp are invoked from
        the executor's worker thread, NOT the asyncio event loop thread.
        Do not call event-loop-only APIs (e.g. websocket.send) directly
        from inside them — bridge back with
        `loop.call_soon_threadsafe(callback, *args)` instead.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self.speak_stream, text, on_chunk, on_amp, voice, speed, cancel_event
        )

    def say_fallback(
        self,
        text: str,
        on_chunk: OnChunk,
        on_amp: OnAmp,
        cancel_event: Optional[threading.Event] = None,
        voice: Optional[str] = None,
    ) -> dict:
        """Blocking fallback path used when kokoro isn't ready or errors:
        `/usr/bin/say -o tmp.aiff` then ffmpeg -> 24k mono s16le, streamed
        through the same chunk/amp path as speak_stream(). All temp files
        live under $TMPDIR and are removed before returning.
        """
        timing = {"t_start": time.monotonic(), "first_chunk_ms": None}
        tmp_dir = tempfile.mkdtemp(prefix="jarvisd-say-")
        aiff_path = os.path.join(tmp_dir, "out.aiff")
        raw_path = os.path.join(tmp_dir, "out.raw")
        completed = True
        try:
            say_cmd = ["/usr/bin/say", "-o", aiff_path]
            if voice:
                say_cmd += ["-v", voice]
            say_cmd.append(text)
            subprocess.run(say_cmd, check=True, capture_output=True, timeout=30)
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", aiff_path,
                    "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "s16le", raw_path,
                ],
                check=True,
                capture_output=True,
                timeout=30,
            )
            with open(raw_path, "rb") as f:
                pcm_bytes = f.read()
            audio_f32 = _pcm16_to_float32(pcm_bytes)
            completed = _stream_audio(audio_f32, on_chunk, on_amp, cancel_event, timing)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        ms_total = (time.monotonic() - timing["t_start"]) * 1000.0
        return {
            "ms_first_chunk": timing["first_chunk_ms"],
            "ms_total": ms_total,
            "chars": len(text),
            "completed": completed,
        }
