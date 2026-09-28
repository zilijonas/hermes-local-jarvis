# jarvisd - binding contracts (v2, 2026-09-28)

Single source of truth for service, plugin proxy, and UI. Change only here first.

## Process
- Python 3.11 venv at repo `service/.venv` (created by `scripts/install.sh`).
- Entry: `service/jarvisd/app.py` -> uvicorn on `127.0.0.1:9140` (config: `service/jarvisd.toml`).
- State: `~/ai/state/jarvis-voice/jarvis.db` (sqlite, WAL). The config key is
 still called `paths.hermes_home` for historical reasons - it is jarvisd's
 own state dir, not a Hermes profile (see `docs/hermes-profiles-sessions.md`).
- Logs: `~/ai/state/jarvis-voice/logs/jarvisd.log` (rotating 2 MB × 3).
- LaunchAgent `local.jarvis.jarvisd.plist` (KeepAlive, RunAtLoad). This is the
 only LaunchAgent this repo manages - the Jarvis tab is served by the main
 Hermes dashboard (`local.hermesagent.dashboard`, port 9120), not by a
 dedicated dashboard process.

## HTTP API (all JSON. No auth - loopback only. Dashboard proxy adds its own session auth)
- `GET /health` -> `{ok, version, uptime_s, components: {ollama, stt, tts, db, mediator, turns}:
 {ok, detail}, models: {mediator: {name, resident}, worker: {name, resident}}, ram: {free_gb}}`.
 `components.turns.detail` names the active turn-detection engine (e.g.
 `"silero + smart-turn v3, mode=ptt"`).
- `GET /config` -> full runtime config (`JarvisConfig.as_dict()` - see §Config below).
- `POST /config` `{patch}` -> deep-merges into config and persists to `jarvisd.toml`. A
 `{"worker":{"backend":...}}` patch also switches the live worker backend with no restart.
- `GET /backends` -> `{active, available: {local, cloud, codex, claude}, backends: [...],
 labels: {id: label}}` - the `delegate_task` worker backend selector.
- `POST /backends` `{backend}` -> `{ok, backend}` (400 on an unknown backend). Persists to config.
- `GET /brains` -> `{active, brains: [{id, label, detail, available}]}` - the mediator's own
 brain selector (independent of the worker backend above).
- `POST /brains` `{brain}` -> `{ok, brain}` (400 on unknown). Persists to config, publishes
 `brain.changed` on the bus so open WS clients update live.
- `GET /credits` `?refresh=` -> per-backend credit/quota gauges (best-effort,
  501 if the credits module isn't installed).
- `GET /tasks?status=&limit=` -> `{tasks: [...]}` (see §DB `tasks`).
- `GET /tasks/{id}` -> task row (404 if unknown).
- `POST /tasks/{id}/control` `{action: pause|resume|cancel|redelegate}` -> `{ok, status}`.
- `POST /say` `{text, interrupt: bool}` -> speak text directly (debug/tests). `interrupt: true`
 barges in on anything currently playing first.
- `POST /converse` `{text, reset?}` -> run a full mediator turn as if spoken (no mic),
  returns `{reply_text, actions: [...], turn_id}`. `{"reset": true}` alone resets mediator
  history without running a turn.
- `GET /memory/search?q=&k=` -> `{hits: [{path, title, snippet, score, confidence, updated,
 conflict}], card, budget_tokens}`.
- `GET /capabilities/search?q=&k=` -> `{hits: [{id, kind: tool|skill|action, name, desc, score}]}`.
- `GET /metrics` -> latency histograms (stt, mediator_first_token, tts_first_chunk,
 e2e_first_audio), counters (turns, barge_ins, tasks, errors), ram snapshot.
- `GET /traces?limit=` -> recent turn traces (timeline events per turn).

## WebSocket `/ws` (single duplex channel per UI client. Every client gets every bus event)

Client->server (JSON text frames unless noted):
- binary frames - 16 kHz mono s16le PCM mic chunks, forwarded to the pipeline only while
 the mic is active.
- `{t:"mic.start"}` / `{t:"mic.stop"}` - push-to-talk gate (also arms `mode.set:"vad"`
 listening).
- `{t:"mode.set", mode:"ptt"|"vad"}` - push-to-talk vs. hands-free. Resets the VAD state.
- `{t:"barge_in"}` - explicit UI interrupt (Esc key or clicking to talk while Jarvis speaks).
 The server also detects barge-in on its own (sustained voice + 2+ real words, see
 ARCHITECTURE.md §Turn taking).
- `{t:"playback.end", turn_id}` - the client's player worklet FIFO ran dry and stayed dry for
 ~250 ms: tells the server audio has genuinely finished, for its echo guard / barge-in
 bookkeeping (protocol v2 - see §Playback clock below).
- `{t:"turn.text", text}` - typed input path (same as `/converse` but streamed over WS).
- `{t:"task.control", id, action}` - pause/resume/cancel, same actions as
 `POST /tasks/{id}/control`.
- `{t:"ping"}` -> `{t:"pong"}`.

Server->client events (every event carries `t`. Most carry `turn_id` once a turn exists):
- `state` `{value, detail?, turn_id?}` - global FSM, UI-canonical. Values: `idle, listening,
 transcribing, thinking, memory, capability, tool, delegating, speaking, interrupted, error,
 done`. Notable `detail` strings: `"no speech recognized"` and `"echo rejected"` on `idle`
 (no reply was produced), `"turn timed out"` on `error`, `"mode=ptt|vad"` on a `mode.set` ack.
- `stt.partial` `{text, utt_id}` - a partial transcript can arrive mid-utterance. `utt_id`
 lets the client drop a stale partial for an utterance that already finalized.
- `stt.final` `{text, ms, turn_id, utt_id, merged}` - `merged: true` means the server folded
  this fragment into the PREVIOUS turn (the user resumed speaking before Jarvis made a sound),
  and the client replaces that turn's bubble instead of pushing a new one.
- `stt.ignored` `{text, reason: "echo of my own speech", turn_id, utt_id}` - a transcript was
 dropped as an echo of Jarvis's own recent speech.
- `turn.pending` `{utt_id}` - hands-free mode only: the user went quiet but Smart Turn scored
 the utterance "not finished yet". Listening continues (up to `vad.max_pause_ms`). Cleared by
 the next `vad.speech` or `stt.final`.
- `vad.speech` `{active, utt_id}` - hands-free voice-activity start/stop, independent of the
 turn-taking decision above. Drives the "user speaking" UI even through a brief pause/breath.
- `mediator.delta` `{text, turn_id}` - streamed reply tokens.
- `mediator.done` `{text, turn_id, ms_first_token, ms_total}`.
- `meta_tool` `{name, args, phase: start|end, result_summary?, ms?, turn_id}` - one of the
 mediator's meta-tools ran (see §Meta-tools).
- `tts.start` `{text, turn_id, engine?}` / `tts.amp` `{v: 0..1}` (~30 Hz) / `tts.end`
 `{turn_id, ms_first_chunk, interrupted?}`. `tts.chunk` is binary (24 kHz mono s16le PCM),
 always preceded by a `{t:"tts.chunk_hdr", seq, samples}` JSON frame. `tts.end
 {interrupted:true}` means the SERVER detected a barge-in (not the client's own
 Esc/click) - the client must call `hardStop()` on its player immediately, or whatever
 audio is still queued in the worklet's FIFO keeps playing for seconds.
- `task.update` `{id, status, title, kind, progress_note?, result_summary?}` - background
 task lifecycle (see §Worker execution for `status` values).
- `memory.hits` `{items: [{path, title, score}]}` - the client re-queries
 `GET /memory/search` to enrich these with snippet/confidence/updated/conflict.
- `latency` `{stage, ms}` - per-turn stage timings as they resolve.
- `health` `{...}` (on change) · `brain.changed` `{brain}` (mediator brain switched, e.g. via
 `POST /brains` from another client) · `error` `{message, recoverable}` · `pong`.

FSM value drives the UI's intelligence-core visualizer 1:1. The server is authoritative. The
UI never fakes a state.

### Playback clock (protocol v2)
"Speaking" lasts until audio has actually PLAYED, not until synthesis finished: the server
sums queued playback time (`Pipeline._play_until`) and the client confirms with
`playback.end` once its FIFO drains. Echo rejection and barge-in timing both key off real
playback, not synthesis completion.

### Echo cancellation (browser side, informational)
Audio plays through a loopback `RTCPeerConnection` into a hidden `<audio>` element so the
browser's own `getUserMedia({echoCancellation:true})` can track it as a "real" media element
(an AudioWorklet routed straight to `AudioContext.destination` is invisible to Chrome's AEC).
Falls back automatically: loopback -> plain `<audio>.srcObject` -> raw `audioCtx.destination`
(no AEC benefit, but always works). `audio-out.js`'s `getDiagnostics()` reports which rung is
active. This has no server-side contract beyond the `playback.end` message above.

## Meta-tools (mediator function-calling schema, flat, 8 tools)
Source of truth: `service/jarvisd/mediator/prompt.py`. Expressed either as one-line JSON
(`{"tool":..., "args":...}`, for models without native tool-call channels) or as real OpenAI
function schemas (`mediator_native = true`, required for gpt-oss-20b - see that file's
docstring for why).
1. `memory_recall(query: str)` -> context card string. Call for any question about the user,
 his projects, this machine, or its services.
2. `capability_search(query: str)` -> top capabilities with ids. NOT started work.
3. `quick_action(action_id: str)` -> one of: `time.now`, `system.status` (jarvisd's own
 health, not the Mac's hardware), `tasks.list`, `say.again`, `memory.note: <text>`,
 `reminders.list`, `reminders.cancel: <words>`.
4. `delegate_task(goal: str, context: str)` -> `{task_id, status:"started"}`. Starts real work
 in the background on the active worker backend. Never claimed done by the mediator itself.
5. `deep_answer(question: str)` -> answers immediately and directly (no task id) using a
 strong cloud model (config `brain.deep_model`, default `minimax-m3`) - for hard
 reasoning/broad-knowledge questions that need neither live data nor a real action.
6. `set_reminder(text: str, in_minutes: number | at: str)` -> handled entirely by jarvisd
 itself (see §Reminders below), never delegated.
7. `task_status(task_id: str)` (empty id -> recent tasks) -> status/progress summaries.
8. `task_control(task_id: str, action: "pause"|"resume"|"cancel")`.

The mediator prompt is ~700 tokens by design (ARCHITECTURE.md §Why the mediator is not a
Hermes session) and states that `delegate_task` only STARTS work. Completion is announced
later via `task.update` / a spoken report, never claimed early by the mediator.

## Brains (mediator conversation driver, config `[brain]`)
- `cloud` (default): OpenCode Go, config `brain.cloud_model` (default `deepseek-v4.1-flash`)
 at `brain.cloud_url`.
- `local`: the model router model, config `ollama.mediator` (default `gpt-oss-20b-mxfp4`) at
 `ollama.mediator_url` (`127.0.0.1:8090`).
- Automatic same-turn fallback either way: if the active brain fails before its first token
 (6 s budget on cloud, 10 s on local), the SAME hop is retried once on the other brain. Once
 a token has been yielded, a later failure is not treated as a brain failure.
- Runtime-switchable via `GET/POST /brains` (`Mediator.set_brain`), independent of the
 `delegate_task` worker backend.

## Worker execution (`delegate_task`, `service/jarvisd/workers/manager.py`)
- `cloud` (default): `hermes -p default -z <goal+context> --yolo --ignore-rules [-t <toolsets>]`
 - Hermes "codecloud" (OpenCode Go + jev-router), the full Hermes agent (web, browser, mail,
 cron reminders, files, terminal). `worker.cloud_toolsets = []` (default) means the default
 profile's own toolsets. An explicit `-t` list only knows built-in toolsets and silently drops
 plugin ones such as mail.
- `local`: `hermes -z <goal+context> --yolo` with `HERMES_HOME` pointed at config
 `paths.worker_home` (`~/ai/state/jarvis-voice/hermes-home`, no `-p` profile) - gpt-oss-20b
 via the model router. Also the automatic one-shot fallback target if `cloud` fails for an
 infrastructure reason (429, 5xx, network, quota, or the `hermes` binary itself missing).
- `codex`: `~/ai/bin/codex-task.sh` (availability-gated, single dispatch, no retries).
- `claude`: `claude -p <prompt> --dangerously-skip-permissions` headless.
- `codex`/`claude` are only ever selected when the user names them by name in the request.
- Every worker gets `WORKER_PREAMBLE`: no one is present to answer questions, do the whole
 task with reasonable defaults, never block (no `sleep`/timers, no GUI dialogs - use the
 cronjob tool for anything that must happen later), end with a 1-3 sentence spoken-safe
 summary.
- Validation before `done`: exit code 0 AND non-empty final text AND no error markers AND
 any claimed file-path artifacts exist. Otherwise `needs_review` with an honest summary - 
 never a false completion.
- Task statuses: `queued|running|paused|canceled|done|failed|needs_review`.
- Pause/cancel: SIGSTOP/SIGCONT/SIGTERM(then SIGKILL) on the process group.
- Hard wall-clock cap: config `worker.timeout_s` (default 900 s). On expiry the process group
 is killed and the task marked `failed` with an honest summary.
- `Pipeline.wait_turn_clear()` holds a worker's start until no voice turn is mid-flight, so a
 worker's prefill never competes with an utterance for the GPU.

## Reminders (`set_reminder`, `service/jarvisd/reminders.py`)
Handled by jarvisd itself, never a worker (a worker once ran `sleep 180` in the foreground
plus a hanging `osascript`, which hung). A reminder is a row in the `reminders` table plus an
in-process timer (`ReminderScheduler`). When due: spoken through the pipeline's announcement
queue (shown in the conversation too) AND sent to the Matrix room `jarvis-voice` via
`~/ai/bin/notify`, so it reaches the phone with the tab closed. Pending reminders survive a
jarvisd restart. Ones missed while it was down fire immediately, marked "a little late".

## DB (`jarvis.db`, WAL, `service/jarvisd/db.py`)
- `tasks(id, kind, goal, context, toolsets, status, created, started, finished, session_id,
 pid, result_text, result_summary, validation JSON, usage JSON, metadata JSON)`
- `task_events(id, task_id, ts, type, payload JSON)`
- `turns(id, ts, transcript, reply, ms_stt, ms_first_token, ms_tts_first, ms_e2e, interrupted)`
- `turn_events(turn_id, ts, type, payload JSON)` - trace timeline
- `capabilities(id, kind, name, desc, keywords, toolsets, success, failures, last_used)`
- `reminders(id, text, due, status, created, fired)`, `status` is one of
  `pending`, `fired`, `canceled`
- memory index tables per `docs/memory-design-inputs.md` (notes/chunks/chunks_fts/embeddings),
 same file, same connection (`check_same_thread=False`).

## Config file `service/jarvisd.toml` (shipped defaults. Full shape in `config.py`'s `DEFAULTS`)
```
[server] host=127.0.0.1 port=9140
[ollama] url=http://127.0.0.1:11434 (embeddings only)
 mediator=gpt-oss-20b-mxfp4 mediator_url=http://127.0.0.1:8090 mediator_native=true
 worker=gpt-oss-20b-mxfp4 embed=nomic-embed-text mediator_num_ctx=8192 keep_alive=30m
[stt] engine=parakeet parakeet_model=mlx-community/parakeet-tdt-0.6b-v2
 model=base.en (whisper fallback) compute=int8 device=cpu partial_interval_ms=400
[vad] engine=smart_turn quiet_ms=250 max_pause_ms=1800 turn_threshold=0.5
 min_speech_ms=200 endpoint_ms=800 (webrtc fallback) aggressiveness=3
 silero_model=~/ai/models/silero/silero_vad.onnx
 smart_turn_model=~/ai/models/smart-turn/smart-turn-v3.2-cpu.onnx
[tts] voice=am_michael speed=1.1 engine=kokoro fallback=say
[paths] vault=~/ai/memory/obsidian-vault
 hermes_home=~/ai/state/jarvis-voice (jarvisd's own state dir. Historical key name)
 worker_home=~/ai/state/jarvis-voice/hermes-home (local worker backend's HERMES_HOME)
 models=~/ai/models
[budgets] context_card_tokens=600 mediator_history_turns=6
[worker] backend=cloud cloud_toolsets=[] timeout_s=900
[brain] active=cloud cloud_model=deepseek-v4.1-flash
 cloud_url=https://opencode.ai/zen/go/v1/chat/completions deep_model=minimax-m3
```
`GET /config` returns this merged (defaults + file + `JARVISD_PORT` env override) structure
verbatim. `POST /config` deep-merges a partial patch and persists it back to `jarvisd.toml`
with a small built-in TOML writer (no third-party TOML-writer dependency in this venv).
