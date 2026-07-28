# Voice architecture comparison — jarvisd vs. pipecat / LiveKit Agents / GLaDOS / OpenJarvis / local_voice

Read-only research, 2026-07-28. Goal: find *why* jarvisd feels inferior to reference voice-assistant
stacks and what to concretely change, ranked by impact vs. effort, inside our constraints (24 GB
Mac mini, local-only, one small mediator model, Ollama as the only inference server).

Sources read directly (shallow clones, commit hash + date noted so claims are reproducible):
- `pipecat-ai/pipecat` @ `73189e18` (2026-07-28) — reference OSS real-time voice framework.
- `livekit/agents` @ `d6aa46d8` (2026-07-28) — production voice-agent SDK.
- `open-jarvis/OpenJarvis` @ `93fc7b9e` (2026-07-28) — Stanford Hazy Research / Scaling Intelligence
  Lab personal-AI framework, the actual repo behind "OpenJarvis" (8.1k★, Apache-2.0).
- `dnhkng/GlaDOS` @ `c0648ca9` (2026-06-08) — local-first voice assistant, actively maintained.
- `andrewgph/local_voice` @ `265a95fa` (2025-01-05) — MLX prototype, most technically novel endpointing idea.

Our code read: `service/jarvisd/pipeline.py`, `mediator/loop.py`, `mediator/prompt.py`, `audio/vad.py`,
`docs/SPEC.md`, `ARCHITECTURE.md`.

---

## 0. Bottom line — why ours felt inferior

The architecture is not fundamentally wrong. The tiny-prompt JSON meta-tool protocol, the
turn-lock + barge-in-cancel model, and the task table + async `task_events` announcement are all
directionally the same choices pipecat and GLaDOS make. The "feels inferior" gap comes from four
concrete, fixable holes, not a redesign:

1. **A real correctness bug, not just a UX rough edge.** `Pipeline._unanswered` (`pipeline.py:59`) is a
   single string slot, not a queue. If the user talks again while the mediator is still *deciding* what
   to do (before `delegate_task` has been dispatched), barge-in cancels that turn and the next
   voice turn silently **overwrites** the pending request — the original ask is dropped with no error,
   no resume, nothing. See §1 for the exact trace. This alone reads as "it ignored me."
2. **Endpointing is one fixed heuristic**, where every reference project treats VAD as a coarse
   pre-filter feeding a dedicated small semantic/adaptive layer on top. Ours has no such layer.
3. **No filler/backchannel mechanism** for the ~1–3 s a `delegate_task`/`memory_recall` round trip
   takes — competitive stacks paper over exactly this gap with a short spoken ack.
4. **Tool-call JSON repair is 100% prompt-level** (one retry with a text nudge, `mediator/loop.py:154-164`)
   when the exact same server we already call (Ollama) offers grammar-constrained decoding for free.

`OpenJarvis` (the Stanford repo) is **not** a meaningful architectural yardstick for the voice loop —
confirmed by exhaustive grep (`grep -rliE "barge|interrupt|duplex|vad" openjarvis/src` → zero hits). It's
a personal-agent framework (tools, memory, connectors, a cron/interval scheduler, evals) with bolt-on,
non-streaming STT/TTS wrappers (`openjarvis/src/openjarvis/speech/{faster_whisper,kokoro_tts,deepgram}.py`)
and no VAD, no turn-taking, no barge-in code anywhere. This matches an earlier finding already in this
repo (`docs/openjarvis-animation-research.md`), which independently concluded OpenJarvis's frontend has
no real-time/animated UI either. Whatever impression "OpenJarvis does voice better" exists is either about
its non-voice agent ecosystem, or conflates it with a different Jarvis-branded project.

---

## 1. Concurrency — background task + continued conversation

### What the best projects do

- **GLaDOS** (`glados/src/glados/core/engine.py:379-486`) runs **two independent LLM call lanes**: a
  `llm_queue_priority` (user chat, exactly one `LanguageModelProcessor` thread, `lane="priority"`) and a
  `llm_queue_autonomy` (background subagents/tasks, N parallel `LanguageModelProcessor` threads,
  `lane="autonomy"`, config `autonomy_parallel_calls`). Background task state is never pushed by blocking
  the chat lane — it's injected into the **next** chat-lane prompt via a registered `ContextBuilder` slot
  (`context_builder.register("slots", self._format_slots, priority=8)`, `engine.py:341`), which renders as
  a `[tasks]` block the conversational LLM sees on its next turn. The user-facing chat call is *never*
  blocked or cancelled by autonomy work; conversely a running autonomy job is unaffected by a chat turn.
- **pipecat** (`pipecat/src/pipecat/workers/base_worker.py`) formalizes this as a full worker/job/bus
  system: `request_job()`/`job_group()` are fire-and-forget async sends; the requester's own pipeline
  keeps processing frames (including new user speech) while the job runs, and results/progress arrive
  later via `on_job_response`/`on_job_update` callbacks (`base_worker.py:659-836`). The conversational
  pipeline is architecturally never the thing waiting on a job.
- **OpenJarvis**'s scheduler (`openjarvis/src/openjarvis/scheduler/scheduler.py`) is a plain
  cron/interval background daemon thread (`_poll_loop`, line 190) — confirms the same principle
  (background work is a wholly separate concern from a live turn) but has no live-conversation
  concurrency story to borrow beyond that.

### Diagnosis of our actual bug (not a design philosophy gap — a specific race)

`pipeline.py` already does the GLaDOS/pipecat thing correctly for *dispatched* work: once
`delegate_task` returns a `task_id`, the worker runs as an independent subprocess, `task_events` and
`mediator.notify_task_event()` surface completion asynchronously (`pipeline.py:554-566`), and the
mediator is explicitly prompted never to claim "done" prematurely (`prompt.py:41-47`). That part is sound.

The gap is the window **before** `delegate_task` is dispatched. Trace:

- `feed_audio()` fires `barge_in()` after `_BARGE_MS_THINKING = 600` ms of sustained voice while
  `self._turn_task` is still running (`pipeline.py:105-123`) — i.e. while the mediator is still
  generating the tool-call JSON, before `delegate_task` has been invoked.
- `barge_in()` cancels `self._turn_task` (`pipeline.py:185-186`), which raises `CancelledError` inside
  `run_turn()`. Because the cancellation happens mid-`mediator.turn()`, the tool call for the *original*
  request may never have fired.
- `_interrupt_recovery()` (`pipeline.py:201-227`) tries to resume `self._unanswered` — but only if the
  interrupting speech does *not* become a new utterance. If it does become a real follow-up utterance,
  `_spawn_turn()` starts a **new** `run_turn()`, whose very first statement is
  `self._unanswered = text` (`pipeline.py:289`) — this **overwrites** the old pending request. It is
  never queued, never resumed, never surfaced as dropped. The user's first ask just vanishes.

This is the literal mechanism behind "a follow-up cancels the in-flight turn instead of handling both" —
worse than described, since the *first* request can be lost outright, not just delayed.

### Recommendation (ranked)

1. **[High impact / Low effort]** Replace `_unanswered: Optional[str]` with a small bounded FIFO
   (`collections.deque(maxlen=3)`) of un-dispatched pending utterances. On barge-in during `thinking`
   (before any tool call fired this turn), push onto the queue instead of a single slot; drain it
   serially in `_interrupt_recovery`/after the current turn settles. This is a contained change to
   `pipeline.py` (`_unanswered`, `barge_in`, `_interrupt_recovery`, `run_turn`) and directly fixes the
   dropped-request bug — this is the single highest-value fix from this whole investigation.
2. **[High impact / Medium effort]** Distinguish "cancel audio" from "cancel the LLM+tool call", mirroring
   pipecat's `InterruptionFrame` (audio/generation cancel only) vs. its job-cancel path. Concretely: once
   the current turn's `tool_calls` already contains a `delegate_task` entry, a subsequent barge-in should
   never re-cancel that dispatch (it already returned a `task_id` and is running independently) — it
   should just let the mediator pivot to the new follow-up while the delegated task keeps running. Right
   now cancellation is all-or-nothing per turn.
3. **[Medium impact / Low effort]** Don't build a GLaDOS-style second parallel LLM lane. GLaDOS's value is
   entirely at the software-queueing layer, not concurrent inference — Ollama still serializes generation
   on one box regardless. Jarvis already gets the equivalent behavior for *dispatched* background work
   via the task table + `task_events`; the only real gap is the pre-dispatch race in #1. Don't over-build.

---

## 2. Barge-in / endpointing quality

### What the best projects do

- **Silero VAD**, not webrtcvad, is the shared default in both pipecat (`audio/vad/vad_analyzer.py`
  ships `data/silero_vad.onnx`) and LiveKit (`livekit-plugins-silero`). In both frameworks VAD is
  explicitly treated as a coarse pre-filter, not the turn-completion decision-maker.
- **pipecat "smart turn" v3** (`pipecat/src/pipecat/audio/turn/smart_turn/local_smart_turn_v3.py`): a
  dedicated ONNX model that computes Whisper-style log-mel features over up to 8 s of raw audio
  (`base_smart_turn.py:99-260`) and predicts a binary complete/incomplete + probability, CPU-only,
  single ONNX session, single-thread executor. It's gated by a silence-timeout fallback (`STOP_SECS=3`)
  and, per `turns/user_stop/turn_analyzer_user_turn_stop_strategy.py:301-359`, by STT finalization timing
  with a p99-latency safety net — so a stale silence timer can never leave the user hanging.
- **LiveKit turn-detector plugin** (`livekit-plugins-turn-detector/.../base.py:151-291`): the opposite
  modality — a *text*-based tiny transformer classifier (ONNX + HF tokenizer) over the last 6 turns
  (≤128 tokens), predicting `eou_probability`, with a **per-language tuned threshold**
  (`languages.json`, `unlikely_threshold`). Runs via a separate inference-executor process, 3 s timeout
  but typically well under 100 ms on CPU.
- **LiveKit `DynamicEndpointing`** (`livekit-agents/livekit/agents/voice/endpointing.py:49-265`): the
  endpoint delay is not a constant — `min_delay` is an EMA (`ExpFilter`, alpha 0.9) of the user's own
  observed intra-utterance pause lengths, explicitly distinguishing "pause between utterances" (raises
  the learned floor) from "immediate interruption right after the agent starts talking" (must NOT raise
  it, or real barge-ins get swallowed). `max_delay` stays a fixed ceiling. This converges to the
  individual user's natural cadence instead of one constant for everyone.
- **LiveKit `AdaptiveInterruptionDetector`** (`inference/interruption.py`): a genuine ML classifier that
  distinguishes real barge-in from backchannel ("mm-hmm", "yeah") on overlapping audio — but it's
  **cloud-hosted only** (`/bargein` websocket, requires `LIVEKIT_API_KEY`/`_SECRET`), not locally
  deployable. Concept-transferable, code is not.
- **local_voice** (`chat_model.py:131-133`, `prob_end_of_user_message`): the most novel idea — reads the
  conversational LLM's own next-token logit for the EOS/turn-end special token as a continuous,
  incrementally-updated (persistent KV cache) end-of-utterance signal, no separate model needed. Not
  transferable to us: it needs raw logprob access plus a persistent per-session KV cache, neither of
  which Ollama's stateless `/api/chat` HTTP endpoint offers cheaply.

### Recommendation (ranked)

1. **[High impact / Low-medium effort]** Replace webrtcvad with Silero VAD (onnxruntime, ~1.8 MB model,
   CPU) in `audio/vad.py`. It is the de facto standard both reference frameworks ship as their default
   local VAD and is materially better than webrtcvad's energy/GMM approach at rejecting breath/keyboard
   noise — should directly cut both false endpoint triggers and false barge-ins. The `VadEndpointer.feed()`
   frame-based contract (`vad.py:107-117`) maps cleanly onto Silero's frame-classifier API; this is close
   to a drop-in swap of the `is_speech()` call, not a redesign.
2. **[Medium impact / Low effort]** Adopt LiveKit's `DynamicEndpointing` idea directly: track an EMA of
   observed inter-utterance pause durations (the timestamps already exist in `VadEndpointer`) and use it
   as the `endpoint_ms` floor instead of the current fixed 500 ms / two-tier long-utterance shrink
   (`vad.py:119-123, 39-51`). No new model, no new dependency — just replaces a constant with a learned
   floor clamped to a ceiling. Directly addresses "one threshold doesn't fit users with different natural
   pause lengths."
3. **[High impact / Medium effort]** Add a dedicated small semantic-endpointing gate on top of VAD,
   pipecat-style: port `local_smart_turn_v3` (bundled pretrained ONNX, BSD-2 license, CPU, tens of ms
   per call) as an extra check before firing `speech_end`, feeding it the same PCM segment the endpointer
   already buffers. This is the highest-quality fix but the most engineering (wiring an ONNX session +
   the vendored Whisper-feature extractor into our pipeline) — do #1 and #2 first and re-evaluate whether
   the remaining false-trigger rate justifies this.
4. **[Low impact / Low effort]** Cheap backchannel filter: before firing `barge_in()` on the
   `_BARGE_MS_SPEAKING`/`_BARGE_MS_THINKING` sustained-voice thresholds (`pipeline.py:105-123`), check
   the STT partial transcript already being computed during that window (`_maybe_partial`,
   `pipeline.py:131-143`); if it's just a short acknowledgement token ("mm-hmm", "yeah", "okay", "right"),
   suppress the barge-in. A heuristic, no-model approximation of LiveKit's cloud backchannel classifier.

---

## 3. Tool-call reliability on a small local model

### What the best projects do

- **Ollama itself already supports grammar-constrained decoding**: `/api/chat`'s `format` parameter
  accepts a JSON Schema and forces the model to only sample tokens that satisfy it — malformed JSON
  becomes "mechanically impossible" at the sampler level (Ollama structured-outputs docs, confirmed via
  Ollama's own blog + community write-ups). Caveat: JSON Schema `description` fields are decorative only
  (the model never sees them — must still be in prompt prose), and there are known adherence issues with
  some model families (Qwen 3.5/3.6) that don't apply to Gemma.
- **pipecat doesn't hand-roll a JSON protocol at all** — it defers structured tool calls to each LLM
  provider's native function-calling support via per-provider adapters
  (`pipecat/src/pipecat/adapters/schemas/function_schema.py`), with `cancel_on_interruption`/
  `timeout_secs` call options (`workers/llm/tool_decorator.py:12-70`) for async tool semantics. This
  isn't directly portable (we deliberately avoid Ollama's tool-template layer for prefill-speed reasons,
  per `ARCHITECTURE.md`'s own rationale) — but it confirms hand-rolling a JSON-line protocol the way we do
  is the outlier choice, not obviously wrong, just under-hardened.
- **pipecat's own turn-completion marker protocol** (`turns/user_turn_completion_mixin.py`, §4 below) is
  itself proof that "make the model emit a tiny, reliably-formatted sentinel, validate structurally, and
  fall back to a corrective re-prompt on violation" is a workable production pattern at pipecat's scale —
  which validates our general approach in `mediator/loop.py`, it just isn't using the strongest available
  tool (schema-constrained decoding) on the repair path.

### Recommendation (ranked)

1. **[High impact / Low effort]** Use Ollama's `format` JSON-schema parameter **only on the existing
   retry path**, not the common case. Today, on invalid tool JSON, `mediator/loop.py:154-164` reissues
   the call with a bare text nudge ("Invalid tool JSON. Reply with exactly one line..."). The common-case
   call must stay unconstrained because it has to support both plain speech and tool JSON in the same
   completion (grammar-constrained decoding can't cleanly do "prose OR this schema" in one call). But the
   retry path already knows a tool call was attempted and failed — reissue *that* one call with
   `format={"type":"object","properties":{"tool":{"enum":[...6 names...]},"args":{"type":"object"}}, "required":["tool","args"]}`.
   This guarantees the retry can't fail on JSON syntax a second time, is a small, low-risk, isolated
   change (touches only the retry branch), and uses infrastructure (Ollama) we already depend on.
2. **[Medium impact / Low effort]** Tighten `_parse_tool` (`mediator/loop.py:258-277`): it currently
   accepts any dict with `tool`/`name` + `args`/`arguments` keys with no per-tool argument validation.
   Add a minimal per-tool required-keys check (e.g. `delegate_task` requires non-empty `goal`) and route
   schema-mismatches into the same retry path as JSON-syntax failures — right now a call like
   `delegate_task` with a missing `goal` silently returns `{"error": "goal required"}` (`pipeline.py:484-486`)
   and the user just perceives "nothing happened," with no repair attempt.
3. **[Low priority]** A verification/"judge" pass on tool calls (pipecat ships `evals/judge.py` as
   precedent) is likely overkill — SPEC.md's own target (`≥98% valid meta-tool args`) is already close to
   what a retry-once protocol should achieve; only revisit if `/metrics` telemetry shows the retry rate is
   materially above budget.

---

## 4. Perceived latency & naturalness

### What the best projects do

- **LiveKit `_FillerScheduler`** (`livekit-agents/livekit/agents/voice/filler_scheduler.py`): a background
  task that, if the session stays idle past a `delay` while a step/tool is running, speaks a filler
  phrase via `session.say()`, optionally repeating every `interval` up to `max_steps`, and is cancelled
  the instant real speech becomes ready (`wait_if_not_interrupted`, line 103). This is the standard
  "let me check that…" pattern for masking tool-call latency.
  This is exactly the gap in jarvisd: `delegate_task`/`memory_recall`/`capability_search` round trips
  (SPEC.md's own tool timeout is 20 s, `mediator/loop.py:169`) currently produce total silence until the
  mediator's next sentence.
- **pipecat / local_voice**: neither literally streams half-finished ASR text into the LLM mid-utterance.
  pipecat's closest equivalent is feeding raw *audio* (not text) into the smart-turn model, bypassing the
  transcript entirely; local_voice's incremental design needs a persistent per-session KV cache server,
  which Ollama's stateless HTTP API doesn't offer. **No surveyed local-first, single-box project actually
  does true incremental-partial-into-LLM prefill in production** — this appears to be a genuinely hard
  problem without a dedicated inference server (llama.cpp server with slots, vLLM, etc.), not something
  we're missing relative to peers.
- **Streaming TTS on first sentence-fragment**: both frameworks stream synthesis per sentence/clause as
  soon as it's available rather than waiting for the full reply — which is exactly what jarvisd's
  `_sentence_cut()` (`pipeline.py:448-461`, aggressive first-fragment cut at `min_len=10`) already does.

### Recommendation (ranked)

1. **[Medium impact / Low effort]** Add a LiveKit-style filler mechanism: if a tool call
   (`delegate_task`/`memory_recall`/`capability_search`) is still pending after ~800 ms–1 s, speak a short
   filler ("One sec." / "Let me check.") through the existing kokoro TTS + cancel-event plumbing
   (`pipeline.py`'s `_speaker`/`_tts_cancel` machinery already supports exactly this shape of interruptible
   speech), cancelled the moment the real sentence is ready to speak. This is the cheapest, most direct
   fix for "the assistant just… pauses" during a tool round trip.
2. **[No action needed]** The sentence-cut streaming TTS start is already aligned with what pipecat and
   LiveKit do — worth calling out explicitly in ARCHITECTURE.md so a future contributor doesn't "fix" it
   away thinking the short first-fragment cut is a bug rather than a deliberate latency optimization.
3. **[Not recommended given constraints]** True streaming-ASR-partials-into-LLM (full incremental
   prefill) requires infrastructure (persistent KV-cache inference server) outside Ollama's model; skip
   unless/until the mediator moves off Ollama's stateless `/api/chat` onto something with session-slot
   KV-cache reuse (e.g. a llama.cpp server) — at which point local_voice's incremental-logit approach
   (§2) becomes directly relevant too.

---

## Summary table

| Pain point | Top fix | Impact | Effort | File(s) to touch |
|---|---|---|---|---|
| 1. Concurrency | `_unanswered` single slot → bounded FIFO queue | High | Low | `pipeline.py` |
| 1. Concurrency | Split "cancel audio" vs "cancel dispatch" barge-in semantics | High | Medium | `pipeline.py` |
| 2. Endpointing | webrtcvad → Silero VAD | High | Low-Med | `audio/vad.py` |
| 2. Endpointing | Learned (EMA) endpoint-delay floor, LiveKit-style | Medium | Low | `audio/vad.py` |
| 2. Endpointing | Dedicated smart-turn ONNX gate (pipecat-style) | High | Medium | `audio/vad.py`, new module |
| 3. Tool reliability | `format=<json schema>` on the existing retry path only | High | Low | `mediator/loop.py` |
| 3. Tool reliability | Per-tool required-arg validation before dispatch | Medium | Low | `mediator/loop.py` |
| 4. Latency/naturalness | Filler phrase during tool-call wait (LiveKit-style) | Medium | Low | `pipeline.py` |

Given the 24 GB / local-only / single-mediator constraint, the recommended order of work is:
**(1) the `_unanswered` queue fix — it's a genuine bug, not a nice-to-have; (2) Silero VAD swap;
(3) schema-constrained retry; (4) filler phrases; (5) learned endpoint delay; (6) smart-turn model** if
false-trigger rate still isn't good enough after the cheaper fixes.
