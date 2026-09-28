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
import os
import re
import time
import uuid
from typing import Any, Awaitable, Callable, Optional

import httpx

from .prompt import NATIVE_TOOLS, system_prompt, task_event_message

MAX_TOOL_HOPS = 3
_JSON_LINE = re.compile(r"^\s*\{.*\}\s*$", re.S)

MetaToolHandler = Callable[[str, dict], Awaitable[dict[str, Any]]]

VALID_TOOLS = {"memory_recall", "capability_search", "quick_action",
               "delegate_task", "deep_answer", "set_reminder", "task_status",
               "task_control"}

BRAINS = ("local", "cloud")
_DEFAULT_ENV_FILE = os.path.expanduser("~/.hermes/.env")
_CLOUD_USER_AGENT = "jarvisd/1.0"


def _read_env_key(name: str, path: Optional[str] = None) -> Optional[str]:
    """Best-effort KEY=value lookup: process env first, then a flat .env file
    (read-only, never written). Mirrors jev-router's client._read_key_from_env_file
    (macmini-hermes-agent/hermes-plugins/jev-router/client.py) -- the OpenCode Go
    key (OPENCODE_GO_API_KEY) lives in the DEFAULT profile's ~/.hermes/.env, not
    jarvisd's own (deliberately key-free) env.

    `path` defaults to the module-level `_DEFAULT_ENV_FILE`, looked up here (not
    bound at def time) so tests can monkeypatch the module attribute.
    """
    val = os.environ.get(name)
    if val:
        return val
    path = path or _DEFAULT_ENV_FILE
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() != name:
                    continue
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                return v or None
    except OSError:
        pass
    return None


def opencode_go_configured() -> bool:
    """Cheap, no-token check: is there a usable OpenCode Go key at all?"""
    return bool(_read_env_key("OPENCODE_GO_API_KEY"))


class _BrainFailure(Exception):
    """Raised only for a pre-first-token failure of a brain's stream -- the
    signal that triggers the one-shot same-turn fallback to the other brain."""


class ThinkStripper:
    """Incrementally strips <think>...</think> spans from a streamed text.

    Some OpenCode Go models (minimax-m3) put chain-of-thought INSIDE the
    content channel instead of a separate reasoning field -- that must never
    reach on_delta/TTS. Handles a span split across chunk boundaries, and an
    UNTERMINATED leading span (all reasoning, cut short by max_tokens): that
    case must yield nothing at all, ever.
    """

    _OPEN = "<think>"
    _CLOSE = "</think>"

    def __init__(self) -> None:
        self.in_think = False
        self._pending = ""

    def feed(self, chunk: str) -> str:
        self._pending += chunk
        out = ""
        while True:
            if self.in_think:
                idx = self._pending.find(self._CLOSE)
                if idx == -1:
                    # Might be a split close tag -- hold back a small tail.
                    keep = min(len(self._pending), len(self._CLOSE) - 1)
                    self._pending = self._pending[len(self._pending) - keep:]
                    break
                self._pending = self._pending[idx + len(self._CLOSE):]
                self.in_think = False
                continue
            idx = self._pending.find(self._OPEN)
            if idx == -1:
                # No open tag (yet) -- keep enough tail in case it's split.
                safe_len = max(0, len(self._pending) - (len(self._OPEN) - 1))
                out += self._pending[:safe_len]
                self._pending = self._pending[safe_len:]
                break
            out += self._pending[:idx]
            self._pending = self._pending[idx + len(self._OPEN):]
            self.in_think = True
            continue
        return out

    def flush(self) -> str:
        """Call once the stream ends. Prose held back only for tag-boundary
        safety is returned; an unterminated open span is dropped, never spoken."""
        if self.in_think:
            self._pending = ""
            return ""
        out, self._pending = self._pending, ""
        return out


class Mediator:
    def __init__(self, ollama_url: str, model: str, num_ctx: int = 8192,
                 keep_alive: str = "30m", history_turns: int = 12,
                 temperature: float = 0.4, think: bool = False,
                 native: bool = False, max_tokens: int = 512,
                 brain: str = "local", cloud_model: str = "deepseek-v4.1-flash",
                 cloud_url: str = "https://opencode.ai/zen/go/v1/chat/completions",
                 deep_model: str = "minimax-m3"):
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
        # Two-brain support (SPEC §Brains): "local" = this router/model above;
        # "cloud" = OpenCode Go (deep_model/cloud_model below), same native tool
        # calling either way. Runtime-switchable via /brains -> set_brain().
        self.brain = brain if brain in BRAINS else "local"
        self.cloud_model = cloud_model
        self.cloud_url = cloud_url
        self.deep_model = deep_model
        self.session_id = f"jarvis-{uuid.uuid4().hex[:12]}"

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
        self.session_id = f"jarvis-{uuid.uuid4().hex[:12]}"

    def set_brain(self, brain: str) -> dict[str, Any]:
        """Live-switch the active brain (called by POST /brains). Takes effect
        on the NEXT turn -- nothing in-flight is interrupted."""
        if brain not in BRAINS:
            return {"ok": False, "error": f"unknown brain {brain}"}
        self.brain = brain
        return {"ok": True, "brain": brain}

    def component_status(self) -> dict[str, Any]:
        model = self.cloud_model if self.brain == "cloud" else self.model
        return {"ok": True, "detail": f"{self.brain} brain: {model} "
                                      f"(fallback: {self.model if self.brain == 'cloud' else self.cloud_model}), "
                                      f"{len(self.history) // 2} turns held"}

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
        """Stream one hop on the active brain (self.brain). If that brain fails
        before producing any token -- connect error, HTTP error, or nothing
        within the brain's first-token budget (6s cloud / 10s local) -- retry
        the SAME hop once on the OTHER brain. Once a token has been yielded,
        a later failure is NOT a brain failure (something was already spoken);
        it propagates like any other mid-stream error. Publishes nothing of its
        own; the caller's on_delta already sees every yielded delta as normal.
        """
        brain = self.brain
        other = "local" if brain == "cloud" else "cloud"
        try:
            async for delta in self._guarded_stream(brain, msgs, cancel, fmt,
                                                    6.0 if brain == "cloud" else 10.0):
                yield delta
            return
        except _BrainFailure:
            pass
        if cancel.is_set():
            return
        try:
            async for delta in self._guarded_stream(other, msgs, cancel, fmt,
                                                    6.0 if other == "cloud" else 10.0):
                yield delta
        except _BrainFailure:
            return  # both brains failed before any token -- caller sees an empty buf

    async def _guarded_stream(self, brain: str, msgs: list[dict], cancel: asyncio.Event,
                              fmt, timeout_s: float):
        """Wrap `_raw_stream` so a pre-first-token failure raises _BrainFailure
        instead of propagating -- the signal `_stream` retries on. Deliberately
        does NOT cancel the underlying generator's task on timeout via
        asyncio.wait_for's cancellation semantics for anything past the first
        token; only the very first `__anext__()` is time-boxed."""
        gen = self._raw_stream(brain, msgs, cancel, fmt)
        try:
            first = await asyncio.wait_for(gen.__anext__(), timeout=timeout_s)
        except StopAsyncIteration:
            return
        except asyncio.TimeoutError as e:
            await gen.aclose()
            raise _BrainFailure(f"{brain}: no token within {timeout_s}s") from e
        except Exception as e:  # noqa: BLE001 — ANY pre-first-token failure (missing
            # key, connect error, HTTP error, malformed setup, ...) is a brain
            # failure worth the same-turn fallback; nothing has been spoken yet.
            await gen.aclose()
            raise _BrainFailure(f"{brain}: {e}") from e
        yield first
        async for delta in gen:
            yield delta

    async def _raw_stream(self, brain: str, msgs: list[dict], cancel: asyncio.Event, fmt=None):
        if brain == "cloud":
            async for delta in self._stream_cloud(msgs, cancel):
                yield delta
        else:
            async for delta in self._stream_local(msgs, cancel, fmt):
                yield delta

    async def _stream_local(self, msgs: list[dict], cancel: asyncio.Event, fmt=None):
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
        """Stream from the LOCAL OpenAI-compatible router with real tool schemas.

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

    async def _stream_cloud(self, msgs: list[dict], cancel: asyncio.Event):
        """Stream from OpenCode Go (cloud brain) with real tool schemas.

        Every request needs `x-opencode-session` (else HTTP 400) and a
        non-Python User-Agent (Cloudflare 403s the default urllib/httpx UA) --
        both verified live 2026-09-28. <think>...</think> spans some Go models
        (minimax-m3) put INSIDE the content channel are stripped by a
        ThinkStripper before anything is yielded -- they must never be spoken.
        """
        key = _read_env_key("OPENCODE_GO_API_KEY")
        if not key:
            raise RuntimeError("OPENCODE_GO_API_KEY not configured")
        headers = {"Authorization": f"Bearer {key}", "User-Agent": _CLOUD_USER_AGENT,
                   "x-opencode-session": self.session_id}
        payload = {"model": self.cloud_model, "messages": msgs, "stream": True,
                   "temperature": self.temperature,
                   "max_tokens": self.max_tokens,
                   "tools": NATIVE_TOOLS}
        name, arg_buf, spoke, call_id = None, "", False, None
        stripper = ThinkStripper()
        async with self._client.stream(
                "POST", self.cloud_url, json=payload, headers=headers) as r:
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
                    raw_text = delta.get("content") or ""
                    if raw_text:
                        clean = stripper.feed(raw_text)
                        if clean:
                            spoke = True
                            yield clean
        tail = stripper.flush()
        if tail:
            spoke = True
            yield tail
        if name and not cancel.is_set():
            try:
                args = json.loads(arg_buf) if arg_buf.strip() else {}
            except json.JSONDecodeError:
                args = {}
            self._last_call = {"id": call_id or "call_0", "name": name,
                               "arguments": arg_buf or "{}"}
            yield ("\n" if spoke else "") + json.dumps({"tool": name, "args": args})

    # ------------------------------------------------------------ one-shot calls
    async def _complete_no_tools(self, brain: str, prompt: str, max_tokens: int,
                                 timeout_s: float, model_override: Optional[str] = None) -> str:
        """One-shot, tool-free, non-streaming completion on the given brain --
        used by deep_answer and report_task, which are short synchronous
        asides, not the voice turn's token-by-token path. Raises on any
        failure (bad key, HTTP error, timeout); callers decide the fallback.
        <think> spans are stripped before the text is returned.
        """
        msgs = [{"role": "user", "content": prompt}]
        if brain == "cloud":
            key = _read_env_key("OPENCODE_GO_API_KEY")
            if not key:
                raise RuntimeError("OPENCODE_GO_API_KEY not configured")
            url = self.cloud_url
            model = model_override or self.cloud_model
            headers = {"Authorization": f"Bearer {key}", "User-Agent": _CLOUD_USER_AGENT,
                       "x-opencode-session": self.session_id}
            payload = {"model": model, "messages": msgs, "stream": False,
                       "max_tokens": max_tokens}
        elif self.native:
            url = f"{self.url}/v1/chat/completions"
            model = model_override or self.model
            headers = {}
            payload = {"model": model, "messages": msgs, "stream": False,
                       "max_tokens": max_tokens}
        else:
            url = f"{self.url}/api/chat"
            model = model_override or self.model
            headers = {}
            payload = {"model": model, "messages": msgs, "stream": False,
                       "think": False, "options": {"num_predict": max_tokens}}
        r = await self._client.post(url, json=payload, headers=headers,
                                    timeout=httpx.Timeout(timeout_s, connect=5.0))
        r.raise_for_status()
        data = r.json()
        if brain == "cloud" or self.native:
            content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        else:
            content = (data.get("message") or {}).get("content") or ""
        stripper = ThinkStripper()
        return (stripper.feed(content) + stripper.flush()).strip()

    async def deep_answer(self, question: str) -> dict[str, Any]:
        """Meta-tool handler: a synchronous call to a strong cloud model
        (config brain.deep_model, default minimax-m3) for a hard-reasoning or
        broad-knowledge question that does NOT need live data or a real
        action -- delegate_task is for that. No tools, <think> stripped,
        answered in <=4 spoken sentences, 25s hard timeout.

        Contract: the pipeline dispatches unknown tool names via its own
        dispatcher (jarvisd/pipeline.py `_dispatch_meta_tool`), so this is
        called from there as:
            if name == "deep_answer": return await self.mediator.deep_answer(**args)
        Returns {"answer": str} on success, {"error": str} on any failure --
        never raises.
        """
        question = str(question or "").strip()[:1000]
        if not question:
            return {"error": "question required"}
        prompt = ("Answer in one to three short spoken sentences (more only if the question asks for detail): plain speech, "
                  "no markdown, no lists.\n\nQuestion: " + question)
        try:
            answer = await asyncio.wait_for(
                self._complete_no_tools("cloud", prompt, max_tokens=400, timeout_s=25.0,
                                        model_override=self.deep_model),
                timeout=25.0)
            if not answer:
                return {"error": "deep_answer returned no content"}
            return {"answer": answer}
        except Exception as e:  # noqa: BLE001 — a tool handler must never raise
            return {"error": f"deep_answer failed: {e}"}

    async def report_task(self, task: dict) -> str:
        """Turn a finished background task into a natural 1-2 sentence spoken
        report, using the ACTIVE brain, no tools, 8s hard timeout.

        Contract: called by the pipeline (jarvisd/pipeline.py's `_on_task_event`
        owns the finished-task announcement) once a WorkerManager task reaches a
        terminal status, to produce the text it speaks/announces -- NOT part of
        the tool-dispatch loop. `task` is the same dict shape
        WorkerManager._brief()/db.get_task() produce: at minimum `status`, and
        `goal` or `title`; `result_summary` and `result_text` are used when
        present. Never raises -- on any failure (brain down, timeout, empty
        reply) it falls back to a sanitized template sentence built purely from
        those fields, so a report is always produced.
        """
        status = task.get("status", "unknown")
        goal = str(task.get("goal") or task.get("title") or "the task").strip()
        summary = str(task.get("result_summary") or "").strip()
        tail = str(task.get("result_text") or "")[-800:]
        verdict = {"done": "finished successfully", "failed": "failed",
                   "needs_review": "finished but needs review",
                   "canceled": "was canceled"}.get(status, status)
        fallback_text = f"{goal[:200].rstrip('.')}. {verdict}."
        if summary:
            fallback_text += f" {summary[:200]}"
        fallback_text = re.sub(r"\s+", " ", fallback_text).strip()
        prompt = (f"A background task just {verdict}. Goal: {goal!r}. "
                  f"Summary: {summary or 'none'}. Recent output: {tail or 'none'}\n\n"
                  "Report this to the user in one short natural spoken sentence (two only if needed): plain "
                  "speech, no markdown, key facts and numbers only, honest about "
                  "failure if it failed.")
        try:
            text = await asyncio.wait_for(
                self._complete_no_tools(self.brain, prompt, max_tokens=200, timeout_s=8.0),
                timeout=8.0)
            text = text.strip()
            if not text or text.startswith("{"):
                return fallback_text
            return text
        except Exception:  # noqa: BLE001 — a report must always come back
            return fallback_text

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
