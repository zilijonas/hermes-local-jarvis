#!/usr/bin/env bash
# jarvis-voice — install (idempotent).
#
# 1) back up anything this script is about to overwrite
# 2) symlink the profile's plugin dir to this repo's hermes-plugin/
# 3) ensure service/.venv exists with the jarvisd runtime deps installed
# 4) install + bootstrap both LaunchAgents (jarvisd, dashboard)
# 5) wait for both to report healthy and print the result
#
# Safe to re-run: every step checks current state before acting. No sudo.
#
# NOTE: jarvisd's service/jarvisd/app.py may not exist yet (built by a
# parallel agent) — step 5 (health wait) can legitimately time out on a
# fresh checkout. That is expected, not a bug in this script; re-run once
# the service is in place.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

jarvis_log "repo root: ${JARVIS_REPO_ROOT}"

# ---------------------------------------------------------------------------
# 1) Backup anything install.sh is about to touch — only if it exists.
# ---------------------------------------------------------------------------
jarvis_log "step 1/5: backup"

backup_targets=()
# `-e` alone misses a dangling symlink (broken target); `-L` catches it too.
# Each check is its own `if` (not `test && arr+=(...)`) so a false result
# doesn't trip `set -e` by making the statement's exit status non-zero.
if [ -e "$JARVIS_PLUGIN_LINK" ] || [ -L "$JARVIS_PLUGIN_LINK" ]; then
  backup_targets+=("${JARVIS_PLUGIN_LINK#/}")
fi
if [ -e "${JARVIS_LAUNCHAGENTS_DIR}/${JARVISD_LABEL}.plist" ]; then
  backup_targets+=("${JARVIS_LAUNCHAGENTS_DIR#/}/${JARVISD_LABEL}.plist")
fi
if [ -e "${JARVIS_LAUNCHAGENTS_DIR}/${DASHBOARD_LABEL}.plist" ]; then
  backup_targets+=("${JARVIS_LAUNCHAGENTS_DIR#/}/${DASHBOARD_LABEL}.plist")
fi

if [ "${#backup_targets[@]}" -eq 0 ]; then
  jarvis_log "nothing to back up (first install)"
else
  mkdir -p "$JARVIS_BACKUPS_DIR"
  backup_file="${JARVIS_BACKUPS_DIR}/jarvis-voice-install-$(date +%Y%m%dT%H%M%S).tgz"
  # Archive with paths relative to / (no leading slash) so rollback.sh can
  # restore with a plain `tar -xzf ... -C /`.
  tar -czf "$backup_file" -C / "${backup_targets[@]}"
  jarvis_log "backed up -> ${backup_file}"
fi

# ---------------------------------------------------------------------------
# 2) Symlink profile plugins/jarvis-voice -> repo hermes-plugin/
# ---------------------------------------------------------------------------
jarvis_log "step 2/5: plugin symlink"

mkdir -p "$(dirname "$JARVIS_PLUGIN_LINK")"
target="${JARVIS_REPO_ROOT}/hermes-plugin"

if [ -L "$JARVIS_PLUGIN_LINK" ]; then
  current="$(readlink "$JARVIS_PLUGIN_LINK")"
  if [ "$current" = "$target" ]; then
    jarvis_log "symlink already correct: ${JARVIS_PLUGIN_LINK} -> ${target}"
  else
    jarvis_log "replacing stale symlink (was -> ${current})"
    rm -f "$JARVIS_PLUGIN_LINK"
    ln -s "$target" "$JARVIS_PLUGIN_LINK"
  fi
elif [ -e "$JARVIS_PLUGIN_LINK" ]; then
  echo "[jarvis-voice] ABORT: ${JARVIS_PLUGIN_LINK} exists and is a real file/dir," >&2
  echo "  not a symlink this installer manages. Refusing to overwrite it." >&2
  echo "  Move it aside manually if you want install.sh to take over." >&2
  exit 1
else
  ln -s "$target" "$JARVIS_PLUGIN_LINK"
  jarvis_log "linked ${JARVIS_PLUGIN_LINK} -> ${target}"
fi

# ---------------------------------------------------------------------------
# 3) Ensure service/.venv exists with the jarvisd runtime deps installed.
# ---------------------------------------------------------------------------
jarvis_log "step 3/5: service venv"

if [ ! -f "$JARVIS_SERVICE_REQUIREMENTS" ]; then
  jarvis_log "writing ${JARVIS_SERVICE_REQUIREMENTS} (not present yet)"
  mkdir -p "$JARVIS_SERVICE_DIR"
  cat > "$JARVIS_SERVICE_REQUIREMENTS" <<'EOF'
fastapi
uvicorn[standard]
faster-whisper
kokoro-onnx
soundfile
webrtcvad-wheels
httpx
websockets
psutil
pyyaml
pytest
pytest-asyncio
EOF
else
  jarvis_log "${JARVIS_SERVICE_REQUIREMENTS} already present, leaving as-is"
fi

if ! command -v python3.11 >/dev/null 2>&1; then
  echo "[jarvis-voice] ABORT: python3.11 not found on PATH (needed for service/.venv)." >&2
  exit 1
fi

if [ ! -x "${JARVIS_SERVICE_VENV}/bin/python" ]; then
  jarvis_log "creating venv: ${JARVIS_SERVICE_VENV}"
  python3.11 -m venv "$JARVIS_SERVICE_VENV"
else
  jarvis_log "venv already exists: ${JARVIS_SERVICE_VENV}"
fi

jarvis_log "installing service deps (pip -q)"
"${JARVIS_SERVICE_VENV}/bin/pip" install -q --upgrade pip
"${JARVIS_SERVICE_VENV}/bin/pip" install -q -r "$JARVIS_SERVICE_REQUIREMENTS"

# ---------------------------------------------------------------------------
# 4) Install + bootstrap LaunchAgents.
# ---------------------------------------------------------------------------
jarvis_log "step 4/5: LaunchAgents"

mkdir -p "$JARVIS_LAUNCHAGENTS_DIR" "${JARVIS_PROFILE_HOME}/logs"

install_agent() {
  local label="$1" template="$2"
  local dest="${JARVIS_LAUNCHAGENTS_DIR}/${label}.plist"
  sed "s|@REPO@|${JARVIS_REPO_ROOT}|g" "$template" > "$dest"
  plutil -lint "$dest" >/dev/null
  jarvis_agent_bootstrap "$label" "$dest"
}

install_agent "$JARVISD_LABEL" "${JARVIS_LAUNCHAGENTS_SRC_DIR}/${JARVISD_LABEL}.plist.tmpl"
install_agent "$DASHBOARD_LABEL" "${JARVIS_LAUNCHAGENTS_SRC_DIR}/${DASHBOARD_LABEL}.plist.tmpl"

# ---------------------------------------------------------------------------
# 5) Health wait loop.
# ---------------------------------------------------------------------------
jarvis_log "step 5/5: health wait"

jarvisd_ok=0
dashboard_ok=0
jarvis_wait_health "$JARVISD_HEALTH_URL" 30 2 && jarvisd_ok=1 || true
jarvis_wait_health "$DASHBOARD_HEALTH_URL" 30 2 && dashboard_ok=1 || true

echo
jarvis_log "=== install summary ==="
if [ "$jarvisd_ok" -eq 1 ]; then
  jarvis_log "jarvisd:    HEALTHY (${JARVISD_HEALTH_URL})"
else
  jarvis_log "jarvisd:    NOT HEALTHY (${JARVISD_HEALTH_URL}) — check ${JARVIS_PROFILE_HOME}/logs/jarvisd.err.log"
fi
if [ "$dashboard_ok" -eq 1 ]; then
  jarvis_log "dashboard:  HEALTHY (${DASHBOARD_HEALTH_URL})"
else
  jarvis_log "dashboard:  NOT HEALTHY (${DASHBOARD_HEALTH_URL}) — check ${JARVIS_PROFILE_HOME}/logs/dashboard.err.log"
fi

if [ "$jarvisd_ok" -eq 1 ] && [ "$dashboard_ok" -eq 1 ]; then
  jarvis_log "install complete, both services healthy."
else
  jarvis_log "install steps complete, but one or more services are not healthy yet."
  jarvis_log "run scripts/status.sh for details, or tail the logs above."
fi
