"""Tests for jarvisd.memory (indexer.py, search.py, cards.py, __init__.py).

Everything runs against a tmp vault + tmp sqlite path — nothing here touches the
real ~/ai/memory/obsidian-vault or ~/.hermes/profiles/jarvis-voice/jarvis.db.
Only one test (marked skipif Ollama is unreachable) makes a real network call.
"""
from __future__ import annotations

import socket
import time
from pathlib import Path

import pytest

import jarvisd.memory as jm
from jarvisd.memory import indexer as indexer_mod
# NB: no separate `search` submodule alias here. jarvisd/memory/__init__.py does
# `from .search import search`, which rebinds the *package attribute*
# `jarvisd.memory.search` to the function (shadowing the submodule for both
# `from jarvisd.memory import search` and `import jarvisd.memory.search as x` --
# both resolve via attribute access, not sys.modules). `jm.search` below is that
# exact same function object, so there is nothing to gain from a second alias.


# --------------------------------------------------------------------------
# synthetic vault fixture
# --------------------------------------------------------------------------

_ROOT_ONLY_FILES = {
    "MAP.md": "# Vault map\n\nAuto-generated index. Should never be indexed.\n",
    "README.md": "# Vault README\n\nRoot readme. Should never be indexed.\n",
    "sharing.md": "# Sharing\n\nCouchDB LiveSync notes. Should never be indexed.\n",
}

_NOTES = {
    "60-system-state/model-and-provider-state.md": """---
title: "Model and Provider State"
type: system-state
updated: 2026-07-25
confidence: high
---

# Model and Provider State

The current mediator model is WidgetFrobnicator v9, chosen for fast cold starts on the
Mac mini. WidgetFrobnicator replaced the previous GizmoTron model in June.

Embeddings use nomic-embed-text via Ollama, unrelated to WidgetFrobnicator itself.
""",
    "60-system-state/README.md": """# System state folder

Folder-level README with real content (NOT the excluded root README.md). See
model-and-provider-state.md for the live WidgetFrobnicator entry.
""",
    "90-archive/model-and-provider-state.md": """---
title: "Model and Provider State"
type: system-state
status: superseded
updated: 2026-05-01
confidence: medium
---

# Model and Provider State (superseded)

Historical note: the mediator model used to be WidgetFrobnicator v7 before the v9
upgrade. This page is kept for archive purposes only.
""",
    "80-postmortems/auto-2026-07-10-diagnostics.md": """---
title: "Auto-diagnostics 2026-07-10"
type: postmortem
source: self-improve.sh
updated: 2026-07-10
confidence: medium
---

# Auto-diagnostics 2026-07-10

Self-improvement detected a failure related to WidgetFrobnicator timing out during
cold start. Traceback logged below (redacted).
""",
    "30-lessons/lesson-widget-frobnicator-20260715.md": """---
title: "WidgetFrobnicator startup lesson"
type: lesson
created: 2026-07-15
updated: 2026-07-15
tags: [lesson, widgetfrobnicator]
aliases: ["Frobnicator Lesson", "WF startup"]
confidence: medium
---

# WidgetFrobnicator startup lesson

Always warm the WidgetFrobnicator model before the first user turn to avoid a slow
first response. Cold start adds roughly six seconds.
""",
    "00-inbox/broken-frontmatter.md": """---
title: "Broken note
tags: [unterminated
---

# Fallback Heading Note

This note has deliberately malformed frontmatter (unterminated quote/list) to test
tolerant parsing. It should still index using the heading as its title.
""",
    "20-runbooks/runbook-plain.md": """# Runbook: Restart the Frobnicator Service

If the WidgetFrobnicator mediator becomes unresponsive, restart the LaunchAgent and
check logs for stale sockets before re-launching.
""",
}

TOTAL_REAL_NOTES = len(_NOTES)  # 7 (includes the folder-scoped README.md)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _build_vault(root: Path) -> Path:
    vault = root / "obsidian-vault"
    for name, content in _ROOT_ONLY_FILES.items():
        _write(vault / name, content)
    for rel, content in _NOTES.items():
        _write(vault / rel, content)
    # .obsidian/ noise — must never be indexed
    _write(vault / ".obsidian" / "workspace.json", "{}")
    _write(vault / ".obsidian" / "stray-plugin-note.md", "# Should be excluded\n")
    return vault


def _reindex(vault_path: Path, db_path: Path, **kw):
    """jm.reindex(), but hermetic by default: the real ~/.hermes/memories and
    ~/.hermes/profiles/jarvis-voice/memories must never leak into a tmp-vault
    test's counts. Tests that specifically exercise hermes-memory indexing
    (test_hermes_memory_files_indexed) pass their own tmp paths explicitly.
    """
    kw.setdefault("hermes_memories_path", vault_path.parent / "_no_hermes_memories")
    kw.setdefault("profile_memories_path", vault_path.parent / "_no_profile_memories")
    return jm.reindex(vault_path=vault_path, db_path=db_path, **kw)


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    return _build_vault(tmp_path)


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "jarvis.db"


@pytest.fixture
def indexed(vault: Path, db_path: Path):
    """A vault reindexed once, without embeddings (fast, deterministic)."""
    stats = _reindex(vault, db_path, embed=False)
    return vault, db_path, stats


# --------------------------------------------------------------------------
# indexer
# --------------------------------------------------------------------------

def test_initial_index_counts(indexed):
    _, _, stats = indexed
    assert stats["notes_scanned"] == TOTAL_REAL_NOTES
    assert stats["notes_added"] == TOTAL_REAL_NOTES
    assert stats["notes_updated"] == 0
    assert stats["notes_deleted"] == 0
    assert stats["chunks_added"] > 0
    assert stats["errors"] == []


def test_root_only_files_and_obsidian_dir_excluded(indexed, db_path):
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    paths = [r[0] for r in conn.execute("SELECT path FROM notes").fetchall()]
    conn.close()
    names = {Path(p).name for p in paths}
    assert "MAP.md" not in names
    assert "sharing.md" not in names
    assert not any("stray-plugin-note" in p for p in paths)
    assert not any(".obsidian" in p for p in paths)
    # but the folder-scoped README.md (real content) IS indexed
    assert any(p.endswith("60-system-state/README.md") for p in paths)


def test_incremental_gate_second_run_zero_changed(vault, db_path):
    first = _reindex(vault, db_path, embed=False)
    assert first["notes_added"] == TOTAL_REAL_NOTES

    second = _reindex(vault, db_path, embed=False)
    assert second["notes_added"] == 0
    assert second["notes_updated"] == 0
    assert second["notes_touched"] == 0
    assert second["notes_unchanged"] == TOTAL_REAL_NOTES
    assert second["chunks_added"] == 0


def test_incremental_gate_touch_without_edit_is_not_an_update(vault, db_path):
    _reindex(vault, db_path, embed=False)
    target = vault / "20-runbooks/runbook-plain.md"
    new_mtime = time.time() + 5
    import os
    os.utime(target, (new_mtime, new_mtime))

    stats = _reindex(vault, db_path, embed=False)
    assert stats["notes_touched"] == 1
    assert stats["notes_updated"] == 0
    assert stats["notes_added"] == 0


def test_broken_frontmatter_falls_back_tolerantly(indexed, db_path):
    import sqlite3, json
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT title, frontmatter FROM notes WHERE path LIKE ?",
        ("%broken-frontmatter.md",),
    ).fetchone()
    conn.close()
    assert row is not None
    assert json.loads(row["frontmatter"]) == {}
    assert row["title"] == "Fallback Heading Note"  # derived from first heading


def test_deletion_purges_note(vault, db_path):
    _reindex(vault, db_path, embed=False)
    target = vault / "20-runbooks/runbook-plain.md"
    target.unlink()

    stats = _reindex(vault, db_path, embed=False)
    assert stats["notes_deleted"] == 1

    import sqlite3
    conn = sqlite3.connect(str(db_path))
    n = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE path LIKE ?", ("%runbook-plain.md",)
    ).fetchone()[0]
    conn.close()
    assert n == 0


def test_full_reindex_rebuilds_from_scratch(vault, db_path):
    _reindex(vault, db_path, embed=False)
    stats = _reindex(vault, db_path, embed=False, full=True)
    assert stats["notes_added"] == TOTAL_REAL_NOTES


def test_hermes_memory_files_indexed(tmp_path, db_path):
    vault = _build_vault(tmp_path)
    hermes_memories = tmp_path / "hermes-memories"
    _write(hermes_memories / "MEMORY.md",
           "fact one about the frobnicator rollout\n§\nfact two, unrelated\n§\nfact three\n")
    stats = jm.reindex(vault_path=vault, db_path=db_path,
                        hermes_memories_path=hermes_memories,
                        profile_memories_path=tmp_path / "no-such-profile-dir",
                        embed=False)
    assert stats["errors"] == []

    import sqlite3
    conn = sqlite3.connect(str(db_path))
    row = conn.execute(
        "SELECT folder, title FROM notes WHERE path LIKE ?", ("%MEMORY.md",)
    ).fetchone()
    n_chunks = conn.execute(
        "SELECT COUNT(*) FROM chunks c JOIN notes n ON n.id=c.note_id WHERE n.path LIKE ?",
        ("%MEMORY.md",),
    ).fetchone()[0]
    conn.close()
    assert row is not None
    assert row[0] == "hermes-memory"
    assert n_chunks == 3  # one per section split on the '§' separator


# --------------------------------------------------------------------------
# search
# --------------------------------------------------------------------------

def test_fts_hit(indexed):
    _, db_path, _ = indexed
    hits = jm.search("stale sockets restart LaunchAgent", k=5, db_path=db_path)
    assert hits
    assert hits[0]["path"].endswith("runbook-plain.md")
    assert hits[0]["snippet"]
    assert len(hits[0]["snippet"]) <= 300


def test_folder_prior_beats_archive_dup(indexed):
    _, db_path, _ = indexed
    hits = jm.search("WidgetFrobnicator model", k=10, db_path=db_path)
    paths = [h["path"] for h in hits]
    live_idx = next(i for i, p in enumerate(paths) if "60-system-state" in p)
    archive_idx = next(i for i, p in enumerate(paths) if "90-archive" in p)
    assert live_idx < archive_idx

    live_hit = hits[live_idx]
    archive_hit = hits[archive_idx]
    assert live_hit["confidence"] == "high"
    # same title (duplicate across system-state/archive) -> contradiction flag
    assert live_hit["conflict"] is True
    assert archive_hit["conflict"] is True


def test_postmortem_downranked(indexed):
    _, db_path, _ = indexed
    hits = jm.search("WidgetFrobnicator model", k=10, db_path=db_path)
    paths = [h["path"] for h in hits]
    live_idx = next(i for i, p in enumerate(paths) if "60-system-state" in p)
    postmortem_idx = next((i for i, p in enumerate(paths) if "80-postmortems" in p), None)
    assert postmortem_idx is not None
    assert live_idx < postmortem_idx
    assert hits[postmortem_idx]["score"] < hits[live_idx]["score"]


def test_alias_hit_boost(indexed):
    _, db_path, _ = indexed
    hits = jm.search("WF startup", k=5, db_path=db_path)
    assert hits
    assert hits[0]["path"].endswith("lesson-widget-frobnicator-20260715.md")


def test_missing_ollama_still_returns_fts_results(indexed, monkeypatch):
    _, db_path, _ = indexed

    def _raise(*_args, **_kwargs):
        raise ConnectionError("ollama unreachable")

    monkeypatch.setattr(indexer_mod, "embed_texts", _raise)
    hits = jm.search("frobnicator", k=5, db_path=db_path)
    assert hits
    assert all("score" in h and "path" in h for h in hits)


def test_search_empty_query_returns_empty(indexed):
    _, db_path, _ = indexed
    assert jm.search("", k=5, db_path=db_path) == []


# --------------------------------------------------------------------------
# cards
# --------------------------------------------------------------------------

def test_card_header_and_shape(indexed):
    _, db_path, _ = indexed
    hits = jm.search("WidgetFrobnicator", k=5, db_path=db_path)
    card = jm.build_card("WidgetFrobnicator", hits, budget_tokens=600)
    assert card.startswith(f"MEMORY ({len(hits)} sources)")
    for hit in hits:
        if hit["conflict"]:
            assert "⚠ conflicting:" in card


def test_card_respects_small_budget(indexed):
    _, db_path, _ = indexed
    hits = jm.search("WidgetFrobnicator", k=5, db_path=db_path)
    assert len(hits) >= 2  # otherwise this test can't show truncation

    small_budget = 20  # ~80 chars -- header + maybe one short line at most
    card = jm.build_card("WidgetFrobnicator", hits, budget_tokens=small_budget)
    assert len(card) <= small_budget * 4 + len(f"MEMORY ({len(hits)} sources)") + 1
    # a full, generous budget should include strictly more content
    big_card = jm.build_card("WidgetFrobnicator", hits, budget_tokens=4000)
    assert len(big_card) > len(card)


def test_build_card_empty_hits():
    card = jm.build_card("anything", [], budget_tokens=600)
    assert card == "MEMORY (0 sources)"


# --------------------------------------------------------------------------
# component_status
# --------------------------------------------------------------------------

def test_component_status_not_indexed(tmp_path):
    status = jm.component_status(db_path=str(tmp_path / "nope.db"))
    assert status["ok"] is False


def test_component_status_after_index(indexed):
    _, db_path, _ = indexed
    status = jm.component_status(db_path=str(db_path))
    assert status["ok"] is True
    assert "notes" in status["detail"]
    assert "chunks" in status["detail"]
    assert "embeddings" in status["detail"]


# --------------------------------------------------------------------------
# real-Ollama integration (only runs if Ollama is actually reachable)
# --------------------------------------------------------------------------

def _ollama_reachable(host: str = "127.0.0.1", port: int = 11434, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


OLLAMA_UP = _ollama_reachable()


@pytest.mark.skipif(not OLLAMA_UP, reason="Ollama not reachable on 127.0.0.1:11434")
def test_real_ollama_embeddings_integration(vault, db_path):
    stats = _reindex(vault, db_path, embed=True)
    assert stats["ollama_available"] is True
    assert stats["embeddings_pending"] == 0
    assert stats["embeddings_added"] > 0

    hits = jm.search("frobnicator cold start latency", k=5, db_path=db_path)
    assert hits
