"""/ws — single duplex channel per UI client (SPEC §WebSocket).

Text frames are JSON dispatched by "t"; binary frames (mic PCM) are forwarded to
app.state.pipeline if one is registered. Every client is also subscribed to the bus and gets
all published events relayed as JSON. Multiple concurrent clients are supported (each gets its
own bus subscription + forwarder task).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


async def send_tts_chunk(ws: WebSocket, seq: int, samples: int, pcm: bytes) -> None:
    """Server->client binary audio: a tts.chunk_hdr JSON frame followed by the raw PCM frame."""
    await ws.send_json({"t": "tts.chunk_hdr", "seq": seq, "samples": samples})
    await ws.send_bytes(pcm)


async def _forward_bus_events(ws: WebSocket, queue) -> None:
    while True:
        item = await queue.get()
        if isinstance(item, tuple):  # (header, pcm_bytes) from bus.publish_binary
            header, data = item
            await ws.send_json(header)
            await ws.send_bytes(data)
        else:
            await ws.send_json(item)


async def _send_pipeline_missing_once(ws: WebSocket, already_sent: bool) -> bool:
    if not already_sent:
        await ws.send_json(
            {"t": "error", "ts": time.time(), "message": "pipeline not initialized", "recoverable": True}
        )
    return True


async def _handle_client_messages(ws: WebSocket) -> None:
    pipeline_warned = False
    while True:
        message = await ws.receive()
        if message["type"] == "websocket.disconnect":
            return

        raw_bytes = message.get("bytes")
        if raw_bytes is not None:
            pipeline = ws.app.state.pipeline
            if pipeline is None:
                pipeline_warned = await _send_pipeline_missing_once(ws, pipeline_warned)
                continue
            await pipeline.handle_audio_chunk(raw_bytes)
            continue

        text = message.get("text")
        if text is None:
            continue
        try:
            event = json.loads(text)
        except json.JSONDecodeError:
            await ws.send_json({"t": "error", "ts": time.time(), "message": "invalid JSON frame", "recoverable": True})
            continue

        if event.get("t") == "ping":
            await ws.send_json({"t": "pong"})
            continue

        pipeline = ws.app.state.pipeline
        if pipeline is None:
            pipeline_warned = await _send_pipeline_missing_once(ws, pipeline_warned)
            continue
        handler = getattr(pipeline, "handle_client_event", None)
        if handler is not None:
            await handler(event)


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    bus = ws.app.state.bus
    queue = bus.subscribe()
    forward_task = asyncio.create_task(_forward_bus_events(ws, queue))
    try:
        await _handle_client_messages(ws)
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        bus.unsubscribe(queue)
        # CancelledError is a BaseException (not Exception) since 3.8 — must be named explicitly.
        with contextlib.suppress(asyncio.CancelledError):
            await forward_task
