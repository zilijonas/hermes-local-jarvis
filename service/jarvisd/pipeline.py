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
import re
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
        self._tts_cancel: Optional[asyncio.Event] = None
        self._speaking = False
        self._turn_lock = asyncio.Lock()
        self._loop = asyncio.get_event_loop()
        self._announce_queue: list[str] = []
        self._turn_active = False
        self._tts_last_end = 0.0          # echo rejection only near real playback
        self._pending_voiced_ms = 0.0     # sustained-voice accumulator for barge-in
        # Turns are SERIALIZED through a queue, never cancelled mid-thought. A
        # follow-up spoken while Jarvis is working ("while you're doing that, also
        # tell me X") enqueues as the next turn — so BOTH questions get answered and
        # no in-flight tool/delegation is thrown away. Barge-in only stops audio
        # playback; it never kills the mediator or a background task.
        self._turn_queue: "asyncio.Queue[dict]" = asyncio.Queue()
        self._drainer: Optional[asyncio.Task] = None
        workers.on_task_event = self._on_task_event  # optional hook
        workers.wait_turn_clear = self._wait_turn_clear

    async def _wait_turn_clear(self) -> None:
        """Workers hold their (mediator-evicting) model load until no voice turn
        is mid-flight, so gemma never dies right before it must speak."""
        while self._turn_active or self._speaking:
            await asyncio.sleep(0.25)

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
        # Pre-warm the mediator while the user is still talking: if a worker run
        # evicted gemma, the ~6 s reload happens under the utterance, not after it.
        asyncio.get_running_loop().create_task(self.mediator.warmup())

    def mic_stop(self) -> None:
        """PTT release: whatever is buffered becomes the utterance."""
        self.mic_active = False
        pcm = bytes(self._utt_buf) + self.vad.flush()
        self._utt_buf.clear()
        if len(pcm) >= 3200:  # ≥100 ms of speech-ish audio
            self._spawn_turn(pcm)
        elif not self._turn_active and self._turn_queue.empty() and not self._speaking:
            self._set_state("idle")

    # Sustained real speech (not a lone blip) needed before we stop playback.
    _BARGE_MS_SPEAKING = 240

    def feed_audio(self, chunk: bytes) -> None:
        if not self.mic_active:
            return
        for kind, payload in self.vad.feed(chunk):
            if kind == "speech_start":
                self._pending_voiced_ms = 0.0
            elif kind == "chunk":
                self._utt_buf.extend(payload)
                self._maybe_partial()
                # Only barge to stop AUDIO while speaking. While thinking we let the
                # turn finish and just buffer this utterance — it becomes the next
                # queued turn (no work is thrown away).
                if self._speaking and self._pending_voiced_ms >= 0:
                    self._pending_voiced_ms += 20.0
                    if self._pending_voiced_ms >= self._BARGE_MS_SPEAKING:
                        self.barge_in("sustained voice")
                        self._pending_voiced_ms = float("-inf")  # once per utterance
            elif kind == "speech_end":
                self._pending_voiced_ms = 0.0
                pcm = bytes(payload)
                self._utt_buf.clear()
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

    # ------------------------------------------------------------- WS adapter
    # ws.py's contract: it awaits these two on every inbound frame.
    _MAX_AUDIO_FRAME = 256 * 1024  # ~8 s of 16 kHz s16le; anything bigger is garbage

    async def handle_audio_chunk(self, raw: bytes) -> None:
        if len(raw) > self._MAX_AUDIO_FRAME:
            return  # drop oversized frames, never crash the connection
        self.feed_audio(raw)

    async def handle_client_event(self, event: dict) -> None:
        t = event.get("t")
        if t == "mic.start":
            self.mic_start()
        elif t == "mic.stop":
            self.mic_stop()
        elif t == "mode.set":
            mode = event.get("mode")
            if mode in ("ptt", "vad"):
                self.mode = mode
                self.bus.publish({"t": "state", "value": self.state,
                                  "detail": f"mode={mode}"})
        elif t == "barge_in":
            self.barge_in("client")
        elif t == "turn.text":
            text = str(event.get("text", "")).strip()
            if text:
                # never block the WS receive loop on a full turn
                self._enqueue_turn(text)
        elif t == "task.control":
            result = self.workers.control(str(event.get("id", "")),
                                          str(event.get("action", "")))
            if not result.get("ok"):
                self.bus.publish({"t": "error", "message": result.get("error", ""),
                                  "recoverable": True})

    # ------------------------------------------------------------- barge-in
    def barge_in(self, reason: str = "user") -> None:
        """Stop the CURRENT audio playback only. Never cancels the mediator or a
        background task — the user's next utterance queues as the next turn."""
        if not self._speaking:
            return
        if self._tts_cancel:
            self._tts_cancel.set()
        self._speaking = False
        self._tts_last_end = time.monotonic()
        self.bus.publish({"t": "tts.end", "interrupted": True})
        self._set_state("interrupted", detail=reason)
        metrics.counter("barge_ins")

    # ------------------------------------------------------------- turns (queued)
    def _spawn_turn(self, pcm: bytes) -> None:
        # Transcribe off the queue-drain path so STT of a follow-up overlaps the
        # current turn; the resulting text is what gets enqueued.
        asyncio.get_running_loop().create_task(self._transcribe_and_enqueue(pcm))

    async def _transcribe_and_enqueue(self, pcm: bytes) -> None:
        turn_id = f"t{int(time.time() * 1000) % 10 ** 10}"
        if not (self._turn_active or not self._turn_queue.empty()):
            self._set_state("transcribing", turn_id=turn_id)
        text, ms_stt = await self._stt_final(pcm)
        self.bus.publish({"t": "stt.final", "text": text, "ms": ms_stt, "turn_id": turn_id})
        metrics.record("stt", ms_stt)
        if not text.strip():
            if not self._turn_active and self._turn_queue.empty() and not self._speaking:
                self._set_state("idle", detail="no speech recognized")
            return
        if self._echo_of_own_speech(text):
            self.bus.publish({"t": "stt.ignored", "reason": "echo of my own speech",
                              "text": text, "turn_id": turn_id})
            if not self._turn_active and self._turn_queue.empty() and not self._speaking:
                self._set_state("idle", detail="echo rejected")
            return
        self._enqueue_turn(text, turn_id, time.monotonic())

    def _enqueue_turn(self, text: str, turn_id: str = "",
                      t_endpoint: Optional[float] = None) -> None:
        self._turn_queue.put_nowait({"text": text, "turn_id": turn_id,
                                     "t_endpoint": t_endpoint})
        if self._drainer is None or self._drainer.done():
            self._drainer = asyncio.get_running_loop().create_task(self._drain_turns())

    async def _drain_turns(self) -> None:
        while not self._turn_queue.empty():
            item = self._turn_queue.get_nowait()
            try:
                await self.run_turn(item["text"], turn_id=item.get("turn_id", ""),
                                    t_endpoint=item.get("t_endpoint"))
            except Exception as e:  # noqa: BLE001 — one bad turn must not stop the queue
                self.bus.publish({"t": "error", "message": f"turn failed: {e}"[:300],
                                  "recoverable": True})
                self.bus.publish({"t": "state", "value": "error",
                                  "detail": str(e)[:120]})
        if not self._speaking:
            self._set_state("idle")
        self._drain_announcements()

    async def run_turn(self, text: str, turn_id: str = "",
                       t_endpoint: Optional[float] = None) -> dict[str, Any]:
        """Shared by voice path and /converse (typed) path."""
        async with self._turn_lock:
            turn_id = turn_id or f"t{int(time.time() * 1000) % 10 ** 10}"
            t_endpoint = t_endpoint or time.monotonic()
            self._turn_active = True
            self._set_state("thinking", turn_id=turn_id)

            sentence_q: asyncio.Queue[Optional[str]] = asyncio.Queue()
            self._tts_cancel = asyncio.Event()
            speak_task = asyncio.get_running_loop().create_task(
                self._speaker(sentence_q, turn_id, t_endpoint))

            sent_buf = ""
            cuts_done = 0

            def on_delta(d: str) -> None:
                nonlocal sent_buf, cuts_done
                self.bus.publish({"t": "mediator.delta", "text": d, "turn_id": turn_id})
                sent_buf += d
                while True:
                    cut = self._sentence_cut(sent_buf, first=(cuts_done == 0))
                    if cut is None:
                        break
                    sentence, sent_buf = sent_buf[:cut].strip(), sent_buf[cut:]
                    if sentence:
                        sentence_q.put_nowait(sentence)
                        cuts_done += 1

            def on_tool(name: str, args: dict, phase: str) -> None:
                state = {"memory_recall": "memory", "capability_search": "capability",
                         "delegate_task": "delegating"}.get(name, "tool")
                if phase == "start":
                    self._set_state(state, detail=name, turn_id=turn_id)
                self.bus.publish({"t": "meta_tool", "name": name, "args": args,
                                  "phase": phase, "turn_id": turn_id})

            try:
                # Hard cap: a wedged mediator/tool must never leave the assistant
                # deaf-mute behind the turn lock.
                result = await asyncio.wait_for(
                    self.mediator.turn(
                        text, tools=self._dispatch_meta_tool,
                        on_delta=on_delta, on_tool=on_tool, cancel=self._tts_cancel),
                    timeout=90.0)
            except asyncio.TimeoutError:
                self._set_state("error", detail="turn timed out")
                self.bus.publish({"t": "error", "message":
                                  "That took too long and I gave up on it. Try again?",
                                  "recoverable": True})
                sentence_q.put_nowait(None)
                await asyncio.gather(speak_task, return_exceptions=True)
                return {"reply_text": "", "error": "turn timed out", "turn_id": turn_id}
            except Exception as e:  # noqa: BLE001
                self._set_state("error", detail=str(e)[:200])
                self.bus.publish({"t": "error", "message": f"Something went wrong: {e}"[:200],
                                  "recoverable": True})
                sentence_q.put_nowait(None)
                await asyncio.gather(speak_task, return_exceptions=True)
                return {"reply_text": "", "error": str(e), "turn_id": turn_id}
            finally:
                self._turn_active = False

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
            # Only settle to idle if this was the last queued turn; otherwise the
            # drainer moves straight to the next one without a visible idle flicker.
            if self._turn_queue.empty() and self.state not in ("error", "blocked"):
                self._set_state("done", turn_id=turn_id)
                if not self._speaking:
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
                if cancel and cancel.is_set():
                    return  # barge-in already announced tts.end — drop late audio
                loop.call_soon_threadsafe(
                    self.bus.publish_binary, {"t": "tts.chunk_hdr", "samples": samples,
                                              "turn_id": turn_id}, data)

            def on_amp(v: float) -> None:
                loop.call_soon_threadsafe(
                    self.bus.publish, {"t": "tts.amp", "v": round(v, 3)})

            try:
                stats = await self.tts.speak(sentence, on_chunk=on_chunk, on_amp=on_amp,
                                             voice=self.cfg.tts.voice, speed=self.cfg.tts.speed,
                                             cancel_event=cancel)
            except Exception as e:  # noqa: BLE001 — a TTS failure must never mute the reply
                self.bus.publish({"t": "error", "message": f"tts failed: {e}",
                                  "recoverable": True})
                try:
                    stats = await asyncio.get_running_loop().run_in_executor(
                        None, lambda: self.tts.say_fallback(sentence, on_chunk, on_amp,
                                                            cancel_event=cancel))
                except Exception:
                    stats = {"ms_first_chunk": 0}
            if first:
                e2e = (time.monotonic() - t_endpoint) * 1000
                self.bus.publish({"t": "latency", "stage": "e2e_first_audio",
                                  "ms": round(e2e, 1), "turn_id": turn_id})
                metrics.record("e2e_first_audio", e2e)
                metrics.record("tts_first_chunk", stats.get("ms_first_chunk", 0))
                first = False
        self._speaking = False
        self._tts_last_end = time.monotonic()
        if not (cancel and cancel.is_set()):  # barge_in already sent an interrupted tts.end
            self.bus.publish({"t": "tts.end", "turn_id": turn_id})

    # ------------------------------------------------------------- helpers
    async def _stt_final(self, pcm: bytes) -> tuple[str, float]:
        t0 = time.monotonic()
        text = await asyncio.get_running_loop().run_in_executor(
            None, lambda: self.stt.transcribe_final(pcm)[0])
        return text, (time.monotonic() - t0) * 1000

    def _echo_of_own_speech(self, text: str) -> bool:
        """Speaker-leak guard: transcript ≈ tail of what Jarvis just said.

        Only meaningful while playback is running or just ended — a user
        utterance from silence can legitimately reuse Jarvis's words and must
        NEVER be eaten (that was the 'transcript disappears' bug)."""
        near_playback = self._speaking or (time.monotonic() - self._tts_last_end) < 2.5
        if not near_playback:
            return False
        last = (self.mediator.last_reply or "")[-300:].lower()
        if not last or len(text) < 12:
            return False
        ratio = difflib.SequenceMatcher(None, text.lower(), last).ratio()
        return ratio > 0.75 or text.lower() in last

    @staticmethod
    def _sentence_cut(buf: str, first: bool = False) -> Optional[int]:
        # First fragment cuts aggressively so TTS starts ASAP (kokoro synthesizes
        # per-fragment; a short lead fragment shaves seconds off first audio).
        min_len = 10 if first else 24
        for i, ch in enumerate(buf):
            if ch in ".!?" and i >= min_len and (i + 1 == len(buf) or buf[i + 1] in " \n"):
                return i + 1
            if first and ch in ",;:" and i >= 16:
                return i + 1
        limit = 90 if first else 220
        if len(buf) > limit:  # runaway clause — cut on last space
            j = max(buf.rfind(",", 0, limit), buf.rfind(" ", 0, limit))
            return j + 1 if j > min_len else limit
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
        if action_id.startswith("memory.note"):
            return self._memory_note(action_id)
        return {"error": f"unknown quick action {action_id}"}

    def _memory_note(self, action_id: str) -> dict[str, Any]:
        """Conservative memory write: a new triage-flagged note in the vault inbox.
        Never edits existing notes; the curator/human reviews and files it."""
        text = action_id.partition(":")[2].strip() or (self.mediator.history[-2]["content"]
                                                       if len(self.mediator.history) >= 2 else "")
        if not text:
            return {"error": "nothing to note"}
        if re.search(r"(api[_-]?key|token|secret|password)\s*[:=]", text, re.I):
            return {"error": "refusing to store something that looks like a secret"}
        import datetime as _dt
        vault = self.cfg.path_for("vault")
        inbox = vault / "00-inbox"
        if not inbox.is_dir():
            return {"error": "vault inbox not found"}
        ts = _dt.datetime.now()
        path = inbox / f"jarvis-note-{ts.strftime('%Y%m%d-%H%M%S')}.md"
        path.write_text(
            "---\n"
            f"title: Jarvis note {ts.strftime('%Y-%m-%d %H:%M')}\n"
            "type: capture\nstatus: triage\nsource: jarvis\n"
            f"created: {ts.strftime('%Y-%m-%d')}\nupdated: {ts.strftime('%Y-%m-%d')}\n"
            "tags: [jarvis-voice]\n---\n\n"
            f"{text[:2000]}\n")
        self.bus.publish({"t": "memory.hits",
                          "items": [{"path": str(path), "title": "note saved (triage)",
                                     "score": 1.0}]})
        return {"speech": "Noted. I saved that to your inbox for review.",
                "path": str(path)}

    # ------------------------------------------------------------- task events
    def _on_task_event(self, task: dict) -> None:
        """WorkerManager calls this on completion-grade transitions; the mediator
        surfaces it on the next turn, and finished tasks are announced aloud."""
        self.mediator.notify_task_event(task)
        # A granite worker run usually evicted gemma (24 GB box can't hold both) —
        # re-warm the mediator now so the next voice turn isn't a 6 s cold load.
        asyncio.get_running_loop().create_task(self.mediator.warmup())
        if task.get("status") in ("done", "failed", "needs_review"):
            summary = task.get("result_summary") or ""
            verdict = {"done": "finished", "failed": "failed",
                       "needs_review": "finished but needs your review"}[task["status"]]
            text = f"Task update: {task.get('title', 'a task')} {verdict}. {summary[:160]}"
            asyncio.get_running_loop().create_task(self._announce(text))

    def _drain_announcements(self) -> None:
        """Speak queued announcements once the floor is free (never drop them)."""
        if self._announce_queue and not self._speaking and self.state in ("idle", "done"):
            text = self._announce_queue.pop(0)
            asyncio.get_running_loop().create_task(self._announce(text))

    async def _announce(self, text: str) -> None:
        if self._speaking or self._turn_active or self.state not in ("idle", "done"):
            # Busy — queue instead of dropping; drained at end of the current turn.
            self._announce_queue.append(text)
            if len(self._announce_queue) > 5:
                self._announce_queue = self._announce_queue[-5:]
            return
        # Same lock as run_turn: an announcement must never race a live turn's
        # _tts_cancel/_speaking state (empty-reply hazard seen in quality battery).
        async with self._turn_lock:
            await self._announce_locked(text)

    async def _announce_locked(self, text: str) -> None:
        self._tts_cancel = asyncio.Event()
        turn_id = f"a{int(time.time() * 1000) % 10 ** 10}"
        # Anything spoken is ALSO shown in the conversation log — no audio-only
        # message the user can't scroll back to (goal #2 audio↔text completeness).
        self.bus.publish({"t": "mediator.delta", "text": text, "turn_id": turn_id,
                          "kind": "announcement"})
        self.bus.publish({"t": "mediator.done", "text": text, "turn_id": turn_id,
                          "kind": "announcement", "ms_first_token": 0, "ms_total": 0})
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
        self.bus.publish({"t": "tts.end", "turn_id": turn_id})
        self._set_state("idle")
        self._drain_announcements()

    def component_status(self) -> dict[str, Any]:
        return {"ok": True, "detail": f"state={self.state} mode={self.mode}"}
