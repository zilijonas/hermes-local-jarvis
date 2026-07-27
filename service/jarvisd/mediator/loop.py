"""Mediator loop — Gemma E4B conversation driver.

Talks straight to Ollama's OpenAI-compatible endpoint with a tiny prompt.
Tool use is a one-line JSON protocol (see prompt.py) — model-agnostic, no
dependency on Ollama tool templates. One tool per turn, max 3 tool hops,
one malformed-JSON retry, then the mediator must speak.

Streaming contract: text deltas go to `on_delta` as they arrive; the caller
(pipeline) forwards sentences to TTS. A cancel_event aborts generation
mid-stream (barge-in).
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, Awaitable, Callable, Optional

import httpx

from .prompt import SYSTEM_PROMPT, task_event_message

MAX_TOOL_HOPS = 3
_JSON_LINE = re.compile(r"^\s*\{.*\}\s*$", re.S)

MetaToolHandler = Callable[[str, dict], Awaitable[dict[str, Any]]]

VALID_TOOLS = {"memory_recall", "capability_search", "quick_action",
               "delegate_task", "task_status", "task_control"}


class Mediator:
    def __init__(self, ollama_url: str, model: str, num_ctx: int = 8192,
                 keep_alive: str = "30m", history_turns: int = 12,
                 temperature: float = 0.4):
        self.url = ollama_url.rstrip("/")
        self.model = model
        self.num_ctx = num_ctx
        self.keep_alive = keep_alive
        self.history_turns = history_turns
        self.temperature = temperature
        self.history: list[dict[str, str]] = []
        self.pending_events: list[str] = []   # task updates to surface next turn
        self.tool_stats = {"calls": 0, "parse_errors": 0}
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=3.0))
        self.last_reply = ""

    # ------------------------------------------------------------------
    def notify_task_event(self, task: dict) -> None:
        self.pending_events.append(task_event_message(task))
        if len(self.pending_events) > 6:
            self.pending_events = self.pending_events[-6:]

    def component_status(self) -> dict[str, Any]:
        return {"ok": True, "detail": f"{self.model}, {len(self.history) // 2} turns held"}

    async def warmup(self) -> bool:
        try:
            await self._client.post(f"{self.url}/api/chat", json={
                "model": self.model, "stream": False, "keep_alive": self.keep_alive,
                "options": {"num_ctx": self.num_ctx, "num_predict": 1},
                "messages": [{"role": "user", "content": "hi"}]})
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    async def turn(self, user_text: str,
                   tools: MetaToolHandler,
                   on_delta: Callable[[str], None],
                   on_tool: Callable[[str, dict, str], None],
                   cancel: Optional[asyncio.Event] = None) -> dict[str, Any]:
        """Run one conversation turn. Returns {text, ms_first_token, ms_total, tool_calls}."""
        t0 = time.monotonic()
        first_token_ms: Optional[float] = None
        cancel = cancel or asyncio.Event()

        msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
        msgs += self.history[-2 * self.history_turns:]
        for ev in self.pending_events:
            msgs.append({"role": "system", "content": ev})
        self.pending_events.clear()
        msgs.append({"role": "user", "content": user_text})

        spoken = ""
        tool_calls: list[dict] = []
        parse_retry_used = False

        for _hop in range(MAX_TOOL_HOPS + 1):
            if cancel.is_set():
                break
            buf, emitted, got_first = "", 0, first_token_ms
            async for delta in self._stream(msgs, cancel):
                if first_token_ms is None:
                    first_token_ms = (time.monotonic() - t0) * 1000
                buf += delta
                # Hold back output while it could still be a JSON tool line.
                if not spoken and buf.lstrip()[:1] == "{":
                    continue
                on_delta(delta)
                emitted += len(delta)
                spoken += delta

            stripped = buf.strip()
            if not spoken and _JSON_LINE.match(stripped):
                call = self._parse_tool(stripped)
                if call is None:
                    self.tool_stats["parse_errors"] += 1
                    if parse_retry_used:
                        spoken = "Sorry, I got confused with a tool call. Could you rephrase?"
                        on_delta(spoken)
                        break
                    parse_retry_used = True
                    msgs.append({"role": "assistant", "content": stripped})
                    msgs.append({"role": "system", "content":
                                 "Invalid tool JSON. Reply with exactly one line: "
                                 '{"tool": "<name>", "args": {...}} using a valid tool name, '
                                 "or answer in plain speech."})
                    continue
                name, args = call
                self.tool_stats["calls"] += 1
                on_tool(name, args, "start")
                try:
                    result = await asyncio.wait_for(tools(name, args), timeout=20.0)
                except asyncio.TimeoutError:
                    result = {"error": "tool timed out"}
                except Exception as e:  # noqa: BLE001
                    result = {"error": f"tool failed: {e}"}
                on_tool(name, args, "end")
                tool_calls.append({"name": name, "args": args, "result": result})
                msgs.append({"role": "assistant", "content": stripped})
                msgs.append({"role": "system",
                             "content": f"[tool result] {json.dumps(result, ensure_ascii=False)[:1200]}\n"
                                        "Now answer the user in plain speech."})
                continue

            if not spoken and stripped:      # withheld text that wasn't a tool call
                on_delta(stripped)
                spoken = stripped
            break

        spoken = spoken.strip()
        if not spoken and not cancel.is_set():
            # Rare empty completion (Ollama under load) — never return silence.
            spoken = "Sorry, I lost my train of thought there. Could you say that again?"
            on_delta(spoken)
        if spoken:
            self.history.append({"role": "user", "content": user_text})
            self.history.append({"role": "assistant", "content": spoken})
            self.history = self.history[-2 * self.history_turns:]
            self.last_reply = spoken
        return {"text": spoken,
                "ms_first_token": round(first_token_ms or 0, 1),
                "ms_total": round((time.monotonic() - t0) * 1000, 1),
                "tool_calls": tool_calls}

    # ------------------------------------------------------------------
    async def _stream(self, msgs: list[dict], cancel: asyncio.Event):
        # Native /api/chat, NOT /v1: the OpenAI endpoint silently ignores
        # options.num_ctx (verified on this box 2026-07), /api/chat honors it.
        payload = {"model": self.model, "messages": msgs, "stream": True,
                   "keep_alive": self.keep_alive,
                   "options": {"num_ctx": self.num_ctx,
                               "temperature": self.temperature,
                               "num_predict": 400}}
        async with self._client.stream("POST", f"{self.url}/api/chat",
                                       json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if cancel.is_set():
                    break
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if chunk.get("done"):
                    break
                delta = (chunk.get("message") or {}).get("content") or ""
                if delta:
                    yield delta

    @staticmethod
    def _parse_tool(text: str) -> Optional[tuple[str, dict]]:
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            # tolerate trailing prose after the JSON object
            m = re.match(r"\s*(\{.*?\})\s*$", text, re.S)
            if not m:
                return None
            try:
                obj = json.loads(m.group(1))
            except json.JSONDecodeError:
                return None
        if not isinstance(obj, dict):
            return None
        name = obj.get("tool") or obj.get("name")
        args = obj.get("args") or obj.get("arguments") or {}
        if name not in VALID_TOOLS or not isinstance(args, dict):
            return None
        return name, args
