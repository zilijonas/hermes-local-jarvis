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


def _probe(force: bool) -> dict[str, Any]:
    try:
        out = subprocess.run(
            [HERMES_VENV_PY, _PROBE, "force" if force else ""],
            capture_output=True, text=True, timeout=30)
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

    # cloud — OpenRouter USD limit.
    o = prov.get("openrouter")
    if o and o.get("configured") and o.get("ok", True) and o.get("error") is None:
        limit = o.get("limit")
        used = o.get("usage_usd") or 0.0
        rem = o.get("remaining_usd")
        if limit:
            pct = max(0.0, min(1.0, (rem if rem is not None else limit - used) / limit))
            out["cloud"] = {"available": True, "tier": "limit", "phase": "ok",
                            "note": None,
                            "gauges": [{"label": "credit", "remaining_pct": pct,
                                        "value_label": f"${(rem if rem is not None else limit - used):.2f} of ${limit:.0f}",
                                        "reset_epoch": None}]}
        else:  # unlimited / pay-as-you-go — show spend, no needle
            out["cloud"] = {"available": True, "tier": "limit", "phase": "ok",
                            "note": "pay-as-you-go",
                            "gauges": [{"label": "spent", "remaining_pct": None,
                                        "value_label": f"${used:.2f} used", "reset_epoch": None}]}
    else:
        out["cloud"] = {"available": False, "tier": "limit", "gauges": [],
                        "note": "not linked", "phase": "unavailable"}

    # codex — ChatGPT sub; usage not exposed via API, so tier only.
    c = prov.get("openai")
    if c and c.get("configured") and c.get("ok", True):
        rr, rl = c.get("requests_remaining"), c.get("requests_limit")
        gauges = []
        if rr is not None and rl:
            gauges = [{"label": "requests", "remaining_pct": max(0.0, min(1.0, rr / rl)),
                       "value_label": f"{rr} of {rl}", "reset_epoch": c.get("requests_reset")}]
        out["codex"] = {"available": True, "tier": "sub", "phase": "ok",
                        "note": (c.get("plan") or "").upper() + " plan · limits not exposed"
                                if not gauges else (c.get("plan") or "").upper() + " plan",
                        "gauges": gauges}
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
