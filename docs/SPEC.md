# jarvisd — binding contracts (v1)

Single source of truth for service, plugin proxy, and UI. Change only here first.

## Process
- Python 3.11 venv at repo `service/.venv` (created by scripts/install.sh).
- Entry: `service/jarvisd/app.py` → uvicorn on `127.0.0.1:9140` (config: `service/jarvisd.toml`).
- State: `~/.hermes/profiles/jarvis-voice/jarvis.db` (sqlite, WAL).
- Logs: `~/.hermes/profiles/jarvis-voice/logs/jarvisd.log` (rotating 2 MB × 3).
- LaunchAgent `local.jarvis.jarvisd.plist` (KeepAlive, RunAtLoad).

## HTTP API (all JSON; no auth — loopback only; plugin proxy adds dashboard auth)
- `GET  /health` → `{ok, version, uptime_s, components: {ollama, stt, tts, db, mediator}:
  {ok, detail}, models: {mediator: {name, resident}, worker: {name, resident}}, ram: {free_gb}}`
- `GET  /config` → sanitized runtime config (models, ports, budgets, feature flags).
- `POST /config` → patch subset (voice, budgets, reduced_motion etc.); persisted to jarvisd.toml.
- `GET  /tasks?status=&limit=` → task list (see db.tasks).
- `GET  /tasks/{id}` → task + progress events + result.
- `POST /tasks/{id}/control` `{action: pause|resume|cancel}` → `{ok, status}`.
- `POST /say` `{text, interrupt: bool}` → speak text (debug/tests).
- `POST /converse` `{text}` → run a full mediator turn as if spoken (tests/no-mic mode);
  returns `{reply_text, actions: [...], turn_id}`.
- `GET  /memory/search?q=&k=` → `{hits: [{path, title, snippet, score, confidence, updated,
  conflict}], card, budget_tokens}`.
- `GET  /capabilities/search?q=&k=` → `{hits: [{id, kind: tool|skill|action, name, desc, score}]}`.
- `GET  /metrics` → latency histograms (stt, mediator_first_token, tts_first_chunk,
  e2e_first_audio), counters (turns, barge_ins, tasks, errors), ram snapshot.
- `GET  /traces?limit=` → recent turn traces (timeline events per turn).

## WebSocket `/ws` (single duplex channel per UI client)
Client→server (JSON text frames unless noted):
- binary frames: 16 kHz mono s16le PCM mic chunks (only while `mic.active`).
- `{t:"mic.start"}` / `{t:"mic.stop"}` — push-to-talk gate.
- `{t:"mode.set", mode:"ptt"|"vad"}` — continuous VAD mode (post-MVP default ptt).
- `{t:"barge_in"}` — explicit UI interrupt (also auto via VAD server-side).
- `{t:"turn.text", text}` — typed input path (same as /converse but streamed events).
- `{t:"task.control", id, action}` — pause/resume/cancel.
- `{t:"ping"}` → `{t:"pong"}`.

Server→client events (every event: `{t, ts, turn_id?, ...}`):
- `state` `{value: idle|listening|transcribing|thinking|memory|capability|tool|delegating|
  worker_progress|speaking|interrupted|blocked|error|done, detail?}` — global FSM, UI-canonical.
- `stt.partial` `{text}` / `stt.final` `{text, ms}`
- `mediator.delta` `{text}` / `mediator.done` `{text, ms_first_token, ms_total}`
- `meta_tool` `{name, args, phase: start|end, result_summary?, ms?}`
- `tts.start` `{text}` / `tts.chunk` (binary: 24 kHz mono s16le PCM) preceded by
  `{t:"tts.chunk_hdr", seq, samples}` / `tts.amp` `{v: 0..1}` (~30 Hz) / `tts.end` `{ms_first_chunk}`
- `task.update` `{id, status, title, kind, progress_note?, result_summary?}`
- `memory.hits` `{items: [{path, title, score}]}`
- `latency` `{stage, ms}` — per-turn stage timings as they resolve.
- `health` `{...}` (on change) · `error` `{message, recoverable}`

FSM value drives the cinematic canvas 1:1. Server is authoritative; UI never fakes states.

## Meta-tools (mediator function-calling schema, flat, ≤6)
1. `memory_recall(query: str)` → context card string.
2. `capability_search(query: str)` → top capabilities with ids.
3. `quick_action(action_id: str, args_json: str)` → immediate small action (whitelisted:
   get_time, system_status, open_task_board, say_again, set_volume, list_tasks).
4. `delegate_task(goal: str, kind: "granite"|"codex", context: str)` → `{task_id, status:"started"}`.
5. `task_status(task_id: str)` (empty id → latest few) → status/progress summaries.
6. `task_control(task_id: str, action: "pause"|"resume"|"cancel")`.
Mediator prompt: ≤2k tokens, states that delegate_task only STARTS work; completion is
announced later via task events, never claimed by the mediator.

## Worker execution
- granite: subprocess `hermes -p jarvis-voice -z <goal+context> --yolo -t <toolsets_csv>
  --source tool --usage-file <tmp>`; toolsets chosen by capability router (1-3 sets, ~3-12 tools).
  stdout captured; session id recovered from state.db (latest by source+time) for progress reads.
- codex: `~/ai/bin/codex-task.sh` conventions (availability gate `status`, one dispatch, no retry loop).
- Validation before `done`: exit code 0 AND non-empty final text AND no `[error]` markers AND
  artifact checks when the goal names file outputs. Else status `needs_review` with honest summary.
- Task statuses: `queued|running|paused|canceled|done|failed|needs_review`.
- Pause/cancel: SIGSTOP/SIGCONT/SIGTERM process group; resume of canceled granite task =
  new session with `--resume` when available else fresh with context.

## DB (jarvis.db)
- tasks(id TEXT pk, kind, goal, context, toolsets, status, created, started, finished,
  session_id, pid, result_text, result_summary, validation JSON, usage JSON)
- task_events(id, task_id, ts, type, payload JSON)
- turns(id, ts, transcript, reply, ms_stt, ms_first_token, ms_tts_first, ms_e2e, interrupted)
- turn_events(turn_id, ts, type, payload JSON)  — trace timeline
- memory index tables per docs/memory-design-inputs.md
- capabilities(id, kind, name, desc, keywords, toolsets, success, failures, last_used)

## Latency targets (measured, /metrics)
mic UI ack <100 ms (client-side) · stt.final ≤500 ms after endpoint · first tts.chunk ≤1.5 s
median after endpoint · barge-in stop <150 ms · valid meta-tool args ≥98%.

## Config file service/jarvisd.toml (defaults)
[server] host=127.0.0.1 port=9140
[ollama] url=http://127.0.0.1:11434 mediator=gemma4:e4b-it-qat worker=granite4.1-local-64k
  embed=nomic-embed-text mediator_num_ctx=8192 keep_alive=30m
[stt] model=base.en compute=int8 device=cpu partial_interval_ms=600
[vad] aggressiveness=2 endpoint_ms=500 min_speech_ms=200
[tts] voice=am_michael speed=1.1 engine=kokoro fallback=say
[paths] vault=~/ai/memory/obsidian-vault hermes_home=~/.hermes/profiles/jarvis-voice
  models=~/ai/models
[budgets] context_card_tokens=600 mediator_history_turns=12
