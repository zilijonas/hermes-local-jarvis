#!/usr/bin/env bash
# jarvis-voice — update (idempotent).
#
# git pull --ff-only (skipped if the tree is dirty), reinstall service deps
# quietly, kickstart the jarvisd LaunchAgent, wait for health. No sudo.
# Also boots out + removes a leftover legacy local.jarvis.dashboard plist,
# if one is still on disk from before the isolated dashboard was retired
# (2026-09-28: the Jarvis tab moved to the main Hermes dashboard).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

jarvis_log "repo root: ${JARVIS_REPO_ROOT}"

# ---------------------------------------------------------------------------
# git pull --ff-only, skipped (with a warning) if the tree is dirty.
# ---------------------------------------------------------------------------
jarvis_log "step 1/4: git pull"

if [ ! -d "${JARVIS_REPO_ROOT}/.git" ]; then
  jarvis_warn "not a git checkout (${JARVIS_REPO_ROOT}), skipping pull"
elif [ -n "$(git -C "$JARVIS_REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
  jarvis_warn "working tree is dirty, skipping git pull (commit/stash first)"
else
  git -C "$JARVIS_REPO_ROOT" pull --ff-only
fi

# ---------------------------------------------------------------------------
# Reinstall service deps quietly (only if the venv already exists — update
# never creates it; that's install.sh's job).
# ---------------------------------------------------------------------------
jarvis_log "step 2/4: service deps"

if [ -x "${JARVIS_SERVICE_VENV}/bin/pip" ] && [ -f "$JARVIS_SERVICE_REQUIREMENTS" ]; then
  "${JARVIS_SERVICE_VENV}/bin/pip" install -q -r "$JARVIS_SERVICE_REQUIREMENTS"
else
  jarvis_warn "service/.venv or requirements.txt missing, skipping (run install.sh first)"
fi

# ---------------------------------------------------------------------------
# Boot out + remove a leftover legacy local.jarvis.dashboard plist, if any
# (backup first, like every other destructive step in these scripts).
# ---------------------------------------------------------------------------
jarvis_log "step 3/4: legacy dashboard cleanup"

legacy_dashboard_label="local.jarvis.dashboard"
legacy_dashboard_plist="${JARVIS_LAUNCHAGENTS_DIR}/${legacy_dashboard_label}.plist"
if [ -e "$legacy_dashboard_plist" ]; then
  mkdir -p "$JARVIS_BACKUPS_DIR"
  legacy_backup="${JARVIS_BACKUPS_DIR}/jarvis-voice-legacy-dashboard-$(date +%Y%m%dT%H%M%S).tgz"
  tar -czf "$legacy_backup" -C / "${legacy_dashboard_plist#/}"
  jarvis_log "backed up legacy dashboard plist -> ${legacy_backup}"
  jarvis_agent_bootout "$legacy_dashboard_label"
  rm -f "$legacy_dashboard_plist"
  jarvis_log "removed legacy ${legacy_dashboard_plist}"
else
  jarvis_log "no legacy ${legacy_dashboard_label} plist found, nothing to clean up"
fi

# ---------------------------------------------------------------------------
# Kickstart the jarvisd LaunchAgent (restart in place) — only if already
# loaded; `kickstart` on an unloaded label errors, so skip with a warning.
# ---------------------------------------------------------------------------
jarvis_log "step 4/4: kickstart + health wait"

if jarvis_agent_loaded "$JARVISD_LABEL"; then
  jarvis_log "kickstart -k ${JARVISD_LABEL}"
  launchctl kickstart -k "$(jarvis_gui_domain)/${JARVISD_LABEL}"
else
  jarvis_warn "${JARVISD_LABEL} not loaded, skipping kickstart (run install.sh first)"
fi

jarvisd_ok=0
jarvis_wait_health "$JARVISD_HEALTH_URL" 30 2 && jarvisd_ok=1 || true

echo
jarvis_log "=== update summary ==="
if [ "$jarvisd_ok" -eq 1 ]; then
  jarvis_log "jarvisd:    HEALTHY"
else
  jarvis_log "jarvisd:    NOT HEALTHY — check ${JARVIS_STATE_DIR}/logs/jarvisd.err.log"
fi
