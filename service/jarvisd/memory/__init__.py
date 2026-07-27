"""Obsidian vault + Hermes memory retrieval module for jarvisd.

See docs/memory-design-inputs.md (binding design + landmines) and docs/SPEC.md
(§HTTP /memory/search, §Meta-tools memory_recall, §DB) for the contract this
module implements.

Public surface:
    index(...) / reindex(...)  -- incremental (or full) index build -> stats dict.
    search(q, k=6, ...)        -- hybrid retrieval -> ranked hit dicts.
    build_card(q, hits, ...)   -- compact markdown context card for memory_recall.
    component_status(...)      -- {ok, detail} for GET /health's components.memory.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Optional

from .cards import build_card
from .indexer import index, reindex, resolve_db_path
from .search import search

__all__ = ["index", "reindex", "search", "build_card", "component_status"]


def component_status(db_path: "str | None" = None,
                      conn: Optional[sqlite3.Connection] = None) -> dict[str, Any]:
    """Health summary for GET /health: {ok, detail: "N notes, M chunks, embeddings X/Y"}."""
    owns = False
    try:
        if conn is not None:
            c = conn
        else:
            path = resolve_db_path(db_path)
            if not path.exists():
                return {"ok": False, "detail": "not indexed"}
            c = sqlite3.connect(str(path))
            owns = True
        try:
            tables = {r[0] for r in c.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if not {"notes", "chunks"} <= tables:
                return {"ok": False, "detail": "not indexed"}
            n_notes = c.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
            n_chunks = c.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            n_emb = c.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0] \
                if "embeddings" in tables else 0
            return {"ok": True,
                    "detail": f"{n_notes} notes, {n_chunks} chunks, embeddings {n_emb}/{n_chunks}"}
        finally:
            if owns:
                c.close()
    except sqlite3.Error as exc:
        return {"ok": False, "detail": f"db error: {exc}"}
