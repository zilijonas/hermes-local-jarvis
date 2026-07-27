# Hermes profiles/sessions/delegation — verified facts (2026-07-27)

## Profile mechanics
- Created: `hermes profile create jarvis-voice --no-skills` (DONE 2026-07-27). Fresh profile:
  empty placeholder `.env` (0600), no `auth.json`, `.no-bundled-skills` marker blocks bundled
  skill seeding (also during `hermes update` sync). Wrapper `~/.local/bin/jarvis-voice`.
- `-p NAME` sets `HERMES_HOME=~/.hermes/profiles/NAME` pre-argparse (`hermes_cli/main.py:475-620`).
- Skills come ONLY from the profile's own `skills/` dir (empty here) + `skills.external_dirs`.
  Bundled repo skills never read live. Skills index drops from prompt when `skills` toolset absent.
- System prompt injection off-switches used: `agent.environment_probe: false`,
  `parallel_tool_call_guidance: false`; memory guidance gated on `memory` toolset (absent);
  SOUL.md replaced with lean worker identity. Always-injected残: help guidance + profile hint (small).
- `MINIMUM_CONTEXT_LENGTH = 64_000` (`agent/model_metadata.py:196`) — any Hermes session model
  must claim ≥64k. granite4.1-local-64k alias provides real 64k (`ollama_num_ctx: 65536`).
- Gateway per profile = separate process + hand-authored LaunchAgent. jarvis-voice runs NO
  platform gateway (no Telegram); only dashboard `--isolated` + jarvisd.
- `~/.hermes/scripts/ensure-gateways.sh` (LaunchAgent, 300 s) restarts gateways on stale code;
  LABELS=(ai.hermes.gateway ai.hermes.gateway-local). If we ever add a jarvis gateway, add label.
  Dashboard instances are NOT covered by it.

## Programmatic sessions
- One-shot: `hermes -p jarvis-voice -z "<prompt>" --yolo [-m MODEL] [-t toolsets,csv]
  [--usage-file PATH] [--source tool]` → prints final text only; approvals bypassed.
- Resume: `hermes -p jarvis-voice chat --resume <session_id>` / `-c`.
- Python: `run_agent.AIAgent(base_url=..., model=...)` with `skip_context_files`,
  `load_soul_identity` params.
- Sessions stored in profile `state.db` (SQLite WAL + FTS5, `hermes_state.SessionDB`);
  readable read-only for progress (messages, tool calls). `runtime/active_sessions.json`.
- NO session-to-session messaging API. `delegate_task` (toolset `delegation`) spawns isolated
  child; async plumbing in `tools/async_delegation.py` (SQLite, survives restarts).
  `DELEGATE_BLOCKED_TOOLS = {delegate_task, clarify, memory, send_message, execute_code, cronjob}`.
  `delegation.model/provider/base_url` pins ALL subagents to a specific model.
- Per-spawn tool restriction: `-t` flag with toolset names (union). Toolsets defined in
  `toolsets.py` (`TOOLSETS` dict, `resolve_multiple_toolsets`). Tool schemas built at session
  start; `check_fn` gates per tool.
- `pre_tool_call` hook (plugin or shell) can veto specific calls → arg validation hook point.

## Cloud-leak guard (verified)
- `fallback_providers: []`, no `fallback_model` → main model never falls to cloud.
- `auxiliary.*.provider: auto` walks openrouter→nous→local→any-API-key-found when the local call
  FAILS → jarvis config pins every auxiliary block to `custom` + Ollama explicitly.
- Never add cloud keys to profile `.env`; `backfill_profile_envs()` only copies default `.env`
  if profile has none — ours exists, so safe.
- LaunchAgent EnvironmentVariables must not include cloud keys.

## Tool-audit facts (2026-07-27, granite prod)
- Prompt bloat is the latency killer: 25 tools/43 kB schemas + 15.7 kB system prompt ≈ 15k tok
  prefill; diet to 15 tools → input 25,995→12,225 tok, warm latency 6-17 s→2-5 s.
- jarvis-voice worker uses 5 toolsets (file, terminal, web, todo, clarify) minus 15 disabled
  toolsets; typical spawn passes `-t` with 1-3 toolsets → ~4-12 tools.
- Baselines (this box): granite warm round-trip 0.2-0.4 s (trivial gen); gemma e4b cold load
  6.3 s / warm 0.38 s; profile one-shot cold `hermes -z` 79 s (model swap + prefill), warm 2-5 s.

## jarvis-voice profile state (as installed)
- `~/.hermes/profiles/jarvis-voice/config.yaml` — see repo copy in `config/` (canonical here).
- SOUL.md = lean worker identity. Skills dir empty. Plugins: `jarvis-voice` enabled.
- Smoke test passed: `hermes -p jarvis-voice -z "Reply with exactly: JARVIS-OK" --yolo` → JARVIS-OK.
