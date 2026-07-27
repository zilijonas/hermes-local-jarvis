"""jarvis-voice agent/gateway-side plugin surface.

Intentionally minimal. All real functionality (voice pipeline, mediator,
workers, memory, task board) lives in the standalone `jarvisd` service
(see ../service/) and is reached by the dashboard through
`dashboard/plugin_api.py`. This module only exposes an in-session `/jarvis`
status command so a Hermes chat session can check whether jarvisd is up
without leaving the conversation.

Never raises: plugin loading treats an exception here as a load failure for
the *agent-side* surface only (the dashboard discovers `dashboard/` on its
own, independent of this file), so we defend anyway — a broken health check
must degrade to a status string, never break `register()` or the command.
"""

from __future__ import annotations

import json
import urllib.request

JARVISD_HEALTH_URL = "http://127.0.0.1:9140/health"
HEALTH_TIMEOUT_S = 2


def _fetch_status() -> str:
    """Fetch jarvisd `/health` and render a one-line status string.

    Any failure (offline, timeout, connection refused, bad JSON, ...)
    collapses to a plain "jarvisd offline" — callers never see a traceback.
    """
    try:
        with urllib.request.urlopen(JARVISD_HEALTH_URL, timeout=HEALTH_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return "jarvisd offline"

    try:
        ok = bool(payload.get("ok"))
        version = payload.get("version") or "?"
        uptime_s = payload.get("uptime_s")
        uptime = f"{int(uptime_s)}s" if isinstance(uptime_s, (int, float)) else "?"
        state = "online" if ok else "degraded"
        return f"jarvisd {state} (v{version}, up {uptime})"
    except Exception:
        return "jarvisd online (unparsed health payload)"


def _jarvis_status_command(raw_args: str = "") -> str:
    """Handler for the in-session `/jarvis` command. Never raises."""
    try:
        return _fetch_status()
    except Exception:
        return "jarvisd offline"


def register(ctx):
    """Hermes plugin entry point. Registers `/jarvis` only; never raises."""
    try:
        if hasattr(ctx, "register_command"):
            ctx.register_command(
                name="jarvis",
                handler=_jarvis_status_command,
                description="Show jarvisd (Jarvis voice service) health status.",
                args_hint="",
            )
    except Exception:
        pass
    return None
