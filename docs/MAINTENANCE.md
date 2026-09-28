# Maintenance

Repo: `/Users/agent/ai/repos/hermes-jarvis-voice`.

## Updating this repo

```sh
scripts/update.sh
```

Does, in order: `git pull --ff-only` (skipped with a warning if the working
tree is dirty - commit/stash first). `service/.venv/bin/pip install -q -r
service/requirements.txt` (only if the venv already exists - `update.sh`
never creates it, that's `install.sh`'s job). Cleans up a leftover legacy
`local.jarvis.dashboard` plist if one is still on disk from before the
isolated dashboard was retired (2026-09-28). `launchctl kickstart -k` on
`local.jarvis.jarvisd` (only if already loaded). Health-wait.

There is only one LaunchAgent left to manage. The Jarvis tab is served by
the main Hermes dashboard (`local.hermesagent.dashboard`, port 9120), which
this repo does not install, update, or restart.

### Interplay with `hermes update` (updates the Hermes engine itself, not this repo)

```sh
hermes update --check # see if an engine update is available
hermes update # pulls ~/.hermes/hermes-agent, reinstalls its deps
```

This is a separate axis from `scripts/update.sh`. jarvisd has no Hermes
profile of its own anymore (see `docs/hermes-profiles-sessions.md`), so a
`hermes update` has nothing profile-shaped to preserve for jarvisd - it only
affects the `default` profile jarvisd shells out to for the cloud worker
backend, and the local worker's lean `HERMES_HOME`
(`~/ai/state/jarvis-voice/hermes-home`, config `paths.worker_home`), which
is a plain directory, not a registered profile. The plugin symlink
(`~/.hermes/plugins/jarvis-voice` -> `<repo>/hermes-plugin`) is unaffected by
`hermes update` either way.

Run `scripts/update.sh` and `hermes update` independently. Neither depends
on the other's cadence.

## Model updates

```sh
# Ollama holds embeddings only.
ollama pull nomic-embed-text

# Local brain / local worker model: replace the GGUF the router points at,
# then restart it (this repo doesn't own the router).
# launchctl kickstart -k gui/$(id -u)/local.hermesagent.modelrouter

# STT - Parakeet-TDT (MLX, default) is pulled from the HuggingFace cache
# automatically (config stt.parakeet_model). To force a re-pull, clear its
# cache entry and restart jarvisd. faster-whisper (fallback engine) manages
# its own weights the same way - no manual file needed for either.

# Turn detection - replace the ONNX files in place, then restart jarvisd:
# ~/ai/models/silero/silero_vad.onnx
# ~/ai/models/smart-turn/smart-turn-v3.2-cpu.onnx

# kokoro TTS - replace the two files in place, then restart jarvisd
# (model load is lazy-on-first-use, so a restart is the clean way to pick up new weights)
# ~/ai/models/kokoro/kokoro-v1.0.onnx
# ~/ai/models/kokoro/voices-v1.0.bin

launchctl kickstart -k gui/$(id -u)/local.jarvis.jarvisd
```

After any Ollama model swap, confirm with `ollama list` (shows size + pull
age) and `ollama ps` (shows what's actually resident right now).

Cloud-side model changes (the `cloud` brain's `deepseek-v4.1-flash`, or
`deep_answer`'s `minimax-m3`) are config-only, not a weight refresh: edit
`[brain]` in `service/jarvisd.toml` or `POST /brains`, no restart needed for
`/brains` (mediator brain switches take effect immediately.
`brain.cloud_model`/`deep_model` changes in the file need a restart to be
picked up).

## Log rotation

- `jarvisd`'s own application log rotates internally: `RotatingFileHandler`
  on `~/ai/state/jarvis-voice/logs/jarvisd.log`, 2 MB × 3 backups
  (`service/jarvisd/logging_setup.py`). No action needed.
- The two LaunchAgent-captured files, `jarvisd.out.log` and `jarvisd.err.log`
  (under `~/ai/state/jarvis-voice/logs/`), are **not** rotated by
  `jarvisd.log`'s handler (that only wraps the app's own logger calls, not
  stdout/stderr). Confirm whether the box's global log-rotate LaunchAgent
  (`~/ai/scripts/log-rotate.sh`, `local.hermesagent.logrotate`) covers
  `~/ai/state/jarvis-voice/logs/` before assuming it does, if not, these
  two files grow unbounded. Manual truncate-in-place (safe for a file a
  running process has open):
  ```sh
  tail -n 2000 ~/ai/state/jarvis-voice/logs/jarvisd.out.log > /tmp/t && cat /tmp/t > ~/ai/state/jarvis-voice/logs/jarvisd.out.log
  ```
  (repeat per file).

## Memory reindex cadence

Fully in-process, no cron/LaunchAgent involved: jarvisd runs one incremental
`reindex()` at startup, then `await asyncio.sleep(600)` between subsequent
incremental passes - a flat 10-minute cadence (`service/jarvisd/app.py`).
Incremental = mtime+content-hash diff against `notes`/`chunks` tables in
`jarvis.db`. A from-scratch full reindex of the whole vault takes under
10 s if ever needed (`reindex(full=True, ...)`).

## Vault curator relationship

jarvisd is a **read-only consumer** of `~/ai/memory/obsidian-vault` - it
indexes and searches, never edits existing notes (writes, when they happen,
go only to new `00-inbox/` notes via the separate `memory-capture.sh`
convention, not through jarvisd itself). Hygiene/triage of the vault is
owned by a different, pre-existing system: `~/ai/scripts/obsidian-curator.sh`
under LaunchAgent `local.hermesagent.curator`, which runs `dry-run` weekly
(Sun 03:00) and - by design - never auto-applies, to avoid unreviewed
changes landing in the vault. If `00-inbox/` backs up, that's a deliberate
manual call: `~/ai/scripts/obsidian-curator.sh apply` (run by whoever owns
vault curation. Not something this repo's scripts touch).

## Benchmark re-run

`bench/run_bench.py` - see `ARCHITECTURE.md` §Brains and §STT benchmark for
the current (2026-09-28) measured numbers this repo's own bake-offs
produced. Older baselines live in `docs/AUDIT-baseline.md` and
`docs/hermes-profiles-sessions.md` (marked historical).

## Disk / RAM budget

| Item | Notes |
|---|---|
| gpt-oss-20b-MXFP4.gguf (model router) | local brain fallback AND local worker fallback - one resident copy, shared |
| nomic-embed-text (Ollama) | memory embeddings only |
| Parakeet-TDT 0.6b-v2 (MLX, HuggingFace cache) | primary STT |
| faster-whisper base.en | STT fallback engine, own weight cache |
| `~/ai/models/kokoro/` | TTS, in active use |
| `~/ai/models/silero/`, `~/ai/models/smart-turn/` | turn detection (ONNX, small) |
| `jarvis.db` (WAL) | grows with tasks/turns/reminders/memory index - also see `-wal`/`-shm` |
| Obsidian vault | read-only source, not owned by this repo |

RAM: gpt-oss-20b resident only matters when the `local` brain/worker is
actually active - with `cloud` as the default for both, this box's steady
state is dominated by STT (Parakeet, on-GPU via MLX) + kokoro TTS + jarvisd
itself, well under what the router alone used to cost. Verify with `ollama
ps` (embeddings) and `curl -s 127.0.0.1:8090/v1/status` (router residency)
before assuming either is loaded.
