# Jarvis Voice — Final Delivery Report (2026-07-27, fixes round 2026-07-28)

## Fixes round (user feedback, 2026-07-28)
1. **Full-bleed layout**: host wrapper padding neutralized via `:has(#jarvis-voice-root)`
   CSS; root height pinned to real viewport remainder in JS (the SPA's
   `display:contents` + content-sized wrapper made `height:100%` useless). No page
   overflow; right column and transcript scroll internally.
2. **Mic**: click now TOGGLES listening (Space = hold-to-talk). Capture bugs fixed:
   AudioContext resumed inside the gesture, linear-interpolation resampler (handles
   44.1 kHz non-integer ratios), worklet/getUserMedia errors surfaced as banners,
   live level meter + "mic is silent" hint. (The old press-and-release ~50 ms window
   was why no words were ever recorded.)
3. **Global dashboard**: plugin installed into the default dashboard (9119) —
   Jarvis tab appears next to signal-engine/crypto-trader, including the
   Tailscale-shared URL. jarvisd serves both dashboards.
4. **Visualizer rebuilt to the OpenClaw-JARVIS look** (`jincocodev/openclaw-jarvis-ui`,
   ISC — notices in THIRD_PARTY_LICENSES): Three.js wireframe icosahedron with
   simplex-noise displacement, rim-concentrated Fresnel glow shell, additive particle
   field; 14 state choreographies; **true voice sync** via an AnalyserNode on the
   actually-played audio (not server events); Obsidian memory-hit constellation with
   labeled note sprites; 60 fps, DPR-aware, context-loss recovery, reduced-motion mode.
   Bundle 150 KB gz (three.js tree-shaken).
5. Shipped to https://github.com/zilijonas/hermes-local-jarvis.


## What was delivered
A production-installed, Hermes-native local voice assistant on the Mac mini M4 (24 GB):

- **Isolated Hermes profile** `jarvis-voice` (`--no-skills`, zero cloud escape hatches:
  `fallback_providers: []`, every `auxiliary.*` pinned `custom`→Ollama, clean `.env`, no `auth.json`).
- **jarvisd** service daemon (LaunchAgent `local.jarvis.jarvisd`, 127.0.0.1:9140, own venv):
  VAD (webrtcvad, adaptive endpointing) → faster-whisper base.en int8 STT (partials + finals)
  → Gemma 4 E4B mediator (custom tiny-prompt loop, native Ollama /api/chat, 6 flat meta-tools,
  JSON tool protocol, one-retry parse recovery) → kokoro-onnx streaming TTS (sentence/fragment
  chunks, amplitude events, `say` fallback).
- **Workers**: Granite 4.1 (64k alias) via `hermes -p jarvis-voice -z … -t <toolsets>` with
  per-task 1–3 toolset diet (≈3–12 tools, never the full catalogue); Codex delegation via
  availability-gated `codex-task.sh`; validation gate (exit code + output + claimed-artifact
  existence) → `done` / `needs_review` / `failed`, no false completions; pause/resume/cancel
  with SIGKILL escalation; restart reconciliation flags orphaned tasks honestly.
- **Memory**: SQLite FTS5 + nomic-embed hybrid over the Obsidian vault (87 notes indexed,
  incremental 10-min refresh, folder priors, postmortem down-ranking, archive penalty),
  token-budgeted context cards, conflict flagging; writes ONLY as reviewable triage notes
  to `00-inbox` (secret-pattern refusal). Vault itself never modified.
- **Dashboard UI** (isolated instance `local.jarvis.dashboard`, 127.0.0.1:9131, tab `/jarvis`):
  AudioWorklet mic capture (16 kHz PCM over WS), player worklet, cinematic canvas visualizer
  (13 real event-driven states, reduced-motion + hidden-tab power saving), activity timeline
  with expandable tool calls, task board with live controls, memory sources, health + latency
  panels, typed-input fallback, WS auto-reconnect.
- **Ops**: install/update/uninstall/rollback/status scripts, backups to `~/ai/backups/`,
  docs (SETUP, TROUBLESHOOTING, ROLLBACK, MAINTENANCE), 52 unit tests + 10-scenario
  integration suite + 12-turn mediator-quality battery + `bench/run_bench.py`.

## Verified live (not simulated)
- WS voice loop end-to-end with real audio (say-generated speech → VAD → STT → mediator →
  kokoro chunks back over WS) — integration test green.
- Real delegation: spoken-style request → capability routing (`files.edit`→`file` toolset) →
  granite session created `/tmp/jarvis-test.txt` → validated `done` → announced.
- Memory recall of real vault facts; `memory.note` wrote a reviewable inbox note.
- Barge-in: interrupted `tts.end` within 500 ms (client playback stops immediately).
- Quality battery ≥10/12 across 3 runs; zero false-completion claims; zero unbounded loops;
  prompt-injection probe deflected.
- Restart recovery: kill -9 → reconcile marks `needs_review`; full LaunchAgent
  bootout/bootstrap cycle → both services return, task history intact (RunAtLoad=reboot path).
- Existing services untouched after everything: both Telegram gateways `connected`,
  dashboard 9119, ollama, crypto-trader 9127, docker/couch/n8n/tailscale LaunchAgents intact.

## Measured (bench/results-20260727T171033.json)
| Stage | p50 | p95 |
|---|---|---|
| mic UI response (client CSS state) | <100 ms (immediate, by construction) | — |
| voice STT (final decode) | 382 ms | 404 ms |
| mediator first token | 1 550 ms | 2 253 ms |
| first spoken audio after mic stop | 6 372 ms | 6 803 ms |
| text turn wall (incl. full TTS) | 3 936 ms | 7 551 ms |
| barge-in → tts.end | <500 ms (test-asserted) | — |
| tool-arg validity (quality battery) | 100% parsed (1 retry allowed) | — |

## Honest limitations
1. **First spoken reply ≈6.4 s median, not the 1.5 s aspiration.** Bound by E4B prefill
   (~1.5 s) + fragment decode + kokoro per-fragment synth (~0.5–1.2 s, uninterruptible
   `create()`). Already mitigated with aggressive first-fragment cutting, 6-turn history,
   `num_predict` 220. Paths to ~2–3 s: llama.cpp server with persistent KV prompt cache,
   smaller mediator, or streaming TTS engine.
2. **24 GB cannot hold Gemma + Granite resident together** — worker runs evict the mediator
   (cold worker ≈60–90 s; jarvisd re-warms gemma after each task so voice stays snappy).
3. **Wake-word/continuous mode** shipped as experimental toggle; push-to-talk is primary
   (per spec). OS-global hotkey not possible from the browser sandbox — needs a native
   helper later.
4. Real physical-mic echo behavior untested by automation (browser AEC + half-duplex gate +
   transcript-echo rejection implemented); a human live-room test remains.
5. A real machine reboot wasn't performed (would interrupt trading/Telegram services);
   equivalent LaunchAgent bootout/bootstrap cycle verified instead.
6. Isolated dashboard shows the stock profile banner "default" (cosmetic, Hermes SPA quirk)
   and bundled dashboard plugins (kanban/achievements) also appear as tabs.
7. Profile-scoped LaunchAgent logs not covered by the global logrotate (documented
   workaround in MAINTENANCE.md).

## Build-cost model routing (credit optimization)
The build itself followed an explicit cheap-model-for-simple-work policy:
- **Sonnet 5 subagents (11 launches, 100% of delegated subtasks)**: all four read-only
  exploration/audit agents (plugin API map, voice/UI stack map, profiles/sessions map,
  vault audit), all five component builders (jarvisd core skeleton, audio modules,
  Hermes plugin + install scripts, memory indexer, web UI), the integration-test suite
  builder, and the ops-docs writer — every `Agent` call passed `model: sonnet`.
- **Fable (main thread) reserved for**: architecture decisions, binding contracts
  (SPEC.md), the four correctness-critical modules (mediator loop/prompt, worker
  validation gate, capability router, pipeline orchestrator), cross-module integration,
  live debugging, and this report.
- Zero-token shell checks preferred over model calls throughout (md5/grep/curl audits,
  `codex-task.sh status` availability gating).

## Launch
- UI: http://127.0.0.1:9131/jarvis (Safari web-app wrapper can be pinned like the others)
- Services: `launchctl kickstart -k gui/$(id -u)/local.jarvis.jarvisd` (and `.dashboard`)
- Status: `~/ai/repos/hermes-jarvis-voice/scripts/status.sh`
- Rollback: `scripts/rollback.sh` · Uninstall: `scripts/uninstall.sh`
