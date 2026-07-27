"""Capability routing: map a spoken request to a capability entry.

Matching layers, cheapest first:
  1. exact id or name hit
  2. lexical keyword score (token overlap, phrase bonus)
  3. embedding cosine via Ollama nomic-embed-text (lazy, cached per manifest hash)
  4. historical success-rate nudge from the capabilities table

The router never invents toolsets: workers get exactly the manifest's `toolsets`
for the chosen capability (1-2 sets ≈ 3-12 tools), which is the small-model diet
the 2026-07-27 tool audit demands.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import struct
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import yaml

_MANIFEST_PATH = Path(__file__).parent / "manifest.yaml"
_WORD_RE = re.compile(r"[a-z0-9']+")


def _tokens(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


class CapabilityRouter:
    def __init__(self, ollama_url: str = "http://127.0.0.1:11434",
                 embed_model: str = "nomic-embed-text",
                 db_conn: Optional[sqlite3.Connection] = None,
                 manifest_path: Path = _MANIFEST_PATH):
        self.ollama_url = ollama_url.rstrip("/")
        self.embed_model = embed_model
        self.db = db_conn
        self.manifest_path = manifest_path
        self.caps: list[dict[str, Any]] = []
        self._embeds: dict[str, list[float]] = {}
        self._manifest_hash = ""
        self.reload()

    def reload(self) -> None:
        raw = self.manifest_path.read_text()
        self.caps = yaml.safe_load(raw) or []
        self._manifest_hash = hashlib.sha256(raw.encode()).hexdigest()[:12]
        self._embeds = {}
        if self.db is not None:
            self._sync_db()

    # -- persistence of success stats ------------------------------------
    def _sync_db(self) -> None:
        cur = self.db.cursor()
        for c in self.caps:
            cur.execute(
                "INSERT INTO capabilities (id, kind, name, desc, keywords, toolsets, success, failures, last_used) "
                "VALUES (?,?,?,?,?,?,0,0,NULL) "
                "ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, "
                "keywords=excluded.keywords, toolsets=excluded.toolsets",
                (c["id"], c["kind"], c["name"], c.get("desc", ""),
                 json.dumps(c.get("keywords", [])), json.dumps(c.get("toolsets", []))),
            )
        self.db.commit()

    def record_outcome(self, cap_id: str, ok: bool) -> None:
        if self.db is None:
            return
        col = "success" if ok else "failures"
        self.db.execute(
            f"UPDATE capabilities SET {col} = {col} + 1, last_used = ? WHERE id = ?",
            (time.time(), cap_id),
        )
        self.db.commit()

    def _success_nudge(self, cap_id: str) -> float:
        if self.db is None:
            return 0.0
        row = self.db.execute(
            "SELECT success, failures FROM capabilities WHERE id = ?", (cap_id,)
        ).fetchone()
        if not row:
            return 0.0
        s, f = row[0] or 0, row[1] or 0
        if s + f < 3:
            return 0.0
        return 0.15 * (s - f) / (s + f)

    # -- embeddings --------------------------------------------------------
    def _embed(self, texts: list[str]) -> Optional[list[list[float]]]:
        try:
            r = httpx.post(f"{self.ollama_url}/api/embed",
                           json={"model": self.embed_model, "input": texts}, timeout=5.0)
            r.raise_for_status()
            return r.json()["embeddings"]
        except Exception:
            return None

    def _cap_embeds(self) -> dict[str, list[float]]:
        if self._embeds:
            return self._embeds
        texts = [f'{c["name"]}. {" ".join(c.get("keywords", []))}' for c in self.caps]
        vecs = self._embed(texts)
        if vecs:
            self._embeds = {c["id"]: v for c, v in zip(self.caps, vecs)}
        return self._embeds

    @staticmethod
    def _cos(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = sum(x * x for x in a) ** 0.5
        nb = sum(y * y for y in b) ** 0.5
        return dot / (na * nb) if na and nb else 0.0

    # -- search ------------------------------------------------------------
    def search(self, query: str, k: int = 4) -> list[dict[str, Any]]:
        q_tokens = set(_tokens(query))
        q_lower = query.lower()
        scored: list[tuple[float, dict]] = []

        q_vec = None
        cap_vecs = self._cap_embeds()
        if cap_vecs:
            got = self._embed([query])
            q_vec = got[0] if got else None

        for c in self.caps:
            score = 0.0
            if c["id"] == q_lower or c["name"] == q_lower:
                score += 3.0
            kw_tokens: set[str] = set()
            for kw in c.get("keywords", []):
                kw_l = kw.lower()
                if kw_l in q_lower:          # phrase hit
                    score += 0.8
                kw_tokens |= set(_tokens(kw_l))
            if q_tokens and kw_tokens:
                score += 1.2 * len(q_tokens & kw_tokens) / max(3, len(kw_tokens))
            if q_vec and c["id"] in cap_vecs:
                score += 1.0 * max(0.0, self._cos(q_vec, cap_vecs[c["id"]]) - 0.4)
            score += self._success_nudge(c["id"])
            scored.append((score, c))

        scored.sort(key=lambda t: t[0], reverse=True)
        out = []
        for score, c in scored[:k]:
            out.append({"id": c["id"], "kind": c["kind"], "name": c["name"],
                        "desc": c.get("desc", ""), "score": round(score, 3),
                        "toolsets": c.get("toolsets", [])})
        return out

    def best(self, query: str) -> Optional[dict[str, Any]]:
        hits = self.search(query, k=1)
        if not hits or hits[0]["score"] < 0.35:
            return None
        return hits[0]

    def component_status(self) -> dict[str, Any]:
        return {"ok": bool(self.caps),
                "detail": f"{len(self.caps)} capabilities, manifest {self._manifest_hash}"}
