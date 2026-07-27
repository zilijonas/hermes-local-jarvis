#!/usr/bin/env bash
# jarvis-voice — uninstall (idempotent).
#
# Boots out + removes both LaunchAgents and the profile plugin symlink.
# Leaves the repo, the Hermes profile (config/state/jarvis.db/vault refs),
# and ~/ai/models completely untouched — this only undoes what install.sh
# added. No sudo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

jarvis_log "step 1/3: bootout LaunchAgents"
jarvis_agent_bootout "$JARVISD_LABEL"
jarvis_agent_bootout "$DASHBOARD_LABEL"

jarvis_log "step 2/3: remove plist files"
for label in "$JARVISD_LABEL" "$DASHBOARD_LABEL"; do
  plist="${JARVIS_LAUNCHAGENTS_DIR}/${label}.plist"
  if [ -e "$plist" ]; then
    rm -f "$plist"
    jarvis_log "removed ${plist}"
  else
    jarvis_log "${plist} already absent"
  fi
done

jarvis_log "step 3/3: remove plugin symlink"
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
jarvis_log "  profile:         ${JARVIS_PROFILE_HOME} (config, state.db, jarvis.db, logs)"
jarvis_log "  models:          ~/ai/models"
jarvis_log "to fully remove the profile or repo, do so manually — this script never touches them."
