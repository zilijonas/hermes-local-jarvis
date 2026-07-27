# Jarvis Voice

Hermes-native local voice assistant. Gemma 4 E4B mediator (fast turn-taking) +
Granite 4.1 worker (tool-using tasks) + faster-whisper (STT) + kokoro-onnx
(TTS). Everything runs on-box against Ollama and local model files — no
cloud calls anywhere in the runtime path, no API keys.

Full design: [ARCHITECTURE.md](ARCHITECTURE.md). Binding contracts (HTTP/WS
API, DB schema, config): [docs/SPEC.md](docs/SPEC.md).

## Repo map

| Path | What |
|---|---|
| `service/` | `jarvisd` — standalone daemon (own venv, LaunchAgent). Audio, mediator, workers, memory, task DB. |
| `service/jarvisd.toml` | Runtime config (models, ports, STT/VAD/TTS params). |
| `hermes-plugin/` | Hermes plugin surface. `dashboard/` = web UI (thin proxy to jarvisd). Symlinked into the `jarvis-voice` Hermes profile. |
| `ui/` | React (via Hermes plugin SDK) frontend source, built to `hermes-plugin/dashboard/dist/`. |
| `scripts/` | `install.sh`, `update.sh`, `uninstall.sh`, `rollback.sh`, `status.sh`, `lib.sh` (shared vars/helpers). |
| `scripts/launchagents/` | `.plist.tmpl` templates for the two LaunchAgents. |
| `docs/` | SPEC, architecture-exploration notes (`hermes-plugin-api.md`, `hermes-profiles-sessions.md`, `memory-design-inputs.md`), audit baseline. |
| `docs/SETUP.md`, `docs/TROUBLESHOOTING.md`, `docs/ROLLBACK.md`, `docs/MAINTENANCE.md` | Operations docs (this set). |

## Quick start

```sh
cd /Users/agent/ai/repos/hermes-jarvis-voice
scripts/install.sh          # idempotent: venv, symlink, both LaunchAgents, health wait
open http://127.0.0.1:9131/jarvis
```

Prerequisites and a fresh-install walkthrough: [docs/SETUP.md](docs/SETUP.md).

## Ports

| Port | Service | Notes |
|---|---|---|
| 9131 | Hermes dashboard (`jarvis-voice` profile, `--isolated`) | loopback only; serves the `/jarvis` tab + `/api/plugins/jarvis-voice/*` proxy |
| 9140 | jarvisd | loopback only; standalone service, survives dashboard restarts |
| 11434 | Ollama | pre-existing, shared with the rest of the box |

## Tests

```sh
# unit (no real models loaded — JARVISD_NO_PIPELINE=1, set by conftest.py)
cd /Users/agent/ai/repos/hermes-jarvis-voice
service/.venv/bin/python -m pytest service/tests -q -m 'not integration'

# audio integration (real faster-whisper + kokoro models; needs macOS `say` + ffmpeg)
service/.venv/bin/python -m pytest service/tests/test_audio.py -x

# real-Ollama embeddings integration (needs Ollama reachable on 127.0.0.1:11434)
service/.venv/bin/python -m pytest service/tests/test_memory.py -k real_ollama_embeddings -x
```

Note: no test currently carries an explicit `integration` pytest marker — the
`-m 'not integration'` filter is a harmless no-op today (all 51 tests pass
under it). The two integration-shaped tests self-gate via `skipif` instead
(Ollama reachability, `say`/`ffmpeg` presence), which is why they're called
out as separate commands above rather than by marker.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, latency budget, restart model.
- [docs/SPEC.md](docs/SPEC.md) — HTTP/WS API, DB schema, config file, meta-tools.
- [docs/hermes-plugin-api.md](docs/hermes-plugin-api.md) — verified Hermes plugin/dashboard facts.
- [docs/hermes-profiles-sessions.md](docs/hermes-profiles-sessions.md) — profile mechanics, session/delegation facts.
- [docs/SETUP.md](docs/SETUP.md) — prerequisites, fresh install, verification checklist.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — symptom → check → fix.
- [docs/ROLLBACK.md](docs/ROLLBACK.md) — rollback and manual teardown.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md) — updates, model refresh, log rotation, budgets.
