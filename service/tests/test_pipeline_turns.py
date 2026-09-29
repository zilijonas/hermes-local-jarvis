"""Turn-taking behaviour of the voice pipeline (2026-09-28 rework), with fakes.

Covers the user-visible bugs this rework fixes:
  * push-to-talk utterances are never split on pauses,
  * a continuation spoken before Jarvis makes a sound merges into one turn,
  * a follow-up while a turn is still queued merges into the queued turn,
  * "speaking" lasts until playback ends, and echo is judged against real playback,
  * barge-in needs real words, not just noise,
  * delegate_task honours the user's backend (codex only when asked),
  * stale partials never reach the UI after the final.
"""
import asyncio
import time
import types

import pytest

from jarvisd import pipeline as pl
from jarvisd.audio.tts import speakable


class FakeBus:
    def __init__(self):
        self.events = []
        self.binary = []

    def publish(self, ev):
        self.events.append(ev)

    def publish_binary(self, hdr, data):
        self.binary.append(hdr)

    def has_listeners(self):
        return True

    def of(self, t):
        return [e for e in self.events if e.get("t") == t]


class FakeSTT:
    def __init__(self, texts):
        self.texts = list(texts)
        self.partial_text = "hello there"

    def transcribe_final(self, pcm):
        return (self.texts.pop(0) if self.texts else ""), 5.0

    def transcribe_partial(self, pcm):
        return self.partial_text

    def component_status(self):
        return {"ok": True, "detail": "fake"}


class FakeTTS:
    def __init__(self, seconds_per_sentence=0.2):
        self.spoken = []
        self.sps = seconds_per_sentence

    async def speak(self, text, on_chunk, on_amp, voice=None, speed=None, cancel_event=None):
        self.spoken.append(text)
        on_chunk(b"\x00\x00" * 10, int(24000 * self.sps))
        await asyncio.sleep(0)
        return {"ms_first_chunk": 1}

    def component_status(self):
        return {"ok": True, "detail": "fake"}


class FakeMediator:
    def __init__(self, delay=0.0, reply="Sure thing. Done."):
        self.delay = delay
        self.reply = reply
        self.turns = []
        self.last_reply = ""
        self.history = []

    async def warmup(self):
        return True

    def notify_task_event(self, task):
        pass

    def component_status(self):
        return {"ok": True, "detail": "fake"}

    async def turn(self, text, tools, on_delta, on_tool, cancel):
        self.turns.append(text)
        t0 = time.monotonic()
        while time.monotonic() - t0 < self.delay:
            if cancel.is_set():
                return {"text": "", "ms_first_token": 0, "ms_total": 0, "tool_calls": []}
            await asyncio.sleep(0.01)
        on_delta(self.reply)
        self.last_reply = self.reply
        return {"text": self.reply, "ms_first_token": 1, "ms_total": 2, "tool_calls": []}


class FakeWorkers:
    def __init__(self):
        self.on_task_event = None
        self.wait_turn_clear = None
        self.delegated = []

    async def delegate(self, **kw):
        self.delegated.append(kw)
        return {"task_id": "x", "status": "started"}

    def status(self, _):
        return []

    def control(self, *a):
        return {"ok": True}


class FakeCaps:
    def best(self, goal):
        return {"id": "shell.ops", "kind": "local", "toolsets": ["terminal"]}

    def search(self, q):
        return []


class FakeDB:
    def add_turn(self, *a, **k):
        pass


def _cfg():
    data = {"vad": {"engine": "webrtc", "utt_finalize_ms": 200},
            "stt": {"partial_interval_ms": 200}}
    return types.SimpleNamespace(
        data=data, tts=types.SimpleNamespace(voice="v", speed=1.0),
        budgets=types.SimpleNamespace(context_card_tokens=100))


def make(texts=(), delay=0.0, tts_s=0.2):
    bus = FakeBus()
    p = pl.Pipeline(_cfg(), FakeDB(), bus, FakeSTT(texts), FakeTTS(tts_s),
                    FakeMediator(delay), FakeWorkers(), None, FakeCaps())
    return p, bus


class _ScriptedVAD:
    """Plays back a scripted sequence one event per `feed()` call.

    Mirrors how the real endpointer streams events: each `feed()` returns
    the NEXT event in the script (consumed one at a time). Used to reproduce
    a mid-utterance `speech_end` (smart-turn sometimes decides "complete"
    on a sub-second pause) and verify the pipeline does not split that
    into two turn_ids unless the silence is genuinely long (>= 2.5 s).
    """
    def __init__(self, script):
        # script: list of (kind, payload_bytes_or_None)
        self._script = list(script)
        self._idx = 0
        self.in_speech = False
        self.last_is_speech = False
        self.use_smart_turn = False
        self.max_pause_ms = 2500
        self.mode = "vad"

    def reset(self):
        self._idx = 0

    def set_mode(self, mode, ptt_silence_ms=2500):
        self.mode = mode
        if mode == "ptt":
            self.use_smart_turn = False
            self.max_pause_ms = ptt_silence_ms

    def flush(self):
        return b""

    def feed(self, chunk):
        if self._idx >= len(self._script):
            return []
        ev = self._script[self._idx]
        self._idx += 1
        return [ev]


async def _settle(p, timeout=3.0):
    t0 = time.monotonic()
    await asyncio.sleep(0.05)
    while time.monotonic() - t0 < timeout:
        pending_finalize = getattr(p, "_pending_finalize", None)
        if (not p._busy() and (p._drainer is None or p._drainer.done())
                and pending_finalize is None):
            return
        await asyncio.sleep(0.02)


@pytest.mark.asyncio
async def test_ptt_is_one_utterance_despite_pauses():
    p, bus = make(["remind me to call mom tomorrow"])
    p.mode = "ptt"
    p.vad.set_mode("ptt", 2500)
    p.mic_start()
    speech = (b"\x00\x40\x00\xc0" * 4000)   # loud square-ish wave, 0.5 s
    silence = b"\x00\x00" * 16000            # a full second of silence mid-utterance
    for chunk in (speech, silence, speech):
        p.feed_audio(chunk)
    p.mic_stop()
    await _settle(p)
    finals = bus.of("stt.final")
    assert len(finals) == 1 and p.mediator.turns == ["remind me to call mom tomorrow"]


@pytest.mark.asyncio
async def test_ptt_mic_left_on_ends_turn_after_silence():
    """Mic toggled on, user speaks then goes quiet without touching anything: the
    turn ends by itself instead of recording silence forever."""
    import shutil, subprocess, tempfile
    if not (shutil.which("say") and shutil.which("ffmpeg")):
        pytest.skip("needs say + ffmpeg")
    d = tempfile.mkdtemp()
    subprocess.run(["say", "-o", f"{d}/a.aiff", "what time is it"], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{d}/a.aiff", "-ar", "16000",
                    "-ac", "1", "-f", "s16le", f"{d}/a.raw"], check=True)
    p, bus = make(["what time is it"])
    p.mode = "ptt"
    p.vad.set_mode("ptt", 2500)
    p.mic_start()
    p.feed_audio(open(f"{d}/a.raw", "rb").read())
    shutil.rmtree(d, ignore_errors=True)
    p.feed_audio(b"\x00\x00" * 16000 * 3)     # 3 s of silence
    await _settle(p)
    assert p.mediator.turns == ["what time is it"] and p.mic_active


@pytest.mark.asyncio
async def test_continuation_before_audio_merges_into_one_turn():
    p, bus = make(["remind me to", "call mom tomorrow"], delay=0.5)
    p.mode = "vad"
    p.mic_active = True
    p._spawn_turn(b"\x00\x00" * 8000, "u1")
    await asyncio.sleep(0.1)            # turn 1 is thinking, nothing audible yet
    p._maybe_continuation()             # the user starts speaking again
    p._spawn_turn(b"\x00\x00" * 8000, "u2")
    await _settle(p)
    assert p.mediator.turns[-1] == "remind me to call mom tomorrow"
    assert any(e.get("merged") for e in bus.of("stt.final"))
    assert bus.of("turn.merged")
    assert p.tts.spoken and len(bus.of("mediator.done")) == 1


@pytest.mark.asyncio
async def test_no_merge_after_side_effects():
    p, _bus = make()
    p.mode = "vad"
    p._current = {"turn_id": "t", "text": "x", "t_endpoint": time.monotonic(),
                  "spoke": False, "side_effects": True, "aborted": False}
    p._maybe_continuation()
    assert p._carry is None and not p._current["aborted"]


@pytest.mark.asyncio
async def test_followup_merges_into_queued_turn():
    p, bus = make(["and a second part"], delay=0.3)
    p._enqueue_turn("busy turn")
    await asyncio.sleep(0.05)
    p._pending.append({"text": "first question", "turn_id": "tq", "t_endpoint": None})
    p._spawn_turn(b"\x00\x00" * 8000, "u9")
    await asyncio.sleep(0.05)
    assert p._pending[-1]["text"] == "first question and a second part"
    assert bus.of("stt.final")[-1]["merged"] is True
    await _settle(p)
    assert p.mediator.turns == ["busy turn", "first question and a second part"]


@pytest.mark.asyncio
async def test_speaking_lasts_until_playback_and_client_can_end_it():
    p, bus = make(tts_s=0.6)
    task = asyncio.get_running_loop().create_task(p.run_turn("hi"))
    await asyncio.sleep(0.15)
    assert p._speaking and p.audible() and not bus.of("tts.end")
    p.playback_ended()                  # client: player drained
    await asyncio.wait_for(task, 2.0)
    assert bus.of("tts.end") and not p._speaking


@pytest.mark.asyncio
async def test_echo_only_near_playback():
    p, _ = make()
    p._recent_spoken = "the disk check finished with plenty of free space"
    assert not p._is_echo("the disk check finished")        # silence: never eaten
    p._play_until = time.monotonic() + 1.0
    assert p._is_echo("the disk check finished")
    assert not p._is_echo("stop, what about the backup job")


@pytest.mark.asyncio
async def test_barge_in_needs_words():
    p, bus = make()
    p._speaking = True
    p._play_until = time.monotonic() + 5
    p._recent_spoken = "here is the weather for this weekend"
    p.stt.partial_text = "um"
    p._barge_voiced_ms = 400
    p._maybe_barge()
    await asyncio.sleep(0.05)
    assert not bus.of("tts.end")
    p.stt.partial_text = "stop stop that's enough"
    p._maybe_barge()
    await asyncio.sleep(0.05)
    assert bus.of("tts.end") and bus.of("tts.end")[0]["interrupted"] is True


@pytest.mark.asyncio
async def test_stale_partial_dropped_after_final():
    p, bus = make(["hello there"])
    p.mode = "ptt"
    p.mic_start()
    p._finalized.add(p._utt_id)
    p._utt_buf.extend(b"\x01\x00" * 16000)
    p._maybe_partial()
    await asyncio.sleep(0.05)
    assert not bus.of("stt.partial")


@pytest.mark.asyncio
async def test_delegate_uses_selected_backend_unless_user_names_codex():
    p, _ = make()
    await p._dispatch_meta_tool("delegate_task", {"goal": "refactor the repo"},
                                user_text="refactor the repo please")
    await p._dispatch_meta_tool("delegate_task", {"goal": "refactor the repo"},
                                user_text="use codex to refactor the repo")
    kinds = [d["kind"] for d in p.workers.delegated]
    assert kinds == ["", "codex"]


def test_sentence_cut_keeps_decimals_and_abbrev():
    cut = pl.Pipeline._sentence_cut
    assert cut("It is up 3.5 percent today. More", first=False) == len("It is up 3.5 percent today.")
    assert cut("Sure, e.g. apples are here. ok", first=False) == len("Sure, e.g. apples are here.")


def test_speakable_cleans_markdown_and_money():
    out = speakable("**Done!** It costs $64,250 — see [docs](https://a.b/c) 🎉")
    assert "*" not in out and "64,250 dollars" in out and "http" not in out and "docs" in out


@pytest.mark.asyncio
async def test_mid_utterance_pause_keeps_single_turn_id():
    """Regression: a sub-2.5 s mid-sentence pause must NOT split one utterance
    into two turn_ids. Reproduces the silero + smart-turn edge case where
    Smart Turn prematurely declared "complete" on a ~600 ms pause.

    Scripted endpointer emits:
        speech_start, chunk*, speech_end (~600 ms in), chunk*,
        speech_start (user resumes ~600 ms later), chunk*, speech_end (real end)
    The pipeline must end with EXACTLY ONE `stt.final` event with merged=False
    and ONE mediator.turn() call — a single turn_id across the whole utterance.
    """
    bus = FakeBus()
    p = pl.Pipeline(_cfg(), FakeDB(), bus,
                    FakeSTT(["remind me to call mom tomorrow", "second text"]),
                    FakeTTS(seconds_per_sentence=0.8), FakeMediator(delay=0.4),
                    FakeWorkers(), None, FakeCaps())
    # Scripted endpointer: speech_start, 2 chunks, premature speech_end,
    # one silence chunk, speech_start (resume), one chunk, real speech_end.
    p.vad = _ScriptedVAD([
        ("speech_start", None),
        ("chunk", b"\x01\x00" * 4800),
        ("chunk", b"\x01\x00" * 3200),
        ("speech_end", b"\x01\x00" * 8000),
        ("chunk", b"\x00\x00" * 1280),
        ("speech_start", None),
        ("chunk", b"\x01\x00" * 6400),
        ("speech_end", b"\x01\x00" * 14400),
    ])
    p.mode = "vad"
    p.mic_start()
    # Deferred finalize must outlast the mid-utterance pause (< 0.6 s in this
    # test) so that the resume path cancels it instead of letting the turn
    # spawn. Production uses the 2.5 s default.
    p._utt_finalize_ms = 1500
    # Each feed_audio call drives ONE scripted event.
    p.feed_audio(b"\x01\x00" * 8000)   # -> speech_start
    p.feed_audio(b"\x01\x00" * 4800)   # -> chunk
    p.feed_audio(b"\x01\x00" * 3200)   # -> chunk
    p.feed_audio(b"\x01\x00" * 3200)   # -> speech_end (premature)
    # Let the first turn start processing (STT -> mediator -> TTS first chunk).
    # In production the user pauses ~600 ms; that is enough time for the
    # first turn to set cur["spoke"]=True via TTS.first_chunk. With
    # delay=0.5 the FakeMediator returns, then FakeTTS.speak immediately
    # sends the first chunk (cur["spoke"]=True). The continuation merge
    # in _maybe_continuation then refuses to merge (cur["spoke"]=True),
    # so a second turn_id is emitted — the production bug.
    await asyncio.sleep(0.6)
    p.feed_audio(b"\x00\x00" * 1280)   # -> chunk (silence)
    p.feed_audio(b"\x01\x00" * 1600)   # -> speech_start (resume, ~600 ms gap)
    p.feed_audio(b"\x01\x00" * 6400)   # -> chunk
    p.feed_audio(b"\x01\x00" * 16000)  # -> speech_end (REAL end)
    # With the fix: the pipeline deferred both speech_ends; only the LAST
    # timer is still armed. Sleep long enough that the timer fires AFTER
    # the second speech_start has cancelled any earlier one (it did, ~0.6 s
    # after the first speech_end), then the second speech_end at the end
    # of the stream arms a fresh timer. 1.8 s is enough for > 1.5 s to elapse
    # without speech_start.
    await asyncio.sleep(1.8)
    await _settle(p, timeout=5.0)

    finals = bus.of("stt.final")
    assert len(finals) == 1, finals
    assert finals[0]["text"] == "remind me to call mom tomorrow"
    assert finals[0]["merged"] is False
    assert len(p.mediator.turns) == 1
    assert p.mediator.turns[0] == "remind me to call mom tomorrow"
    turn_ids = {f["turn_id"] for f in finals}
    assert len(turn_ids) == 1, turn_ids


@pytest.mark.asyncio
async def test_slow_tool_gets_instant_ack_once():
    p, bus = make()

    async def turn(text, tools, on_delta, on_tool, cancel):
        on_tool("delegate_task", {"goal": "x"}, "start")
        on_tool("delegate_task", {"goal": "x"}, "end")
        on_tool("memory_recall", {"query": "x"}, "start")
        on_delta("Started the backup. I'll tell you when it's done.")
        return {"text": "Started the backup. I'll tell you when it's done.",
                "ms_first_token": 1, "ms_total": 2, "tool_calls": []}
    p.mediator.turn = turn
    await p.run_turn("back up the vault")
    assert p.tts.spoken[0] == "On it."
    assert sum(1 for t in p.tts.spoken if t in ("On it.", "Let me check.")) == 1


def test_plain_typography_for_display():
    from jarvisd.audio.tts import plain_typography

    out = plain_typography("Checking now — I'll tell you soon… it's 5–7 degrees → fine")
    assert "—" not in out and "…" not in out and "→" not in out
    assert "5-7 degrees" in out and out.startswith("Checking now, I'll")
