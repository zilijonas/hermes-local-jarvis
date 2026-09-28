# Jarvis Voice: Architecture

Voice assistant on a Mac mini M4 24 GB, built into the Hermes dashboard. Audio (speech
recognition, turn detection, speech synthesis) runs on this box. The thinking runs on the
OpenCode Go subscription by default, with the local model as an automatic fallback.

```
 browser: main Hermes dashboard, tab /jarvis (https://macmini-ai.tail9102ce.ts.net/jarvis)
   mic: getUserMedia (echoCancellation) to AudioWorklet 16 kHz PCM ──────────+  WS
   speaker: FIFO player worklet to loopback RTCPeerConnection to <audio> (iOS: direct, system AEC)  <───|  /api/plugins/jarvis-voice/ws
            (so the browser's echo canceller hears Jarvis's own voice)      │  (hermes-plugin/dashboard/plugin_api.py
   state, live captions, tasks, memory hits, brain + worker selectors       │   is a thin proxy)
                                                                            ▼
 jarvisd  127.0.0.1:9140  (LaunchAgent local.jarvis.jarvisd, own venv, state ~/ai/state/jarvis-voice)
   audio/turn.py   Silero VAD v6 + Smart Turn v3.2: "has the user finished?"   (hands-free)
   audio/stt.py    Parakeet-TDT 0.6B v2 on MLX (~150 ms), faster-whisper base.en fallback
   audio/tts.py    kokoro-onnx (voice am_michael), speakable() text cleanup, `say` fallback
   pipeline.py     turn queue, fragment merging, playback clock, barge-in, announcements
   mediator/       the conversation loop, 8 meta-tools, two brains:
                     cloud  OpenCode Go deepseek-v4.1-flash (default)  ─+ automatic per-turn
                     local  gpt-oss-20b via the model router :8090     ─+ fallback either way
                   deep_answer to OpenCode Go minimax-m3 for hard questions
   workers/        delegate_task to background task, one of:
                     cloud  `hermes -p default -z` = codecloud (Go minimax-m3 + jev-router), the
                            full Hermes agent: web, browser, mail, cron reminders, files, terminal...
                     local  `hermes -z` with HERMES_HOME=~/ai/state/jarvis-voice/hermes-home (gpt-oss)
                     codex / claude  only when the user names them
   memory/         FTS5 + nomic-embed index of the Obsidian vault and ~/.hermes/memories
   caps/           capability manifest (hints; toolsets for the local backend)
```

## Why the mediator is not a Hermes session
Hermes enforces a 64k minimum context and a ~12k-token system surface. The mediator needs a
first spoken word in about a second, so it is a bare chat loop with a small prompt and eight
flat tool schemas (mediator/prompt.py). Real work goes to Hermes through `delegate_task`.

## Brains (measured 2026-09-28, 12-turn quality battery, tests/test_mediator_quality.py)
| brain | first token | battery |
|---|---|---|
| cloud · deepseek-v4.1-flash | 1.3-1.9 s, steady | 12/12 |
| local · gpt-oss-20b | 1.5-12 s (GPU shared with other local jobs) | 8-10/12 |
minimax-m3 streams its `<think>` block inside `content`; the mediator strips think spans before
anything reaches TTS. qwen3.8-flash measured up to 14 s to first word and is not used.

## Turn taking
- **Push to talk / mic button**: pauses never split a sentence. A turn ends on release, on mic off, or after 2.5 s of silence (so a mic left on doesn't record silence forever); the next sentence is a new turn, or merges if Jarvis hasn't spoken yet.
- **Hands-free**: after 250 ms of silence Smart Turn scores the utterance; "finished" ends the
  turn, "not finished" keeps listening (`turn.pending` to "go on..." in the UI) up to 1.8 s.
- **Fragment merge**: if the user speaks again before Jarvis has made a sound and before any
  side-effect tool ran, the half-answered turn is aborted and both fragments become one turn
  (`stt.final` with `merged: true`). A follow-up while a turn is still queued merges into it.
- **Playback clock**: "speaking" lasts until the audio has played, not until synthesis ends.
  The server sums queued audio, and the client confirms with `playback.end`.
- **Barge-in**: sustained voice (300 ms) while Jarvis is audible, then a quick decode must give
  at least two words that are not an echo of what Jarvis is saying. Push-to-talk always barges.
- **Echo guard**: a transcript close to Jarvis's recent speech is ignored, only while audio
  plays or within 1.5 s after it.

## STT benchmark (2026-09-28, 12 utterances, clean / SNR 10 dB / SNR 3 dB)
| engine | WER | latency |
|---|---|---|
| faster-whisper base.en int8 (old) | 9.7 / 18.7 / 38.8 % | ~420 ms |
| mlx whisper-large-v3-turbo | 8.2 / 16.4 / 23.1 % | 820-1300 ms |
| parakeet-tdt-0.6b-v2 (now) | ~11 / 17.9 / 19.4 % | ~150 ms |
The test voices are macOS `say` voices; real speech favours Parakeet further (Open ASR leaderboard).

## Reminders
`set_reminder(text, in_minutes | at)` is handled by jarvisd itself (reminders.py), not a worker:
a row in jarvis.db plus a timer. When due it is spoken (queued behind any live turn) and sent to
the Matrix room `jarvis-voice` through `~/ai/bin/notify`, so it reaches the phone with the tab
closed. Pending reminders survive restarts, and ones missed while jarvisd was down fire late.
A worker was tried first and ran `sleep 180` in the foreground plus a hanging Reminders.app
osascript, so workers are now told never to block and to use the cronjob tool for later work.

## Tasks and announcements
Workers get a preamble: no one is there to answer questions, do the whole task, end with a
1-3 sentence spoken summary. When a task finishes, `Mediator.report_task` turns the result into a
short spoken report, which is also shown in the conversation. Cloud tasks that fail for
infrastructure reasons (429, 5xx, network, quota) retry once on the local backend. Wall-clock cap
900 s. A task becomes `done` only after validation (exit code, output, claimed files exist).

## Ports and state
- 9140 jarvisd (loopback). The Jarvis tab is served by the main dashboard (9120, tailnet https).
- `~/ai/state/jarvis-voice/`: `jarvis.db` (turns, tasks, memory index), `logs/`, `hermes-home/`
  (lean Hermes home for the local worker; not a dashboard profile).
- Models: `~/ai/models/{kokoro,silero,smart-turn}`, Parakeet in the HuggingFace cache.

## Restart and recovery
jarvisd owns all state in jarvis.db (WAL). The UI reconnects and replays open tasks. On boot,
tasks whose worker PID is gone become `needs_review`. `scripts/install.sh` / `update.sh` /
`uninstall.sh` / `rollback.sh` manage the LaunchAgent and back up to `~/ai/backups/` first.

## Mobile (iPhone Safari / home-screen app)
- Phones open in fullscreen (below the host bar). Text inputs are 16px so Safari doesn't zoom.
- Audio unlocks on the first tap anywhere (iOS keeps a context created outside a gesture silent),
  uses the hardware sample rate on iOS, and plays straight to the speaker there.
- Sheets (Tasks / Memory / Activity) rely on hermes-ui 1.5.5: older versions stranded them off-screen
  behind a dark scrim in WebKit and left an invisible scrim that blocked every tap.
- The central visualizer is a WebGL orb (visualizer/orb-gl.js) with a Canvas 2D fallback (orb-2d.js).
