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
    # there's no live balance endpoint; when the `codex` CLI itself has run a
    # turn recently, hermes-plugin-credits surfaces its last-cached weekly
    # rate-limit snapshot (codex_weekly_* fields, read from local CLI session
    # logs — see plugin_api.py). Fall back to tier-only when that's absent
    # (e.g. real API key configured, or no recent CLI cache) or an
    # OPENAI_API_KEY's per-request rate-limit headers if present.
    c = prov.get("openai")
    if c and c.get("configured") and c.get("ok", True):
        gauges = []
        wu = c.get("codex_weekly_used_percent")
        if wu is not None:
            pct = max(0.0, min(1.0, 1.0 - (wu / 100.0)))
            gauges.append({"label": "weekly", "remaining_pct": pct,
                           "value_label": f"{round(100 - wu)}% left",
                           "reset_epoch": c.get("codex_weekly_resets_at")})
        else:
            rr, rl = c.get("requests_remaining"), c.get("requests_limit")
            if rr is not None and rl:
                gauges = [{"label": "requests", "remaining_pct": max(0.0, min(1.0, rr / rl)),
                           "value_label": f"{rr} of {rl}", "reset_epoch": c.get("requests_reset")}]
        note = (c.get("plan") or "").upper() + " plan"
        if not gauges:
            note += " · usage limits not exposed"
        elif c.get("codex_weekly_snapshot_at"):
            # This % is a passive cache from the last `codex` CLI turn, not a
            # live read — flag its age so a stale number isn't mistaken for
            # current usage (e.g. if usage since then happened via the
            # ChatGPT desktop app instead of the CLI).
            age_s = max(0.0, time.time() - c["codex_weekly_snapshot_at"])
            if age_s < 3600:
                age_str = "just now"
            elif age_s < 86400:
                age_str = f"{int(age_s // 3600)}h ago"
            else:
                age_str = f"{int(age_s // 86400)}d ago"
            note += f" · cached, last codex CLI turn {age_str}"
        out["codex"] = {"available": True, "tier": "sub", "phase": "ok",
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
