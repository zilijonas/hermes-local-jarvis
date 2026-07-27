"""Voice-activity detection and utterance endpointing (webrtcvad-based).

Pure synchronous, no asyncio — safe to call from any thread (the ws layer
feeds this from whichever thread reads mic bytes off the socket). Consumes
16 kHz mono s16le PCM in arbitrary-sized chunks and internally re-frames it
into the fixed 20 ms / 320-sample windows webrtcvad requires.

Per docs/SPEC.md the endpointer only ever emits three event kinds from
`feed()`:
    ("speech_start", None)
    ("chunk", frame_bytes)              -- one 20ms frame while speaking
    ("speech_end", utterance_pcm_bytes) -- full utterance incl. pre-roll

Utterances shorter than `min_speech_ms` (blips/breath noise) are silently
dropped: no "speech_end" is emitted for them, so callers (STT) never see
garbage. This is a deliberate omission, not a 4th event type — SPEC.md's
event vocabulary stays exactly those three tuples.
"""
from __future__ import annotations

import collections
from typing import Deque, List, Optional, Tuple

import webrtcvad

SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # bytes per sample, s16le
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 320
FRAME_BYTES = FRAME_SAMPLES * SAMPLE_WIDTH  # 640

Event = Tuple[str, Optional[bytes]]


class VadEndpointer:
    """Streaming speech endpointer built on webrtcvad.

    Config (defaults per SPEC):
        aggressiveness: webrtcvad mode 0-3 (default 2).
        endpoint_ms: trailing silence required to close an utterance (500).
        min_speech_ms: utterances shorter than this are rejected (200).
        pre_roll_ms: audio kept before speech_start so onsets aren't
            clipped (240).
        max_utterance_s: hard cut regardless of silence (30).
        long_utterance_s / long_utterance_shrink: adaptive two-tier
            endpointing — once an in-progress utterance has run longer
            than `long_utterance_s` (5s), the silence-to-close threshold
            shrinks by `long_utterance_shrink` (20%, i.e. factor 0.8) so
            long dictation pauses close faster. Simple two-tier, not a
            continuous ramp.
    """

    def __init__(
        self,
        aggressiveness: int = 2,
        endpoint_ms: int = 500,
        min_speech_ms: int = 200,
        pre_roll_ms: int = 240,
        max_utterance_s: float = 30.0,
        long_utterance_s: float = 5.0,
        long_utterance_shrink: float = 0.8,
    ) -> None:
        if not 0 <= aggressiveness <= 3:
            raise ValueError("aggressiveness must be 0-3")
        self.aggressiveness = aggressiveness
        self.endpoint_ms = endpoint_ms
        self.min_speech_ms = min_speech_ms
        self.pre_roll_ms = pre_roll_ms
        self.max_utterance_s = max_utterance_s
        self.long_utterance_s = long_utterance_s
        self.long_utterance_shrink = long_utterance_shrink

        self._vad = webrtcvad.Vad(aggressiveness)
        self._byte_buf = bytearray()
        # the rest of the mutable state is (re)initialized in reset()
        self._pre_roll: Deque[bytes] = collections.deque()
        self._in_speech = False
        self._silence_frames = 0
        self._speech_frames: List[bytes] = []
        self._elapsed_frames = 0
        self._true_speech_frames = 0
        self.reset()

    def reset(self) -> None:
        """Clear all buffered/in-progress state. Config is untouched."""
        self._byte_buf = bytearray()
        pre_roll_frames = max(1, self.pre_roll_ms // FRAME_MS)
        self._pre_roll = collections.deque(maxlen=pre_roll_frames)
        self._in_speech = False
        self._silence_frames = 0
        self._speech_frames = []
        self._elapsed_frames = 0
        self._true_speech_frames = 0

    def flush(self) -> bytes:
        """Drain and return the internal re-framing buffer's remainder
        (<FRAME_BYTES of trailing PCM that never completed a full 20ms
        frame). Used by callers that finalize an utterance externally —
        e.g. PTT release — instead of waiting for a silence-triggered
        speech_end: `pcm = bytes(utt_buf) + vad.flush()` so no audio is
        lost at the tail. Does not otherwise touch in-progress VAD state.
        """
        remainder = bytes(self._byte_buf)
        self._byte_buf = bytearray()
        return remainder

    def feed(self, pcm_bytes: bytes) -> List[Event]:
        """Accept an arbitrary-sized PCM chunk, return new events."""
        events: List[Event] = []
        self._byte_buf.extend(pcm_bytes)

        while len(self._byte_buf) >= FRAME_BYTES:
            frame = bytes(self._byte_buf[:FRAME_BYTES])
            del self._byte_buf[:FRAME_BYTES]
            events.extend(self._process_frame(frame))

        return events

    def _endpoint_frames(self, utterance_s: float) -> int:
        ms = self.endpoint_ms
        if utterance_s > self.long_utterance_s:
            ms = int(ms * self.long_utterance_shrink)
        return max(1, ms // FRAME_MS)

    def _process_frame(self, frame: bytes) -> List[Event]:
        events: List[Event] = []
        is_speech = self._vad.is_speech(frame, SAMPLE_RATE)

        if not self._in_speech:
            if is_speech:
                self._in_speech = True
                self._silence_frames = 0
                self._speech_frames = list(self._pre_roll)
                self._elapsed_frames = len(self._speech_frames)
                self._true_speech_frames = 0

                self._speech_frames.append(frame)
                self._elapsed_frames += 1
                self._true_speech_frames += 1

                events.append(("speech_start", None))
                events.append(("chunk", frame))
            else:
                self._pre_roll.append(frame)
            return events

        # already in an utterance
        self._speech_frames.append(frame)
        self._elapsed_frames += 1
        events.append(("chunk", frame))

        if is_speech:
            self._true_speech_frames += 1
            self._silence_frames = 0
        else:
            self._silence_frames += 1

        utterance_s = self._elapsed_frames * FRAME_MS / 1000.0
        endpoint_frames = self._endpoint_frames(utterance_s)
        hit_silence = self._silence_frames >= endpoint_frames
        hit_max = utterance_s >= self.max_utterance_s

        if hit_silence or hit_max:
            closed = self._close_utterance()
            if closed is not None:
                events.append(closed)

        return events

    def _close_utterance(self) -> Optional[Event]:
        utterance_pcm = b"".join(self._speech_frames)
        true_speech_ms = self._true_speech_frames * FRAME_MS
        min_ok = true_speech_ms >= self.min_speech_ms

        self._in_speech = False
        self._silence_frames = 0
        self._speech_frames = []
        self._elapsed_frames = 0
        self._true_speech_frames = 0
        self._pre_roll.clear()

        if min_ok:
            return ("speech_end", utterance_pcm)
        return None
