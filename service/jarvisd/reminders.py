"""Reminders Jarvis owns itself: "remind me in 10 minutes to stretch".

Handing reminders to a worker went wrong in practice (2026-09-28): the agent ran
`sleep 180` in the foreground and scripted Reminders.app through osascript, which
hung. A reminder is just a row in jarvis.db plus a timer, so jarvisd does it
directly: the mediator calls `set_reminder`, the scheduler fires it on time and
survives restarts (pending rows are reloaded on boot; ones missed while jarvisd
was down fire immediately, marked late).

Delivery: spoken aloud through the pipeline's announcement queue (shown in the
conversation too) AND sent to the Matrix room `jarvis-voice` via ~/ai/bin/notify,
so it reaches the phone when the dashboard is closed.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import os
import re
import shutil
import subprocess
import time
import uuid
from typing import Any, Awaitable, Callable, Optional

NOTIFY_BIN = os.path.expanduser("~/ai/bin/notify")
NOTIFY_ROOM = "jarvis-voice"
MAX_AHEAD_DAYS = 366


def parse_due(in_minutes: Any = None, at: Any = None,
              now: Optional[dt.datetime] = None) -> Optional[dt.datetime]:
    """Due time from either a relative offset or a clock time / ISO datetime.

    `at` accepts "17:30", "5:30 PM", "2026-09-29 09:00", "2026-09-29T09:00". A bare
    clock time already past today means tomorrow."""
    now = now or dt.datetime.now()
    if in_minutes not in (None, ""):
        try:
            mins = float(in_minutes)
        except (TypeError, ValueError):
            return None
        if mins <= 0 or mins > MAX_AHEAD_DAYS * 1440:
            return None
        return now + dt.timedelta(minutes=mins)
    if not at:
        return None
    s = str(at).strip()
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", ""))
        return d if d > now - dt.timedelta(minutes=1) else None
    except ValueError:
        pass
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?", s, re.I)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    ampm = (m.group(3) or "").lower().replace(".", "")
    if ampm == "pm" and hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    due = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return due if due > now else due + dt.timedelta(days=1)


def spoken_when(due: dt.datetime, now: Optional[dt.datetime] = None) -> str:
    now = now or dt.datetime.now()
    mins = max(1, round((due - now).total_seconds() / 60))
    if mins < 60:
        return f"in {mins} minute{'s' if mins != 1 else ''}"
    clock = due.strftime("%-I:%M %p").replace(":00 ", " ")
    if due.date() == now.date():
        return f"at {clock}"
    if due.date() == (now + dt.timedelta(days=1)).date():
        return f"tomorrow at {clock}"
    return due.strftime(f"on %A, %B %-d at {clock}")


class ReminderScheduler:
    def __init__(self, db, announce: Callable[[str], Awaitable[None]],
                 notify_bin: str = NOTIFY_BIN, room: str = NOTIFY_ROOM):
        self.db = db
        self.announce = announce
        self.notify_bin = notify_bin
        self.room = room
        self._wake = asyncio.Event()
        self._task: Optional[asyncio.Task] = None
        self._stopping = False

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        # A flag, not just task.cancel(): on Python 3.11 asyncio.wait_for swallows a
        # cancel that lands right after its inner wait completed, and the loop would
        # sleep another minute.
        self._stopping = True
        self._wake.set()
        if self._task is not None and not self._task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                self._task.cancel()

    # ------------------------------------------------------------ API (meta-tools)
    def set(self, text: str, in_minutes: Any = None, at: Any = None) -> dict[str, Any]:
        text = re.sub(r"\s+", " ", str(text or "")).strip()[:300]
        if not text:
            return {"error": "what should I remind you about?"}
        due = parse_due(in_minutes, at)
        if due is None:
            return {"error": "I need a time: minutes from now, or a clock time like 17:30."}
        rid = uuid.uuid4().hex[:8]
        self.db.add_reminder(rid, text, due.timestamp())
        self._wake.set()
        return {"id": rid, "text": text, "due": due.isoformat(timespec="minutes"),
                "speech": f"Okay, I'll remind you {spoken_when(due)} to {text}."
                          if not text.lower().startswith("to ") else
                          f"Okay, I'll remind you {spoken_when(due)} {text}."}

    def list(self) -> list[dict[str, Any]]:
        now = dt.datetime.now()
        return [{"id": r["id"], "text": r["text"],
                 "when": spoken_when(dt.datetime.fromtimestamp(r["due"]), now)}
                for r in self.db.list_reminders("pending")]

    def cancel(self, key: str) -> dict[str, Any]:
        key = (key or "").strip().lower()
        pending = self.db.list_reminders("pending")
        hits = [r for r in pending if r["id"] == key] or \
            [r for r in pending if key and key in r["text"].lower()]
        if not hits and key in ("", "all", "last", "latest"):
            hits = pending[-1:] if key != "all" else pending
        if not hits:
            return {"error": "no matching reminder"}
        for r in hits:
            self.db.set_reminder_status(r["id"], "canceled")
        self._wake.set()
        return {"canceled": [r["text"] for r in hits]}

    # ------------------------------------------------------------ loop
    async def _run(self) -> None:
        while not self._stopping:
            pending = self.db.list_reminders("pending", limit=50)
            now = time.time()
            for r in [r for r in pending if r["due"] <= now]:
                await self._fire(r, late=now - r["due"] > 90)
            upcoming = [r["due"] for r in pending if r["due"] > now]
            timeout = min(60.0, max(0.5, min(upcoming) - now)) if upcoming else 60.0
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                pass

    async def _fire(self, r: dict[str, Any], late: bool = False) -> None:
        self.db.set_reminder_status(r["id"], "fired")
        text = r["text"]
        spoken = f"Reminder{' (a little late)' if late else ''}: {text}."
        self._notify(f"Reminder: {text}")
        try:
            await self.announce(spoken)
        except Exception:  # noqa: BLE001 — Matrix already has it
            pass

    def _notify(self, message: str) -> None:
        if not (os.path.exists(self.notify_bin) or shutil.which(self.notify_bin)):
            return
        try:
            # jarvisd's HERMES_HOME is the local worker's home; notify belongs to the
            # main Hermes install (its log, its delivery policy).
            env = {k: v for k, v in os.environ.items() if k != "HERMES_HOME"}
            subprocess.Popen([self.notify_bin, "--room", self.room, "--plain", message],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True, env=env)
        except OSError:
            pass
