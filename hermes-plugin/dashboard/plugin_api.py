"""jarvis-voice dashboard plugin API — thin transparent proxy to jarvisd.

Mounted at ``/api/plugins/jarvis-voice/`` by the Hermes dashboard server
(``hermes_cli/web_server.py``). jarvisd is the standalone voice-assistant
service (see ``../../service/``) listening on loopback ``127.0.0.1:9140``.
This module owns no state of its own: every HTTP request/response and the
``/ws`` duplex channel are forwarded through, byte/frame-for-frame.

Import-safety contract (see docs/hermes-plugin-api.md): the dashboard
imports every plugin's ``plugin_api.py`` exactly once at server startup — a
broken import here must never break the whole dashboard. ``httpx`` and
``websockets`` are therefore imported defensively; if either is missing from
the hermes venv, the module still imports and ``router`` still exists, but
the affected endpoints answer 501 with an explanation instead of failing to
load.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter()

JARVISD_HTTP_BASE = "http://127.0.0.1:9140"
JARVISD_WS_URL = "ws://127.0.0.1:9140/ws"
HTTP_PROXY_TIMEOUT_S = 30.0
WS_CONNECT_TIMEOUT_S = 5.0

# Headers that must not be copied across the proxy boundary in either
# direction: connection-management / framing headers whose values describe
# the *previous* hop, not the one we're about to make (content-length and
# content-encoding in particular — the outgoing response is built fresh by
# Starlette/httpx and would otherwise disagree with the forwarded bytes).
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
    "host",
}

try:
    import httpx

    _HTTPX_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # pragma: no cover - depends on venv contents
    httpx = None  # type: ignore[assignment]
    _HTTPX_IMPORT_ERROR = repr(exc)

try:
    import websockets

    _WEBSOCKETS_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # pragma: no cover - depends on venv contents
    websockets = None  # type: ignore[assignment]
    _WEBSOCKETS_IMPORT_ERROR = repr(exc)


def _offline_response(detail: str = "jarvisd offline") -> JSONResponse:
    return JSONResponse({"error": detail}, status_code=502)


def _not_available_response(dep: str, err: Optional[str]) -> JSONResponse:
    return JSONResponse(
        {
            "error": (
                f"jarvis-voice dashboard plugin: '{dep}' is not importable in "
                "the hermes venv; this endpoint is disabled."
            ),
            "detail": err,
        },
        status_code=501,
    )


def _filtered_headers(items) -> dict:
    return {k: v for k, v in items if k.lower() not in _HOP_BY_HOP}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy(path: str, request: Request):
    """Transparent HTTP proxy: dashboard client -> jarvisd.

    Streams the upstream response body back as it arrives instead of
    buffering it in memory; forwards the method, query string, JSON/raw
    body, and headers (minus hop-by-hop ones) untouched. Any failure to
    reach jarvisd (offline, refused, timed out) maps to a uniform
    ``502 {"error": "jarvisd offline"}`` rather than leaking a stack trace.
    """
    if httpx is None:
        return _not_available_response("httpx", _HTTPX_IMPORT_ERROR)

    body = await request.body()
    headers = _filtered_headers(request.headers.items())
    url = f"{JARVISD_HTTP_BASE}/{path}"
    params = list(request.query_params.multi_items())

    client = httpx.AsyncClient(timeout=HTTP_PROXY_TIMEOUT_S)
    try:
        upstream_request = client.build_request(
            request.method,
            url,
            params=params,
            content=body or None,
            headers=headers,
        )
        upstream = await client.send(upstream_request, stream=True)
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        await client.aclose()
        return _offline_response(f"jarvisd offline ({exc.__class__.__name__})")
    except Exception as exc:  # never raise into the dashboard server
        await client.aclose()
        logger.warning("jarvis-voice proxy error for %s %s: %s", request.method, path, exc)
        return _offline_response(f"jarvisd proxy error: {exc}")

    response_headers = _filtered_headers(upstream.headers.items())

    async def body_iterator():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body_iterator(),
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


@router.websocket("/ws")
async def ws_bridge(client_ws: WebSocket):
    """Bidirectional WS bridge: dashboard client <-> jarvisd ``/ws``.

    Text frames pass through as text (JSON control/event messages); binary
    frames pass through as binary (mic PCM upstream, TTS PCM downstream).
    Either side disconnecting cleanly closes the other.
    """
    await client_ws.accept()

    if websockets is None:
        try:
            await client_ws.send_json(
                {
                    "t": "error",
                    "message": (
                        "jarvis-voice dashboard plugin: 'websockets' package not "
                        f"importable in the hermes venv ({_WEBSOCKETS_IMPORT_ERROR})."
                    ),
                    "recoverable": False,
                }
            )
        except Exception:
            pass
        await client_ws.close(code=1011)
        return

    try:
        upstream = await websockets.connect(
            JARVISD_WS_URL, open_timeout=WS_CONNECT_TIMEOUT_S, max_size=None
        )
    except Exception as exc:
        try:
            await client_ws.send_json(
                {"t": "error", "message": "jarvisd offline", "detail": str(exc), "recoverable": True}
            )
        except Exception:
            pass
        await client_ws.close(code=1011)
        return

    async def client_to_upstream():
        try:
            while True:
                message = await client_ws.receive()
                mtype = message.get("type")
                if mtype == "websocket.disconnect":
                    break
                text = message.get("text")
                data = message.get("bytes")
                if text is not None:
                    await upstream.send(text)
                elif data is not None:
                    await upstream.send(data)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.debug("jarvis-voice ws client->upstream closed: %s", exc)

    async def upstream_to_client():
        try:
            async for message in upstream:
                if isinstance(message, (bytes, bytearray)):
                    await client_ws.send_bytes(bytes(message))
                else:
                    await client_ws.send_text(message)
        except Exception as exc:
            logger.debug("jarvis-voice ws upstream->client closed: %s", exc)

    tasks = [
        asyncio.create_task(client_to_upstream()),
        asyncio.create_task(upstream_to_client()),
    ]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        try:
            await upstream.close()
        except Exception:
            pass
        try:
            await client_ws.close()
        except Exception:
            pass
