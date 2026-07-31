"""Per-backend credit / limit balances for the worker-backend selector gauges.

Reuses hermes-plugin-credits' provider readers via a subprocess against the
HERMES venv (see _credits_probe.py) so provider-API logic lives in exactly one
place. Read on demand only — a long TTL cache plus an explicit refresh; never a
per-second poll (each anthropic/openai probe burns ~1 token).

Contract consumed by the UI gauges, one entry per worker backend:
    { available: bool, tier: "free"|"sub"|"limit",
      gauges: [ {label, remaining_pct: float|None, value_label, reset_epoch: int|None} ],
      note: str|None, phase: "ok"|"unavailable" }
`remaining_pct` is 0..1 (1 = full/green, 0 = empty/red) or None when the
provider doesn't expose a number (show the tier, no needle).
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from typing import Any, Optional

HERMES_VENV_PY = os.path.expanduser("~/.hermes/hermes-agent/venv/bin/python")
_PROBE = os.path.join(os.path.dirname(__file__), "_credits_probe.py")
_TTL = 600.0  # 10 min; refresh=True bypasses

_cache: dict[str, Any] = {"at": 0.0, "raw": None}


_DEFAULT_ENV = os.path.expanduser("~/.hermes/.env")


def _probe_env() -> dict[str, str]:
    """jarvisd's own env is deliberately key-free (local purity). The credit
    reader needs the provider keys (OPENROUTER_API_KEY etc.) that live in the
    default profile's .env — the same ones the dashboard process sees. Load them
    ONLY for this read-only balance probe; they never touch the local mediator.
    """
    env = dict(os.environ)
    try:
        for line in open(_DEFAULT_ENV):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass
    return env


def _probe(force: bool) -> dict[str, Any]:
    try:
        out = subprocess.run(
            [HERMES_VENV_PY, _PROBE, "force" if force else ""],
            capture_output=True, text=True, timeout=30, env=_probe_env())
        return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:200], "providers": []}


def _by_provider(raw: dict[str, Any]) -> dict[str, dict]:
    return {p.get("provider"): p for p in raw.get("providers", []) if isinstance(p, dict)}


def _shape(raw: dict[str, Any]) -> dict[str, Any]:
    prov = _by_provider(raw)
    out: dict[str, Any] = {}

    # granite — always free, on-box, no gauge.
    out["granite"] = {"available": True, "tier": "free", "gauges": [],
                      "note": "on-device · free", "phase": "ok"}

    # cloud — OpenRouter. The user's key carries a WEEKLY spend limit:
    # `limit_usd` is the weekly cap and `remaining_usd` is what's left THIS week
    # (starts at the cap, drains per call, resets weekly). `usage_usd` is
    # LIFETIME spend — never mix it into the weekly fraction (that was the
    # "0% left" bug: lifetime $16.57 vs a $4 weekly cap).
    o = prov.get("openrouter")
    if o and o.get("configured") and o.get("ok", True) and o.get("error") is None:
        limit = o.get("limit_usd")
        rem = o.get("remaining_usd")
        used = o.get("usage_usd") or 0.0
        if limit and rem is not None:
            pct = max(0.0, min(1.0, rem / limit))
            out["cloud"] = {"available": True, "tier": "limit", "phase": "ok",
                            "note": "resets weekly",
                            "gauges": [{"label": "weekly", "remaining_pct": pct,
                                        "value_label": f"${rem:.2f} of ${limit:.2f}",
                                        "reset_epoch": None}]}
        else:  # no cap configured — pay-as-you-go, show lifetime spend, no needle
            out["cloud"] = {"available": True, "tier": "limit", "phase": "ok",
                            "note": "pay-as-you-go",
                            "gauges": [{"label": "spent", "remaining_pct": None,
                                        "value_label": f"${used:.2f} used", "reset_epoch": None}]}
    else:
        out["cloud"] = {"available": False, "tier": "limit", "gauges": [],
                        "note": "not linked", "phase": "unavailable"}

    # codex — ChatGPT sub. Real API rejects the subscription OAuth token, so
    # weekly usage instead comes from a LIVE read hermes-plugin-credits takes
    # via the `codex` CLI's own app-server RPC (account/rateLimits/read — a
    # zero-quota metadata call, see plugin_api._codex_live_rate_limits).
    # codex_weekly_state distinguishes three cases: "ok" (gauge below),
    # "off" (plan has no weekly cap -> explicit 0, never a fake full gauge)
    # and "unavailable" (live read failed -> render like "not linked").
    c = prov.get("openai")
    if c and c.get("configured") and c.get("ok", True):
        state = c.get("codex_weekly_state")
        gauges = []
        available = True
        phase = "ok"
        note = (c.get("plan") or "").upper() + " plan"
        if state == "ok" and c.get("codex_weekly_used_percent") is not None:
            wu = c["codex_weekly_used_percent"]
            pct = max(0.0, min(1.0, 1.0 - (wu / 100.0)))
            gauges = [{"label": "weekly", "remaining_pct": pct,
                       "value_label": f"{round(100 - wu)}% left",
                       "reset_epoch": c.get("codex_weekly_resets_at")}]
        elif state == "off":
            gauges = [{"label": "weekly", "remaining_pct": 0.0,
                       "value_label": "0%", "reset_epoch": None}]
            note += " · no weekly limit"
        elif state == "unavailable":
            available = False
            phase = "unavailable"
            note = "live weekly usage unavailable"
        else:
            # No ChatGPT-subscription weekly state (e.g. a real
            # OPENAI_API_KEY is configured instead) — fall back to
            # per-request rate-limit headers if present.
            rr, rl = c.get("requests_remaining"), c.get("requests_limit")
            if rr is not None and rl:
                gauges = [{"label": "requests", "remaining_pct": max(0.0, min(1.0, rr / rl)),
                           "value_label": f"{rr} of {rl}", "reset_epoch": c.get("requests_reset")}]
            if not gauges:
                note += " · usage limits not exposed"
        out["codex"] = {"available": available, "tier": "sub", "phase": phase,
                        "note": note, "gauges": gauges}
    else:
        out["codex"] = {"available": False, "tier": "sub", "gauges": [],
                        "note": "not linked", "phase": "unavailable"}

    # claude-code — Anthropic sub: weekly (7d) + session (5h) utilization.
    a = prov.get("anthropic")
    if a and a.get("configured") and a.get("ok", True):
        gauges = []
        u7 = a.get("unified_7d_utilization")
        u5 = a.get("unified_5h_utilization")
        if u7 is not None:
            gauges.append({"label": "weekly", "remaining_pct": max(0.0, min(1.0, 1.0 - u7)),
                           "value_label": f"{round((1 - u7) * 100)}% left", "reset_epoch": a.get("unified_7d_reset")})
        if u5 is not None:
            gauges.append({"label": "session", "remaining_pct": max(0.0, min(1.0, 1.0 - u5)),
                           "value_label": f"{round((1 - u5) * 100)}% left", "reset_epoch": a.get("unified_5h_reset")})
        out["claude"] = {"available": True, "tier": "sub", "phase": "ok",
                         "note": (a.get("plan") or "").upper() + " plan" if a.get("plan") else None,
                         "gauges": gauges}
    else:
        out["claude"] = {"available": False, "tier": "sub", "gauges": [],
                         "note": "not linked", "phase": "unavailable"}
    return out


def get_credits(force: bool = False) -> dict[str, Any]:
    now = time.time()
    if force or _cache["raw"] is None or (now - _cache["at"]) > _TTL:
        _cache["raw"] = _probe(force)
        _cache["at"] = now
    shaped = _shape(_cache["raw"])
    return {"backends": shaped, "checked_epoch": int(_cache["at"]),
            "age_seconds": int(now - _cache["at"]),
            "stale": (now - _cache["at"]) > _TTL,
            "error": _cache["raw"].get("error")}
