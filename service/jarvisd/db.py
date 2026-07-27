"""sqlite WAL store at <hermes_home>/jarvis.db.

Owns tasks/task_events/turns/turn_events/capabilities only — the memory module owns the
notes/chunks/chunks_fts/embeddings/aliases tables (docs/memory-design-inputs.md) in the SAME
file, so the connection is opened with check_same_thread=False and exposed via get_conn()
for other modules to share.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    goal TEXT,
    context TEXT,
    toolsets TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    created REAL NOT NULL,
    started REAL,
    finished REAL,
    session_id TEXT,
    pid INTEGER,
    result_text TEXT,
    result_summary TEXT,
    validation TEXT,
    usage TEXT,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    ts REAL NOT NULL,
    type TEXT NOT NULL,
    payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);

CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    ts REAL NOT NULL,
    transcript TEXT,
    reply TEXT,
    ms_stt REAL,
    ms_first_token REAL,
    ms_tts_first REAL,
    ms_e2e REAL,
    interrupted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turn_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id TEXT NOT NULL,
    ts REAL NOT NULL,
    type TEXT NOT NULL,
    payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_turn_events_turn_id ON turn_events(turn_id);

CREATE TABLE IF NOT EXISTS capabilities (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    desc TEXT,
    keywords TEXT,
    toolsets TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    last_used REAL
);
"""


def _row_to_dict(row: sqlite3.Row, json_fields: tuple[str, ...] = ()) -> dict[str, Any]:
    d = dict(row)
    for f in json_fields:
        if d.get(f):
            try:
                d[f] = json.loads(d[f])
            except (TypeError, json.JSONDecodeError):
                pass
    return d


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def get_conn(self) -> sqlite3.Connection:
        """Raw shared connection — memory module opens its own tables against this file."""
        return self._conn

    # ---------------- tasks ----------------

    def create_task(
        self, task_id: str | None = None, *, kind: str, goal: str = "", context: str = "",
        toolsets: str = "", status: str = "queued", metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """task_id: caller-supplied id (workers.manager mints its own short ids to correlate
        bus events emitted before this row exists); auto-generated when omitted.
        """
        task_id = task_id or uuid.uuid4().hex
        self._conn.execute(
            "INSERT INTO tasks (id, kind, goal, context, toolsets, status, created, metadata)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (task_id, kind, goal, context, toolsets, status, time.time(),
             json.dumps(metadata) if metadata is not None else None),
        )
        self._conn.commit()
        task = self.get_task(task_id)
        assert task is not None
        return task

    _TASK_UPDATE_FIELDS = {
        "status", "started", "finished", "session_id", "pid",
        "result_text", "result_summary", "validation", "usage", "metadata",
    }

    def update_task(self, task_id: str, **fields: Any) -> dict[str, Any] | None:
        unknown = set(fields) - self._TASK_UPDATE_FIELDS
        if unknown:
            raise ValueError(f"unknown task fields: {sorted(unknown)}")
        if not fields:
            return self.get_task(task_id)
        cols: list[str] = []
        vals: list[Any] = []
        for key, val in fields.items():
            if key in ("validation", "usage", "metadata") and isinstance(val, (dict, list)):
                val = json.dumps(val)
            cols.append(f"{key} = ?")
            vals.append(val)
        vals.append(task_id)
        self._conn.execute(f"UPDATE tasks SET {', '.join(cols)} WHERE id = ?", vals)
        self._conn.commit()
        return self.get_task(task_id)

    def add_task_event(self, task_id: str, type_: str, payload: Any = None) -> None:
        self._conn.execute(
            "INSERT INTO task_events (task_id, ts, type, payload) VALUES (?, ?, ?, ?)",
            (task_id, time.time(), type_, json.dumps(payload) if payload is not None else None),
        )
        self._conn.commit()

    def list_tasks(self, status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        if status:
            cur = self._conn.execute(
                "SELECT * FROM tasks WHERE status = ? ORDER BY created DESC LIMIT ?", (status, limit)
            )
        else:
            cur = self._conn.execute("SELECT * FROM tasks ORDER BY created DESC LIMIT ?", (limit,))
        return [_row_to_dict(r, ("validation", "usage", "metadata")) for r in cur.fetchall()]

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        task = _row_to_dict(row, ("validation", "usage", "metadata"))
        ev_cur = self._conn.execute(
            "SELECT * FROM task_events WHERE task_id = ? ORDER BY ts ASC", (task_id,)
        )
        task["events"] = [_row_to_dict(r, ("payload",)) for r in ev_cur.fetchall()]
        return task

    # ---------------- turns ----------------

    def add_turn(
        self,
        turn_id: str | None = None,
        *,
        transcript: str = "",
        reply: str = "",
        ms_stt: float | None = None,
        ms_first_token: float | None = None,
        ms_tts_first: float | None = None,
        ms_e2e: float | None = None,
        interrupted: bool = False,
    ) -> dict[str, Any]:
        """turn_id: caller-supplied id (the voice pipeline mints its own turn_id up front and
        publishes bus events under it well before the turn completes); auto-generated when
        omitted, as callers that don't need a pre-existing correlation id do in tests.
        """
        turn_id = turn_id or uuid.uuid4().hex
        self._conn.execute(
            "INSERT INTO turns (id, ts, transcript, reply, ms_stt, ms_first_token, ms_tts_first,"
            " ms_e2e, interrupted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                turn_id, time.time(), transcript, reply,
                ms_stt, ms_first_token, ms_tts_first, ms_e2e, int(interrupted),
            ),
        )
        self._conn.commit()
        row = self._conn.execute("SELECT * FROM turns WHERE id = ?", (turn_id,)).fetchone()
        return _row_to_dict(row)

    def add_turn_event(self, turn_id: str, type_: str, payload: Any = None) -> None:
        self._conn.execute(
            "INSERT INTO turn_events (turn_id, ts, type, payload) VALUES (?, ?, ?, ?)",
            (turn_id, time.time(), type_, json.dumps(payload) if payload is not None else None),
        )
        self._conn.commit()

    def recent_traces(self, limit: int = 20) -> list[dict[str, Any]]:
        """Recent turns with their full turn_events timeline, newest turn first."""
        cur = self._conn.execute("SELECT * FROM turns ORDER BY ts DESC LIMIT ?", (limit,))
        turns = [_row_to_dict(r) for r in cur.fetchall()]
        for turn in turns:
            ev_cur = self._conn.execute(
                "SELECT * FROM turn_events WHERE turn_id = ? ORDER BY ts ASC", (turn["id"],)
            )
            turn["events"] = [_row_to_dict(r, ("payload",)) for r in ev_cur.fetchall()]
        return turns
