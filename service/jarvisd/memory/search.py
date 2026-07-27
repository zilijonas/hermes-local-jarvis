"""Hybrid memory search: alias/entity boost + FTS5 BM25 + cosine embeddings,
folder priors, recency decay, note-level dedupe, contradiction flagging.
See docs/SPEC.md (§HTTP /memory/search) and docs/memory-design-inputs.md (§Design).
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

import numpy as np

from . import indexer

ALIAS_WEIGHT = 3.0
FTS_WEIGHT = 1.0
VEC_WEIGHT = 1.2

# Folder priors: lessons/decisions/runbooks/projects and the hermes-memory hot
# corpus rank up; postmortem noise (100% auto-generated per the audit doc) and
# the archive folder (superseded/duplicate content) rank down.
FOLDER_PRIORS: dict[str, float] = {
    "30-lessons": 0.15,
    "40-decisions": 0.15,
    "20-runbooks": 0.15,
    "10-projects": 0.15,
    "60-system-state": 0.10,
    "hermes-memory": 0.20,
    "80-postmortems": -0.5,
    "90-archive": -0.3,
}

RECENCY_HALF_LIFE_DAYS = 90.0
RECENCY_MAX_BONUS = 0.1
CONFLICT_JACCARD_THRESHOLD = 0.6

_WORD_RE = re.compile(r"[a-z0-9]+")
_DATE_FORMATS = ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d")


def _tokens(q: str) -> list[str]:
    return _WORD_RE.findall(q.lower())


def _fts_query(tokens: list[str]) -> str:
    return " OR ".join(f"{t}*" for t in tokens if t)


def _parse_ts(s: str) -> Optional[float]:
    s = s.strip()
    for fmt in _DATE_FORMATS:
        try:
            return time.mktime(time.strptime(s, fmt))
        except ValueError:
            continue
    return None


def _recency_bonus(updated_val: Any, mtime: float) -> float:
    ts = _parse_ts(str(updated_val)) if updated_val else None
    if ts is None:
        ts = mtime
    age_days = max(0.0, (time.time() - ts) / 86400.0)
    decay = 2.0 ** (-age_days / RECENCY_HALF_LIFE_DAYS)
    bonus = (decay - 0.5) * (RECENCY_MAX_BONUS / 0.5)
    return max(-RECENCY_MAX_BONUS, min(RECENCY_MAX_BONUS, bonus))


def _snippet(text: str, tokens: list[str], limit: int = 300) -> str:
    low = text.lower()
    idx = -1
    for tok in tokens:
        i = low.find(tok)
        if i != -1:
            idx = i
            break
    if idx == -1:
        s = text[:limit]
    else:
        start = max(0, idx - limit // 2)
        s = text[start:start + limit]
    return s.strip()


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def search(q: str, k: int = 6,
           db_path: "str | Path | None" = None,
           conn: Optional[sqlite3.Connection] = None,
           ollama_url: Optional[str] = None,
           embed_model: Optional[str] = None) -> list[dict]:
    q = (q or "").strip()
    if not q or k <= 0:
        return []

    owns_conn = conn is None
    c = indexer.get_conn(db_path, conn)

    try:
        tokens = _tokens(q)
        q_norm = indexer.normalize_entity(q)
        note_scores: dict[int, dict[str, Any]] = {}

        def acc(note_id: int) -> dict[str, Any]:
            return note_scores.setdefault(note_id, {
                "alias": 0.0, "fts": 0.0, "vec": 0.0,
                "chunk_text": None, "chunk_signal": -1.0,
            })

        # (1) exact alias/entity hit boost
        if q_norm:
            for row in c.execute("SELECT DISTINCT entity, note_id FROM aliases"):
                entity = row["entity"]
                if entity and len(entity) >= 3 and entity in q_norm:
                    acc(row["note_id"])["alias"] = 1.0

        # (2) FTS5 BM25 (query sanitized to alnum tokens, prefix-matched, OR-joined
        # for recall — a strict AND across all tokens zeroes out on multi-word
        # queries where a note only contains some of the words)
        fts_q = _fts_query(tokens)
        if fts_q:
            try:
                rows = c.execute(
                    "SELECT chunks_fts.rowid AS cid, bm25(chunks_fts) AS rank "
                    "FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 100",
                    (fts_q,),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
            if rows:
                ranks = [r["rank"] for r in rows]
                lo, hi = min(ranks), max(ranks)
                span = (hi - lo) or 1.0
                chunk_ids = [r["cid"] for r in rows]
                placeholders = ",".join("?" for _ in chunk_ids)
                meta = {m["id"]: m for m in c.execute(
                    f"SELECT id, note_id, text FROM chunks WHERE id IN ({placeholders})",
                    chunk_ids,
                ).fetchall()}
                for r in rows:
                    m = meta.get(r["cid"])
                    if not m:
                        continue
                    norm_score = (hi - r["rank"]) / span  # lower bm25 = better match
                    a = acc(m["note_id"])
                    if norm_score > a["fts"]:
                        a["fts"] = norm_score
                    if norm_score > a["chunk_signal"]:
                        a["chunk_signal"] = norm_score
                        a["chunk_text"] = m["text"]

        # (3) cosine over embeddings of q — skip silently if Ollama/embeddings unavailable
        qvec = None
        try:
            qvec = indexer.embed_texts([q], ollama_url, embed_model)[0]
        except Exception:
            qvec = None
        if qvec is not None:
            emb_rows = c.execute(
                "SELECT e.chunk_id AS chunk_id, e.vec AS vec, ch.note_id AS note_id, "
                "ch.text AS text FROM embeddings e JOIN chunks ch ON ch.id = e.chunk_id"
            ).fetchall()
            if emb_rows:
                qarr = np.asarray(qvec, dtype=np.float32)
                qnorm = float(np.linalg.norm(qarr)) or 1.0
                for r in emb_rows:
                    vec = np.frombuffer(r["vec"], dtype=np.float32)
                    if vec.shape[0] != qarr.shape[0]:
                        continue
                    vnorm = float(np.linalg.norm(vec)) or 1.0
                    cos = max(0.0, float(np.dot(qarr, vec) / (qnorm * vnorm)))
                    a = acc(r["note_id"])
                    if cos > a["vec"]:
                        a["vec"] = cos
                    if cos > a["chunk_signal"]:
                        a["chunk_signal"] = cos
                        a["chunk_text"] = r["text"]

        if not note_scores:
            return []

        note_ids = list(note_scores.keys())
        placeholders = ",".join("?" for _ in note_ids)
        notes_meta = {n["id"]: n for n in c.execute(
            f"SELECT id, path, title, folder, frontmatter, mtime FROM notes "
            f"WHERE id IN ({placeholders})",
            note_ids,
        ).fetchall()}

        results = []
        for note_id, acc_scores in note_scores.items():
            meta = notes_meta.get(note_id)
            if not meta:
                continue
            try:
                fm = json.loads(meta["frontmatter"] or "{}")
            except (TypeError, ValueError):
                fm = {}
            folder = meta["folder"]
            score = (
                acc_scores["alias"] * ALIAS_WEIGHT
                + acc_scores["fts"] * FTS_WEIGHT
                + acc_scores["vec"] * VEC_WEIGHT
                + FOLDER_PRIORS.get(folder, 0.0)
                + _recency_bonus(fm.get("updated"), meta["mtime"])
            )
            updated_val = fm.get("updated")
            updated_val = str(updated_val) if updated_val is not None else \
                time.strftime("%Y-%m-%d", time.localtime(meta["mtime"]))
            results.append({
                "_note_id": note_id,
                "path": meta["path"],
                "title": meta["title"],
                "folder": folder,
                "snippet": _snippet(acc_scores["chunk_text"] or "", tokens),
                "score": round(score, 6),
                "confidence": fm.get("confidence"),
                "updated": updated_val,
                "conflict": False,
            })

        results.sort(key=lambda h: h["score"], reverse=True)
        top = results[:k]

        # contradiction flagging: >=2 notes among the returned top hits whose
        # title/alias entity-token sets overlap >= 0.6 jaccard
        tokset: dict[int, set] = {}
        for h in top:
            nid = h["_note_id"]
            toks = set(indexer.entity_tokens(h["title"]))
            for row in c.execute("SELECT entity FROM aliases WHERE note_id=?", (nid,)):
                toks |= indexer.entity_tokens(row["entity"])
            tokset[nid] = toks
        for i in range(len(top)):
            for j in range(i + 1, len(top)):
                if _jaccard(tokset[top[i]["_note_id"]], tokset[top[j]["_note_id"]]) \
                        >= CONFLICT_JACCARD_THRESHOLD:
                    top[i]["conflict"] = True
                    top[j]["conflict"] = True

        for h in top:
            h.pop("_note_id", None)
        return top
    finally:
        if owns_conn:
            c.close()
