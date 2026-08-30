"""Mediator loop — conversation driver.

Two transports, chosen by `native`:

  native=False  Ollama `/api/chat` with the one-line JSON tool protocol. Used
                for small models with no tool-template support.
  native=True   an OpenAI `/v1/chat/completions` endpoint (the local model
                router) with real function schemas. Used for gpt-oss-20b, which
                returns an EMPTY reply under the JSON-line protocol because it
                puts calls on its native tool channel.

Native tool calls are re-emitted downstream as the same one-line JSON, so the
speakable-prefix, hop, and tool-dispatch logic below is shared by both. One tool
per turn, max 3 tool hops, one malformed-JSON retry, then the mediator must speak.

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

from .prompt import NATIVE_TOOLS, system_prompt, task_event_message

MAX_TOOL_HOPS = 3
_JSON_LINE = re.compile(r"^\s*\{.*\}\s*$", re.S)

MetaToolHandler = Callable[[str, dict], Awaitable[dict[str, Any]]]

VALID_TOOLS = {"memory_recall", "capability_search", "quick_action",
               "delegate_task", "task_status", "task_control"}


class Mediator:
    def __init__(self, ollama_url: str, model: str, num_ctx: int = 8192,
                 keep_alive: str = "30m", history_turns: int = 12,
                 temperature: float = 0.4, think: bool = False,
                 native: bool = False, max_tokens: int = 512):
        self.url = ollama_url.rstrip("/")
        self.model = model
        # native=True -> OpenAI endpoint + real tool schemas (see module docstring).
        # The prompt has to match the transport: telling a native tool-caller to
        # emit a JSON line is what produced the empty replies.
        self.native = native
        self.system_prompt = system_prompt(native=native)
        # Reasoning models spend output budget before the spoken reply; 512 leaves
        # room for both. Ollama's num_predict stays at 320 (no hidden reasoning).
        self.max_tokens = max_tokens
        self.num_ctx = num_ctx
        self.keep_alive = keep_alive
        self.history_turns = history_turns
        self.temperature = temperature
        # Gemma E4B (gemma4:e4b-it-qat) spends its num_predict budget on hidden
        # reasoning when thinking is left on — verified on this box 2026-08-02:
        # warm /api/chat round-trip 3.2s->1.5s, and under a tight num_predict the
        # reply comes back EMPTY (message.thinking holds all the tokens, content
        # is ""). think=False is the mediator default: it needs sub-1.5s voice
        # turns, never hidden chain-of-thought. Override only for debugging.
        self.think = think
        self.history: list[dict[str, str]] = []
        self.pending_events: list[str] = []   # task updates to surface next turn
        self.tool_stats = {"calls": 0, "parse_errors": 0}
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=3.0))
        self.last_reply = ""
        self._partial_spoken = ""
        self._last_call: dict | None = None   # native tool call awaiting its result

    # ------------------------------------------------------------------
    def notify_task_event(self, task: dict) -> None:
        self.pending_events.append(task_event_message(task))
        if len(self.pending_events) > 6:
            self.pending_events = self.pending_events[-6:]

    def _record_interrupted(self, user_text: str, partial: str) -> None:
        """Record a cut-off turn WITH whatever was already said, so 'continue'
        actually works — the unfinished answer stays available to the model."""
        if partial.strip():
            note = f"[interrupted mid-answer; I had said: \"{partial.strip()[:400]}\"]"
        else:
            note = "[the user interrupted before I answered]"
        self.history.append({"role": "user", "content": user_text})
        self.history.append({"role": "assistant", "content": note})
        self.history = self.history[-2 * self.history_turns:]

    def reset(self) -> None:
        """Start a fresh conversation (user-facing 'new conversation' + tests)."""
        self.history.clear()
        self.pending_events.clear()
        self.last_reply = ""
        self._partial_spoken = ""

    def component_status(self) -> dict[str, Any]:
        return {"ok": True, "detail": f"{self.model}, {len(self.history) // 2} turns held"}

    async def warmup(self) -> bool:
        try:
            if self.native:
                # Router loads on demand; this first call pays the load so the
                # user's first spoken turn does not.
                await self._client.post(
                    f"{self.url}/v1/chat/completions",
                    json={"model": self.model, "max_tokens": 1,
                          "messages": [{"role": "user", "content": "hi"}]},
                    timeout=httpx.Timeout(180.0, connect=3.0))
                return True
            await self._client.post(f"{self.url}/api/chat", json={
                "model": self.model, "stream": False, "keep_alive": self.keep_alive,
                "think": self.think,
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

        msgs = [{"role": "system", "content": self.system_prompt}]
        msgs += self.history[-2 * self.history_turns:]
        for ev in self.pending_events:
            msgs.append({"role": "system", "content": ev})
        self.pending_events.clear()
        msgs.append({"role": "user", "content": user_text})

        try:
            return await self._turn_body(user_text, msgs, tools, on_delta, on_tool,
                                         cancel, t0, first_token_ms)
        except asyncio.CancelledError:
            # Barge-in: keep the partial answer in history so the user can say
            # "continue" and get the rest instead of a restart.
            self._record_interrupted(user_text, self._partial_spoken)
            raise

    async def _turn_body(self, user_text: str, msgs: list[dict],
                         tools: MetaToolHandler,
                         on_delta: Callable[[str], None],
                         on_tool: Callable[[str, dict, str], None],
                         cancel: asyncio.Event, t0: float,
                         first_token_ms: Optional[float]) -> dict[str, Any]:
        spoken = ""
        tool_calls: list[dict] = []
        parse_retry_used = False
        self._partial_spoken = ""

        force_schema = None  # set after a bad tool line → grammar-constrain the retry
        for _hop in range(MAX_TOOL_HOPS + 1):
            if cancel.is_set():
                break
            buf, spoke_len = "", len(spoken)
            for_this_hop = ""
            async for delta in self._stream(msgs, cancel, fmt=force_schema):
                if first_token_ms is None:
                    first_token_ms = (time.monotonic() - t0) * 1000
                buf += delta
                # Emit only the "speakable" prefix: text up to a line that begins a
                # JSON tool object. Catches both a leading tool call (nothing spoken)
                # and a trailing one the model tacks on AFTER prose (the JSON-leak
                # bug) — everything from `{`-at-line-start on is withheld from speech.
                speakable = self._speakable_prefix(buf)
                new = speakable[len(for_this_hop):]
                if new:
                    on_delta(new)
                    for_this_hop = speakable
                    spoken += new
                    self._partial_spoken = spoken

            stripped = buf.strip()
            # Anything that *starts* like a tool call is treated as one — including
            # truncated/malformed JSON (e.g. cut by num_predict). Raw JSON must
            # never leak into speech; the parse-retry path handles bad shapes.
            if not spoken and stripped.startswith("{"):
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
                                 "That tool call was malformed. Re-issue it as valid JSON."})
                    # Grammar-constrain the retry so Ollama can only emit a
                    # schema-valid tool object (adopted from LiveKit/pipecat's
                    # constrained-decoding approach; native to Ollama's `format`).
                    force_schema = {
                        "type": "object",
                        "properties": {
                            "tool": {"type": "string", "enum": sorted(VALID_TOOLS)},
                            "args": {"type": "object"},
                        },
                        "required": ["tool", "args"],
                    }
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
                payload = json.dumps(result, ensure_ascii=False)[:1200]
                if self.native and self._last_call:
                    call = self._last_call
                    msgs.append({"role": "assistant", "content": None,
                                 "tool_calls": [{"id": call["id"], "type": "function",
                                                 "function": {"name": call["name"],
                                                              "arguments": call["arguments"]}}]})
                    msgs.append({"role": "tool", "tool_call_id": call["id"],
                                 "content": payload})
                    msgs.append({"role": "system",
                                 "content": "Now answer the user in plain speech."})
                    self._last_call = None
                else:
                    msgs.append({"role": "assistant", "content": stripped})
                    msgs.append({"role": "system",
                                 "content": f"[tool result] {payload}\n"
                                            "Now answer the user in plain speech."})
                continue

            if not spoken and stripped:      # withheld text that wasn't a tool call
                on_delta(stripped)
                spoken = stripped
            break

        spoken = spoken.strip()
        if not spoken and not cancel.is_set():
            # Empty/failed completion. Retry once with an explicit nudge — an
            # identical retry tends to reproduce the identical failure.
            try:
                retry_msgs = msgs + [{"role": "system", "content":
                                      "Answer the user now in plain spoken English. "
                                      "Do not use a tool."}]
                retry_buf = ""
                async for delta in self._stream(retry_msgs, cancel):
                    retry_buf += delta
                retry_buf = retry_buf.strip()
                if retry_buf and not retry_buf.startswith("{"):
                    spoken = retry_buf
                    on_delta(spoken)
            except Exception:
                pass
        if not spoken and not cancel.is_set():
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
    async def _stream(self, msgs: list[dict], cancel: asyncio.Event, fmt=None):
        if self.native:
            async for delta in self._stream_openai(msgs, cancel):
                yield delta
            return
        # Ollama /api/chat, NOT /v1: the OpenAI endpoint silently ignores
        # options.num_ctx (verified on this box 2026-07), /api/chat honors it.
        # think=False (top-level, not inside options — verified 2026-08-02):
        # stops Gemma from burning num_predict on hidden reasoning instead of
        # the spoken reply.
        payload = {"model": self.model, "messages": msgs, "stream": True,
                   "keep_alive": self.keep_alive,
                   "think": self.think,
                   "options": {"num_ctx": self.num_ctx,
                               "temperature": self.temperature,
                               "num_predict": 320}}
        if fmt is not None:
            payload["format"] = fmt  # grammar-constrained JSON (tool-retry only)
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

    async def _stream_openai(self, msgs: list[dict], cancel: asyncio.Event):
        """Stream from an OpenAI-compatible endpoint with real tool schemas.

        Content deltas are yielded as they arrive so TTS starts early. Reasoning
        deltas are dropped — they must never reach the speaker. A tool call is
        accumulated across deltas and yielded at the end as the same one-line
        JSON the Ollama path produces, so the caller needs no special case.
        """
        payload = {"model": self.model, "messages": msgs, "stream": True,
                   "temperature": self.temperature,
                   "max_tokens": self.max_tokens,
                   "tools": NATIVE_TOOLS}
        name, arg_buf, spoke, call_id = None, "", False, None
        async with self._client.stream(
                "POST", f"{self.url}/v1/chat/completions", json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if cancel.is_set():
                    break
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                body = line[5:].strip()
                if body == "[DONE]":
                    break
                try:
                    chunk = json.loads(body)
                except json.JSONDecodeError:
                    continue
                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    for tc in (delta.get("tool_calls") or []):
                        fn = tc.get("function") or {}
                        name = fn.get("name") or name
                        call_id = tc.get("id") or call_id
                        arg_buf += fn.get("arguments") or ""
                    text = delta.get("content") or ""
                    if text:
                        spoke = True
                        yield text
        if name and not cancel.is_set():
            try:
                args = json.loads(arg_buf) if arg_buf.strip() else {}
            except json.JSONDecodeError:
                args = {}
            # Remembered for the history the next hop sends back: a native model
            # needs its own call echoed as assistant.tool_calls plus a matching
            # role="tool" result. Fed the result as a system message instead, it
            # does not recognise the call as answered and simply repeats it until
            # the hop budget runs out ("lost my train of thought").
            self._last_call = {"id": call_id or "call_0", "name": name,
                               "arguments": arg_buf or "{}"}
            # Leading newline when prose came first: _speakable_prefix splits on
            # a `{` at line start, so without it the JSON would be spoken aloud.
            yield ("\n" if spoke else "") + json.dumps({"tool": name, "args": args})

    @staticmethod
    def _speakable_prefix(buf: str) -> str:
        """Text safe to speak: everything before a line that begins a JSON tool
        object. A leading `{` → nothing speakable; a `{` after prose → the prose
        only (the trailing tool JSON is withheld, never voiced)."""
        s = buf.lstrip()
        if s.startswith("{"):
            return ""
        idx = buf.find("\n{")
        if idx == -1:
            # also guard a `{` that opens right after a space at line-ish boundary
            return buf
        return buf[:idx]

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
