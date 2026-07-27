"""Incremental indexer for the Obsidian vault + Hermes memory files.

Builds/maintains the SQLite tables `notes`, `chunks`, `chunks_fts` (FTS5, external
content), `embeddings`, `aliases` inside the shared `jarvis.db` (docs/SPEC.md §DB,
docs/memory-design-inputs.md §Design). Incremental by (mtime, sha256) gate; a
full rebuild is `< 10s` for the real vault per the design doc's own measurement.

Sources indexed on every `reindex()` call:
  1. the Obsidian vault (`vault_path`, default `~/ai/memory/obsidian-vault`) —
     `*.md`, excluding `.obsidian/` and the root-only `MAP.md`/`README.md`/`sharing.md`.
     Folder-scoped `README.md` files (e.g. `60-system-state/README.md`) ARE real
     content and are indexed.
  2. the global Hermes memory store: `~/.hermes/memories/MEMORY.md` + `USER.md`
     (present, `§`-separated sections; each file is one `note`, chunked by section).
  3. the jarvis-voice profile's own memories dir, if present (same `§` chunking).
     Both (2) and (3) are stored with `folder="hermes-memory"`.

Ollama down: chunks are inserted without embeddings (left "pending" — no explicit
flag needed, a chunk with no `embeddings` row IS pending) and backfilled on the
next call once Ollama is back, in addition to any embeddings for newly (re)chunked
notes in that same call.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

import httpx
import numpy as np
import yaml

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT UNIQUE NOT NULL,
    mtime        REAL NOT NULL,
    title        TEXT NOT NULL,
    folder       TEXT NOT NULL,
    frontmatter  TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    ord     INTEGER NOT NULL,
    text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(note_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text, content='chunks', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS embeddings (
    chunk_id INTEGER PRIMARY KEY,
    vec      BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases (
    entity  TEXT NOT NULL,
    note_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aliases_entity ON aliases(entity);
CREATE INDEX IF NOT EXISTS idx_aliases_note ON aliases(note_id);
"""

_ROOT_EXCLUDE = {"MAP.md", "README.md", "sharing.md"}
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?\n)---\s*\n?", re.DOTALL)
_HEADING_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
_WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)")
_PUNCT_RE = re.compile(r"[^a-z0-9\s]")
_STOPWORDS = {"the", "and", "of", "a", "to", "in", "for", "on", "with", "is",
              "at", "an", "as", "by", "from"}

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_EMBED_MODEL = "nomic-embed-text"
DEFAULT_PROFILE = "jarvis-voice"


# --------------------------------------------------------------------------
# config resolution — jarvisd.config if importable, else literal fallbacks
# --------------------------------------------------------------------------

def _load_jarvisd_config() -> Any:
    try:
        from jarvisd.config import load_config
        return load_config()
    except Exception:
        return None


def resolve_vault_path(vault_path: "str | Path | None" = None) -> Path:
    if vault_path:
        return Path(vault_path).expanduser()
    cfg = _load_jarvisd_config()
    if cfg is not None:
        try:
            return cfg.path_for("vault")
        except Exception:
            pass
    return Path("~/ai/memory/obsidian-vault").expanduser()


def resolve_db_path(db_path: "str | Path | None" = None) -> Path:
    if db_path:
        return Path(db_path).expanduser()
    cfg = _load_jarvisd_config()
    if cfg is not None:
        try:
            return cfg.path_for("hermes_home") / "jarvis.db"
        except Exception:
            pass
    return Path("~/.hermes/profiles/jarvis-voice/jarvis.db").expanduser()


def default_hermes_memories_path() -> Path:
    """Global Hermes memory store — independent of the jarvis-voice profile."""
    return Path("~/.hermes/memories").expanduser()


def default_profile_memories_path(profile: str = DEFAULT_PROFILE) -> Path:
    cfg = _load_jarvisd_config()
    if cfg is not None:
        try:
            return cfg.path_for("hermes_home") / "memories"
        except Exception:
            pass
    return Path(f"~/.hermes/profiles/{profile}/memories").expanduser()


def resolve_ollama(ollama_url: Optional[str] = None,
                    embed_model: Optional[str] = None) -> tuple[str, str]:
    cfg = _load_jarvisd_config()
    url, model = ollama_url, embed_model
    if cfg is not None:
        try:
            url = url or cfg.data["ollama"]["url"]
            model = model or cfg.data["ollama"]["embed"]
        except Exception:
            pass
    return (url or DEFAULT_OLLAMA_URL, model or DEFAULT_EMBED_MODEL)


# --------------------------------------------------------------------------
# db connection / schema
# --------------------------------------------------------------------------

def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)
    conn.commit()


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def get_conn(db_path: "str | Path | None" = None,
             conn: Optional[sqlite3.Connection] = None) -> sqlite3.Connection:
    """Return a ready (schema-ensured) connection. Reuses `conn` if given — this
    lets jarvisd's app wiring share ONE sqlite connection across modules for the
    same jarvis.db file (see service/jarvisd/db.py's docstring) instead of opening
    a second writer against the same WAL file.
    """
    if conn is not None:
        ensure_schema(conn)
        return conn
    c = _connect(resolve_db_path(db_path))
    ensure_schema(c)
    return c


# --------------------------------------------------------------------------
# parsing helpers
# --------------------------------------------------------------------------

def split_frontmatter(raw: str) -> tuple[dict, str]:
    """Tolerant YAML frontmatter split. Missing or broken frontmatter -> ({}, raw)."""
    m = _FRONTMATTER_RE.match(raw)
    if not m:
        return {}, raw
    body = raw[m.end():]
    try:
        data = yaml.safe_load(m.group(1))
    except Exception:
        return {}, body
    if not isinstance(data, dict):
        return {}, body
    return data, body


def derive_title(frontmatter: dict, body: str, path: Path) -> str:
    title = frontmatter.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    m = _HEADING_RE.search(body)
    if m:
        return m.group(1).strip()
    return path.stem


def extract_wikilinks(text: str) -> set[str]:
    return {m.group(1).strip() for m in _WIKILINK_RE.finditer(text) if m.group(1).strip()}


def normalize_entity(s: str) -> str:
    s = (s or "").lower().strip()
    s = _PUNCT_RE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def entity_tokens(s: str) -> set[str]:
    norm = normalize_entity(s)
    return {t for t in norm.split(" ") if t and len(t) > 2 and t not in _STOPWORDS}


def chunk_paragraphs(text: str, target: int = 800, min_len: int = 200) -> list[str]:
    """Greedy paragraph-boundary chunking: accumulate paragraphs until the chunk
    is at least `min_len` chars AND the next paragraph would push it past `target`.
    """
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paras:
        return []
    chunks: list[str] = []
    cur = ""
    for p in paras:
        candidate = f"{cur}\n\n{p}" if cur else p
        if cur and len(cur) >= min_len and len(candidate) > target:
            chunks.append(cur)
            cur = p
        else:
            cur = candidate
    if cur:
        chunks.append(cur)
    return chunks


def chunk_hermes_memory(text: str) -> list[str]:
    """MEMORY.md / USER.md (and profile memory files) use bare `§`-separated
    sections rather than blank-line paragraphs. Oversized sections still get
    sub-chunked by the same paragraph rule so no single chunk balloons.
    """
    sections = [s.strip() for s in text.split("§") if s.strip()]
    if not sections:
        return chunk_paragraphs(text)
    out: list[str] = []
    for sec in sections:
        if len(sec) > 800:
            out.extend(chunk_paragraphs(sec))
        else:
            out.append(sec)
    return out


# --------------------------------------------------------------------------
# embeddings
# --------------------------------------------------------------------------

def embed_texts(texts: list[str], base_url: Optional[str] = None,
                 model: Optional[str] = None, timeout: float = 10.0) -> list[list[float]]:
    """POST /api/embed, batched by the caller (<=16 texts/call per design doc).
    Raises on any failure (connection, HTTP status, malformed response) — callers
    decide whether that means "skip silently" (search) or "leave pending" (index).
    """
    url, mdl = resolve_ollama(base_url, model)
    resp = httpx.post(f"{url.rstrip('/')}/api/embed",
                       json={"model": mdl, "input": texts}, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    vecs = data.get("embeddings")
    if not vecs or len(vecs) != len(texts):
        raise RuntimeError(f"unexpected /api/embed response shape for {len(texts)} inputs")
    return vecs


def _batched(seq: list, n: int) -> Iterator[list]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# --------------------------------------------------------------------------
# note purge / index-one-file
# --------------------------------------------------------------------------

def _purge_note_children(conn: sqlite3.Connection, note_id: int) -> int:
    chunk_ids = [r[0] for r in conn.execute(
        "SELECT id FROM chunks WHERE note_id=?", (note_id,)).fetchall()]
    for cid in chunk_ids:
        conn.execute("DELETE FROM embeddings WHERE chunk_id=?", (cid,))
        conn.execute("DELETE FROM chunks WHERE id=?", (cid,))
    conn.execute("DELETE FROM aliases WHERE note_id=?", (note_id,))
    return len(chunk_ids)


def _purge_note(conn: sqlite3.Connection, note_id: int) -> int:
    n = _purge_note_children(conn, note_id)
    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    return n


def _clear_all(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM aliases")
    conn.execute("DELETE FROM embeddings")
    conn.execute("DELETE FROM chunks")
    conn.execute("DELETE FROM notes")
    conn.commit()


def _index_file(conn: sqlite3.Connection, path: Path, folder: str, chunker,
                 stats: dict, title_override: Optional[str] = None) -> None:
    stats["notes_scanned"] += 1
    try:
        mtime = path.stat().st_mtime
    except OSError as exc:
        stats["errors"].append(f"stat failed for {path}: {exc}")
        return

    rp = str(path.resolve())
    row = conn.execute(
        "SELECT id, mtime, content_hash FROM notes WHERE path=?", (rp,)).fetchone()
    if row is not None and row["mtime"] == mtime:
        stats["notes_unchanged"] += 1
        return

    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        stats["errors"].append(f"read failed for {path}: {exc}")
        return

    content_hash = hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()
    if row is not None and row["content_hash"] == content_hash:
        conn.execute("UPDATE notes SET mtime=? WHERE id=?", (mtime, row["id"]))
        stats["notes_touched"] += 1
        return

    frontmatter, body = split_frontmatter(raw)
    title = title_override or derive_title(frontmatter, body, path)
    fm_json = json.dumps(frontmatter, default=str, ensure_ascii=False)

    if row is not None:
        note_id = row["id"]
        conn.execute(
            "UPDATE notes SET mtime=?, title=?, folder=?, frontmatter=?, content_hash=? "
            "WHERE id=?",
            (mtime, title, folder, fm_json, content_hash, note_id),
        )
        stats["chunks_removed"] += _purge_note_children(conn, note_id)
        stats["notes_updated"] += 1
    else:
        cur = conn.execute(
            "INSERT INTO notes(path, mtime, title, folder, frontmatter, content_hash) "
            "VALUES (?,?,?,?,?,?)",
            (rp, mtime, title, folder, fm_json, content_hash),
        )
        note_id = cur.lastrowid
        stats["notes_added"] += 1

    chunk_texts = chunker(body) or [title]
    for ordv, text in enumerate(chunk_texts):
        conn.execute("INSERT INTO chunks(note_id, ord, text) VALUES (?,?,?)",
                     (note_id, ordv, text))
        stats["chunks_added"] += 1

    entities = {normalize_entity(title)}
    aliases_fm = frontmatter.get("aliases")
    if isinstance(aliases_fm, (list, tuple)):
        entities.update(normalize_entity(str(a)) for a in aliases_fm)
    elif isinstance(aliases_fm, str):
        entities.add(normalize_entity(aliases_fm))
    entities.update(normalize_entity(wl) for wl in extract_wikilinks(body))
    entities.discard("")
    for e in entities:
        conn.execute("INSERT INTO aliases(entity, note_id) VALUES (?, ?)", (e, note_id))


def _iter_vault_files(vault_path: Path) -> Iterable[Path]:
    if not vault_path.is_dir():
        return
    for p in sorted(vault_path.rglob("*.md")):
        rel = p.relative_to(vault_path)
        if ".obsidian" in rel.parts:
            continue
        if len(rel.parts) == 1 and rel.name in _ROOT_EXCLUDE:
            continue
        yield p


def _new_stats() -> dict:
    return {
        "notes_scanned": 0,
        "notes_added": 0,
        "notes_updated": 0,
        "notes_touched": 0,
        "notes_unchanged": 0,
        "notes_deleted": 0,
        "chunks_added": 0,
        "chunks_removed": 0,
        "embeddings_added": 0,
        "embeddings_pending": 0,
        "ollama_available": None,
        "errors": [],
        "duration_s": 0.0,
    }


# --------------------------------------------------------------------------
# public entry point
# --------------------------------------------------------------------------

def reindex(vault_path: "str | Path | None" = None,
            db_path: "str | Path | None" = None,
            conn: Optional[sqlite3.Connection] = None,
            hermes_memories_path: "str | Path | None" = None,
            profile_memories_path: "str | Path | None" = None,
            profile: str = DEFAULT_PROFILE,
            ollama_url: Optional[str] = None,
            embed_model: Optional[str] = None,
            full: bool = False,
            embed: bool = True) -> dict:
    """Incremental (or, with full=True, from-scratch) index build. Returns a stats dict.

    NEVER writes to the vault itself — only to the sqlite index.
    """
    t0 = time.time()
    vault_path = resolve_vault_path(vault_path)
    hp = Path(hermes_memories_path).expanduser() if hermes_memories_path \
        else default_hermes_memories_path()
    pp = Path(profile_memories_path).expanduser() if profile_memories_path \
        else default_profile_memories_path(profile)

    owns_conn = conn is None
    c = get_conn(db_path, conn)
    stats = _new_stats()

    if full:
        _clear_all(c)

    seen: set[str] = set()

    for p in _iter_vault_files(vault_path):
        rel = p.relative_to(vault_path)
        folder = rel.parts[0] if len(rel.parts) > 1 else "root"
        seen.add(str(p.resolve()))
        _index_file(c, p, folder, chunk_paragraphs, stats)

    for name in ("MEMORY.md", "USER.md"):
        p = hp / name
        if p.is_file():
            seen.add(str(p.resolve()))
            _index_file(c, p, "hermes-memory", chunk_hermes_memory, stats,
                        title_override=f"hermes-memory: {p.stem}")

    if pp.is_dir():
        for p in sorted(pp.glob("*.md")):
            seen.add(str(p.resolve()))
            _index_file(c, p, "hermes-memory", chunk_hermes_memory, stats,
                        title_override=f"hermes-memory: {profile}/{p.stem}")

    for row in c.execute("SELECT id, path FROM notes").fetchall():
        if row["path"] not in seen:
            stats["chunks_removed"] += _purge_note(c, row["id"])
            stats["notes_deleted"] += 1

    if embed:
        pending = c.execute(
            "SELECT ch.id AS id, ch.text AS text FROM chunks ch "
            "LEFT JOIN embeddings e ON e.chunk_id = ch.id WHERE e.chunk_id IS NULL"
        ).fetchall()
        if pending:
            try:
                for batch in _batched(pending, 16):
                    vecs = embed_texts([r["text"] for r in batch], ollama_url, embed_model)
                    for r, vec in zip(batch, vecs):
                        blob = np.asarray(vec, dtype=np.float32).tobytes()
                        c.execute(
                            "INSERT OR REPLACE INTO embeddings(chunk_id, vec) VALUES (?, ?)",
                            (r["id"], blob),
                        )
                        stats["embeddings_added"] += 1
                stats["ollama_available"] = True
            except Exception as exc:
                stats["ollama_available"] = False
                stats["errors"].append(f"embedding backfill failed: {exc}")
        else:
            stats["ollama_available"] = True

    c.commit()
    stats["embeddings_pending"] = c.execute(
        "SELECT COUNT(*) FROM chunks ch LEFT JOIN embeddings e ON e.chunk_id=ch.id "
        "WHERE e.chunk_id IS NULL"
    ).fetchone()[0]
    stats["duration_s"] = round(time.time() - t0, 4)

    if owns_conn:
        c.close()
    return stats


# `index` is the same operation under the name used by the SPEC's component list;
# kept as a plain alias rather than a duplicate implementation.
index = reindex
