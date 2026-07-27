"""Compact markdown context card for the mediator's `memory_recall` meta-tool.
See docs/SPEC.md §Meta-tools (memory_recall returns a context-card string) and
§Config `[budgets] context_card_tokens` (default 600).
"""
from __future__ import annotations

from typing import Any

CHARS_PER_TOKEN = 4


def build_card(q: str, hits: list[dict[str, Any]], budget_tokens: int = 600) -> str:
    """Greedily assemble a card within `budget_tokens` (approx chars/4). The
    header is always included; hit lines are added in the order given (callers
    pass already-ranked `search()` output) until the next line would overflow.
    """
    budget_chars = max(budget_tokens, 1) * CHARS_PER_TOKEN
    header = f"MEMORY ({len(hits)} sources)"
    lines: list[str] = [header]
    total = len(header)

    for hit in hits:
        title = hit.get("title") or "untitled"
        folder = hit.get("folder") or ""
        updated = hit.get("updated") or ""
        snippet = (hit.get("snippet") or "").replace("\n", " ").strip()
        path = hit.get("path") or ""
        line = f"• {title} ({folder}, {updated}): {snippet} [{path}]"
        if hit.get("conflict"):
            line = f"⚠ conflicting: {line}"
        cost = len(line) + 1  # + newline joining it to the card
        if total + cost > budget_chars:
            break
        lines.append(line)
        total += cost

    return "\n".join(lines)
