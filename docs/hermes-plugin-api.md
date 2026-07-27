# Hermes plugin API — verified facts (v0.19.0, explored 2026-07-27)

Source root: `/Users/agent/.hermes/hermes-agent`. Line numbers verified at exploration time.

## Plugin anatomy
Two independent surfaces sharing one directory:

### Agent/gateway plugin
- `plugin.yaml` — required key `name`; optional `version, description, author, requires_env,
  provides_tools, provides_hooks, kind, manifest_version` (parsed `hermes_cli/plugins.py:1635-1647`).
  Unknown keys silently ignored. `kind` ∈ {standalone, backend, exclusive, platform, model-provider}.
- `__init__.py` with `def register(ctx)` — mandatory (`plugins.py:1841-1843`).
- Layout: `plugins/<name>/plugin.yaml` (or one category level deeper, max).

### Dashboard (web UI) plugin — independent discovery, plugin.yaml NOT required
```
dashboard/
├── manifest.json   # name, label, icon, version, tab{path,position,override,hidden}, slots[], entry, css, api
├── dist/index.js   # IIFE bundle loaded via <script>
├── dist/style.css  # optional
└── plugin_api.py   # optional — module-level `router: APIRouter` (FastAPI)
```
- Discovery scans `get_process_hermes_home()/plugins/*/dashboard/manifest.json`
  (`hermes_cli/web_server.py:18445-18550`) → **profile-scoped when dashboard runs `--isolated`
  under that profile**.
- `plugin_api.py` mounted at `/api/plugins/<name>/` (`web_server.py:19075`), imported ONCE at
  server startup — restart dashboard after backend changes. `@router.websocket(...)` works
  (plain APIRouter); SDK ships `buildWsUrl`/`buildWsAuthParam` for authenticated WS.
- Asset route `GET /dashboard-plugins/{plugin}/{file}` serves only browser suffixes (no .py).
- Rescan UI-only: `curl http://127.0.0.1:<port>/api/dashboard/plugins/rescan`.

## Enable/disable
`plugins.enabled: [...]` allow-list + `plugins.disabled: [...]` deny-list (wins) in the profile's
config.yaml. CLI: `hermes plugins enable <name>`.

## PluginContext API (register(ctx))
- `ctx.register_tool(name, toolset, schema, handler, check_fn=None, requires_env=None,
  is_async=False, description="", emoji="", override=False)` — handler `(args: dict, **kw) -> str`
  (JSON string, never raise).
- `ctx.register_hook(name, cb)` — hooks incl. `pre_tool_call, post_tool_call, pre_llm_call,
  post_llm_call, on_session_start/end/finalize/reset, subagent_start/stop, pre_gateway_dispatch`.
  `pre_llm_call` return `{"context": "..."}` appends to user message (10k char cap).
  `pre_tool_call` (also as shell hook) can return `{"action":"block","message":...}` to veto a call.
- `ctx.register_command(name, handler, description)` — in-session `/name`.
- `ctx.register_cli_command(...)` — `hermes <plugin> <subcmd>`.
- `ctx.dispatch_tool(name, args)` — call any registered tool.
- `ctx.register_tts_provider`, `ctx.register_transcription_provider` — instance of ABC in
  `agent/tts_provider.py` / `agent/transcription_provider.py`.
- `ctx.register_skill(name, path)` — namespaced `plugin:skill`, not in system prompt.
- `ctx.profile_name` — active profile name.

## Frontend SDK (web/src/plugins/)
- `window.__HERMES_PLUGINS__.register(name, Component)` / `.registerSlot(slot, name, Component)`.
- `window.__HERMES_PLUGIN_SDK__` = `{ sdkVersion, React, hooks{useState,useEffect,useCallback,
  useMemo,useRef,useContext,createContext}, api, fetchJSON, authedFetch, buildWsUrl,
  buildWsAuthParam, components{Card,Badge,Button,Checkbox,Select,Input,Label,Separator,Tabs,
  PluginSlot,...}, utils{cn,timeAgo,isoTimeAgo}, useI18n }`. Contract 1.1.0.
- Bundle gets 2 s after script injection to call register().
- Slots: `backdrop, header-left, header-right, header-banner, sidebar, pre-main, post-main,
  footer-left, footer-right, overlay` + `{sessions,analytics,logs,cron,skills,plugins,config,
  env,docs,chat}:{top,bottom}`.
- manifest `tab.position`: `"end" | "after:<seg>" | "before:<seg>"`; `tab.override` replaces a
  built-in route; `tab.hidden` for slot-only plugins.
- Working examples on disk: `~/.hermes/plugins/hermes-plugin-dashboard` (page + api),
  `~/.hermes/plugins/hermes-chat-bubble` (slot-only overlay, AGENT_INSTALL.md runbook),
  `~/ai/repos/crypto-trader/hermes-plugin` (thin proxy to standalone service on :9127 —
  OUR PATTERN; the plugin dir in ~/.hermes/plugins is a symlink to the repo).

## Dashboard ↔ backend protocol (for the embedded chat, reusable)
- `/api/ws` — tui_gateway JSON-RPC (newline-delimited): `session.create`, `session.resume`,
  `prompt.submit {session_id, text}`, `session.interrupt`, `clarify.respond`, `approval.respond`.
  Events: `message.start/delta/interim/complete`, `tool.progress/start/complete`,
  `voice.status {state: idle|listening|transcribing}`, `voice.transcript {text}`,
  `session.info`, `clarify.request`, `approval.request`, `subagent.*`, `error`.
  Client reference: `web/src/lib/gatewayClient.ts`.
- `/api/pty`, `/api/pub`, `/api/events` — PTY + tool-event fan-out.
- Auth loopback mode: token injected as `window.__HERMES_SESSION_TOKEN__`, header
  `X-Hermes-Session-Token`, WS `?token=`.
- REST: `POST /api/audio/transcribe {data_url: "data:audio/webm;base64,..."}` →
  faster-whisper via `tools/transcription_tools.transcribe_audio` (needs `stt.enabled: true`).

## TTS/STT engines (Hermes built-ins)
- TTS tool `text_to_speech` (toolset `tts`), engines: edge/elevenlabs/openai/minimax/xai/
  mistral/gemini/neutts/kittentts/piper/deepinfra + **custom command providers**
  (`tts.providers.<name>.type: command`, placeholders {input_path}/{output_path}/{voice}...).
  Only elevenlabs真 streams; others synthesize-then-play. Cache: ~/.hermes/audio_cache (legacy)
  or cache/audio.
- STT providers: `local` (faster-whisper, auto-download), `local_command`
  (HERMES_LOCAL_STT_COMMAND), plus cloud ones. `stt.enabled` gate. `transcribe_audio` is
  infrastructure, not an agent tool.
- Media delivery to chat platforms: reply text `MEDIA:<abs_path>` (+ optional `[[audio_as_voice]]`
  prefix) parsed by `gateway/platforms/base.py:3777 extract_media`.

## Dashboard CLI
`hermes -p <profile> dashboard --isolated --port <p> --host 127.0.0.1 --skip-build --no-open`
— dedicated per-profile server (default unified machine-level). `--stop`/`--status` manage.
`hermes serve` = same server headless.
