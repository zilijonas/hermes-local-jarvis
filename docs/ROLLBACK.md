# Rollback

Repo: `/Users/agent/ai/repos/hermes-jarvis-voice`. Two levels: **rollback**
(undo the last `install.sh`, restore whatever it overwrote) and **manual
teardown** (fully remove Jarvis, keep everything else).

## The 2026-09-28 profile removal

Until 2026-09-28, jarvisd ran under its own Hermes profile
(`~/.hermes/profiles/jarvis-voice/`), and the Jarvis tab was served by a
dedicated, isolated dashboard LaunchAgent (`local.jarvis.dashboard`, port
9131). Both were retired the same day: jarvisd now keeps its own state at
`~/ai/state/jarvis-voice/` (no `-p` profile), and the tab is served by the
main Hermes dashboard (port 9120) as a standalone plugin. See
`docs/hermes-profiles-sessions.md` for why.

The removed profile was backed up before deletion to:
```
~/ai/backups/jarvis-voice-profile-20260928-174001.tgz
```
This is a **one-time, historical** backup of the pre-migration profile
directory (config, `state.db`, the old `jarvis.db`, logs) - separate from
the ongoing `jarvis-voice-install-*.tgz` backups `scripts/install.sh` makes
on every run (see below). There is no supported path back to running
jarvisd under a Hermes profile. This tarball exists purely so nothing from
that era was lost, not as a rollback target `scripts/rollback.sh` knows
about.

## scripts/rollback.sh

```sh
scripts/rollback.sh # uses newest ~/ai/backups/jarvis-voice-install-*.tgz
scripts/rollback.sh /path/to/specific.tgz # or name one explicitly
```

What it does, in order:
1. Boots out the `local.jarvis.jarvisd` LaunchAgent via
 `launchctl bootout gui/$(id -u)/local.jarvis.jarvisd` - no-op if not loaded.
2. Prints the tarball's contents (`tar -tzf`) so you can see what's about to
 come back before it does.
3. Extracts the tarball at `/` (`tar -xzf ... -C /`) - it was archived with
 paths relative to `/`, so this restores each file to its exact original
 location: the pre-install plugin symlink and/or the pre-install
 `local.jarvis.jarvisd.plist`, whichever existed before `install.sh` last
 ran (only targets that existed get backed up in the first place - see
 `scripts/install.sh` step 1).

What it deliberately does **not** do: re-bootstrap the LaunchAgent. After a
rollback it is stopped. Next steps (printed by the script):
```sh
scripts/install.sh # re-bootstrap the (now-restored) LaunchAgent, or
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.jarvis.jarvisd.plist # by hand
scripts/status.sh # verify current state either way
```

Backups live at `~/ai/backups/jarvis-voice-install-<timestamp>.tgz`, one per
`install.sh` run that actually overwrote something (first-ever install
writes none - nothing to back up yet). `update.sh` and `uninstall.sh` also
back up a leftover legacy `local.jarvis.dashboard.plist` (if one is still on
disk from before 2026-09-28) to
`~/ai/backups/jarvis-voice-legacy-dashboard-<timestamp>.tgz` before removing it.

## Manual teardown

### Undo just the install (recommended path - same as rollback.sh's target, no tarball needed)

```sh
scripts/uninstall.sh
```

Idempotent. Boots out `local.jarvis.jarvisd` (and a legacy
`local.jarvis.dashboard` if still present), removes the plist file(s) from
`~/Library/LaunchAgents/`, removes the plugin symlink
`~/.hermes/plugins/jarvis-voice` (only if it's still a symlink - a real
file/dir there is left alone with a warning). Leaves the repo,
`service/.venv`, the state dir (`~/ai/state/jarvis-voice/`: `jarvis.db`,
logs, the worker `hermes-home`), and `~/ai/models` completely untouched.

### Equivalent by hand, if you don't trust the script

```sh
launchctl bootout gui/$(id -u)/local.jarvis.jarvisd
rm -f ~/Library/LaunchAgents/local.jarvis.jarvisd.plist
rm -f ~/.hermes/plugins/jarvis-voice # only if it IS a symlink
```

### Full removal of jarvisd's state (separate, deliberate step)

```sh
rm -rf ~/ai/state/jarvis-voice
```

This removes `jarvis.db` (the entire task/turn/reminder/memory-index DB),
logs, and the local worker's `hermes-home` - everything jarvisd itself
owns. Only do this if you actually want to lose task history and the
memory index, not just stop the service. There is no `hermes profile
delete` step anymore - jarvisd has no profile to delete.

## What is NEVER touched by any of the above

- **Any Hermes profile** - `default`, `local`, or any other profile's
 config/state/plugins. jarvisd's cloud/local worker backends shell out to
 `hermes -p default -z` / `hermes -z` at runtime, but nothing here
 installs, modifies, or deletes those profiles.
- **The main Hermes dashboard** (`local.hermesagent.dashboard`, port 9120)
 - every script here only ever touches `local.jarvis.jarvisd` and the
 `~/.hermes/plugins/jarvis-voice` symlink.
- **Telegram** - jarvisd runs no platform gateway at all. Reminders reach
 Matrix (room `jarvis-voice`) via `~/ai/bin/notify`, nothing Telegram-side.
- **Trading services** (crypto-trader, signal-engine) and their LaunchAgents/ports.
- **The Obsidian vault** (`~/ai/memory/obsidian-vault`) - jarvisd only reads
 it for memory search. Nothing here writes to existing notes, and nothing
 here deletes vault content. Uninstall/rollback don't touch it either.
- **`~/ai/models`** (kokoro, silero, smart-turn) and the Ollama model store
 (`~/.ollama/models`) - models are a separate, shared resource. Removing
 Jarvis never deletes model weights.
