# Setup

Repo: `/Users/agent/ai/repos/hermes-jarvis-voice`. All commands below assume
this as cwd unless stated otherwise.

Since 2026-09-28, jarvisd needs no Hermes profile of its own: the plugin is
a standalone Hermes plugin (`kind: standalone` in `hermes-plugin/plugin.yaml`)
served directly by the main Hermes dashboard, and jarvisd keeps its own state
directory rather than a `~/.hermes/profiles/<name>` home. See
[hermes-profiles-sessions.md](hermes-profiles-sessions.md) for why the old
profile was removed.

## Prerequisites

1. **The main Hermes dashboard** (`local.hermesagent.dashboard`) already
   running on `127.0.0.1:9120`, this repo does not install or manage it.
   `scripts/install.sh` only symlinks the plugin into it.
2. **The model router** on `127.0.0.1:8090` (LaunchAgent
   `local.hermesagent.modelrouter`) serving **gpt-oss-20b MXFP4** via
   llama.cpp. This is the automatic local fallback for both the mediator
   (config `brain.active`, default `cloud`) and the `delegate_task` worker
   backend (config `worker.backend`, default `cloud`), and the exclusive
   engine when either is explicitly switched to `local`. Native tool-calling
   (`mediator_native = true`) is required for gpt-oss-20b, see
   `service/jarvisd/mediator/prompt.py`.
3. **OpenCode Go** reachable at the URL in config `brain.cloud_url`
   (`https://opencode.ai/zen/go/v1/chat/completions`), the default cloud
   brain (`deepseek-v4.1-flash`) and, via `hermes -p default -z` (Hermes
   "codecloud" + jev-router), the default `delegate_task` worker backend.
   `deep_answer` calls the same account's `minimax-m3`. No local Hermes
   profile is needed for jarvisd itself, the cloud path shells out to the
   pre-existing `default` Hermes profile.
4. **Ollama** on `127.0.0.1:11434`, for embeddings only:
   ```sh
   ollama pull nomic-embed-text   # memory embeddings, ~0.27 GB
   ```
5. **kokoro-onnx TTS model files** at `~/ai/models/kokoro/`:
   - `kokoro-v1.0.onnx`
   - `voices-v1.0.bin`

   Falls back to macOS `say` if these are missing or fail to load
   (config `tts.fallback`).
6. **STT models**:
   - Parakeet-TDT 0.6B v2 on MLX (`mlx-community/parakeet-tdt-0.6b-v2`,
     config `stt.parakeet_model`), the default engine (`stt.engine =
     "parakeet"`). Weights download to the HuggingFace cache on first load
     (`HF_HUB_OFFLINE=1` is tried first so a warm box never phones home).
   - faster-whisper `base.en`, automatic fallback if MLX or the Parakeet
     weights fail to load. Downloads its own CTranslate2 weights on first
     use.
7. **Turn-detection models** at `~/ai/models/silero/silero_vad.onnx` and
   `~/ai/models/smart-turn/smart-turn-v3.2-cpu.onnx` (config `vad.*_model`).
   If either file is missing, `audio/turn.py` falls back to the older
   webrtcvad endpointer (`vad.engine = "webrtc"`) so jarvisd never goes deaf.
8. **Python 3.11** on PATH as `python3.11` (used to create `service/.venv`).
9. **Hermes** installed at `~/.local/bin/hermes`, used for both
   `delegate_task` worker backends: `hermes -p default -z ...` (cloud) and
   `hermes -z ...` with `HERMES_HOME=~/ai/state/jarvis-voice/hermes-home`
   (local, no `-p`). `codex`/`claude` backends are separate, user-named-only
   paths (`~/ai/bin/codex-task.sh`, `claude` on PATH).
10. macOS `say` + `ffmpeg` on PATH, used by the TTS fallback path and by
    `service/tests/test_audio.py`.

## Fresh install

### 1. Run the installer

```sh
scripts/install.sh
```

Steps (idempotent, no sudo):
1. Back up anything about to be overwritten to
   `~/ai/backups/jarvis-voice-install-<timestamp>.tgz`.
2. Create `~/ai/state/jarvis-voice/{logs,hermes-home}` and, only if absent, a
   minimal `hermes-home/config.yaml` pointing the **local** worker fallback
   at the model router (`127.0.0.1:8090`, manual approvals, web search on
   locally, browser off). The **cloud** worker path (default) doesn't need
   this file at all, it shells out to the separate `default` Hermes
   profile.
3. Symlink `~/.hermes/plugins/jarvis-voice` to `<repo>/hermes-plugin`.
4. Create `service/.venv` (python3.11) + install `service/requirements.txt`.
5. Install + bootstrap the `local.jarvis.jarvisd` LaunchAgent.
6. Poll `http://127.0.0.1:9140/health` for up to 60 s.

`service/jarvisd/app.py` may not exist yet on a very fresh checkout (built
in parallel), a health-wait timeout on first run is expected, not a bug.
Re-run `scripts/install.sh` once the service code is present.

### 2. Verification checklist

```sh
# jarvisd health
curl -s 127.0.0.1:9140/health
# expect: {"ok":true, "components":{"stt":{"ok":true,...},"tts":{"ok":true,...},
# "mediator":{"ok":true,...},"ollama":{"ok":true,...},"db":{"ok":true,...},
# "turns":{"ok":true,...}}, "models":{...}, "ram":{...}}

# dashboard plugin list (needs the browser's session token for most
# /api/dashboard/* routes - a bare curl may get {"detail":"Unauthorized"}.
# see docs/TROUBLESHOOTING.md)
curl -s 127.0.0.1:9120/api/dashboard/plugins | grep jarvis-voice

# full mediator turn, no mic (text-in/text-out)
curl -s -X POST 127.0.0.1:9140/converse -H 'Content-Type: application/json' \
 -d '{"text":"what time is it"}'
# expect: {"reply_text":"...", "actions":[...], "turn_id":"..."}

# dashboard tab loads (200)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9120/jarvis
```

Then open `http://127.0.0.1:9120/jarvis` (or the tailnet https URL) in a
browser and grant microphone permission when prompted.

### 3. LaunchAgent + log paths

| Label | plist | stdout | stderr |
|---|---|---|---|
| `local.jarvis.jarvisd` | `~/Library/LaunchAgents/local.jarvis.jarvisd.plist` | `~/ai/state/jarvis-voice/logs/jarvisd.out.log` | `.../jarvisd.err.log` |

jarvisd additionally writes its own application-level rotating log to
`~/ai/state/jarvis-voice/logs/jarvisd.log` (2 MB × 3, via Python
`RotatingFileHandler`) - distinct from the LaunchAgent-captured
`jarvisd.out/err.log` above, which only catch uvicorn access lines and
anything printed/crashed outside the app's own logger.

The dashboard itself (`local.hermesagent.dashboard`, port 9120) is **not**
managed by this repo - it's the pre-existing main Hermes dashboard, already
running for other plugins. `install.sh`/`uninstall.sh` only ever touch the
`local.jarvis.jarvisd` LaunchAgent and the plugin symlink.

`local.jarvis.jarvisd` runs `KeepAlive` + `RunAtLoad`, scoped to
`LimitLoadToSessionType: [Aqua, Background]`. No cloud API key is set in the
plist's `EnvironmentVariables` (only `HERMES_HOME` and `PATH`) - when the
cloud brain or cloud worker backend needs credentials, the process reads
them from `~/.hermes/.env` at runtime.

Check current state any time with:
```sh
scripts/status.sh
```
