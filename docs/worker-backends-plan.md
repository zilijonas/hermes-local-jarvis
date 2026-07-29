# Worker-backend selector + credit gauges — agreed plan (2026-07-29)

Agreed with Linas; implementation lands when the updated design arrives.

## Backends (worker tier — complex tasks + real tool calling)
| id | runs | auth | notes |
|---|---|---|---|
| granite | `hermes -p local -z … --yolo` subprocess | none | free, on-box; RAM-aware (one-model cap) |
| cloud | `hermes -p default -z … --yolo --ignore-rules` | default profile creds (openrouter) | direct model call, bypass its delegate-everything routing |
| codex | `codex-task.sh run …` | ChatGPT sub | availability via `status` (exists) |
| claude | `claude -p "<goal>" --dangerously-skip-permissions` headless | Anthropic sub (~/.claude creds) | full blast radius allowed per Linas — no allowlist |

Mediator stays gemma (unchanged). Selection = `worker_backend` in jarvisd.toml,
switchable at runtime.

## HTTP/event contract (backend implements, UI consumes)
- `GET /backends` → `[{id, label, kind: local|cloud|sub, available: bool,
  detail: str, metrics: {speed: str, cost: str}}]`  (metrics = the "super small font" line)
- `POST /config {"worker_backend": id}` → persists + `backend.changed` event
- `GET /credits` → `{codex: {pct_left, label, window}, claude: {session_pct_left,
  weekly_pct_left, label}, openrouter: {pct_left, usd_used, usd_limit}}` — any field
  null when unknown; `credits.update` event on refresh
- `task.update` gains `backend` field; NEW `task.partial` event carries streamed
  intermediate output snippets (codex/claude stdout lines; granite via session poll)
- Actionable-notification derivation: tasks with status `needs_review` (or future
  approval states) → count drives the Tasks-label dot (amber). Running → cyan dot.

## Credit sources — free/cheap checks (no credits burned)
Crib from `~/.hermes/plugins/hermes-plugin-credits/dashboard/plugin_api.py`
(already reads `~/.claude/.credentials.json`, `~/.codex/auth.json`, openrouter key
usage endpoint; 5-min TTL in-memory cache):
- openrouter: `GET /api/v1/key` (usage/limit, free)
- claude: OAuth usage endpoints the credits plugin uses (session 5h window + weekly)
- codex: whatever the credits plugin reads for openai-codex; fallback = local
  dispatch-count estimate; refresh 10-min TTL + on-demand + after each dispatch
- Auth files are read-only; secrets never leave the box; gauges show pct only.

## Concurrency requirements (Linas #5)
- New prompts NEVER stop running workers (already true: turn queue + background
  tasks); explicit stop only (task_control cancel).
- Intermediate results: task.partial → task card live tail; mediator may speak a
  one-line progress summary when asked "how's it going".
- Multiple concurrent workers stay allowed (sem=2); backend badge per task.

## Mobile fixes bundled in this round
- Floating/undismissable notifications (e.g. sleep need