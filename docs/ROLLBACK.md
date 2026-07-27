# Rollback

Repo: `/Users/agent/ai/repos/hermes-jarvis-voice`. Two levels: **rollback**
(undo the last `install.sh`, restore whatever it overwrote) and **manual
teardown** (fully remove Jarvis, keep everything else).

## scripts/rollback.sh

```sh
scripts/rollback.sh                       # uses newest ~/ai/backups/jarvis-voice-install-*.tgz
scripts/rollback.sh /path/to/specific.tgz # or name one explicitly
```

What it does, in order:
1. Boots out both LaunchAgents (`local.jarvis.jarvisd`, `local.jarvis.dashboard`) via
   `launchctl bootout gui/$(id -u)/<label>` — no-op if not loaded.
2. Prints the tarball's contents (`tar -tzf`) so you can see what's about to
   come back before it does.
3. Extracts the tarball at `/` (`tar -xzf ... -C /`) — it was archived with
   paths relative to `/`, so this restores each file to its exact original
   location: the pre-install plugin symlink/dir and/or the pre-install
   `.plist` files, whichever existed before `install.sh` last ran (only
   targets that existed get backed up in the first place — see
   `scripts/install.sh` step 1).

What it deliberately does **not** do: re-bootstrap the LaunchAgents. After a
rollback both agents are stopped. Next steps (printed by the script):
```sh
scripts/install.sh          # re-bootstrap the (now-restored) LaunchAgents, or
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist   # by hand
scripts/status.sh           # verify current state either way
```

Backups live at `~/ai/backups/jarvis-voice-install-<timestamp>.tgz`, one per
`install.sh` run that actually overwrote something (first-ever install
writes none — nothing to back up yet).

## Manual teardown

### Undo just the install (recommended path — same as rollback.sh's target, no tarball needed)

```sh
scripts/uninstall.sh
```

Idempotent. Boots out both LaunchAgents, removes both `.plist` files from
`~/Library/LaunchAgents/`, removes the plugin symlink
`~/.hermes/profiles/jarvis-voice/plugins/jarvis-voice` (only if it's still a
symlink — a real file/dir there is left alone with a warning). Leaves the
repo, `service/.venv`, the Hermes profile (config, `state.db`, `jarvis.db`,
logs), and `~/ai/models` completely untouched.

### Equivalent by hand, if you don't trust the script

```sh
launchctl bootout gui/$(id -u)/local.jarvis.jarvisd
launchctl bootout gui/$(id -u)/local.jarvis.dashboard
rm -f ~/Library/LaunchAgents/local.jarvis.jarvisd.plist
rm -f ~/Library/LaunchAgents/local.jarvis.dashboard.plist
rm -f ~/.hermes/profiles/jarvis-voice/plugins/jarvis-voice   # only if it IS a symlink
```

### Full removal of the Hermes profile (separate, deliberate step — not part of uninstall.sh)

```sh
hermes profile delete jarvis-voice        # prompts for confirmation
hermes profile delete jarvis-voice -y     # skip the confirmation prompt
```

Verified live (`hermes profile --help`): `delete` is a real subcommand,
signature `hermes profile delete [-h] [-y] profile_name`. This removes
`~/.hermes/profiles/jarvis-voice/` — config.yaml, `state.db`, `jarvis.db`
(the entire task/turn/memory-index DB), logs, everything. Only run this if
you actually want to lose task history and the memory index, not just stop
the services.

## What is NEVER touched by any of the above

- **Other Hermes profiles** — `default`, `local`, or any other profile's
  config/state/plugins. Every script here is scoped to the `jarvis-voice`
  profile name and this repo's own paths only.
- **Telegram** — jarvis-voice runs no platform gateway at all (confirmed:
  no Telegram wiring in this profile); nothing to disturb.
- **Trading services** (crypto-trader, signal-engine) and their LaunchAgents/ports.
- **The Obsidian vault** (`~/ai/memory/obsidian-vault`) — jarvisd only reads
  it for memory search; nothing here writes to existing notes, and nothing
  here deletes vault content. Uninstall/rollback don't touch it either.
- **`~/ai/models`** (kokoro, whisper) and the Ollama model store
  (`~/.ollama/models`) — models are a separate, shared resource; removing
  Jarvis never deletes model weights.
