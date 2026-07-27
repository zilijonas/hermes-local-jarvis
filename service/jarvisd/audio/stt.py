"""Streaming speech-to-text wrapper around faster-whisper.

The WhisperModel is heavy to construct (loads weights, picks kernels), so
it is loaded lazily in a background thread rather than blocking whatever
constructs StreamingSTT. Call `load()` early (e.g. at app startup) to
start warming it in the background; `ready` / `component_status()` report
progress for `/health`. If nothing calls `load()` explicitly, the first
`transcribe_final()` call triggers it and blocks (in its own thread, via
the async `final()` wrapper this does not block the event loop).
"""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional, Tuple

import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # bytes, s16le
PARTIAL_WINDOW_S = 6.0  # only the last N seconds are used for partials


def _pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Decode 16k s16le mono PCM bytes into a float32 array in [-1, 1]."""
    if not pcm_bytes:
        return np.zeros(0, dtype=np.float32)
    audio_i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    return audio_i16.astype(np.float32) / 32768.0


class StreamingSTT:
    """Persistent faster-whisper model with lazy background load.

    Thread-safety: only one decode runs at a time, guarded by
    `_decode_lock`. `transcribe_final()` BLOCKS until the lock is free
    (finals must always eventually produce a result). `transcribe_partial()`
    never queues: if a decode is already in flight it returns `None`
    immediately rather than waiting, so partials never pile up behind a
    final (or another partial).
    """

    def __init__(
        self,
        model_size: str = "base.en",
        device: str = "cpu",
        compute_type: str = "int8",
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type

        self._model: Optional[WhisperModel] = None
        self._load_lock = threading.Lock()
        self._load_thread: Optional[threading.Thread] = None
        self._load_error: Optional[str] = None
        self._decode_lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        """Idempotently kick off a background model load. Non-blocking."""
        with self._load_lock:
            if self._model is not None or self._load_thread is not None:
                return
            self._load_thread = threading.Thread(
                target=self._load_blocking, daemon=True, name="stt-load"
            )
            self._load_thread.start()

    def _load_blocking(self) -> None:
        try:
            model = WhisperModel(
                self.model_size, device=self.device, compute_type=self.compute_type
            )
            self._model = model
            self._load_error = None
        except Exception as exc:  # pragma: no cover - defensive
            self._load_error = f"{type(exc).__name__}: {exc}"

    def _ensure_loaded_blocking(self, timeout_s: float = 120.0) -> None:
        self.load()
        deadline = time.monotonic() + timeout_s
        while self._model is None and self._load_error is None:
            if time.monotonic() > deadline:
                raise TimeoutError(f"whisper model load exceeded {timeout_s}s")
            time.sleep(0.05)
        if self._load_error is not None:
            raise RuntimeError(f"whisper model failed to load: {self._load_error}")

    def component_status(self) -> dict:
        if self._load_error is not None:
            return {"ok": False, "detail": f"load error: {self._load_error}"}
        if self._model is not None:
            return {
                "ok": True,
                "detail": f"{self.model_size} ({self.compute_type}/{self.device}) resident",
            }
        if self._load_thread is not None:
            return {"ok": False, "detail": "loading"}
        return {"ok": False, "detail": "not loaded"}

    def transcribe_final(self, pcm_bytes: bytes) -> Tuple[str, float]:
        """Decode a full utterance. Blocks until the decode lock is free."""
        self._ensure_loaded_blocking()
        audio = _pcm16_to_float32(pcm_bytes)
        t0 = time.monotonic()
        with self._decode_lock:
            segments, _info = self._model.transcribe(
                audio,
                language="en",
                beam_size=1,
                vad_filter=False,
            )
            text = "".join(seg.text for seg in segments).strip()
        ms = (time.monotonic() - t0) * 1000.0
        return text, ms

    def transcribe_partial(self, pcm_bytes_so_far: bytes) -> Optional[str]:
        """Decode only the tail (~PARTIAL_WINDOW_S) of audio so far.

        Returns None (never blocks/queues) if the model isn't ready yet or
        a decode (final or partial) is already running.
        """
        if not self.ready:
            return None
        if not self._decode_lock.acquire(blocking=False):
            return None
        try:
            tail_bytes = int(PARTIAL_WINDOW_S * SAMPLE_RATE) * SAMPLE_WIDTH
            window = pcm_bytes_so_far[-tail_bytes:]
            audio = _pcm16_to_float32(window)
            if audio.size == 0:
                return ""
            segments, _info = self._model.transcribe(
                audio,
                language="en",
                beam_size=1,
                condition_on_previous_text=False,
                vad_filter=False,
            )
            return "".join(seg.text for seg in segments).strip()
        finally:
            self._decode_lock.release()

    async def final(self, pcm_bytes: bytes) -> Tuple[str, float]:
        """Async wrapper: runs transcribe_final() in the default executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.transcribe_final, pcm_bytes)

    async def partial(self, pcm_bytes_so_far: bytes) -> Optional[str]:
        """Async wrapper: runs transcribe_partial() in the default executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.transcribe_partial, pcm_bytes_so_far)
