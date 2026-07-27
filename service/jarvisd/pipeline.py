"""Voice pipeline orchestrator — ties audio, mediator, memory, capabilities and
workers together and drives the UI state machine over the event bus.

States (SPEC §WebSocket `state`): idle → listening → transcribing → thinking
→ (memory|capability|tool|delegating) → speaking → idle, with `interrupted`,
`blocked`, `error` as cross-cuts. The server is authoritative; the UI renders
exactly what this module publishes — nothing is faked.
"""
from __future__ import annotations

import asyncio
import datetime
import difflib
import time
from typing import Any, Optional

from .audio.vad import VadEndpointer
from .audio.stt import StreamingSTT
from .audio.tts import StreamingTTS
from .mediator.loop import Mediator
from . import metrics


class Pipeline:
    def __init__(self, cfg, db, bus, stt: StreamingSTT, tts: StreamingTTS,
                 mediator: Mediator, workers, memory_mod, caps_router):
        self.cfg = cfg
        self.db = db
        self.bus = bus
        self.stt = stt
        self.tts = tts
        self.mediator = mediator
        self.workers = workers
        self.memory = memory_mod
        self.caps = caps_router
        self.vad = VadEndpointer(
            aggressiveness=cfg.vad.aggressiveness,
            endpoint_ms=cfg.vad.endpoint_ms,
            min_speech_ms=cfg.vad.min_speech_ms)
        self.state = "idle"
        self.mode = "ptt"
        self.mic_active = False
        self._utt_buf = bytearray()
        self._partial_task: Optional[asyncio.Task] = None
        self._turn_task: Optional[asyncio.Task] = None
        self._tts_cancel: Optional[asyncio.Event] = None
        self._speaking = False
        self._turn_lock = asyncio.Lock()
        self._loop = asyncio.get_event_loop()
        workers.on_task_event = self._on_task_event  # optional hook

    # ------------------------------------------------------------- states
    def _set_state(self, value: str, detail: str = "", turn_id: str = "") -> None:
        self.state = value
        ev = {"t": "state", "value": value}
        if detail:
            ev["detail"] = detail
        if turn_id:
            ev["turn_id"] = turn_id
        self.bus.publish(ev)

    # ------------------------------------------------------------- mic I/O
    def mic_start(self) -> None:
        self.mic_active = True
        self.vad.reset()
        self._utt_buf.clear()
        if self._speaking:
            self.barge_in("mic reopened")
        self._set_state("listening")

    def mic_stop(self) -> None:
        """PTT release: whatever is buffered becomes the utterance."""
        self.mic_active = False
        pcm = bytes(self._utt_buf) + self.vad.flush()
        self._utt_buf.clear()
        if len(pcm) >= 3200:  # ≥100 ms of speech-ish audio
            self._spawn_turn(pcm)
        else:
            self._set_state("idle")

    def feed_audio(self, chunk: bytes) -> None:
        if not self.mic_active:
            return
        for kind, payload in self.vad.feed(chunk):
            if kind == "speech_start":
                if self._speaking:
                    self.barge_in("voice detected")
            elif kind == "chunk":
                self._utt_buf.extend(payload)
                self._maybe_partial()
            elif kind == "speech_end":
                pcm = bytes(payload)
                self._utt_buf.clear()
                if self.mode == "vad" or not self.mic_active:
                    self._spawn_turn(pcm)
                else:
                    # PTT: endpoint fired but button still held — treat as done.
                    self._spawn_turn(pcm)

    def _maybe_partial(self) -> None:
        if self._partial_task and not self._partial_task.done():
            return
        if len(self._utt_buf) < 16000:  # <0.5 s — too early
            return
        snapshot = bytes(self._utt_buf)

        async def _run():
            text = await asyncio.get_running_loop().run_in_executor(
                None, self.stt.transcribe_partial, snapshot)
            if text:
                self.bus.publish({"t": "stt.partial", "text": text})
        self._partial_task = asyncio.get_running_loop().create_task(_run())

    # ------------------------------------------------------------- barge-in
    def barge_in(self, reason: str = "user") -> None:
        if self._tts_cancel:
            self._tts_cancel.set()
        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()
        if self._speaking or (self._turn_task and not self._turn_task.done()):
            self._set_state("interrupted", detail=reason)
            metrics.counter("barge_ins")

    # ------------------------------------------------------------- turns
    def _spawn_turn(self, pcm: bytes) -> None:
        self._turn_task = asyncio.get_running_loop().create_task(self._voice_turn(pcm))

    async def _voice_turn(self, pcm: bytes) -> None:
        turn_id = f"t{int(time.time() * 1000) % 10 ** 10}"
        t_endpoint = time.monotonic()
        self._set_state("transcribing", turn_id=turn_id)
        text, ms_stt = await self._stt_final(pcm)
        self.bus.publish({"t": "stt.final", "text": text, "ms": ms_stt, "turn_id": turn_id})
        metrics.record("stt", ms_stt)

        if not text.strip():
            self._set_state("idle")
            return
        if self._echo_of_own_speech(text):
            self.bus.publish({"t": "state", "value": "idle", "detail": "echo rejected"})
            self.state = "idle"
            return
        await self.run_turn(text, turn_id=turn_id, t_endpoint=t_endpoint)

    async def run_turn(self, text: str, turn_id: str = "",
                       t_endpoint: Optional[float] = None) -> dict[str, Any]:
        """Shared by voice path and /converse (typed) path."""
        async with self._turn_lock:
            turn_id = turn_id or f"t{int(time.time() * 1000) % 10 ** 10}"
            t_endpoint = t_endpoint or time.monotonic()
            self._set_state("thinking", turn_id=turn_id)

            sentence_q: asyncio.Queue[Optional[str]] = asyncio.Queue()
            self._tts_cancel = asyncio.Event()
            speak_task = asyncio.get_running_loop().create_task(
                self._speaker(sentence_q, turn_id, t_endpoint))

            sent_buf = ""

            def on_delta(d: str) -> None:
                nonlocal sent_buf
                self.bus.publish({"t": "mediator.delta", "text": d, "turn_id": turn_id})
                sent_buf += d
                while True:
                    cut = self._sentence_cut(sent_buf)
                    if cut is None:
                        break
                    sentence, sent_buf = sent_buf[:cut].strip(), sent_buf[cut:]
                    if sentence:
                        sentence_q.put_nowait(sentence)

            def on_tool(name: str, args: dict, phase: str) -> None:
                state = {"memory_recall": "memory", "capability_search": "capability",
                         "delegate_task": "delegating"}.get(name, "tool")
                if phase == "start":
                    self._set_state(state, detail=name, turn_id=turn_id)
                self.bus.publish({"t": "meta_tool", "name": name, "args": args,
                                  "phase": phase, "turn_id": turn_id})

            try:
                result = await self.mediator.turn(
                    text, tools=self._dispatch_meta_tool,
                    on_delta=on_delta, on_tool=on_tool, cancel=self._tts_cancel)
            except asyncio.CancelledError:
                sentence_q.put_nowait(None)
                await asyncio.gather(speak_task, return_exceptions=True)
                raise
            except Exception as e:  # noqa: BLE001
                self._set_state("error", detail=str(e)[:200])
                sentence_q.put_nowait(None)
                await asyncio.gather(speak_task, return_exceptions=True)
                return {"reply_text": "", "error": str(e), "turn_id": turn_id}

            if sent_buf.strip():
                sentence_q.put_nowait(sent_buf.strip())
            sentence_q.put_nowait(None)
            await speak_task

            self.bus.publish({"t": "mediator.done", "text": result["text"],
                              "ms_first_token": result["ms_first_token"],
                              "ms_total": result["ms_total"], "turn_id": turn_id})
            metrics.record("mediator_first_token", result["ms_first_token"])
            self.db.add_turn(turn_id, transcript=text, reply=result["text"],
                             ms_first_token=result["ms_first_token"])
            if self.state not in ("interrupted", "error", "blocked"):
                self._set_state("done", turn_id=turn_id)
                self._set_state("idle")
            return {"reply_text": result["text"],
                    "actions": [c["name"] for c in result["tool_calls"]],
                    "turn_id": turn_id}

    async def _speaker(self, q: asyncio.Queue, turn_id: str,
                       t_endpoint: float) -> None:
        first = True
        cancel = self._tts_cancel
        while True:
            sentence = await q.get()
            if sentence is None or (cancel and cancel.is_set()):
                break
            if first:
                self._set_state("speaking", turn_id=turn_id)
                self._speaking = True
            self.bus.publish({"t": "tts.start", "text": sentence, "turn_id": turn_id})

            loop = asyncio.get_running_loop()

            def on_chunk(data: bytes, samples: int) -> None:
                loop.call_soon_threadsafe(
                    self.bus.publish_binary, {"t": "tts.chunk_hdr", "samples": samples,
                                              "turn_id": turn_id}, data)

            def on_amp(v: float) -> None:
                loop.call_soon_threadsafe(
                    self.bus.publish, {"t": "tts.amp", "v": round(v, 3)})

            stats = await self.tts.speak(sentence, on_chunk=on_chunk, on_amp=on_amp,
                                         voice=self.cfg.tts.voice, speed=self.cfg.tts.speed,
                                         cancel_event=cancel)
            if first:
                e2e = (time.monotonic() - t_endpoint) * 1000
                self.bus.publish({"t": "latency", "stage": "e2e_first_audio",
                                  "ms": round(e2e, 1), "turn_id": turn_id})
                metrics.record("e2e_first_audio", e2e)
                metrics.record("tts_first_chunk", stats.get("ms_first_chunk", 0))
                first = False
        self._speaking = False
        self.bus.publish({"t": "tts.end", "turn_id": turn_id})

    # ------------------------------------------------------------- helpers
    async def _stt_final(self, pcm: bytes) -> tuple[str, float]:
        t0 = time.monotonic()
        text = await asyncio.get_running_loop().run_in_executor(
            None, lambda: self.stt.transcribe_final(pcm)[0])
        return text, (time.monotonic() - t0) * 1000

    def _echo_of_own_speech(self, text: str) -> bool:
        """Half-duplex leak guard: transcript ≈ tail of what Jarvis just said."""
        last = (self.mediator.last_reply or "")[-300:].lower()
        if not last or len(text) < 12:
            return False
        ratio = difflib.SequenceMatcher(None, text.lower(), last).ratio()
        return ratio > 0.75 or text.lower() in last

    @staticmethod
    def _sentence_cut(buf: str) -> Optional[int]:
        for i, ch in enumerate(buf):
            if ch in ".!?" and i >= 24 and (i + 1 == len(buf) or buf[i + 1] in " \n"):
                return i + 1
        if len(buf) > 220:  # runaway clause — cut on last comma/space
            j = max(buf.rfind(",", 0, 220), buf.rfind(" ", 0, 220))
            return j + 1 if j > 40 else 220
        return None

    # ------------------------------------------------------------- meta-tools
    async def _dispatch_meta_tool(self, name: str, args: dict) -> dict[str, Any]:
        if name == "memory_recall":
            q = str(args.get("query", ""))[:300]
            hits = await asyncio.get_running_loop().run_in_executor(
                None, self.memory.search, q)
            card = self.memory.build_card(q, hits, self.cfg.budgets.context_card_tokens)
            self.bus.publish({"t": "memory.hits",
                              "items": [{"path": h["path"], "title": h["title"],
                                         "score": h["score"]} for h in hits[:5]]})
            return {"card": card, "sources": len(hits)}

        if name == "capability_search":
            return {"capabilities": self.caps.search(str(args.get("query", ""))[:200]),
                    "note": "Nothing has been started. To do the work, call delegate_task now."}

        if name == "quick_action":
            return self._quick_action(str(args.get("action_id", "")))

        if name == "delegate_task":
            goal = str(args.get("goal", "")).strip()
            if not goal:
                return {"error": "goal required"}
            kind = args.get("kind", "granite")
            if kind not in ("granite", "codex"):
                kind = "granite"
            cap = self.caps.best(goal)
            toolsets = cap["toolsets"] if cap and cap["kind"] == "granite" else ["file", "terminal"]
            if cap and cap["kind"] == "codex":
                kind = "codex"
            return await self.workers.delegate(
                goal=goal, kind=kind, context=str(args.get("context", ""))[:2000],
                toolsets=toolsets, capability_id=cap["id"] if cap else "")

        if name == "task_status":
            return {"tasks": self.workers.status(str(args.get("task_id", "")))}

        if name == "task_control":
            return self.workers.control(str(args.get("task_id", "")),
                                        str(args.get("action", "")))
        return {"error": f"unknown tool {name}"}

    def _quick_action(self, action_id: str) -> dict[str, Any]:
        if action_id == "time.now":
            now = datetime.datetime.now()
            return {"speech": now.strftime("It's %H:%M on %A, %B %d.")}
        if action_id == "system.status":
            h = {"stt": self.stt.component_status(), "tts": self.tts.component_status(),
                 "mediator": self.mediator.component_status()}
            bad = [k for k, v in h.items() if not v.get("ok")]
            return {"speech": "All systems are running." if not bad
                    else f"Problems with: {', '.join(bad)}."}
        if action_id == "tasks.list":
            return {"tasks": self.workers.status("")}
        if action_id == "say.again":
            return {"speech": self.mediator.last_reply or "I haven't said anything yet."}
        return {"error": f"unknown quick action {action_id}"}

    # ------------------------------------------------------------- task events
    def _on_task_event(self, task: dict) -> None:
        """WorkerManager calls this on completion-grade transitions; the mediator
        surfaces it on the next turn, and finished tasks are announced aloud."""
        self.mediator.notify_task_event(task)
        if task.get("status") in ("done", "failed", "needs_review") and not self._speaking:
            summary = task.get("result_summary") or ""
            verdict = {"done": "finished", "failed": "failed",
                       "needs_review": "finished but needs your review"}[task["status"]]
            text = f"Task update: {task.get('title', 'a task')} {verdict}. {summary[:160]}"
            asyncio.get_running_loop().create_task(self._announce(text))

    async def _announce(self, text: str) -> None:
        if self._speaking or self.state not in ("idle", "done"):
            return
        self._tts_cancel = asyncio.Event()
        self._set_state("speaking", detail="task announcement")
        self._speaking = True
        loop = asyncio.get_running_loop()
        await self.tts.speak(text,
                             on_chunk=lambda d, s: loop.call_soon_threadsafe(
                                 self.bus.publish_binary,
                                 {"t": "tts.chunk_hdr", "samples": s}, d),
                             on_amp=lambda v: loop.call_soon_threadsafe(
                                 self.bus.publish, {"t": "tts.amp", "v": round(v, 3)}),
                             voice=self.cfg.tts.voice, speed=self.cfg.tts.speed,
                             cancel_event=self._tts_cancel)
        self._speaking = False
        self._set_state("idle")

    def component_status(self) -> dict[str, Any]:
        return {"ok": True, "detail": f"state={self.state} mode={self.mode}"}
