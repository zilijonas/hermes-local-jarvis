#!/usr/bin/env python3
"""Standalone jarvisd latency/RAM benchmark (docs/SPEC.md §Latency targets).

Usage:
    service/.venv/bin/python bench/run_bench.py --turns 10 --out bench/results-<ts>.json

Measures, against a real running jarvisd (default http://127.0.0.1:9140):
  - N typed turns via POST /converse: wall-clock ms per turn (p50/p95).
  - 5 WS voice turns using a macOS `say`-generated utterance ("what time is it right
    now"), streamed as 16kHz s16le PCM in 40ms chunks: stt ms (stt.final event's `ms`),
    mediator first-token ms (mediator.done's `ms_first_token`), first tts binary frame
    ms after mic.stop, and e2e ms (mic.stop -> first tts binary frame).
  - RAM (/health -> ram.free_gb) before and after the whole run.

Never fabricates numbers: every measurement comes from a real HTTP/WS round trip or a
real field off the wire. If a WS voice turn never produces any tts audio within its
timeout, that sample's stage fields are left null with a `note` explaining why --
notably, docs/SPEC.md's WebSocket contract for mic.start/mic.stop/turn.text/barge_in and
raw mic PCM frames is not currently wired to jarvisd/pipeline.py's Pipeline class (see
the written integration-test report), so on an unpatched checkout every voice sample is
expected to come back empty rather than something fabricated to look successful.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None

DEFAULT_BASE_URL = "http://127.0.0.1:9140"
UTTERANCE_TEXT = "what time is it right now"
SAY_BIN = "/usr/bin/say"
FFMPEG_BIN = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

TEXT_TURNS = [
    "what time is it?",
    "hello jarvis",
    "what's today's date?",
    "are you doing okay?",
    "list what you're working on",
    "what do you know about this machine?",
    "thanks",
    "how much memory is free right now?",
    "say that again",
    "what can you help me with?",
]


def http_get_json(url: str, timeout: float = 15.0) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def http_post_json(url: str, body: dict, timeout: float = 120.0) -> tuple[dict, float]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.loads(r.read())
    return payload, (time.monotonic() - t0) * 1000.0


def percentile(values: list[float], pct: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    idx = min(len(s) - 1, max(0, round(pct / 100 * (len(s) - 1))))
    return s[idx]


def stage_stats(values: list) -> dict:
    clean = [v for v in values if v is not None]
    return {
        "p50": percentile(clean, 50),
        "p95": percentile(clean, 95),
        "min": min(clean) if clean else None,
        "max": max(clean) if clean else None,
        "n": len(clean),
    }


def say_to_pcm16k(text: str) -> bytes:
    if not (os.path.exists(SAY_BIN) and FFMPEG_BIN and os.path.exists(FFMPEG_BIN)):
        raise RuntimeError("macOS `say` and/or ffmpeg not available")
    tmp_dir = tempfile.mkdtemp(prefix="jarvisd-bench-say-")
    try:
        aiff = os.path.join(tmp_dir, "speech.aiff")
        raw = os.path.join(tmp_dir, "speech16.raw")
        subprocess.run([SAY_BIN, "-o", aiff, text], check=True, capture_output=True, timeout=30)
        subprocess.run(
            [FFMPEG_BIN, "-y", "-i", aiff, "-ar", "16000", "-ac", "1", "-f", "s16le", raw],
            check=True,
            capture_output=True,
            timeout=30,
        )
        return Path(raw).read_bytes()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def pcm_chunks(pcm: bytes, chunk_ms: int = 40, sample_rate: int = 16000):
    n = int(sample_rate * chunk_ms / 1000) * 2  # s16le mono
    for i in range(0, len(pcm), n):
        yield pcm[i : i + n]


async def run_ws_voice_turn(base_url: str, pcm: bytes, timeout_s: float = 30.0) -> dict:
    """One mic.start -> stream -> mic.stop round trip over the real /ws."""
    ws_url = base_url.replace("http://", "ws://") + "/ws"
    result: dict[str, Any] = {
        "stt_ms": None,
        "mediator_first_token_ms": None,
        "first_tts_ms_after_mic_stop": None,
        "e2e_ms": None,
        "note": "",
    }
    async with websockets.connect(ws_url, open_timeout=10, max_size=2**21) as ws:
        await ws.send(json.dumps({"t": "mic.start"}))
        for chunk in pcm_chunks(pcm):
            await ws.send(chunk)
            await asyncio.sleep(0.02)
        t_mic_stop = time.monotonic()
        await ws.send(json.dumps({"t": "mic.stop"}))

        deadline = time.monotonic() + timeout_s
        saw_first_binary = False
        while time.monotonic() < deadline:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            except Exception as e:  # connection closed mid-turn, etc.
                result["note"] = f"connection error mid-turn: {e!r}"
                break
            if isinstance(msg, (bytes, bytearray)):
                if not saw_first_binary:
                    result["first_tts_ms_after_mic_stop"] = (time.monotonic() - t_mic_stop) * 1000.0
                    result["e2e_ms"] = result["first_tts_ms_after_mic_stop"]
                    saw_first_binary = True
                continue
            try:
                ev = json.loads(msg)
            except json.JSONDecodeError:
                continue
            if ev.get("t") == "stt.final":
                result["stt_ms"] = ev.get("ms")
            elif ev.get("t") == "mediator.done":
                result["mediator_first_token_ms"] = ev.get("ms_first_token")
            elif ev.get("t") == "state" and ev.get("value") == "idle" and saw_first_binary:
                break
    if not saw_first_binary and not result["note"]:
        result["note"] = "no tts audio observed within timeout"
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="jarvisd latency/RAM benchmark")
    ap.add_argument("--turns", type=int, default=10, help="number of typed /converse turns")
    ap.add_argument("--voice-turns", type=int, default=5, help="number of WS voice turns")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--out", default=None, help="output JSON path (default: bench/results-<ts>.json)")
    args = ap.parse_args()

    out_path = (
        Path(args.out)
        if args.out
        else Path(__file__).resolve().parent / f"results-{time.strftime('%Y%m%dT%H%M%S')}.json"
    )

    try:
        health_before = http_get_json(f"{args.base_url}/health")
    except (urllib.error.URLError, OSError) as e:
        print(f"ERROR: {args.base_url}/health unreachable: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"jarvisd bench target: {args.base_url}")
    print(f"RAM free before: {health_before.get('ram', {}).get('free_gb')} GB")

    text_ms: list[float] = []
    text_results = []
    for i in range(args.turns):
        text = TEXT_TURNS[i % len(TEXT_TURNS)]
        try:
            payload, wall_ms = http_post_json(f"{args.base_url}/converse", {"text": text})
            text_ms.append(wall_ms)
            text_results.append(
                {
                    "turn": i,
                    "text": text,
                    "wall_ms": round(wall_ms, 1),
                    "reply_chars": len(payload.get("reply_text", "")),
                    "actions": payload.get("actions", []),
                }
            )
            print(f"  [text {i + 1}/{args.turns}] {wall_ms:6.0f} ms  {text!r}")
        except Exception as e:
            text_results.append({"turn": i, "text": text, "error": str(e)})
            print(f"  [text {i + 1}/{args.turns}] ERROR: {e}")

    voice_results: list[dict] = []
    if args.voice_turns > 0:
        if websockets is None:
            print("websockets package not installed -- skipping WS voice turns", file=sys.stderr)
        else:
            try:
                pcm = say_to_pcm16k(UTTERANCE_TEXT)
            except Exception as e:
                print(f"cannot generate say-audio ({e}) -- skipping WS voice turns", file=sys.stderr)
                pcm = None
            if pcm is not None:
                for i in range(args.voice_turns):
                    try:
                        r = asyncio.run(run_ws_voice_turn(args.base_url, pcm))
                    except Exception as e:
                        r = {"error": str(e)}
                    voice_results.append(r)
                    print(f"  [voice {i + 1}/{args.voice_turns}] {r}")

    try:
        health_after = http_get_json(f"{args.base_url}/health")
    except Exception as e:
        health_after = {"error": str(e)}

    report = {
        "base_url": args.base_url,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "ram_before_gb": health_before.get("ram", {}).get("free_gb"),
        "ram_after_gb": health_after.get("ram", {}).get("free_gb") if isinstance(health_after, dict) else None,
        "text_turns": text_results,
        "text_wall_ms_stats": stage_stats(text_ms),
        "voice_turns": voice_results,
        "voice_stt_ms_stats": stage_stats([v.get("stt_ms") for v in voice_results]),
        "voice_mediator_first_token_ms_stats": stage_stats(
            [v.get("mediator_first_token_ms") for v in voice_results]
        ),
        "voice_first_tts_ms_stats": stage_stats([v.get("first_tts_ms_after_mic_stop") for v in voice_results]),
        "voice_e2e_ms_stats": stage_stats([v.get("e2e_ms") for v in voice_results]),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))

    print("\n=== jarvisd bench summary ===")
    print(f"RAM free: {report['ram_before_gb']} GB -> {report['ram_after_gb']} GB")
    print(f"{'stage':<34}{'p50':>10}{'p95':>10}{'n':>6}")

    def _row(name: str, stats: dict) -> None:
        p50 = f"{stats['p50']:.0f}" if stats["p50"] is not None else "-"
        p95 = f"{stats['p95']:.0f}" if stats["p95"] is not None else "-"
        print(f"{name:<34}{p50:>10}{p95:>10}{stats['n']:>6}")

    _row("text turn wall ms", report["text_wall_ms_stats"])
    _row("voice stt ms", report["voice_stt_ms_stats"])
    _row("voice mediator first-token ms", report["voice_mediator_first_token_ms_stats"])
    _row("voice first-tts-after-mic-stop ms", report["voice_first_tts_ms_stats"])
    _row("voice e2e ms", report["voice_e2e_ms_stats"])
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
