"""Provider credit/limit readers vendored from the (now-removed)
hermes-plugin-credits plugin so jarvisd owns this logic outright and
has no dependency on any external dashboard plugin. Pure functions +
an async status(force) aggregator; no FastAPI router.

Readers: OpenRouter (auth/key), Anthropic (unified 5h/7d headers),
OpenAI/Codex (live weekly via `codex app-server account/rateLimits/read`).
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx


TIMEOUT = httpx.Timeout(6.0, connect=3.0)


# Subscription monthly prices (USD). Sources: openai.com/chatgpt/pricing,
# anthropic.com/pricing as of 2026. Update when providers shift pricing.
CHATGPT_PLAN_PRICE_USD = {
    "free": 0,
    "plus": 20,
    "pro": 200,
    "team": 30,        # per user / month
    "business": 30,    # alias surfaced by some endpoints
    "enterprise": None,  # custom — show "custom"
    "edu": 0,
}
CLAUDE_PLAN_PRICE_USD = {
    "pro": 20,
    "max": 100,        # Max 5x baseline; Max 20x is 200
    "max_5x": 100,
    "max_20x": 200,
    "team": 30,
    "enterprise": None,
}


async def _openrouter(client: httpx.AsyncClient) -> dict[str, Any]:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        return {"provider": "openrouter", "configured": False}
    try:
        r = await client.get(
            "https://openrouter.ai/api/v1/auth/key",
            headers={"Authorization": f"Bearer {key}"},
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        # OpenRouter returns: usage (USD spent), limit (USD cap or null=unlimited),
        # limit_remaining (USD or null), is_free_tier, rate_limit
        usage = float(data.get("usage") or 0)
        limit = data.get("limit")  # null means unlimited
        limit_remaining = data.get("limit_remaining")
        return {
            "provider": "openrouter",
            "configured": True,
            "ok": True,
            "usage_usd": usage,
            "limit_usd": float(limit) if limit is not None else None,
            "remaining_usd": float(limit_remaining) if limit_remaining is not None else None,
            "is_free_tier": bool(data.get("is_free_tier", False)),
            "label": data.get("label"),
        }
    except Exception as e:
        return {"provider": "openrouter", "configured": True, "ok": False, "error": str(e)[:200]}


def _hdr_int(headers, name: str):
    v = headers.get(name)
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _claude_subscription_label() -> str | None:
    """Return the Claude subscription tier from the local creds file."""
    import json
    from pathlib import Path
    p = Path.home() / ".claude" / ".credentials.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        return data.get("claudeAiOauth", {}).get("subscriptionType")
    except Exception:
        return None


def _claude_oauth_from_file() -> tuple[str | None, str | None]:
    """Get a working Anthropic OAuth access token.

    Tries (in order):
      1. ~/.hermes/.anthropic_oauth.json — Hermes-managed; refreshes cleanly
         since Hermes writes here AND the dashboard runs from this same
         install. No keychain access needed.
      2. ~/.claude/.credentials.json — fallback. Refreshable only if Claude
         Code hasn't already burned the refresh token (single-use rotation).

    Returns (access_token, source_label) so we can surface why a refresh
    might fail.
    """
    import json
    import time
    from pathlib import Path

    now_ms = int(time.time() * 1000)

    # 1) Hermes auth pool (~/.hermes/auth.json) — populated by `hermes auth
    #    add anthropic`. Highest-priority oauth credential is used.
    pool_path = Path.home() / ".hermes" / "auth.json"
    if pool_path.exists():
        try:
            data = json.loads(pool_path.read_text())
            entries = (data.get("credential_pool") or {}).get("anthropic") or []
            # Prefer non-env credentials (manual OAuth from PKCE flow).
            entries = sorted(
                entries,
                key=lambda e: (
                    e.get("source", "").startswith("env"),
                    -(e.get("priority") or 0),
                ),
            )
            for e in entries:
                if e.get("auth_type") != "oauth":
                    continue
                access = e.get("access_token")
                refresh = e.get("refresh_token")
                exp = int(e.get("expires_at_ms") or 0)
                if access and (exp == 0 or exp > now_ms + 60_000):
                    return access, "hermes_pool"
                if refresh:
                    t = _refresh_anthropic_pool(refresh, pool_path, e["id"])
                    if t:
                        return t, "hermes_pool"
        except Exception:
            pass

    # 2) Legacy Hermes-only file (older versions).
    hermes_path = Path.home() / ".hermes" / ".anthropic_oauth.json"
    if hermes_path.exists():
        try:
            data = json.loads(hermes_path.read_text())
            access = data.get("accessToken") or data.get("access_token")
            refresh = data.get("refreshToken") or data.get("refresh_token")
            exp = int(data.get("expiresAt") or data.get("expires_at_ms") or 0)
            if access and exp > now_ms + 60_000:
                return access, "hermes_oauth"
            if refresh:
                t = _refresh_anthropic(refresh, hermes_path, hermes_format=True)
                if t:
                    return t, "hermes_oauth"
        except Exception:
            pass

    # 3) Claude Code's credentials file.
    p = Path.home() / ".claude" / ".credentials.json"
    if not p.exists():
        return None, None
    try:
        data = json.loads(p.read_text())
    except Exception:
        return None, None

    creds = data.get("claudeAiOauth", {}) or {}
    access = creds.get("accessToken")
    refresh = creds.get("refreshToken")
    expires_at_ms = int(creds.get("expiresAt") or 0)

    if access and expires_at_ms > now_ms + 60_000:
        return access, "claude_code"

    if refresh:
        t = _refresh_anthropic(refresh, p, hermes_format=False, claude_data=data)
        if t:
            return t, "claude_code"
    return access, "claude_code"


def _refresh_anthropic_pool(refresh: str, pool_path, cred_id: str) -> str | None:
    """Refresh an Anthropic credential stored in ~/.hermes/auth.json's pool."""
    import json
    import time
    try:
        with httpx.Client(timeout=8) as c:
            for endpoint in (
                "https://platform.claude.com/v1/oauth/token",
                "https://console.anthropic.com/v1/oauth/token",
            ):
                r = c.post(
                    endpoint,
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": refresh,
                        "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
                    },
                )
                if r.status_code != 200:
                    continue
                payload = r.json()
                new_access = payload.get("access_token")
                new_refresh = payload.get("refresh_token") or refresh
                expires_in = int(payload.get("expires_in") or 3600)
                if not new_access:
                    continue
                # Persist back into the pool.
                try:
                    data = json.loads(pool_path.read_text())
                    entries = (data.get("credential_pool") or {}).get("anthropic") or []
                    for e in entries:
                        if e.get("id") == cred_id:
                            e["access_token"] = new_access
                            e["refresh_token"] = new_refresh
                            e["expires_at_ms"] = int(time.time() * 1000) + expires_in * 1000
                            break
                    pool_path.write_text(json.dumps(data, indent=2))
                except Exception:
                    pass
                return new_access
    except Exception:
        pass
    return None


def _refresh_anthropic(
    refresh: str,
    file_path,
    hermes_format: bool,
    claude_data: dict | None = None,
) -> str | None:
    """Run the Anthropic OAuth refresh-token grant and persist the result.

    Single-use rotation: each refresh issues a new refresh_token; older ones
    are invalidated. Returns the new access token or None on failure.
    """
    import json
    import time
    try:
        with httpx.Client(timeout=8) as c:
            for endpoint in (
                "https://platform.claude.com/v1/oauth/token",
                "https://console.anthropic.com/v1/oauth/token",
            ):
                try:
                    r = c.post(
                        endpoint,
                        data={
                            "grant_type": "refresh_token",
                            "refresh_token": refresh,
                            "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
                        },
                    )
                    if r.status_code != 200:
                        continue
                    payload = r.json()
                    new_access = payload.get("access_token")
                    new_refresh = payload.get("refresh_token") or refresh
                    expires_in = int(payload.get("expires_in") or 3600)
                    if not new_access:
                        continue
                    new_exp = int(time.time() * 1000) + expires_in * 1000
                    try:
                        if hermes_format:
                            file_path.write_text(json.dumps({
                                "accessToken": new_access,
                                "refreshToken": new_refresh,
                                "expiresAt": new_exp,
                            }, indent=2))
                        elif claude_data is not None:
                            claude_data["claudeAiOauth"]["accessToken"] = new_access
                            claude_data["claudeAiOauth"]["refreshToken"] = new_refresh
                            claude_data["claudeAiOauth"]["expiresAt"] = new_exp
                            file_path.write_text(json.dumps(claude_data, indent=2))
                    except Exception:
                        pass
                    return new_access
                except Exception:
                    continue
    except Exception:
        pass
    return None


async def _anthropic(client: httpx.AsyncClient) -> dict[str, Any]:
    """Anthropic has no balance endpoint, but every /v1/messages response carries
    rate-limit headers. For Claude Pro/Max subscriptions, the *unified* headers
    show 5h + 7d window utilization. We probe with a 1-token request to read
    them. Costs ~$0.0001 per refresh (or counts a tiny sliver of subscription).

    Auth precedence: ANTHROPIC_API_KEY > CLAUDE_CODE_OAUTH_TOKEN > ~/.claude/.credentials.json.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    oauth_token: str | None = os.getenv("CLAUDE_CODE_OAUTH_TOKEN")
    oauth_source: str | None = "env" if oauth_token else None
    if not oauth_token:
        oauth_token, oauth_source = _claude_oauth_from_file()
    if not api_key and not oauth_token:
        return {"provider": "anthropic", "configured": False}
    plan = _claude_subscription_label()  # e.g. "max", "pro"

    headers = {"anthropic-version": "2023-06-01"}
    auth_kind = "api_key"
    if api_key:
        headers["x-api-key"] = api_key
    else:
        headers["Authorization"] = f"Bearer {oauth_token}"
        headers["anthropic-beta"] = "oauth-2025-04-20"
        auth_kind = "oauth"

    body = {
        "model": "claude-haiku-4-5",
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "."}],
    }
    try:
        r = await client.post(
            "https://api.anthropic.com/v1/messages", headers=headers, json=body,
        )
        h = r.headers

        def _flt(name):
            v = h.get(name)
            try:
                return float(v) if v is not None else None
            except (ValueError, TypeError):
                return None

        def _ts(name):
            """Reset values are unix seconds for unified, ISO-8601 for legacy."""
            v = h.get(name)
            if v is None:
                return None
            try:
                return int(v)  # unix seconds (unified)
            except (ValueError, TypeError):
                return v       # ISO-8601 string (legacy)

        normalized_plan = (plan or "").lower().replace("-", "_")
        plan_price = CLAUDE_PLAN_PRICE_USD.get(normalized_plan)
        out = {
            "provider": "anthropic",
            "configured": True,
            "ok": r.is_success,
            "auth": auth_kind,
            "plan": plan,
            "plan_price_usd": plan_price,
            "oauth_source": oauth_source,
            # Claude Pro/Max subscription (unified headers, utilization 0..1)
            "unified_5h_utilization": _flt("anthropic-ratelimit-unified-5h-utilization"),
            "unified_5h_status": h.get("anthropic-ratelimit-unified-5h-status"),
            "unified_5h_reset": _ts("anthropic-ratelimit-unified-5h-reset"),
            "unified_7d_utilization": _flt("anthropic-ratelimit-unified-7d-utilization"),
            "unified_7d_status": h.get("anthropic-ratelimit-unified-7d-status"),
            "unified_7d_reset": _ts("anthropic-ratelimit-unified-7d-reset"),
            # Legacy / API-key headers
            "tokens_remaining": _hdr_int(h, "anthropic-ratelimit-tokens-remaining"),
            "tokens_limit": _hdr_int(h, "anthropic-ratelimit-tokens-limit"),
            "tokens_reset": _ts("anthropic-ratelimit-tokens-reset"),
            "requests_remaining": _hdr_int(h, "anthropic-ratelimit-requests-remaining"),
            "requests_limit": _hdr_int(h, "anthropic-ratelimit-requests-limit"),
        }
        if not r.is_success:
            if r.status_code == 401 and auth_kind == "oauth":
                out["error"] = "OAuth token rejected"
                out["hint"] = (
                    "Run `hermes auth add anthropic` once to mint a fresh "
                    "Hermes-managed OAuth token (writes to "
                    "~/.hermes/.anthropic_oauth.json)."
                )
            else:
                out["error"] = f"HTTP {r.status_code}"
        return out
    except Exception as e:
        return {
            "provider": "anthropic", "configured": True, "ok": False,
            "auth": auth_kind, "plan": plan, "error": str(e)[:200],
        }


def _codex_token_from_file() -> tuple[str | None, dict | None]:
    """Read Codex (ChatGPT subscription) OAuth from ~/.codex/auth.json.
    Returns (access_token, full_token_payload_for_metadata).
    """
    import json
    from pathlib import Path
    p = Path.home() / ".codex" / "auth.json"
    if not p.exists():
        return None, None
    try:
        data = json.loads(p.read_text())
        # Codex stores: tokens.access_token + tokens.id_token (JWT with plan info)
        tokens = data.get("tokens") or {}
        return tokens.get("access_token"), tokens
    except Exception:
        return None, None


def _codex_plan_from_jwt(id_token: str) -> str | None:
    """Decode unsigned JWT body to read chatgpt_plan_type (plus/pro/etc)."""
    import base64
    import json
    try:
        body = id_token.split(".")[1]
        body += "=" * (-len(body) % 4)  # pad
        payload = json.loads(base64.urlsafe_b64decode(body))
        auth = payload.get("https://api.openai.com/auth", {})
        return auth.get("chatgpt_plan_type")
    except Exception:
        return None


def _codex_live_rate_limits(timeout: float = 8.0) -> dict[str, Any]:
    """Live Codex (ChatGPT-subscription) weekly rate-limit read via the
    `codex` CLI's own app-server JSON-RPC protocol — `account/rateLimits/read`
    (confirmed via `codex app-server generate-json-schema`; this is the same
    RPC the interactive TUI/VS Code extension use to show "X% of weekly
    limit used, resets in N"). It is a pure metadata read — it never issues
    `thread/start`, so it spends no turn and burns no usage quota. It does
    spawn the `codex` binary itself each call, so callers should cache
    (the /status endpoint above already does, 5 min TTL) rather than poll.

    Returns:
      {"snapshot": <rateLimits dict, camelCase, per RateLimitSnapshot>}
        on success (state classification happens in the caller), or
      {"error": "<reason>"} if the binary/RPC/auth isn't available.
    """
    import json
    import select
    import shutil
    import subprocess
    import time as _t

    binary = shutil.which("codex")
    if not binary:
        for candidate in ("/opt/homebrew/bin/codex", "/usr/local/bin/codex"):
            if os.path.exists(candidate):
                binary = candidate
                break
    if not binary:
        return {"error": "codex binary not found"}

    try:
        proc = subprocess.Popen(
            [binary, "app-server"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1,
        )
    except OSError as exc:
        return {"error": f"spawn failed: {exc}"}

    result = None
    reason = None
    deadline = _t.monotonic() + timeout
    try:
        def _send(msg: dict) -> None:
            proc.stdin.write(json.dumps(msg) + "\n")
            proc.stdin.flush()

        _send({"id": 1, "method": "initialize",
               "params": {"clientInfo": {"name": "hermes-credits", "version": "1.0"}}})
        _send({"method": "initialized", "params": {}})
        _send({"id": 2, "method": "account/rateLimits/read", "params": None})

        while _t.monotonic() < deadline:
            remaining = deadline - _t.monotonic()
            r, _w, _x = select.select([proc.stdout], [], [], max(0.0, remaining))
            if not r:
                break
            line = proc.stdout.readline()
            if not line:
                break
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get("id") == 2:
                if "error" in obj:
                    reason = str(obj["error"])[:200]
                else:
                    result = (obj.get("result") or {}).get("rateLimits")
                break
    except Exception as exc:  # noqa: BLE001
        reason = f"{type(exc).__name__}: {exc}"[:200]
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=2)
            except Exception:
                pass

    if result is None:
        return {"error": reason or "no account/rateLimits/read response"}
    return {"snapshot": result}


def _codex_weekly_state(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Classify a live RateLimitSnapshot into the 3-state gauge contract.

    Codex exposes two rolling windows (`primary`/`secondary`); as of mid-2026
    the 5h window was retired and only the weekly (10080 min) window remains,
    but which slot holds it has changed before. To stay correct either way,
    "weekly" is defined as whichever present window has the larger
    `windowDurationMins`, not by slot name.
    """
    windows = [w for w in (snapshot.get("primary"), snapshot.get("secondary")) if w]
    weekly = None
    for w in windows:
        if int(w.get("windowDurationMins") or 0) >= 7 * 24 * 60:
            weekly = w
    if weekly is None and windows:
        weekly = max(windows, key=lambda w: int(w.get("windowDurationMins") or 0))
    if weekly is None or weekly.get("usedPercent") is None:
        credits = snapshot.get("credits") or {}
        if credits.get("unlimited"):
            return {"state": "off"}
        return {"state": "off" if not windows else "unavailable"}
    return {
        "state": "ok",
        "used_percent": weekly.get("usedPercent"),
        "window_minutes": weekly.get("windowDurationMins"),
        "resets_at": weekly.get("resetsAt"),
        "plan_type": snapshot.get("planType"),
    }


async def _openai(client: httpx.AsyncClient) -> dict[str, Any]:
    """OpenAI / Codex: no balance endpoint on the real API; rate-limit
    headers come back on /chat/completions responses there. For
    ChatGPT-subscription Codex auth, the standard OpenAI API rejects the
    token, so weekly usage instead comes from a LIVE read of the `codex`
    CLI's own app-server RPC (`account/rateLimits/read` — see
    `_codex_live_rate_limits`), the same call the Codex TUI uses. Plan info
    is decoded from the local auth.json's id_token either way.

    Auth precedence: OPENAI_API_KEY (real API) > Codex OAuth (subscription only).
    """
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        # Fall back to Codex subscription metadata.
        access, tokens = _codex_token_from_file()
        if not access:
            return {"provider": "openai", "configured": False}
        plan = None
        id_token = (tokens or {}).get("id_token")
        if id_token:
            plan = _codex_plan_from_jwt(id_token)
        normalized_plan = (plan or "").lower().replace("-", "_")
        plan_price = CHATGPT_PLAN_PRICE_USD.get(normalized_plan)
        out: dict[str, Any] = {
            "provider": "openai",
            "configured": True,
            "ok": True,
            "auth": "codex_oauth",
            "plan": plan,  # "plus", "pro", "free", etc.
            "plan_price_usd": plan_price,
            "note": "ChatGPT subscription; usage limits not exposed via API.",
        }
        import time as _time
        live = await asyncio.to_thread(_codex_live_rate_limits)
        if "snapshot" in live:
            classified = _codex_weekly_state(live["snapshot"])
        else:
            classified = {"state": "unavailable", "reason": live.get("error")}
        state = classified["state"]
        out["codex_weekly_state"] = state
        if state == "ok":
            out["codex_weekly_used_percent"] = classified["used_percent"]
            out["codex_weekly_window_minutes"] = classified.get("window_minutes")
            out["codex_weekly_resets_at"] = classified.get("resets_at")
            out["codex_weekly_snapshot_at"] = int(_time.time())
            out["note"] = "ChatGPT subscription; live weekly usage from codex app-server."
        elif state == "off":
            out["note"] = "ChatGPT subscription; this plan has no weekly Codex limit."
        else:
            reason = classified.get("reason")
            out["note"] = "ChatGPT subscription; live weekly usage unavailable" + (
                f" ({reason})" if reason else ""
            ) + "."
        return out
    try:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": "gpt-4o-mini",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "."}],
            },
        )
        h = r.headers
        out = {
            "provider": "openai",
            "configured": True,
            "ok": r.is_success,
            "tokens_remaining": _hdr_int(h, "x-ratelimit-remaining-tokens"),
            "tokens_limit": _hdr_int(h, "x-ratelimit-limit-tokens"),
            "tokens_reset": h.get("x-ratelimit-reset-tokens"),
            "requests_remaining": _hdr_int(h, "x-ratelimit-remaining-requests"),
            "requests_limit": _hdr_int(h, "x-ratelimit-limit-requests"),
        }
        if not r.is_success:
            out["error"] = f"HTTP {r.status_code}"
        return out
    except Exception as e:
        return {"provider": "openai", "configured": True, "ok": False, "error": str(e)[:200]}


_CACHE: dict[str, Any] = {"at": 0.0, "data": None}
_CACHE_TTL = 300.0  # 5 minutes — Anthropic/OpenAI probes burn ~1 token each


async def status(force: bool = False) -> dict[str, Any]:
    """Return per-provider credit status. Cached 5min to limit probe cost."""
    import time
    now = time.time()
    if not force and _CACHE["data"] and (now - _CACHE["at"]) < _CACHE_TTL:
        return {**_CACHE["data"], "cached": True, "age_seconds": int(now - _CACHE["at"])}

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        results = await asyncio.gather(
            _openrouter(client),
            _anthropic(client),
            _openai(client),
            return_exceptions=False,
        )
    providers = [p for p in results if p.get("configured")]
    payload = {"providers": providers, "cached": False, "age_seconds": 0}
    _CACHE["at"] = now
    _CACHE["data"] = {"providers": providers}
    return payload