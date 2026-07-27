#!/usr/bin/env bash
# jarvis-voice — one-screen status. Read-only, makes no changes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

echo "=== jarvis-voice status ==="
echo "repo:    ${JARVIS_REPO_ROOT}"
echo "profile: ${JARVIS_PROFILE_HOME}"
echo

echo "--- LaunchAgents ---"
jarvis_agent_status_line "$JARVISD_LABEL"
jarvis_agent_status_line "$DASHBOARD_LABEL"
echo

echo "--- HTTP health ---"
if curl -fsS --max-time 3 "$JARVISD_HEALTH_URL" 2>/dev/null; then
  echo
else
  echo "jarvisd:    unreachable (${JARVISD_HEALTH_URL})"
fi
if curl -fsS --max-time 3 "$DASHBOARD_HEALTH_URL" 2>/dev/null; then
  echo
else
  echo "dashboard:  unreachable (${DASHBOARD_HEALTH_URL})"
fi
echo

echo "--- Ollama (ps) ---"
if command -v ollama >/dev/null 2>&1; then
  ollama ps 2>/dev/null || echo "ollama ps failed (is the Ollama server running?)"
else
  curl -fsS --max-time 3 http://127.0.0.1:11434/api/ps 2>/dev/null || echo "ollama not on PATH and http://127.0.0.1:11434/api/ps unreachable"
fi
echo

echo "--- Models disk usage (~/ai/models) ---"
if [ -d "${HOME}/ai/models" ]; then
  du -sh "${HOME}/ai/models" 2>/dev/null
else
  echo "~/ai/models does not exist"
fi
