# Setup

Repo: `/Users/agent/ai/repos/hermes-jarvis-voice`. All commands below assume
this as cwd unless stated otherwise.

## Prerequisites

1. **Ollama** running on `127.0.0.1:11434` with these models pulled:
   ```sh
   ollama pull gemma4:e4b-it-qat        # mediator, ~6.1 GB
   ollama pull granite4.1-local-64k     # worker, ~5.3 GB — must be the -local-64k alias
   ollama pull nomic-embed-text         # memory embeddings, ~0.27 GB
   ```
   `granite4.1-local-64k` matters specifically: Hermes enforces
   `MINIMUM_CONTEXT_LENGTH = 64_000` for any model used in a session, and
   this alias is the one carrying `ollama_num_ctx: 65536`. A plain
   `granite4.1:8b` pull will not satisfy Hermes sessions.
2. **kokoro-onnx TTS model files** at `~/ai/models/kokoro/`:
   - `kokoro-v1.0.onnx`
   - `voices-v1.0.bin`
3. **faster-whisper STT** — no manual model file needed; `faster_whisper.WhisperModel("base.en")`
   downloads its own CTranslate2-format weights on first load. Optional:
   ggml `.bin` files at `~/ai/models/whisper/` (e.g. `ggml-base.en.bin`) are
   NOT consumed by the current faster-whisper path (different format,
   whisper.cpp-only) — keep only if you plan a future whisper.cpp build.
4. **Python 3.11** on PATH as `python3.11` (used to create `service/.venv`).
5. **Hermes** installed at `~/.hermes/hermes-agent` (v0.19.0+ verified).
6. macOS `say` + `ffmpeg` on PATH — used by the TTS fallback path and by
   `service/tests/test_audio.py`.

## Fresh install

### 1. Create the Hermes profile (one-time; already done on this box)

```sh
hermes profile create jarvis-voice --no-skills
```

`--no-skills` drops a `.no-bundled-skills` marker in the profile home that
blocks bundled-skill seeding (including on future `hermes update` syncs).
Live profile home: `~/.hermes/profiles/jarvis-voice/`.

### 2. Canonical profile config

Lives at `~/.hermes/profiles/jarvis-voice/config.yaml` (not mirrored in this
repo — treat the live file as source of truth). Key decisions baked in:

- `fallback_providers: []`, no `fallback_model` — main model never falls to
  cloud on failure.
- `model.provider: custom`, `base_url: http://127.0.0.1:11434/v1`,
  `context_length: 65536`, `ollama_num_ctx: 65536` — worker is
  `granite4.1-local-64k` via Ollama's OpenAI-compatible endpoint.
- `auxiliary.*` (vision, web_extract, compression, skills_hub, approval) each
  pinned to `provider: custom` + explicit Ollama `base_url` — this closes the
  `provider: auto` → openrouter/nous/local/any-API-key cloud-leak path.
- `toolsets: [file, terminal, web, todo, clarify]` plus a long
  `agent.disabled_toolsets` list (session_search, code_execution, vision,
  video, image_gen, video_gen, x_search, moa, tts, context_engine,
  messaging, homeassistant, spotify, yuanbao, computer_use) — lean tool
  surface, cuts prefill for the Granite worker.
- `agent.reasoning_effort: false` — granite4.1 has no thinking mode; `true`
  makes Ollama return 400.
- `plugins.enabled: [jarvis-voice]`.
- `stt.enabled: true`, `stt.provider: local` (faster-whisper) — this is the
  dashboard's `/api/audio/transcribe` fallback path, separate from jarvisd's
  own persistent STT.

### 3. Run the installer

```sh
scripts/install.sh
```

Steps (idempotent, no sudo): back up anything about to be overwritten to
`~/ai/backups/jarvis-voice-install-<timestamp>.tgz` → symlink
`~/.hermes/profiles/jarvis-voice/plugins/jarvis-voice` →
`<repo>/hermes-plugin` → create `service/.venv` (python3.11) + install
`service/requirements.txt` → install + bootstrap both LaunchAgents → poll
both health URLs for up to 60 s.

`service/jarvisd/app.py` may not exist yet on a very fresh checkout (built
in parallel) — a health-wait timeout on first run is expected, not a bug;
re-run `scripts/install.sh` once the service code is present.

### 4. Verification checklist

```sh
# jarvisd health
curl -s 127.0.0.1:9140/health
# expect: {"ok":true, "components":{"stt":{"ok":true,...},"tts":{"ok":true,...},
#          "mediator":{"ok":true,...},"ollama":{"ok":true,...},"db":{"ok":true,...}}, ...}

# dashboard plugin list (this is what scripts/status.sh actually polls as
# the dashboard's "health" — there is no separate /health on the dashboard)
curl -s 127.0.0.1:9131/api/dashboard/plugins | head -c 300

# full mediator turn, no mic (text-in/text-out)
curl -s -X POST 127.0.0.1:9140/converse -H 'Content-Type: application/json' \
  -d '{"text":"what time is it"}'
# expect: {"reply_text":"...", "actions":[...], "turn_id":"..."}

# dashboard tab loads (200)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9131/jarvis
```

Then open `http://127.0.0.1:9131/jarvis` in a browser and grant microphone
permission when prompted.

### 5. LaunchAgent labels + log paths

| Label | plist | stdout | stderr |
|---|---|---|---|
| `local.jarvis.jarvisd` | `~/Library/LaunchAgents/local.jarvis.jarvisd.plist` | `~/.hermes/profiles/jarvis-voice/logs/jarvisd.out.log` | `.../jarvisd.err.log` |
| `local.jarvis.dashboard` | `~/Library/LaunchAgents/local.jarvis.dashboard.plist` | `~/.hermes/profiles/jarvis-voice/logs/dashboard.out.log` | `.../dashboard.err.log` |

jarvisd additionally writes its own application-level rotating log to
`~/.hermes/profiles/jarvis-voice/logs/jarvisd.log` (2 MB × 3, via Python
`RotatingFileHandler`) — distinct from the LaunchAgent-captured
`jarvisd.out/err.log` above, which only catch uvicorn access lines and
anything printed/crashed outside the app's own logger.

Both agents run `KeepAlive` + `RunAtLoad`, scoped to
`LimitLoadToSessionType: [Aqua, Background]`. Neither carries any cloud API
key in `EnvironmentVariables` — jarvisd talks only to loopback Ollama, local
STT/TTS, and the local Obsidian vault.

Check current state any time with:
```sh
scripts/status.sh
```
