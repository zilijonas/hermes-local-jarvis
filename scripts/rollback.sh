#!/usr/bin/env bash
# jarvis-voice — rollback to a pre-install backup tarball.
#
# Usage: rollback.sh [path-to-backup.tgz]
# Defaults to the newest ~/ai/backups/jarvis-voice-install-*.tgz. Boots out
# both LaunchAgents, restores the tarball (which contains the exact files
# install.sh was about to overwrite, archived relative to `/`), then prints
# next steps. Does not re-bootstrap the agents — that's a deliberate,
# separate decision left to the operator (run install.sh, or bootstrap the
# restored plists by hand).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

backup_file="${1:-}"

if [ -z "$backup_file" ]; then
  # Newest matching tarball by mtime.
  backup_file="$(ls -t "${JARVIS_BACKUPS_DIR}"/jarvis-voice-install-*.tgz 2>/dev/null | head -n1 || true)"
fi

if [ -z "$backup_file" ]; then
  echo "[jarvis-voice] ABORT: no backup file given and none found in ${JARVIS_BACKUPS_DIR}/jarvis-voice-install-*.tgz" >&2
  exit 1
fi

if [ ! -f "$backup_file" ]; then
  echo "[jarvis-voice] ABORT: backup file not found: ${backup_file}" >&2
  exit 1
fi

jarvis_log "using backup: ${backup_file}"
jarvis_log "contents:"
tar -tzf "$backup_file" | sed 's/^/[jarvis-voice]   \//'

jarvis_log "step 1/2: bootout LaunchAgents"
jarvis_agent_bootout "$JARVISD_LABEL"
jarvis_agent_bootout "$DASHBOARD_LABEL"

jarvis_log "step 2/2: restore tarball"
tar -xzf "$backup_file" -C /

echo
jarvis_log "=== rollback complete ==="
jarvis_log "restored from: ${backup_file}"
jarvis_log "both LaunchAgents are currently booted out (stopped)."
jarvis_log "next steps:"
jarvis_log "  - inspect the restored files above if unsure what came back"
jarvis_log "  - re-run scripts/install.sh to bootstrap the (now-restored) LaunchAgents, or"
jarvis_log "  - manually: launchctl bootstrap gui/\$(id -u) ${JARVIS_LAUNCHAGENTS_DIR}/<label>.plist"
jarvis_log "  - scripts/status.sh to verify current state"
