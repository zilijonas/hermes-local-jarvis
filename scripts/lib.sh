#!/usr/bin/env bash
# jarvis-voice install tooling — shared helpers.
#
# Sourced by every other script in this directory (install.sh, update.sh,
# uninstall.sh, rollback.sh, status.sh). Not meant to be executed directly.
# Callers are expected to have already run `set -euo pipefail` themselves;
# this file only defines paths/labels/functions, it doesn't change shell
# options on its own.

# shellcheck disable=SC2034
# ^ every constant below is consumed by the scripts that `source` this
# file, not by lib.sh itself — shellcheck analyzes files independently and
# can't see that, so it flags all of them as "unused". Confirmed used by
# install.sh/update.sh/uninstall.sh/rollback.sh/status.sh.

# Repo root autodetect: this file lives at <repo>/scripts/lib.sh, so the
# repo root is always one directory up — independent of the caller's cwd.
JARVIS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JARVIS_REPO_ROOT="$(cd "$JARVIS_SCRIPT_DIR/.." && pwd)"

JARVIS_PROFILE_NAME="jarvis-voice"
JARVIS_PROFILE_HOME="/Users/agent/.hermes/profiles/jarvis-voice"
JARVIS_HERMES_VENV="/Users/agent/.hermes/hermes-agent/venv"
JARVIS_PLUGIN_LINK="${JARVIS_PROFILE_HOME}/plugins/jarvis-voice"
JARVIS_SERVICE_DIR="${JARVIS_REPO_ROOT}/service"
JARVIS_SERVICE_VENV="${JARVIS_SERVICE_DIR}/.venv"
JARVIS_SERVICE_REQUIREMENTS="${JARVIS_SERVICE_DIR}/requirements.txt"

JARVISD_LABEL="local.jarvis.jarvisd"
DASHBOARD_LABEL="local.jarvis.dashboard"
JARVIS_LAUNCHAGENTS_DIR="/Users/agent/Library/LaunchAgents"
JARVIS_LAUNCHAGENTS_SRC_DIR="${JARVIS_SCRIPT_DIR}/launchagents"

JARVISD_HEALTH_URL="http://127.0.0.1:9140/health"
DASHBOARD_HEALTH_URL="http://127.0.0.1:9131/api/dashboard/plugins"

JARVIS_BACKUPS_DIR="/Users/agent/ai/backups"

jarvis_log() {
  echo "[jarvis-voice] $*"
}

jarvis_warn() {
  echo "[jarvis-voice] WARN: $*" >&2
}

jarvis_gui_domain() {
  echo "gui/$(id -u)"
}

# True (exit 0) if the LaunchAgent label is currently loaded in the user's
# GUI domain, per `launchctl print`. False otherwise; never treats an
# unloaded/unknown label as an error worth surfacing.
jarvis_agent_loaded() {
  local label="$1"
  launchctl print "$(jarvis_gui_domain)/${label}" >/dev/null 2>&1
}

# Bootout a LaunchAgent label if currently loaded. No-op if it isn't —
# always safe to call, never fails the calling script.
jarvis_agent_bootout() {
  local label="$1"
  if jarvis_agent_loaded "$label"; then
    jarvis_log "bootout ${label}"
    launchctl bootout "$(jarvis_gui_domain)/${label}" 2>/dev/null || true
  else
    jarvis_log "${label} not loaded, skipping bootout"
  fi
}

# Bootstrap a plist by path under the user's GUI domain. Boots out any
# existing instance of the label first so re-running is idempotent.
jarvis_agent_bootstrap() {
  local label="$1" plist_path="$2"
  jarvis_agent_bootout "$label"
  jarvis_log "bootstrap ${label} <- ${plist_path}"
  launchctl bootstrap "$(jarvis_gui_domain)" "$plist_path"
}

# Print one status line for a LaunchAgent label: running with PID, loaded
# but not running, or not loaded at all.
jarvis_agent_status_line() {
  local label="$1"
  local out
  if ! out="$(launchctl print "$(jarvis_gui_domain)/${label}" 2>/dev/null)"; then
    echo "${label}: not loaded"
    return 0
  fi
  local pid state
  pid="$(printf '%s\n' "$out" | awk -F'= ' '/^[[:space:]]*pid = /{print $2; exit}')"
  state="$(printf '%s\n' "$out" | awk -F'= ' '/^[[:space:]]*state = /{print $2; exit}')"
  if [ -n "$pid" ]; then
    echo "${label}: running (pid ${pid}, state ${state:-unknown})"
  else
    echo "${label}: loaded, not running (state ${state:-unknown})"
  fi
}

# Poll a health URL with curl. One attempt per `delay` seconds, up to
# `attempts` total. Returns 0 on first successful (2xx) response, 1 after
# exhausting all attempts — never aborts the calling script by itself.
jarvis_wait_health() {
  local url="$1" attempts="${2:-30}" delay="${3:-2}"
  local i=1
  while [ "$i" -le "$attempts" ]; do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      jarvis_log "healthy: ${url} (attempt ${i}/${attempts})"
      return 0
    fi
    i=$((i + 1))
    sleep "$delay"
  done
  jarvis_warn "not healthy after ${attempts} attempts (every ${delay}s): ${url}"
  return 1
}
