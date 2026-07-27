# Jarvis Voice — Architecture

Hermes-native local voice assistant on a Mac mini M4 24 GB. Everything runs locally and free;
no cloud calls anywhere in the runtime path.

```
                     ┌─────────────────────────── browser (Hermes dashboard, jarvis profile) ─┐
                     │  Jarvis plugin page (React IIFE via __HERMES_PLUGIN_SDK__)             │
                     │  • AudioWorklet mic capture → PCM chunks over WS                       │
                     │  • Cinematic canvas (state machine, audio-reactive)                    │
                     │  • Activity timeline / task board / memory sources / health            │
                     └───────────────▲──────────────────────────────▲────────────────────────┘
                                     │ /api/plugins/jarvis-voice/*  │ WS /api/plugins/jarvis-voice/ws
                     ┌───────────────┴──────────────────────────────┴────────────────────────┐
                     │ dashboard server (hermes -p jarvis-voice dashboard --isolated :9131)  │
                     │   hermes-plugin/dashboard/plugin_api.py — THIN PROXY to jarvisd       │
                     └───────────────▲────────────────────────────────────────────────────────┘
                                     │ http/ws 127.0.0.1:9140
┌────────────────────────────────────┴────────────────────────────────────────────────────────┐
│ jarvisd — standalone service daemon (own venv, LaunchAgent, survives UI restarts)           │
│                                                                                              │
│  audio/    VAD (webrtcvad) + endpointing · STT faster-whisper base.en int8 (persistent)     │
│            TTS kokoro-onnx (persistent, sentence-streaming) + /usr/bin/say fallback         │
│  mediator/ Gemma 4 E4B via Ollama /v1 (num_ctx 8192, keep_alive) — tiny prompt (<2k tok)    │
│            6 meta-tools: memory_recall · capability_search · quick_action · delegate_task   │
│                          task_status · task_control(pause/resume/cancel)                    │
│  workers/  Granite: subprocess `hermes -p jarvis-voice -z <goal> -t <3-5 relevant toolsets>`│
│            Codex/Claude: ~/ai/bin/codex-task.sh (availability-gated, one dispatch/task)     │
│            task table in jarvis.db (sqlite WAL) — status/progress/results survive restarts  │
│  memory/   incremental index of Obsidian vault (88 notes) + ~/.hermes/memories              │
│            sqlite FTS5 + nomic-embed-text vectors (Ollama) · context cards ≤ token budget   │
│  caps/     capability manifest (tools/skills/actions) — exact + lexical + embedding match   │
│  events/   WS event bus → UI: state transitions, partial transcripts, TTS amplitude,        │
│            tool calls, worker progress, memory hits, latency metrics                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
        │                       │                          │
   Ollama :11434           state: ~/.hermes/profiles/  Obsidian vault
   gemma4:e4b-it-qat       jarvis-voice/ (config,      ~/ai/memory/obsidian-vault (read-mostly;
   granite4.1-local-64k    sessions, state.db,         writes only via reviewed inbox notes)
   nomic-embed-text        jarvis.db)
```

## Why the mediator is NOT a Hermes agent session
Hermes enforces `MINIMUM_CONTEXT_LENGTH = 64_000` (agent/model_metadata.py:196) and injects
a ≥12k-token system surface even after the July tool-diet. Gemma E4B prefill on that kills the
≤1.5 s first-spoken-reply target. The mediator therefore runs as a bare chat loop against
Ollama's OpenAI endpoint with a hand-written <2k-token prompt and exactly 6 flat meta-tool
schemas. Hermes is still the platform: sessions/tools/state for every real task (Granite via
Hermes CLI sessions), profile isolation, dashboard UI, STT config, plugin system.

## Voice pipeline (latency budget → ~1.5 s median)
mic → AudioWorklet 16 kHz PCM frames → WS → jarvisd VAD (webrtcvad, 20 ms frames,
adaptive endpoint 300–800 ms) → rolling faster-whisper partials (~every 500 ms) + final decode
(0.3 s) → mediator first sentence (~0.5–0.9 s) → kokoro first chunk (0.26 s) → WS audio out
→ browser playback with amplitude events.
Barge-in: VAD speech-start while TTS playing → pause playback <150 ms, cancel mediator stream,
new turn. Echo rejection: half-duplex gate + output-fingerprint check (drop STT text that
matches the tail of what Jarvis just spoke) before wake into listening.

## Ports
- 9131 dashboard (jarvis-voice isolated instance, loopback)
- 9140 jarvisd (loopback)
- 11434 Ollama (existing)

## RAM plan (24 GB box, ~35 % free baseline)
gemma e4b @8k ctx ≈ 3.5–4 GB (keep_alive 30m) · granite 64k loads on demand ≈ 5–7 GB ·
whisper base.en int8 ≈ 0.3 GB · kokoro ≈ 0.5 GB · jarvisd+UI ≈ 0.4 GB.
Worst case (both LLMs + speech) ≈ 11–12 GB — fits; degraded mode drops granite keep_alive to 0.

## Restart/recovery model
- jarvisd LaunchAgent (KeepAlive) owns all voice/mediator/worker state via jarvis.db (WAL).
- Dashboard restart: UI reconnects WS, replays open tasks from /tasks. Worker `hermes -z`
  subprocesses are jarvisd children; jarvisd restart re-attaches via task table + session ids
  recorded in state.db (jarvis-voice profile), reconciles orphans on boot.
- Ollama restart: mediator/STT/TTS retry with backoff; UI shows blocked/error state honestly.

## Anti-false-completion
Worker results are validated: exit code + final-text heuristics + (for file tasks) artifact
existence checks before a task may transition to `done`. The mediator is prompted to report
`delegate_task` acceptance as "started", never "done"; only task_status/events flip UI state.

## Repo → install mapping
- repo `hermes-plugin/` → symlink `~/.hermes/profiles/jarvis-voice/plugins/jarvis-voice`
- repo `service/` → run in place via repo venv; LaunchAgent `local.jarvis.jarvisd.plist`
- dashboard LaunchAgent `local.jarvis.dashboard.plist` (isolated, port 9131)
- scripts/install.sh · update.sh · uninstall.sh · rollback.sh manage all of the above;
  backups to ~/ai/backups/ before any overwrite.
