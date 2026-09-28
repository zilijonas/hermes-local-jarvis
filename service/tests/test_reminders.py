"""Reminders Jarvis owns (jarvisd/reminders.py): parsing, persistence, firing."""
import asyncio
import datetime as dt
import time

import pytest

from jarvisd.db import Database
from jarvisd.reminders import ReminderScheduler, parse_due, spoken_when

NOW = dt.datetime(2026, 9, 28, 17, 0)


def test_parse_relative_and_clock_times():
    assert parse_due(in_minutes=10, now=NOW) == NOW + dt.timedelta(minutes=10)
    assert parse_due(at="17:30", now=NOW) == NOW.replace(minute=30)
    assert parse_due(at="9 am", now=NOW) == dt.datetime(2026, 9, 29, 9, 0)      # past -> tomorrow
    assert parse_due(at="5:15 PM", now=NOW) == NOW.replace(minute=15)
    assert parse_due(at="2026-09-30 08:00", now=NOW) == dt.datetime(2026, 9, 30, 8, 0)
    assert parse_due(in_minutes=-5, now=NOW) is None
    assert parse_due(at="soonish", now=NOW) is None
    assert parse_due(now=NOW) is None


def test_spoken_when():
    assert spoken_when(NOW + dt.timedelta(minutes=3), NOW) == "in 3 minutes"
    assert spoken_when(dt.datetime(2026, 9, 29, 9, 0), NOW) == "tomorrow at 9 AM"


@pytest.mark.asyncio
async def test_set_fire_and_cancel(tmp_path):
    db = Database(tmp_path / "j.db")
    said = []

    async def announce(text):
        said.append(text)

    rs = ReminderScheduler(db, announce, notify_bin="/nonexistent/notify")
    out = rs.set("stretch your back", in_minutes=0.02)          # ~1.2 s
    assert out["id"] and "stretch your back" in out["speech"]
    keep = rs.set("call mom", in_minutes=60)
    assert {r["text"] for r in rs.list()} == {"stretch your back", "call mom"}
    rs.start()
    for _ in range(60):
        if said:
            break
        await asyncio.sleep(0.1)
    assert said == ["Reminder: stretch your back."]
    assert db.get_reminder(out["id"])["status"] == "fired"
    assert rs.cancel("mom")["canceled"] == ["call mom"]
    assert db.get_reminder(keep["id"])["status"] == "canceled" and rs.list() == []
    assert "error" in rs.set("", in_minutes=5) and "error" in rs.set("x")
    await rs.stop()


@pytest.mark.asyncio
async def test_missed_reminder_fires_late_after_restart(tmp_path):
    db = Database(tmp_path / "j.db")
    db.add_reminder("r1", "take the pizza out", time.time() - 600)   # due while jarvisd was down
    said = []

    async def announce(text):
        said.append(text)

    rs = ReminderScheduler(db, announce, notify_bin="/nonexistent/notify")
    rs.start()
    await asyncio.sleep(0.2)
    await rs.stop()
    assert said == ["Reminder (a little late): take the pizza out."]
