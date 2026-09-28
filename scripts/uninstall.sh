#!/usr/bin/env bash
# jarvis-voice — uninstall (idempotent).
#
# Boots out + removes the jarvisd LaunchAgent and the ~/.hermes/plugins
# symlink. Also cleans up a leftover legacy local.jarvis.dashboard plist,
# if one is still on disk from before the isolated dashboard was retired
# (2026-09-28: the Jarvis tab moved to the main Hermes dashboard,
# 127.0.0.1:9120/jarvis). Leaves the repo, the jarvisd state dir
# (~/ai/state/jarvis-voice: jarvis.db, logs, the worker Hermes home) and
# ~/ai/models completely untouched — this only undoes what install.sh
# added. No sudo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

jarvis_log "step 1/4: bootout LaunchAgents"
jarvis_agent_bootout "$JARVISD_LABEL"

legacy_dashboard_label="local.jarvis.dashboard"
legacy_dashboard_plist="${JARVIS_LAUNCHAGENTS_DIR}/${legacy_dashboard_label}.plist"
if [ -e "$legacy_dashboard_plist" ]; then
  jarvis_agent_bootout "$legacy_dashboard_label"
fi

jarvis_log "step 2/4: remove plist files"
plist="${JARVIS_LAUNCHAGENTS_DIR}/${JARVISD_LABEL}.plist"
if [ -e "$plist" ]; then
  rm -f "$plist"
  jarvis_log "removed ${plist}"
else
  jarvis_log "${plist} already absent"
fi

jarvis_log "step 3/4: remove legacy dashboard plist (if any)"
if [ -e "$legacy_dashboard_plist" ]; then
  mkdir -p "$JARVIS_BACKUPS_DIR"
  legacy_backup="${JARVIS_BACKUPS_DIR}/jarvis-voice-legacy-dashboard-$(date +%Y%m%dT%H%M%S).tgz"
  tar -czf "$legacy_backup" -C / "${legacy_dashboard_plist#/}"
  jarvis_log "backed up legacy dashboard plist -> ${legacy_backup}"
  rm -f "$legacy_dashboard_plist"
  jarvis_log "removed legacy ${legacy_dashboard_plist}"
else
  jarvis_log "no legacy ${legacy_dashboard_label} plist found"
fi

jarvis_log "step 4/4: remove plugin symlink"
if [ -L "$JARVIS_PLUGIN_LINK" ]; then
  rm -f "$JARVIS_PLUGIN_LINK"
  jarvis_log "removed symlink ${JARVIS_PLUGIN_LINK}"
elif [ -e "$JARVIS_PLUGIN_LINK" ]; then
  jarvis_warn "${JARVIS_PLUGIN_LINK} exists but is not a symlink (real file/dir) — leaving it in place, remove manually if intended"
else
  jarvis_log "${JARVIS_PLUGIN_LINK} already absent"
fi

echo
jarvis_log "=== uninstall complete ==="
jarvis_log "remaining (untouched by uninstall):"
jarvis_log "  repo:            ${JARVIS_REPO_ROOT}"
jarvis_log "  service venv:    ${JARVIS_SERVICE_VENV} (if present)"
jarvis_log "  state dir:       ${JARVIS_STATE_DIR} (jarvis.db, logs, hermes-home)"
jarvis_log "  models:          ~/ai/models"
jarvis_log "to fully remove the state dir or repo, do so manually — this script never touches them."
