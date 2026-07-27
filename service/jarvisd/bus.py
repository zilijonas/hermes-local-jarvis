"""In-process async event bus. subscribe() hands out an asyncio.Queue; publish() fans an event
dict out to every subscriber, dropping the oldest queued item on overflow (never blocks a
publisher on a slow/stuck client). Also best-effort persists task.update -> task_events and any
event carrying turn_id -> turn_events, so /tasks/{id} and /traces stay populated even without a
UI attached.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .db import Database

_MAXSIZE = 512


class EventBus:
    def __init__(self, db: Database | None = None, maxsize: int = _MAXSIZE):
        self._maxsize = maxsize
        self._subscribers: set[asyncio.Queue] = set()
        self._db = db
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Call once from inside the server's running event loop (app startup). Lets publish()
        detect a caller on a different thread (e.g. a test, or a future sync producer) and hop
        onto the right loop via call_soon_threadsafe instead of touching queues cross-thread.
        """
        self._loop = loop or asyncio.get_running_loop()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        event.setdefault("ts", time.time())
        self._send(event)

    def publish_binary(self, header: dict[str, Any], data: bytes) -> None:
        """Fan out a JSON header (e.g. tts.chunk_hdr) immediately followed by a raw binary
        payload to every subscriber — the binary counterpart of publish() (SPEC §WebSocket
        tts.chunk). Queued as a (header, data) tuple; ws.py's forwarder sends header-then-bytes.
        """
        header.setdefault("ts", time.time())
        self._send((header, data))

    def _send(self, item: dict[str, Any] | tuple[dict[str, Any], bytes]) -> None:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if self._loop is not None and running is not self._loop:
            self._loop.call_soon_threadsafe(self._dispatch, item)
        else:
            self._dispatch(item)

    def _dispatch(self, item: dict[str, Any] | tuple[dict[str, Any], bytes]) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()  # drop oldest
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(item)
                except asyncio.QueueFull:
                    pass
        self._persist(item[0] if isinstance(item, tuple) else item)

    def _persist(self, event: dict[str, Any]) -> None:
        if self._db is None:
            return
        try:
            if event.get("t") == "task.update" and "id" in event:
                self._db.add_task_event(event["id"], "task.update", event)
            turn_id = event.get("turn_id")
            if turn_id:
                self._db.add_turn_event(turn_id, event.get("t", "event"), event)
        except Exception:
            pass  # best-effort persistence — never let the bus break on a bad event/db hiccup
