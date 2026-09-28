"""Voice pipeline orchestrator — ties audio, mediator, memory, capabilities and
workers together and drives the UI state machine over the event bus.

States (SPEC §WebSocket `state`): idle → listening → transcribing → thinking
→ (memory|capability|tool|delegating) → speaking → idle, with `interrupted`,
`blocked`, `error` as cross-cuts. The server is authoritative; the UI renders
exactly what this module publishes — nothing is faked.

Turn taking (2026-09-28 rework):
  * push-to-talk: everything between press and release is ONE utterance. The VAD
    no longer splits it on pauses (that was one source of "chopped sentences").
  * hands-free: Silero VAD + Smart Turn v3 decide when the user finished
    (audio/turn.py). If the user starts speaking again before Jarvis has made a
    sound, the half-answered turn is aborted and the two fragments are merged
    into one turn (`stt.final` with merged=true), so a mid-sentence pause never
    gets its own answer.
  * "speaking" lasts until the audio has actually PLAYED, not until synthesis
    finished: the server tracks queued playback time and the client confirms
    with `playback.end`. Echo rejection and barge-in key off real playback.
  * barge-in while Jarvis talks needs sustained voice AND at least two
    transcribed words that are not an echo of what Jarvis is saying.
"""
from __future__ import annotations

import asyncio
import datetime
import difflib
import re
import time
from typing import Any, Optional

from .audio.turn import build_endpointer
from .audio.stt import StreamingSTT
from .audio.tts import StreamingTTS, plain_typography, speakable
from .mediator.loop import Mediator
from .reminders import ReminderScheduler
from . import metrics

TTS_RATE = 24000
_SIDE_EFFECT_TOOLS = ("delegate_task", "task_control")
# Said the instant a slow tool starts when nothing has been spoken yet: a tool turn
# is two LLM round trips, and silence for 3-5 s reads as "didn't hear me".
_TOOL_ACKS = {"delegate_task": "On it.", "memory_recall": "Let me check.",
              "deep_answer": "Let me think.", "capability_search": "One sec."}
_CODEX_RE = re.compile(r"\bcodex\b", re.I)
_CLAUDE_RE = re.compile(r"\bclaude( code)?\b", re.I)


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
        self.vad, self.vad_label = build_endpointer(dict(cfg.data.get("vad") or {}))
        self.state = "idle"
        self.mode = "ptt"
        self.mic_active = False
        stt_cfg = cfg.data.get("stt") or {}
        self._partial_every = max(0.2, float(stt_cfg.get("partial_interval_ms", 400)) / 1000)
        # current utterance
        self._utt_buf = bytearray()
        self._utt_id = ""
        self._utt_seq = 0
        self._finalized: set[str] = set()
        self._partial_task: Optional[asyncio.Task] = None
        self._last_partial_at = 0.0
        # playback
        self._tts_cancel: Optional[asyncio.Event] = None
        self._speaking = False            # a reply/announcement owns the speaker
        self._play_until = 0.0            # monotonic time queued audio finishes playing
        self._last_audible = 0.0
        self._recent_spoken = ""          # what Jarvis said lately (echo reference)
        # barge-in
        self._barge_voiced_ms = 0.0
        self._barge_checking = False
        self._barge_done = False
        # turns
        self._turn_lock = asyncio.Lock()
        self._announce_queue: list[str] = []
        self._turn_active = False
        self._current: Optional[dict[str, Any]] = None
        self._carry: Optional[dict[str, Any]] = None
        # Turns are SERIALIZED, never cancelled mid-thought once they have spoken or
        # started work. A follow-up while Jarvis works queues as the next turn.
        self._pending: list[dict[str, Any]] = []
        self._drainer: Optional[asyncio.Task] = None
        # Reminders Jarvis owns (jarvis.db + timer); app.py starts the scheduler.
        self.reminders = ReminderScheduler(db, self._announce)
        workers.on_task_event = self._on_task_event  # optional hook
        workers.wait_turn_clear = self._wait_turn_clear

    async def _wait_turn_clear(self) -> None:
        """Workers start once no voice turn is mid-flight, so a worker's prefill
        never competes with an utterance for the GPU."""
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

    def _busy(self) -> bool:
        return self._turn_active or bool(self._pending) or self._speaking

    # ------------------------------------------------------------- playback clock
    def audible(self) -> bool:
        return time.monotonic() < self._play_until + 0.1

    def _audio_sent(self, samples: int) -> None:
        if not getattr(self.bus, "has_listeners", lambda: True)():
            return  # nobody is playing it (typed API call, UI closed): no clock to run
        now = time.monotonic()
        self._play_until = max(self._play_until, now) + samples / TTS_RATE
        self._last_audible = self._play_until

    def playback_ended(self) -> None:
        """Client says its player drained: trust it over the estimate."""
        now = time.monotonic()
        if self._play_until > now:
            self._play_until = now
            self._last_audible = now

    async def _wait_played(self, cancel: Optional[asyncio.Event]) -> None:
        deadline = self._play_until + 1.5
        while time.monotonic() < self._play_until and time.monotonic() < deadline:
            if cancel is not None and cancel.is_set():
                return
            await asyncio.sleep(0.05)

    # ------------------------------------------------------------- mic I/O
    def _new_utterance(self) -> str:
        self._utt_seq += 1
        self._utt_id = f"u{self._utt_seq}"
        self._utt_buf.clear()
        self._last_partial_at = 0.0
        self._barge_voiced_ms = 0.0
        self._barge_done = False
        return self._utt_id

    def mic_start(self) -> None:
        self.mic_active = True
        self.vad.reset()
        self._new_utterance()
        if self.mode == "ptt" and (self._speaking or self.audible()):
            self.barge_in("push to talk")
        if not self._busy():
            self._set_state("listening")
        # Pre-warm the mediator while the user is still talking.
        asyncio.get_running_loop().create_task(self.mediator.warmup())

    def mic_stop(self) -> None:
        """PTT release (or hands-free mic off): what is buffered becomes the utterance."""
        was_ptt = self.mode == "ptt"
        in_speech = getattr(self.vad, "in_speech", False) or getattr(self.vad, "_in_speech", False)
        self.mic_active = False
        pcm = bytes(self._utt_buf) + self.vad.flush()
        utt_id = self._utt_id
        self._utt_buf.clear()
        self.vad.reset()
        if len(pcm) >= 8000 and (was_ptt or in_speech):  # ≥250 ms
            self._spawn_turn(pcm, utt_id)
        elif not self._busy():
            self._set_state("idle")

    def feed_audio(self, chunk: bytes) -> None:
        if not self.mic_active:
            return
        if self.mode == "ptt":
            # Push-to-talk: the key decides where the utterance ends, not pauses.
            self._utt_buf.extend(chunk)
            self._maybe_partial()
            return
        for kind, payload in self.vad.feed(chunk):
            if kind == "speech_start":
                self._new_utterance()
                self.bus.publish({"t": "vad.speech", "active": True, "utt_id": self._utt_id})
                self._maybe_continuation()
            elif kind == "chunk":
                self._utt_buf.extend(payload)
                self._maybe_partial()
                if (self._speaking or self.audible()) and getattr(self.vad, "last_is_speech", True):
                    self._barge_voiced_ms += len(payload) / 32.0
                    self._maybe_barge()
            elif kind == "pending":
                self.bus.publish({"t": "turn.pending", "utt_id": self._utt_id})
            elif kind == "resume":
                self.bus.publish({"t": "vad.speech", "active": True, "utt_id": self._utt_id})
            elif kind == "speech_end":
                self.bus.publish({"t": "vad.speech", "active": False, "utt_id": self._utt_id})
                pcm = bytes(payload)
                utt_id = self._utt_id
                self._utt_buf.clear()
                self._spawn_turn(pcm, utt_id)

    def _maybe_partial(self) -> None:
        if self._partial_task and not self._partial_task.done():
            return
        now = time.monotonic()
        if len(self._utt_buf) < 12800 or now - self._last_partial_at < self._partial_every:
            return  # <0.4 s of audio, or too soon
        self._last_partial_at = now
        snapshot, utt_id = bytes(self._utt_buf), self._utt_id

        async def _run():
            text = await asyncio.get_running_loop().run_in_executor(
                None, self.stt.transcribe_partial, snapshot)
            if text and utt_id not in self._finalized:
                self.bus.publish({"t": "stt.partial", "text": text, "utt_id": utt_id})
        self._partial_task = asyncio.get_running_loop().create_task(_run())

    # ------------------------------------------------------------- continuation
    def _maybe_continuation(self) -> None:
        """User speaks again before Jarvis made a sound: the last turn was a fragment.
        Abort it (no side effects yet, nothing audible) and carry its text forward."""
        cur = self._current
        if (self.mode != "vad" or cur is None or cur.get("aborted") or cur["spoke"]
                or cur["side_effects"] or self._pending or self._carry is not None
                or self.audible() or time.monotonic() - cur["t_endpoint"] > 4.0):
            return
        cur["aborted"] = True
        if self._tts_cancel:
            self._tts_cancel.set()
        self._carry = {"text": cur["text"], "turn_id": cur["turn_id"]}
        metrics.counter("turn_merges")

    # ------------------------------------------------------------- WS adapter
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
                self.vad.reset()
                self.bus.publish({"t": "state", "value": self.state,
                                  "detail": f"mode={mode}"})
        elif t == "barge_in":
            self.barge_in("client")
        elif t == "playback.end":
            self.playback_ended()
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
    _BARGE_MS = 300

    def _maybe_barge(self) -> None:
        if (self._barge_done or self._barge_checking
                or self._barge_voiced_ms < self._BARGE_MS):
            return
        self._barge_checking = True
        snapshot = bytes(self._utt_buf)

        async def _check():
            try:
                text = await asyncio.get_running_loop().run_in_executor(
                    None, self.stt.transcribe_partial, snapshot)
                if text is None:
                    return  # decoder busy — the next voiced frame re-checks
                words = re.findall(r"[A-Za-z']+", text)
                if len(words) >= 2 and not self._is_echo(text, near=True):
                    self._barge_done = True
                    self.barge_in("you spoke")
            finally:
                self._barge_checking = False
        asyncio.get_running_loop().create_task(_check())

    def barge_in(self, reason: str = "user") -> None:
        """Stop the CURRENT audio playback. Work already started keeps running; the
        user's words become the next turn."""
        if not (self._speaking or self.audible()):
            return
        if self._tts_cancel:
            self._tts_cancel.set()
        self._speaking = False
        now = time.monotonic()
        self._play_until = now
        self._last_audible = now
        self.bus.publish({"t": "tts.end", "interrupted": True})
        self._set_state("interrupted", detail=reason)
        metrics.counter("barge_ins")

    # ------------------------------------------------------------- turns (queued)
    def _spawn_turn(self, pcm: bytes, utt_id: str = "") -> None:
        # Transcribe off the drain path so STT of a follow-up overlaps the current turn.
        asyncio.get_running_loop().create_task(self._transcribe_and_enqueue(pcm, utt_id))

    async def _transcribe_and_enqueue(self, pcm: bytes, utt_id: str = "") -> None:
        t_endpoint = time.monotonic()
        turn_id = f"t{int(time.time() * 1000) % 10 ** 10}"
        if not self._busy():
            self._set_state("transcribing", turn_id=turn_id)
        text, ms_stt = await self._stt_final(pcm)
        if utt_id:
            self._finalized.add(utt_id)
            if len(self._finalized) > 200:
                self._finalized = set(sorted(self._finalized)[-100:])
        metrics.record("stt", ms_stt)
        text = text.strip()
        carry, self._carry = self._carry, None

        if not text or self._is_echo(text):
            ignored = bool(text)
            if text:
                self.bus.publish({"t": "stt.ignored", "reason": "echo of my own speech",
                                  "text": text, "turn_id": turn_id, "utt_id": utt_id})
            if carry:  # the continuation was noise: answer the original fragment
                self._enqueue_turn(carry["text"], carry["turn_id"], t_endpoint)
            elif not self._busy():
                self._set_state("idle", detail="echo rejected" if ignored
                                else "no speech recognized")
            return

        merged = False
        if carry:
            text, turn_id, merged = f"{carry['text']} {text}", carry["turn_id"], True
        elif self._pending:
            last = self._pending[-1]
            last["text"] = f"{last['text']} {text}"
            self.bus.publish({"t": "stt.final", "text": last["text"], "ms": ms_stt,
                              "turn_id": last["turn_id"], "utt_id": utt_id, "merged": True})
            return
        self.bus.publish({"t": "stt.final", "text": text, "ms": ms_stt, "turn_id": turn_id,
                          "utt_id": utt_id, "merged": merged})
        self._enqueue_turn(text, turn_id, t_endpoint)

    def _enqueue_turn(self, text: str, turn_id: str = "",
                      t_endpoint: Optional[float] = None) -> None:
        self._pending.append({"text": text,
                              "turn_id": turn_id or f"t{int(time.time() * 1000) % 10 ** 10}",
                              "t_endpoint": t_endpoint})
        if self._drainer is None or self._drainer.done():
            self._drainer = asyncio.get_running_loop().create_task(self._drain_turns())

    async def _drain_turns(self) -> None:
        while self._pending:
            item = self._pending.pop(0)
            try:
                await self.run_turn(item["text"], turn_id=item["turn_id"],
                                    t_endpoint=item.get("t_endpoint"))
            except Exception as e:  # noqa: BLE001 — one bad turn must not stop the queue
                self.bus.publish({"t": "error", "message": f"turn failed: {e}"[:300],
                                  "recoverable": True})
                self.bus.publish({"t": "state", "value": "error",
                                  "detail": str(e)[:120]})
        if not self._speaking and self.state not in ("error", "blocked"):
            self._set_state("listening" if self.mic_active and self.mode == "vad" else "idle")
        self._drain_announcements()

    async def run_turn(self, text: str, turn_id: str = "",
                       t_endpoint: Optional[float] = None) -> dict[str, Any]:
        """Shared by voice path and /converse (typed) path."""
        async with self._turn_lock:
            turn_id = turn_id or f"t{int(time.time() * 1000) % 10 ** 10}"
            t_endpoint = t_endpoint or time.monotonic()
            self._turn_active = True
            cur = {"turn_id": turn_id, "text": text, "t_endpoint": t_endpoint,
                   "spoke": False, "side_effects": False, "aborted": False}
            self._current = cur
            self._set_state("thinking", turn_id=turn_id)

            sentence_q: asyncio.Queue[Optional[str]] = asyncio.Queue()
            self._tts_cancel = asyncio.Event()
            speak_task = asyncio.get_running_loop().create_task(
                self._speaker(sentence_q, turn_id, t_endpoint, cur))

            sent_buf = ""
            cuts_done = 0

            def on_delta(d: str) -> None:
                nonlocal sent_buf, cuts_done
                if cur["aborted"]:
                    return
                self.bus.publish({"t": "mediator.delta", "text": d.replace("\u2014", ",").replace("\u2026", "."),
                                  "turn_id": turn_id})
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
                         "delegate_task": "delegating", "deep_answer": "thinking"}.get(name, "tool")
                if phase == "start":
                    ack = _TOOL_ACKS.get(name)
                    if ack and not cur["spoke"] and not cur.get("acked") and not sent_buf.strip() \
                            and cuts_done == 0 and self.cfg.data.get("tts", {}).get("tool_acks", True):
                        cur["acked"] = True
                        self.bus.publish({"t": "mediator.delta", "text": ack + " ",
                                          "turn_id": turn_id, "kind": "ack"})
                        sentence_q.put_nowait(ack)
                    if name in _SIDE_EFFECT_TOOLS or (
                            name == "quick_action"
                            and str(args.get("action_id", "")).startswith("memory.note")):
                        cur["side_effects"] = True
                    self._set_state(state, detail=name, turn_id=turn_id)
                self.bus.publish({"t": "meta_tool", "name": name, "args": args,
                                  "phase": phase, "turn_id": turn_id})

            async def dispatch(name: str, args: dict) -> dict[str, Any]:
                return await self._dispatch_meta_tool(name, args, user_text=text)

            try:
                # Hard cap: a wedged mediator/tool must never leave the assistant
                # deaf-mute behind the turn lock.
                result = await asyncio.wait_for(
                    self.mediator.turn(
                        text, tools=dispatch,
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

            if cur["aborted"]:
                # Superseded by a continuation: silently drop, the merged turn follows.
                sentence_q.put_nowait(None)
                await asyncio.gather(speak_task, return_exceptions=True)
                self.bus.publish({"t": "turn.merged", "turn_id": turn_id})
                return {"reply_text": "", "merged": True, "turn_id": turn_id}

            if sent_buf.strip():
                sentence_q.put_nowait(sent_buf.strip())
            sentence_q.put_nowait(None)
            await speak_task

            result["text"] = plain_typography(result["text"])
            self.bus.publish({"t": "mediator.done", "text": result["text"],
                              "ms_first_token": result["ms_first_token"],
                              "ms_total": result["ms_total"], "turn_id": turn_id})
            metrics.record("mediator_first_token", result["ms_first_token"])
            self.db.add_turn(turn_id, transcript=text, reply=result["text"],
                             ms_first_token=result["ms_first_token"])
            # Only settle to idle if this was the last queued turn; otherwise the
            # drainer moves straight to the next one without a visible idle flicker.
            if not self._pending and self.state not in ("error", "blocked", "interrupted"):
                self._set_state("done", turn_id=turn_id)
            return {"reply_text": result["text"],
                    "actions": [c["name"] for c in result["tool_calls"]],
                    "turn_id": turn_id}

    def _remember_spoken(self, text: str) -> None:
        self._recent_spoken = (self._recent_spoken + " " + text)[-600:]

    def _emit_audio(self, loop, cancel, turn_id: str):
        def on_chunk(data: bytes, samples: int) -> None:
            if cancel is not None and cancel.is_set():
                return  # barge-in already announced tts.end — drop late audio

            def _send() -> None:
                if cancel is not None and cancel.is_set():
                    return
                self._audio_sent(samples)
                self.bus.publish_binary({"t": "tts.chunk_hdr", "samples": samples,
                                         "turn_id": turn_id}, data)
            loop.call_soon_threadsafe(_send)

        def on_amp(v: float) -> None:
            loop.call_soon_threadsafe(self.bus.publish, {"t": "tts.amp", "v": round(v, 3)})
        return on_chunk, on_amp

    async def _speaker(self, q: asyncio.Queue, turn_id: str, t_endpoint: float,
                       cur: Optional[dict] = None) -> None:
        first = True
        cancel = self._tts_cancel
        loop = asyncio.get_running_loop()
        on_chunk, on_amp = self._emit_audio(loop, cancel, turn_id)
        while True:
            sentence = await q.get()
            if sentence is None or (cancel and cancel.is_set()):
                break
            text = speakable(sentence)
            if not text:
                continue
            if first:
                if cur is not None:
                    cur["spoke"] = True
                self._set_state("speaking", turn_id=turn_id)
                self._speaking = True
            self._remember_spoken(text)
            self.bus.publish({"t": "tts.start", "text": sentence, "turn_id": turn_id})
            try:
                stats = await self.tts.speak(text, on_chunk=on_chunk, on_amp=on_amp,
                                             voice=self.cfg.tts.voice, speed=self.cfg.tts.speed,
                                             cancel_event=cancel)
            except Exception as e:  # noqa: BLE001 — a TTS failure must never mute the reply
                self.bus.publish({"t": "error", "message": f"tts failed: {e}",
                                  "recoverable": True})
                try:
                    stats = await loop.run_in_executor(
                        None, lambda: self.tts.say_fallback(text, on_chunk, on_amp,
                                                            cancel_event=cancel))
                except Exception:
                    stats = {"ms_first_chunk": 0}
            if first:
                e2e = (time.monotonic() - t_endpoint) * 1000
                self.bus.publish({"t": "latency", "stage": "e2e_first_audio",
                                  "ms": round(e2e, 1), "turn_id": turn_id})
                metrics.record("e2e_first_audio", e2e)
                metrics.record("tts_first_chunk", stats.get("ms_first_chunk") or 0)
                first = False
        if first:
            return  # nothing was spoken (aborted or empty reply)
        await self._wait_played(cancel)
        if not (cancel and cancel.is_set()):  # barge_in already sent an interrupted tts.end
            self._speaking = False
            self.bus.publish({"t": "tts.end", "turn_id": turn_id})

    # ------------------------------------------------------------- helpers
    async def _stt_final(self, pcm: bytes) -> tuple[str, float]:
        t0 = time.monotonic()
        text = await asyncio.get_running_loop().run_in_executor(
            None, lambda: self.stt.transcribe_final(pcm)[0])
        return text, (time.monotonic() - t0) * 1000

    def _is_echo(self, text: str, near: bool = False) -> bool:
        """Speaker-leak guard: transcript ≈ something Jarvis just said.

        Only meaningful while audio plays or just stopped — a user utterance from
        silence can legitimately reuse Jarvis's words and must NEVER be eaten (that
        was the 'transcript disappears' bug)."""
        if not near and not (self.audible() or time.monotonic() - self._last_audible < 1.5):
            return False
        ref = (self._recent_spoken or self.mediator.last_reply or "")[-400:].lower()
        words = re.findall(r"[a-z']+", text.lower())
        if not ref or len(words) < 2:
            return False
        low = " ".join(words)
        if low in ref:
            return True
        ref_words = set(re.findall(r"[a-z']+", ref))
        overlap = sum(1 for w in words if w in ref_words) / len(words)
        ratio = difflib.SequenceMatcher(None, low, ref[-max(len(low) * 2, 60):]).ratio()
        return overlap >= 0.85 or ratio > 0.75

    @staticmethod
    def _sentence_cut(buf: str, first: bool = False) -> Optional[int]:
        # First fragment cuts early so TTS starts ASAP; later ones prefer whole
        # sentences so prosody stays natural.
        min_len = 10 if first else 24
        for i, ch in enumerate(buf):
            if ch in ".!?" and i >= min_len and (i + 1 == len(buf) or buf[i + 1] in " \n"):
                # "e.g." / "3.5" / "Mr." are not sentence ends
                prev = buf[max(0, i - 3):i].lower()
                if ch == "." and (prev.endswith(("mr", "ms", "dr", "vs", "e.g", "i.e", "st"))
                                  or (i + 1 < len(buf) and buf[i + 1].isdigit())):
                    continue
                return i + 1
            if first and ch in ",;:" and i >= 12 and i + 1 < len(buf) and buf[i + 1] == " ":
                return i + 1
            if first and ch in "\u2014\u2013" and i >= 12:   # "Checking now — ..." : speak the lead
                return i + 1
        limit = 110 if first else 240
        if len(buf) > limit:  # runaway clause — cut on last comma/space
            j = max(buf.rfind(",", 0, limit), buf.rfind(" ", 0, limit))
            return j + 1 if j > min_len else limit
        return None

    # ------------------------------------------------------------- meta-tools
    async def _dispatch_meta_tool(self, name: str, args: dict,
                                  user_text: str = "") -> dict[str, Any]:
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

        if name == "set_reminder":
            return self.reminders.set(args.get("text", ""), args.get("in_minutes"),
                                      args.get("at"))

        if name == "deep_answer" and hasattr(self.mediator, "deep_answer"):
            return await self.mediator.deep_answer(str(args.get("question", ""))[:2000])

        if name == "delegate_task":
            goal = str(args.get("goal", "")).strip()
            if not goal:
                return {"error": "goal required"}
            # The backend the user picked governs every task. Codex / Claude Code
            # only when the user actually asked for them this turn — never because
            # the model thought a job looked big (shared weekly budgets).
            said = f"{user_text} {goal}"
            kind = ("codex" if _CODEX_RE.search(said)
                    else "claude" if _CLAUDE_RE.search(said) else "")
            cap = self.caps.best(goal)
            toolsets = cap["toolsets"] if cap and cap.get("kind") == "local" and cap.get("toolsets") \
                else ["file", "terminal"]
            context = str(args.get("context", ""))[:2000]
            if cap and cap.get("hint"):
                context = f"{context}\nHint: {cap['hint']}".strip()
            return await self.workers.delegate(
                goal=goal, kind=kind, context=context,
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
            return {"speech": now.strftime("It's %-I:%M %p on %A, %B %-d.")}
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
        if action_id == "reminders.list":
            items = self.reminders.list()
            return {"reminders": items} if items else {"speech": "You have no reminders set."}
        if action_id.startswith("reminders.cancel"):
            return self.reminders.cancel(action_id.partition(":")[2])
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
        vault = self.cfg.path_for("vault")
        inbox = vault / "00-inbox"
        if not inbox.is_dir():
            return {"error": "vault inbox not found"}
        ts = datetime.datetime.now()
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
        surfaces it on the next turn, and finished tasks are reported aloud in
        plain speech (not the worker's raw output)."""
        self.mediator.notify_task_event(task)
        loop = asyncio.get_running_loop()
        loop.create_task(self.mediator.warmup())
        if task.get("status") in ("done", "failed", "needs_review"):
            loop.create_task(self._report_task(task))

    async def _report_task(self, task: dict) -> None:
        text = ""
        summary = str(task.get("result_summary") or "")
        report = getattr(self.mediator, "report_task", None)
        if summary.startswith("Question:"):
            # The worker is blocked on the user: ask, don't "report".
            title = (task.get("title") or "that task").rstrip(".")
            text = f"Quick question about {title}: {summary[len('Question:'):].strip()}"
            report = None
        if report is not None:
            try:
                text = await asyncio.wait_for(report(task), timeout=12.0)
            except Exception:  # noqa: BLE001 — fall back to the template below
                text = ""
        if not text:
            verdict = {"done": "is done", "failed": "failed",
                       "needs_review": "finished, but needs your review"}.get(
                task.get("status"), "changed")
            summary = speakable(task.get("result_summary") or "")[:220]
            text = f"{task.get('title') or 'Your task'} {verdict}. {summary}".strip()
        await self._announce(text)

    def _drain_announcements(self) -> None:
        """Speak queued announcements once the floor is free (never drop them)."""
        if self._announce_queue and not self._busy() and self.state in ("idle", "done", "listening"):
            text = self._announce_queue.pop(0)
            asyncio.get_running_loop().create_task(self._announce(text))

    async def _announce(self, text: str) -> None:
        user_talking = self.mode == "vad" and getattr(self.vad, "in_speech", False)
        if self._busy() or user_talking or self.state not in ("idle", "done", "listening"):
            # Busy — queue instead of dropping; drained at end of the current turn.
            self._announce_queue.append(text)
            if len(self._announce_queue) > 5:
                self._announce_queue = self._announce_queue[-5:]
            return
        # Same lock as run_turn: an announcement must never race a live turn's
        # _tts_cancel/_speaking state.
        async with self._turn_lock:
            await self._announce_locked(text)

    async def _announce_locked(self, text: str) -> None:
        text = plain_typography(text)
        self._tts_cancel = asyncio.Event()
        cancel = self._tts_cancel
        turn_id = f"a{int(time.time() * 1000) % 10 ** 10}"
        # Anything spoken is ALSO shown in the conversation log.
        self.bus.publish({"t": "mediator.delta", "text": text, "turn_id": turn_id,
                          "kind": "announcement"})
        self.bus.publish({"t": "mediator.done", "text": text, "turn_id": turn_id,
                          "kind": "announcement", "ms_first_token": 0, "ms_total": 0})
        self._set_state("speaking", detail="task announcement")
        self._speaking = True
        self._remember_spoken(text)
        loop = asyncio.get_running_loop()
        on_chunk, on_amp = self._emit_audio(loop, cancel, turn_id)
        try:
            await self.tts.speak(speakable(text), on_chunk=on_chunk, on_amp=on_amp,
                                 voice=self.cfg.tts.voice, speed=self.cfg.tts.speed,
                                 cancel_event=cancel)
            await self._wait_played(cancel)
        finally:
            if not cancel.is_set():
                self._speaking = False
                self.bus.publish({"t": "tts.end", "turn_id": turn_id})
                self._set_state("listening" if self.mic_active and self.mode == "vad" else "idle")
        self._drain_announcements()

    def component_status(self) -> dict[str, Any]:
        return {"ok": True, "detail": f"state={self.state} mode={self.mode} vad={self.vad_label}"}
