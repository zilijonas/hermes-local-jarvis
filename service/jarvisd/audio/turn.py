"""Turn detection for hands-free mode: Silero VAD + Smart Turn v3.

The old endpointer (vad.py, webrtcvad + a fixed 500 ms silence rule) ended the turn on
every natural pause, so "remind me to... call mom" arrived as two turns and Jarvis
answered the first half. This module separates two questions:

  1. Is there voice in this 32 ms frame?      -> Silero VAD v6 (ONNX, MIT)
  2. The user went quiet: are they DONE?      -> Smart Turn v3.2 (ONNX, BSD-2, pipecat-ai),
                                                a small audio model trained on exactly this
                                                (trailing intonation, fillers, cut-off
                                                grammar); ~15 ms on CPU.

Pattern (same as pipecat's SmartTurn analyzer): after `quiet_ms` of silence ask Smart
Turn; "complete" ends the turn, "incomplete" keeps listening (re-asking every
`recheck_ms`) until `max_pause_ms` of silence ends it regardless. When either model file
is missing the factory falls back to the webrtcvad endpointer, so jarvisd never goes deaf.

Event vocabulary is a superset of vad.py's, so the pipeline treats both alike:
    ("speech_start", None)
    ("chunk", frame_bytes)        every frame while an utterance is open
    ("pending", None)             quiet, but Smart Turn says "not finished yet" (once/pause)
    ("resume", None)              voice came back after a pending pause
    ("speech_end", pcm_bytes)     the full utterance incl. pre-roll
"""
from __future__ import annotations

import collections
import os
import time
from pathlib import Path
from typing import Deque, List, Optional, Tuple

import numpy as np

SAMPLE_RATE = 16000
FRAME_SAMPLES = 512                       # Silero's native window at 16 kHz
FRAME_BYTES = FRAME_SAMPLES * 2
FRAME_MS = FRAME_SAMPLES * 1000 / SAMPLE_RATE  # 32 ms

DEFAULT_SILERO = "~/ai/models/silero/silero_vad.onnx"
DEFAULT_SMART_TURN = "~/ai/models/smart-turn/smart-turn-v3.2-cpu.onnx"

Event = Tuple[str, Optional[bytes]]


def _session(path: str):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.inter_op_num_threads = 1
    so.intra_op_num_threads = 1
    so.log_severity_level = 3
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])


class SileroVAD:
    """Streaming Silero v5/v6: 512-sample frames + 64-sample context + recurrent state."""

    _CTX = 64

    def __init__(self, path: str = DEFAULT_SILERO) -> None:
        self.sess = _session(os.path.expanduser(path))
        self._sr = np.array(SAMPLE_RATE, dtype=np.int64)
        self.reset()

    def reset(self) -> None:
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._ctx = np.zeros((1, self._CTX), dtype=np.float32)

    def prob(self, frame: np.ndarray) -> float:
        x = np.concatenate([self._ctx, frame.reshape(1, -1).astype(np.float32)], axis=1)
        out, self._state = self.sess.run(None, {"input": x, "state": self._state, "sr": self._sr})
        self._ctx = x[:, -self._CTX:]
        return float(out[0][0])


class SmartTurn:
    """Smart Turn v3: P(the speaker finished their turn) from the last 8 s of audio."""

    def __init__(self, path: str = DEFAULT_SMART_TURN) -> None:
        from ._whisper_features import compute_whisper_log_mel_features

        self._features = compute_whisper_log_mel_features
        self.sess = _session(os.path.expanduser(path))
        self.last_ms = 0.0
        self.complete_prob(np.zeros(SAMPLE_RATE, dtype=np.float32))  # warm the graph

    def complete_prob(self, audio: np.ndarray) -> float:
        t0 = time.monotonic()
        n = SAMPLE_RATE * 8
        # Keep the END of the utterance, left-pad short ones (upstream's convention).
        audio = audio[-n:] if audio.size > n else np.pad(audio, (n - audio.size, 0))
        feats = self._features(audio.astype(np.float32))[None, ...]
        p = float(self.sess.run(None, {"input_features": feats})[0][0][0])
        self.last_ms = (time.monotonic() - t0) * 1000
        return p


class TurnEndpointer:
    def __init__(
        self,
        vad: SileroVAD,
        smart_turn: Optional[SmartTurn] = None,
        start_threshold: float = 0.5,
        stop_threshold: float = 0.35,
        start_frames: int = 2,
        min_speech_ms: int = 200,
        pre_roll_ms: int = 320,
        quiet_ms: int = 250,
        recheck_ms: int = 400,
        max_pause_ms: int = 1800,
        fallback_endpoint_ms: int = 800,
        turn_threshold: float = 0.5,
        max_utterance_s: float = 30.0,
    ) -> None:
        self.vad = vad
        self.smart_turn = smart_turn
        self.start_threshold = start_threshold
        self.stop_threshold = stop_threshold
        self.start_frames = start_frames
        self.min_speech_ms = min_speech_ms
        self.pre_roll_frames = max(1, int(pre_roll_ms / FRAME_MS))
        self.quiet_ms = quiet_ms
        self.recheck_ms = recheck_ms
        self.max_pause_ms = max_pause_ms
        self.fallback_endpoint_ms = fallback_endpoint_ms
        self.turn_threshold = turn_threshold
        self.max_utterance_ms = max_utterance_s * 1000
        self.last_turn_prob: Optional[float] = None
        # Push-to-talk switches Smart Turn off and uses a longer plain silence
        # cap (the user holds the floor); hands-free restores both. See set_mode().
        self.use_smart_turn = True
        self._handsfree_max_pause = max_pause_ms
        self.last_is_speech = False
        self.reset()

    # ------------------------------------------------------------ state
    def reset(self) -> None:
        self._byte_buf = bytearray()
        self._pre_roll: Deque[bytes] = collections.deque(maxlen=self.pre_roll_frames)
        self._in_speech = False
        self._onset = 0
        self._frames: List[bytes] = []
        self._silence_ms = 0.0
        self._voiced_ms = 0.0
        self._checked_at: Optional[float] = None
        self._pending = False
        self.last_is_speech = False
        self.vad.reset()

    def set_mode(self, mode: str, ptt_silence_ms: int = 2500) -> None:
        if mode == "ptt":
            self.use_smart_turn = False
            self.max_pause_ms = ptt_silence_ms
        else:
            self.use_smart_turn = True
            self.max_pause_ms = self._handsfree_max_pause

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    @property
    def voiced_ms(self) -> float:
        return self._voiced_ms

    def flush(self) -> bytes:
        remainder = bytes(self._byte_buf)
        self._byte_buf = bytearray()
        return remainder

    def feed(self, pcm_bytes: bytes) -> List[Event]:
        events: List[Event] = []
        self._byte_buf.extend(pcm_bytes)
        while len(self._byte_buf) >= FRAME_BYTES:
            frame = bytes(self._byte_buf[:FRAME_BYTES])
            del self._byte_buf[:FRAME_BYTES]
            events.extend(self._process(frame))
        return events

    # ------------------------------------------------------------ core
    def _process(self, frame: bytes) -> List[Event]:
        audio = np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0
        p = self.vad.prob(audio)

        if not self._in_speech:
            self.last_is_speech = p >= self.start_threshold
            self._pre_roll.append(frame)
            self._onset = self._onset + 1 if self.last_is_speech else 0
            if self._onset < self.start_frames:
                return []
            self._in_speech = True
            self._frames = list(self._pre_roll)
            self._voiced_ms = self._onset * FRAME_MS
            self._silence_ms = 0.0
            self._checked_at = None
            self._pending = False
            self._pre_roll.clear()
            return [("speech_start", None), ("chunk", frame)]

        self._frames.append(frame)
        events: List[Event] = [("chunk", frame)]
        self.last_is_speech = p >= self.stop_threshold  # hysteresis once speaking
        if self.last_is_speech:
            self._voiced_ms += FRAME_MS
            self._silence_ms = 0.0
            self._checked_at = None
            if self._pending:
                self._pending = False
                events.append(("resume", None))
        else:
            self._silence_ms += FRAME_MS

        was_pending = self._pending
        if self._should_close():
            closed = self._close()
            if closed is not None:
                events.append(closed)
        elif self._pending and not was_pending:
            events.append(("pending", None))
        return events

    def _should_close(self) -> bool:
        utter_ms = len(self._frames) * FRAME_MS
        if utter_ms >= self.max_utterance_ms:
            return True
        if self._silence_ms <= 0:
            return False
        if self.smart_turn is None:
            return self._silence_ms >= self.fallback_endpoint_ms
        if not self.use_smart_turn:
            return self._silence_ms >= self.max_pause_ms
        if self._silence_ms >= self.max_pause_ms:
            return True
        if self._silence_ms < self.quiet_ms:
            return False
        if self._checked_at is not None and self._silence_ms - self._checked_at < self.recheck_ms:
            return False
        self._checked_at = self._silence_ms
        pcm = b"".join(self._frames)
        try:
            prob = self.smart_turn.complete_prob(
                np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0)
        except Exception:  # noqa: BLE001 — model hiccup: fall back to plain silence rule
            return self._silence_ms >= self.fallback_endpoint_ms
        self.last_turn_prob = prob
        if prob >= self.turn_threshold:
            return True
        self._pending = True
        return False

    def _close(self) -> Optional[Event]:
        pcm = b"".join(self._frames)
        ok = self._voiced_ms >= self.min_speech_ms
        self._in_speech = False
        self._frames = []
        self._silence_ms = 0.0
        self._voiced_ms = 0.0
        self._checked_at = None
        self._pending = False
        self._onset = 0
        self._pre_roll.clear()
        return ("speech_end", pcm) if ok else None


def build_endpointer(cfg_vad: dict):
    """TurnEndpointer when the models exist, else the webrtcvad VadEndpointer.
    Returns (endpointer, label) — the label goes to /health."""
    silero = os.path.expanduser(cfg_vad.get("silero_model", DEFAULT_SILERO))
    smart = os.path.expanduser(cfg_vad.get("smart_turn_model", DEFAULT_SMART_TURN))
    if cfg_vad.get("engine", "smart_turn") != "webrtc" and Path(silero).exists():
        try:
            st = SmartTurn(smart) if Path(smart).exists() else None
            ep = TurnEndpointer(
                SileroVAD(silero), st,
                min_speech_ms=int(cfg_vad.get("min_speech_ms", 200)),
                quiet_ms=int(cfg_vad.get("quiet_ms", 250)),
                max_pause_ms=int(cfg_vad.get("max_pause_ms", 1800)),
                fallback_endpoint_ms=int(cfg_vad.get("endpoint_ms", 800)),
                turn_threshold=float(cfg_vad.get("turn_threshold", 0.5)))
            return ep, ("silero + smart-turn v3" if st else "silero (no smart-turn model)")
        except Exception as exc:  # noqa: BLE001
            note = f"webrtcvad (silero failed: {type(exc).__name__})"
        else:  # pragma: no cover
            note = "webrtcvad"
    else:
        note = "webrtcvad"
    from .vad import VadEndpointer

    return VadEndpointer(aggressiveness=int(cfg_vad.get("aggressiveness", 3)),
                         endpoint_ms=int(cfg_vad.get("endpoint_ms", 800)),
                         min_speech_ms=int(cfg_vad.get("min_speech_ms", 200))), note
