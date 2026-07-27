# Maintenance

Repo: `/Users/agent/ai/repos/hermes-jarvis-voice`.

## Updating this repo

```sh
scripts/update.sh
```

Does, in order: `git pull --ff-only` (skipped with a warning if the working
tree is dirty — commit/stash first); `service/.venv/bin/pip install -q -r
service/requirements.txt` (only if the venv already exists — `update.sh`
never creates it, that's `install.sh`'s job); `launchctl kickstart -k` on
both LaunchAgents (only if already loaded); health-wait on both.

### Interplay with `hermes update` (updates the Hermes engine itself, not this repo)

```sh
hermes update --check     # see if an engine update is available
hermes update              # pulls ~/.hermes/hermes-agent, reinstalls its deps
```

This is a separate axis from `scripts/update.sh` — it touches
`~/.hermes/hermes-agent`, not this repo or the `jarvis-voice` profile
contents. What survives a `hermes update` untouched:
- `~/.hermes/profiles/jarvis-voice/config.yaml` — profile configs are user
  data, not engine code.
- The plugin symlink `~/.hermes/profiles/jarvis-voice/plugins/jarvis-voice`
  → `<repo>/hermes-plugin` — symlinks aren't part of the engine tree either.
- `~/.hermes/profiles/jarvis-voice/.no-bundled-skills` — this marker blocks
  bundled-skill seeding, and specifically blocks it again during a
  `hermes update`'s profile-sync step, not just at `profile create` time.

Run `scripts/update.sh` and `hermes update` independently; neither depends
on the other's cadence.

## Model updates

```sh
# Ollama models — re-pull to refresh
ollama pull gemma4:e4b-it-qat
ollama pull granite4.1-local-64k
ollama pull nomic-embed-text

# kokoro TTS — replace the two files in place, then restart jarvisd
# (model load is lazy-on-first-use, so a restart is the clean way to pick up new weights)
# ~/ai/models/kokoro/kokoro-v1.0.onnx
# ~/ai/models/kokoro/voices-v1.0.bin
launchctl kickstart -k gui/$(id -u)/local.jarvis.jarvisd

# whisper ggml files at ~/ai/models/whisper/ — currently NOT consumed by the
# faster-whisper STT path (different weight format); refreshing them has no
# runtime effect today. Only relevant if a future whisper.cpp path is added.
```

After any Ollama model swap, confirm with `ollama list` (shows size + pull
age) and `ollama ps` (shows what's actually resident right now) — the
`/health` endpoint's `models.*.resident` field has a known name-matching bug
(bare name vs `:latest`-tagged `/api/ps` entries) and under-reports
residency; don't use it to decide whether a pull "took".

## Log rotation

- `jarvisd`'s own application log rotates internally: `RotatingFileHandler`
  on `~/.hermes/profiles/jarvis-voice/logs/jarvisd.log`, 2 MB × 3 backups
  (`service/jarvisd/logging_setup.py`). No action needed.
- The four LaunchAgent-captured files — `jarvisd.out.log`, `jarvisd.err.log`,
  `dashboard.out.log`, `dashboard.err.log` (all under
  `~/.hermes/profiles/jarvis-voice/logs/`) — are **not** rotated by
  `jarvisd.log`'s handler (that only wraps the app's own logger calls, not
  stdout/stderr) and are **not** covered by the box's existing global
  log-rotate LaunchAgent either: verified 2026-07-27,
  `~/ai/scripts/log-rotate.sh` (LaunchAgent `local.hermesagent.logrotate`,
  daily 04:15) only truncates oversized logs under `~/ai/logs` and
  `~/.hermes/logs` — the profile-scoped `~/.hermes/profiles/jarvis-voice/logs/`
  directory is a different path and isn't in its glob. These four files will
  grow unbounded until something is done. Manual truncate-in-place (safe for
  a file a running process has open):
  ```sh
  tail -n 2000 ~/.hermes/profiles/jarvis-voice/logs/jarvisd.out.log > /tmp/t && cat /tmp/t > ~/.hermes/profiles/jarvis-voice/logs/jarvisd.out.log
  ```
  (repeat per file). Longer term this profile's `logs/` dir should be added
  to `log-rotate.sh`'s `HLOG`-style glob — out of scope for this repo's own
  scripts, flag to whoever owns `~/ai/scripts/log-rotate.sh`.

## Memory reindex cadence

Fully in-process, no cron/LaunchAgent involved: jarvisd runs one incremental
`reindex()` at startup, then `await asyncio.sleep(600)` between subsequent
incremental passes — a flat 10-minute cadence (`service/jarvisd/app.py`).
Incremental = mtime+content-hash diff against `notes`/`chunks` tables in
`jarvis.db`; a from-scratch full reindex of the whole vault (384 KB, 88
notes) takes under 10 s if ever needed (`reindex(full=True, ...)`).

## Vault curator relationship

jarvisd is a **read-only consumer** of `~/ai/memory/obsidian-vault` — it
indexes and searches, never edits existing notes (writes, when they happen,
go only to new `00-inbox/` notes via the separate `memory-capture.sh`
convention, not through jarvisd itself). Hygiene/triage of the vault is
owned by a different, pre-existing system: `~/ai/scripts/obsidian-curator.sh`
under LaunchAgent `local.hermesagent.curator`, which runs `dry-run` weekly
(Sun 03:00) and — by design — never auto-applies, to avoid unreviewed
changes landing in the vault. If `00-inbox/` backs up, that's a deliberate
manual call: `~/ai/scripts/obsidian-curator.sh apply` (run by whoever owns
vault curation; not something this repo's scripts touch).

## Benchmark re-run

Intended path: `bench/run_bench.py`. As of this writing the `bench/`
directory in this repo is still empty (no `run_bench.py` present yet) —
this section documents where it will live once added, not a command you can
run today. Baseline numbers already gathered by hand (see
`docs/AUDIT-baseline.md`, `docs/hermes-profiles-sessions.md`): granite warm
round-trip 0.2–0.4 s, gemma cold load 6.3 s / warm 0.38 s, profile one-shot
cold `hermes -z` ~79–92 s (model swap + prefill) / warm 2–5 s.

## Disk / RAM budget

| Item | Disk | Notes |
|---|---|---|
| gemma4:e4b-it-qat (Ollama) | 6.1 GB | mediator |
| granite4.1-local-64k (Ollama) | 5.3 GB | worker |
| nomic-embed-text (Ollama) | 0.27 GB | memory embeddings |
| `~/.ollama/models` total | 11 GB | layers de-duplicated across tags (e.g. `granite4.1:8b` shares blobs with `-local-64k`) |
| `~/ai/models/kokoro/` | 347 MB | TTS, in active use |
| `~/ai/models/whisper/` | 606 MB | ggml, currently unused (see Model updates) |
| `jarvis.db` | ~2 MB, grows with tasks/turns/memory index | WAL mode — also see `jarvis.db-wal`/`-shm` |
| `state.db` | ~256 KB | Hermes session store for the profile |
| Obsidian vault | 3.4 MB | read-only source, not owned by this repo |
| Box free disk (verified) | 266 GB avail / 460 GB | plenty of headroom |

| RAM (24 GB box) | Budget | Notes |
|---|---|---|
| gemma4:e4b-it-qat @ 8k ctx | ≈3.5–4 GB | `keep_alive 30m` |
| granite4.1-local-64k @ 65536 ctx | ≈5–7 GB (up to ~10 GB observed via `ollama ps`) | loads on demand |
| faster-whisper base.en int8 | ≈0.3 GB | |
| kokoro-onnx | ≈0.5 GB | |
| jarvisd + dashboard UI | ≈0.4 GB | |
| Worst case (both LLMs + speech), per ARCHITECTURE.md | ≈11–12 GB | **caveat below** |

Live-observed caveat (2026-07-27): this box appears to keep roughly one
large Ollama model resident at a time in practice — running a mediator turn
then a worker one-shot back-to-back was seen to evict and reload the other
model rather than hold both, pushing that one-shot's latency to ~90 s. If
you need both models reliably warm simultaneously, verify with `ollama ps`
under real concurrent load rather than assuming the ARCHITECTURE.md
worst-case budget holds — it may be optimistic for this specific box's VRAM
scheduling.
