"""In-memory latency histograms + counters for GET /metrics, plus a RAM snapshot helper."""

from __future__ import annotations

import threading
from collections import defaultdict, deque
from typing import Any

import psutil

_MAX_SAMPLES = 500  # bounded ring buffer per stage; enough for stable p50/p95 on a single box


def ram_snapshot() -> dict[str, float]:
    vm = psutil.virtual_memory()
    return {"free_gb": round(vm.available / (1024**3), 2)}


class Metrics:
    """Stages recorded via record(stage, ms): stt, mediator_first_token, tts_first_chunk,
    e2e_first_audio, etc. (any stage name is accepted, not a fixed enum).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hist: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=_MAX_SAMPLES))
        self._counters: dict[str, int] = defaultdict(int)

    def record(self, stage: str, ms: float) -> None:
        with self._lock:
            self._hist[stage].append(ms)

    def inc(self, counter: str, n: int = 1) -> None:
        with self._lock:
            self._counters[counter] += n

    def percentile(self, stage: str, pct: float) -> float | None:
        with self._lock:
            samples = sorted(self._hist.get(stage, ()))
        if not samples:
            return None
        idx = min(len(samples) - 1, max(0, round(pct / 100 * (len(samples) - 1))))
        return samples[idx]

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            stages = list(self._hist.keys())
            counts = {stage: len(self._hist[stage]) for stage in stages}
            counters = dict(self._counters)
        histograms = {
            stage: {"p50": self.percentile(stage, 50), "p95": self.percentile(stage, 95), "count": counts[stage]}
            for stage in stages
        }
        return {"histograms": histograms, "counters": counters, "ram": ram_snapshot()}

    def reset(self) -> None:
        """Test/debug helper — clears all recorded samples and counters."""
        with self._lock:
            self._hist.clear()
            self._counters.clear()


metrics = Metrics()  # process-wide singleton used by app.py and (later) pipeline modules


# Module-level conveniences — pipeline.py records via `metrics.record(...)`/`metrics.counter(...)`.
def record(stage: str, ms: float) -> None:
    metrics.record(stage, ms)


def counter(name: str, n: int = 1) -> None:
    metrics.inc(name, n)
