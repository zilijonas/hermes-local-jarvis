"""Speech-to-text: Parakeet-TDT (MLX, Apple GPU) with a faster-whisper fallback.

Engine choice (measured on this M4 box 2026-09-28, 12 utterances, clean / SNR 10 dB /
SNR 3 dB white noise):
    faster-whisper base.en int8 CPU   WER  9.7 / 18.7 / 38.8 %   ~420 ms
    mlx whisper-large-v3-turbo        WER  8.2 / 16.4 / 23.1 %   ~820-1300 ms
    parakeet-tdt-0.6b-v2 (MLX)        WER ~11  / 17.9 / 19.4 %   ~150 ms
Parakeet is ~3x faster than base.en, twice as robust in noise, and fast enough that a
partial can re-decode the WHOLE utterance instead of a 6 s tail window (the tail window
was why live captions dropped their beginning). Whisper stays as the fallback: if MLX or
the Parakeet weights fail to load, `engine` silently degrades to faster-whisper.

Threading: MLX state is thread-affine, so every decode (and the model load) runs on ONE
dedicated worker thread owned by this object. Callers may use the sync API from any
thread. Only one decode runs at a time (`_decode_lock`): `transcribe_final()` waits for
it, `transcribe_partial()` returns None immediately when a decode is in flight, so
partials never queue up in front of a final.
"""
from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Tuple

import numpy as np

SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # bytes, s16le
PARTIAL_WINDOW_S = 20.0  # partial decodes cover up to the last 20 s of the utterance
DEFAULT_PARAKEET_MODEL = "mlx-community/parakeet-tdt-0.6b-v2"


def _pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Decode 16k s16le mono PCM bytes into a float32 array in [-1, 1]."""
    if not pcm_bytes:
        return np.zeros(0, dtype=np.float32)
    audio_i16 = np.frombuffer(pcm_bytes[: len(pcm_bytes) // 2 * 2], dtype=np.int16)
    return audio_i16.astype(np.float32) / 32768.0


class _ParakeetEngine:
    name = "parakeet"

    def __init__(self, model_id: str) -> None:
        from parakeet_mlx import from_pretrained  # heavy import, only when chosen
        import mlx.core as mx
        from parakeet_mlx.audio import get_logmel

        self._mx = mx
        self._get_logmel = get_logmel
        self.model_id = model_id
        self.model = self._load(from_pretrained, model_id)
        # One throwaway decode pays the MLX kernel compile now, not on the first turn.
        self.transcribe(np.zeros(SAMPLE_RATE // 2, dtype=np.float32))

    @staticmethod
    def _load(from_pretrained, model_id: str):
        """Cached weights first (no network on every boot); download only if missing."""
        import os

        prev = os.environ.get("HF_HUB_OFFLINE")
        os.environ["HF_HUB_OFFLINE"] = "1"
        try:
            return from_pretrained(model_id)
        except Exception:  # noqa: BLE001 — not cached yet
            os.environ.pop("HF_HUB_OFFLINE", None)
            return from_pretrained(model_id)
        finally:
            if prev is None:
                os.environ.pop("HF_HUB_OFFLINE", None)
            else:
                os.environ["HF_HUB_OFFLINE"] = prev

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size < SAMPLE_RATE // 10:  # <100 ms: nothing a model can use
            return ""
        x = self._mx.array(audio)  # float32: get_logmel views the stft as the input dtype
        mel = self._get_logmel(x, self.model.preprocessor_config)
        return self.model.generate(mel)[0].text.strip()

    def label(self) -> str:
        return f"parakeet {self.model_id.rsplit('/', 1)[-1]} (mlx)"


class _WhisperEngine:
    name = "whisper"

    def __init__(self, model_size: str, device: str, compute_type: str) -> None:
        from faster_whisper import WhisperModel

        self.model_size, self.device, self.compute_type = model_size, device, compute_type
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)

    def transcribe(self, audio: np.ndarray, partial: bool = False) -> str:
        if audio.size == 0:
            return ""
        segments, _info = self.model.transcribe(
            audio, language="en", beam_size=1, vad_filter=False,
            condition_on_previous_text=not partial)
        return "".join(seg.text for seg in segments).strip()

    def label(self) -> str:
        return f"whisper {self.model_size} ({self.compute_type}/{self.device})"


class StreamingSTT:
    """Persistent STT engine with lazy background load on a dedicated thread."""

    def __init__(
        self,
        model_size: str = "base.en",
        device: str = "cpu",
        compute_type: str = "int8",
        engine: str = "whisper",
        parakeet_model: str = DEFAULT_PARAKEET_MODEL,
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.requested_engine = engine
        self.parakeet_model = parakeet_model

        self._engine = None
        self._load_lock = threading.Lock()
        self._load_future = None
        self._load_error: Optional[str] = None
        self._fallback_note = ""
        self._decode_lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt")

    # ------------------------------------------------------------ loading
    @property
    def ready(self) -> bool:
        return self._engine is not None

    @property
    def engine_name(self) -> str:
        return self._engine.name if self._engine else self.requested_engine

    def load(self) -> None:
        """Idempotently kick off a background model load. Non-blocking."""
        with self._load_lock:
            if self._engine is not None or self._load_future is not None:
                return
            self._load_future = self._pool.submit(self._load_blocking)

    def _load_blocking(self) -> None:
        if self.requested_engine == "parakeet":
            try:
                self._engine = _ParakeetEngine(self.parakeet_model)
                return
            except Exception as exc:  # noqa: BLE001 — degrade, never go deaf
                self._fallback_note = f"parakeet unavailable ({type(exc).__name__}: {exc})"[:200]
        try:
            self._engine = _WhisperEngine(self.model_size, self.device, self.compute_type)
            self._load_error = None
        except Exception as exc:  # pragma: no cover - defensive
            self._load_error = f"{type(exc).__name__}: {exc}"

    def _ensure_loaded_blocking(self, timeout_s: float = 180.0) -> None:
        self.load()
        deadline = time.monotonic() + timeout_s
        while self._engine is None and self._load_error is None:
            if time.monotonic() > deadline:
                raise TimeoutError(f"stt model load exceeded {timeout_s}s")
            time.sleep(0.05)
        if self._load_error is not None:
            raise RuntimeError(f"stt model failed to load: {self._load_error}")

    def component_status(self) -> dict:
        if self._load_error is not None:
            return {"ok": False, "detail": f"load error: {self._load_error}"}
        if self._engine is not None:
            detail = f"{self._engine.label()} resident"
            if self._fallback_note:
                detail += f" — fallback: {self._fallback_note}"
            return {"ok": True, "detail": detail}
        if self._load_future is not None:
            return {"ok": False, "detail": "loading"}
        return {"ok": False, "detail": "not loaded"}

    # ------------------------------------------------------------ decoding
    def _decode(self, audio: np.ndarray, partial: bool) -> str:
        eng = self._engine
        if isinstance(eng, _WhisperEngine):
            return eng.transcribe(audio, partial=partial)
        return eng.transcribe(audio)

    def transcribe_final(self, pcm_bytes: bytes) -> Tuple[str, float]:
        """Decode a full utterance. Blocks until the decode lock is free."""
        self._ensure_loaded_blocking()
        audio = _pcm16_to_float32(pcm_bytes)
        t0 = time.monotonic()
        with self._decode_lock:
            text = self._pool.submit(self._decode, audio, False).result()
        return text, (time.monotonic() - t0) * 1000.0

    def transcribe_partial(self, pcm_bytes_so_far: bytes) -> Optional[str]:
        """Decode the utterance so far (up to PARTIAL_WINDOW_S).

        Returns None (never blocks/queues) if the model isn't ready yet or a decode
        (final or partial) is already running.
        """
        if not self.ready:
            return None
        if not self._decode_lock.acquire(blocking=False):
            return None
        try:
            tail_bytes = int(PARTIAL_WINDOW_S * SAMPLE_RATE) * SAMPLE_WIDTH
            audio = _pcm16_to_float32(pcm_bytes_so_far[-tail_bytes:])
            if audio.size == 0:
                return ""
            return self._pool.submit(self._decode, audio, True).result()
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
