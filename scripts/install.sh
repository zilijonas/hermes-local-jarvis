#!/usr/bin/env bash
# jarvis-voice — install (idempotent).
#
# 1) back up anything this script is about to overwrite
# 2) ensure the state dir + profile-free worker Hermes home exist
# 3) symlink ~/.hermes/plugins/jarvis-voice to this repo's hermes-plugin/
# 4) ensure service/.venv exists with the jarvisd runtime deps installed
# 5) install + bootstrap the jarvisd LaunchAgent
# 6) wait for it to report healthy and print the result
#
# The Jarvis tab is served by the main Hermes dashboard (local.hermesagent.dashboard,
# 127.0.0.1:9120/jarvis) — there is no separate isolated dashboard LaunchAgent anymore.
#
# Safe to re-run: every step checks current state before acting. No sudo.
#
# NOTE: jarvisd's service/jarvisd/app.py may not exist yet (built by a
# parallel agent) — step 6 (health wait) can legitimately time out on a
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
jarvis_log "step 1/6: backup"

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
# 2) Ensure the state dir + profile-free worker Hermes home exist.
# ---------------------------------------------------------------------------
jarvis_log "step 2/6: state dir + worker home"

mkdir -p "${JARVIS_STATE_DIR}/logs" "${JARVIS_HERMES_HOME}"

# A minimal config.yaml is written ONLY if one isn't already there — this
# never overwrites a real config, and it never invents secrets. The shape
# below documents what a first-run worker home needs (local-only model
# router + STT), matching what was observed in the pre-migration
# ~/.hermes/profiles/jarvis-voice/config.yaml on 2026-09-28: a local
# gpt-oss-20b-mxfp4 model via the llama.cpp router (127.0.0.1:8090,
# api_key: local, no real secret), manual approvals, web search off/local,
# browser off. Cloud worker routing (the "cloud" default backend talking to
# OpenCode Go via `hermes -p default -z`) is a jarvisd runtime choice, not
# something this config file needs to declare — jarvisd shells out to the
# `default` profile for that, it doesn't run this home in cloud mode.
if [ ! -f "${JARVIS_HERMES_HOME}/config.yaml" ]; then
  jarvis_log "writing minimal ${JARVIS_HERMES_HOME}/config.yaml (not present yet)"
  cat > "${JARVIS_HERMES_HOME}/config.yaml" <<'EOF'
model:
  default: gpt-oss-20b-mxfp4
  provider: custom
  api_key: local
  base_url: http://127.0.0.1:8090/v1
  api_mode: chat_completions
  context_length: 65536
  max_tokens: 4096
  temperature: 0
stt:
  enabled: true
  provider: local
  local:
    model: base.en
    language: en
approvals:
  mode: manual
  timeout: 60
  cron_mode: deny
web:
  backend: ddgs
  search_backend: web-failover
  extract_backend: local-extract
browser:
  backend: off
EOF
else
  jarvis_log "${JARVIS_HERMES_HOME}/config.yaml already present, leaving as-is"
fi

# ---------------------------------------------------------------------------
# 3) Symlink ~/.hermes/plugins/jarvis-voice -> repo hermes-plugin/
# ---------------------------------------------------------------------------
jarvis_log "step 3/6: plugin symlink"

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
# 4) Ensure service/.venv exists with the jarvisd runtime deps installed.
# ---------------------------------------------------------------------------
jarvis_log "step 4/6: service venv"

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
# 5) Install + bootstrap the jarvisd LaunchAgent.
# ---------------------------------------------------------------------------
jarvis_log "step 5/6: LaunchAgent"

mkdir -p "$JARVIS_LAUNCHAGENTS_DIR" "${JARVIS_STATE_DIR}/logs"

install_agent() {
  local label="$1" template="$2"
  local dest="${JARVIS_LAUNCHAGENTS_DIR}/${label}.plist"
  sed "s|@REPO@|${JARVIS_REPO_ROOT}|g" "$template" > "$dest"
  plutil -lint "$dest" >/dev/null
  jarvis_agent_bootstrap "$label" "$dest"
}

install_agent "$JARVISD_LABEL" "${JARVIS_LAUNCHAGENTS_SRC_DIR}/${JARVISD_LABEL}.plist.tmpl"

# ---------------------------------------------------------------------------
# 6) Health wait loop.
# ---------------------------------------------------------------------------
jarvis_log "step 6/6: health wait"

jarvisd_ok=0
jarvis_wait_health "$JARVISD_HEALTH_URL" 30 2 && jarvisd_ok=1 || true

echo
jarvis_log "=== install summary ==="
if [ "$jarvisd_ok" -eq 1 ]; then
  jarvis_log "jarvisd:    HEALTHY (${JARVISD_HEALTH_URL})"
else
  jarvis_log "jarvisd:    NOT HEALTHY (${JARVISD_HEALTH_URL}) — check ${JARVIS_STATE_DIR}/logs/jarvisd.err.log"
fi

if [ "$jarvisd_ok" -eq 1 ]; then
  jarvis_log "install complete, jarvisd healthy."
  jarvis_log "Jarvis tab: http://127.0.0.1:9120/jarvis (served by local.hermesagent.dashboard)"
else
  jarvis_log "install steps complete, but jarvisd is not healthy yet."
  jarvis_log "run scripts/status.sh for details, or tail the log above."
fi
