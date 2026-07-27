#!/usr/bin/env bash
# jarvis-voice — update (idempotent).
#
# git pull --ff-only (skipped if the tree is dirty), reinstall service deps
# quietly, kickstart both LaunchAgents, wait for health. No sudo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

jarvis_log "repo root: ${JARVIS_REPO_ROOT}"

# ---------------------------------------------------------------------------
# git pull --ff-only, skipped (with a warning) if the tree is dirty.
# ---------------------------------------------------------------------------
jarvis_log "step 1/3: git pull"

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
jarvis_log "step 2/3: service deps"

if [ -x "${JARVIS_SERVICE_VENV}/bin/pip" ] && [ -f "$JARVIS_SERVICE_REQUIREMENTS" ]; then
  "${JARVIS_SERVICE_VENV}/bin/pip" install -q -r "$JARVIS_SERVICE_REQUIREMENTS"
else
  jarvis_warn "service/.venv or requirements.txt missing, skipping (run install.sh first)"
fi

# ---------------------------------------------------------------------------
# Kickstart both LaunchAgents (restart in place) — only if already loaded;
# `kickstart` on an unloaded label errors, so skip with a warning instead.
# ---------------------------------------------------------------------------
jarvis_log "step 3/3: kickstart + health wait"

for label in "$JARVISD_LABEL" "$DASHBOARD_LABEL"; do
  if jarvis_agent_loaded "$label"; then
    jarvis_log "kickstart -k ${label}"
    launchctl kickstart -k "$(jarvis_gui_domain)/${label}"
  else
    jarvis_warn "${label} not loaded, skipping kickstart (run install.sh first)"
  fi
done

jarvisd_ok=0
dashboard_ok=0
jarvis_wait_health "$JARVISD_HEALTH_URL" 30 2 && jarvisd_ok=1 || true
jarvis_wait_health "$DASHBOARD_HEALTH_URL" 30 2 && dashboard_ok=1 || true

echo
jarvis_log "=== update summary ==="
if [ "$jarvisd_ok" -eq 1 ]; then
  jarvis_log "jarvisd:    HEALTHY"
else
  jarvis_log "jarvisd:    NOT HEALTHY — check ${JARVIS_PROFILE_HOME}/logs/jarvisd.err.log"
fi
if [ "$dashboard_ok" -eq 1 ]; then
  jarvis_log "dashboard:  HEALTHY"
else
  jarvis_log "dashboard:  NOT HEALTHY — check ${JARVIS_PROFILE_HOME}/logs/dashboard.err.log"
fi
