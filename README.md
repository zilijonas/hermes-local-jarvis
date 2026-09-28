# Jarvis Voice

Hermes-native voice assistant built into the main Hermes dashboard. Speech
recognition (Parakeet-TDT on MLX), turn detection (Silero VAD + Smart Turn
v3.2) and speech synthesis (kokoro) all run on this Mac mini. The
conversation and background tasks run on the OpenCode Go cloud subscription
by default (brain `cloud` = deepseek-v4.1-flash, worker `cloud` = codecloud),
with a local gpt-oss-20b model as the automatic fallback for both. jarvisd
owns its own state directory and needs no Hermes profile of its own.

Full design: [ARCHITECTURE.md](ARCHITECTURE.md). Binding contracts (HTTP/WS
API, DB schema, config): [docs/SPEC.md](docs/SPEC.md).

## Repo map

| Path | What |
|---|---|
| `service/` | `jarvisd`, standalone daemon (own venv, LaunchAgent `local.jarvis.jarvisd`). Audio, mediator, workers, memory, task DB. |
| `service/jarvisd.toml` | Runtime config (models, ports, STT/VAD/TTS params, brain + worker backend). |
| `hermes-plugin/` | Standalone Hermes plugin (`kind: standalone`), symlinked to `~/.hermes/plugins/jarvis-voice` and served by the main Hermes dashboard, not tied to any profile. |
| `ui/` | React (via Hermes plugin SDK) frontend source, built to `hermes-plugin/dashboard/dist/`. |
| `scripts/` | `install.sh`, `update.sh`, `uninstall.sh`, `rollback.sh`, `status.sh`, `lib.sh` (shared vars/helpers). |
| `scripts/launchagents/` | `.plist.tmpl` for the one remaining LaunchAgent (`local.jarvis.jarvisd`). |
| `docs/` | SPEC, architecture-exploration notes (`hermes-plugin-api.md`, `hermes-profiles-sessions.md`, `memory-design-inputs.md`), audit baseline, historical reports. |
| `docs/SETUP.md`, `docs/TROUBLESHOOTING.md`, `docs/ROLLBACK.md`, `docs/MAINTENANCE.md` | Operations docs (this set). |

## Quick start

```sh
cd /Users/agent/ai/repos/hermes-jarvis-voice
scripts/install.sh          # idempotent: state dir, plugin symlink, venv, LaunchAgent, health wait
open http://127.0.0.1:9120/jarvis
```

Prerequisites and a fresh-install walkthrough: [docs/SETUP.md](docs/SETUP.md).

## Ports

| Port | Service | Notes |
|---|---|---|
| 9120 | Main Hermes dashboard (`local.hermesagent.dashboard`) | serves the `/jarvis` tab + `/api/plugins/jarvis-voice/*` proxy, also reachable over tailnet https at `macmini-ai.tail9102ce.ts.net/jarvis`. Not managed by this repo's scripts. |
| 9140 | jarvisd | loopback only, standalone service, own LaunchAgent, survives dashboard restarts |
| 8090 | Model router | gpt-oss-20b, local brain/worker fallback |
| 11434 | Ollama | embeddings only (`nomic-embed-text`) |

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
- [docs/hermes-profiles-sessions.md](docs/hermes-profiles-sessions.md) — why jarvisd no longer uses its own Hermes profile, plus session/delegation facts.
- [docs/SETUP.md](docs/SETUP.md) — prerequisites, fresh install, verification checklist.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — symptom → check → fix.
- [docs/ROLLBACK.md](docs/ROLLBACK.md) — rollback and manual teardown.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md) — updates, model refresh, log rotation, budgets.
