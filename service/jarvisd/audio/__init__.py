"""Audio pipeline: VAD endpointing, streaming STT, streaming TTS.

See docs/SPEC.md (§WebSocket, §Latency, §Config) for the binding contract
these components implement.
"""
from .stt import StreamingSTT
from .tts import StreamingTTS
from .vad import VadEndpointer

__all__ = ["VadEndpointer", "StreamingSTT", "StreamingTTS"]
