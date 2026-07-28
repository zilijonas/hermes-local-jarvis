# jarvis-voice dashboard UI — Jarvis Command Centre

Real frontend for the Jarvis voice assistant Hermes dashboard plugin,
rebuilt (2026-07-28) to the "Jarvis Command Centre" design prototype in
`../design/Jarvis Command Centre.dc.html` (direction B: anchored core,
flanked context). Bundled with esbuild into a single IIFE plus two
standalone AudioWorklet files; consumed by
`hermes-plugin/dashboard/manifest.json` (`entry`/`css`) and the Hermes
dashboard host, which injects `window.__HERMES_PLUGIN_SDK__` /
`window.__HERMES_PLUGINS__` before loading the script (see
`../docs/hermes-plugin-api.md` §Frontend SDK).

React is **not bundled** — components are built with a tiny `h()` helper
(`src/h.js`) bound to `window.__HERMES_PLUGIN_SDK__.React.createElement` at
runtime. three.js is **gone** (the old WebGL orb was replaced by a 2D-canvas
intelligence core), which took the main bundle from ~581 KB to ~75 KB raw.

## Layout (ported from the prototype)

- **≥1280px** — three columns: `SystemBar` on top (brand, LOCAL ONLY,
  mediator/worker models, E2E first-audio p50, RAM free, connection pill,
  MOTION toggle), then `MemoryColumn (304px) · Stage (1fr) · WorkColumn (372px)`.
- **860–1279px** — memory column folds into a 4th "Memory" tab in the work
  column (`minmax(0,1fr) 344px`); waterfall labels collapse to a single
  `e2e —` figure; model stats hide progressively (1280/1024 thresholds).
- **<860px** — `MobileShell`: header, core, active-task chip, conversation,
  thumb composer (64px mic), and Tasks / Memory / Activity as bottom sheets
  (safe-area padded, ≥44px targets).

Breakpoints are driven by the **root element's width** (ResizeObserver →
`store.w`), exactly like the prototype — not viewport media queries — so the
plugin adapts to whatever column the dashboard gives it. No document scroll
at any size: the only scroll containers are the memory list, the work-column
tab body, the conversation log, and sheet bodies.

## Build

```sh
cd ui
npm install     # esbuild + tailwindcss/@tailwindcss/cli + postcss (+ React UMD for the harness)
./build.sh
```

Output goes to `../hermes-plugin/dashboard/dist/`:

| File | What |
|---|---|
| `index.js` | IIFE bundle of `src/index.js` and everything it imports. Registers via `window.__HERMES_PLUGINS__.register("jarvis-voice", App)`. |
| `style.css` | `src/tokens.css` + `src/style.css` (hand layer) + compiled Tailwind utilities (`src/input.css`), all scoped under `#jarvis-voice-root` by `scope-css.mjs`. |
| `mic-worklet.js` / `player-worklet.js` | AudioWorkletProcessor bundles, loaded at runtime via `audioContext.audioWorklet.addModule(...)`. |

`build.sh` fails the build if (a) the registration call is missing from the
bundle, (b) **any** selector in the final CSS lacks `#jarvis-voice-root`
(scope-css.mjs leak check), or (c) any dist bundle fails `node --check`.

### CSS pipeline (Tailwind v4, fully scoped)

`src/input.css` is a CSS-first Tailwind v4 config that deliberately does NOT
import `tailwindcss`: no preflight (its bare `*`/`html` resets would restyle
the host dashboard), no default theme (only the `--jv-*` tokens are mapped,
via `@theme inline`, so utilities compile to `var(--jv-*)` references), no
cascade layers (unlayered host CSS would beat layered plugin CSS). Only
`@tailwind utilities;` output is emitted, and `scope-css.mjs` (postcss)
prefixes every selector with `#jarvis-voice-root`, rewrites any `:root`/
`:host` to the plugin root, unwraps `@layer`, and then re-parses the result
to assert zero unscoped selectors. Components use Tailwind utility classes
(arbitrary values where the prototype's pixel values demand it); the hand
layer (`src/style.css`) keeps only the neutraliser, root skeleton, mini
reset, scrollbars, keyframes, focus rings and canvas positioning.

`src/tokens.css` holds the design tokens (colors with AA-contrast notes,
4px spacing scale, radii 5/9/12, elevation, motion durations + easing),
scoped under `#jarvis-voice-root` — never `:root`.

## File map (`src/`)

- **`index.js`** — entry point. Guards on both host globals, registers under
  the exact name `"jarvis-voice"`, and exposes
  `window.__JARVIS_VOICE_INTERNALS__ = { createVisualizer, App }` for the
  harness.
- **`app.js`** — composition root. Owns the store, the WS event loop
  (`onEvent`), audio in/out, the visualizer lifecycle, keyboard map, timers,
  and renders `SystemBar · MemoryColumn · Stage · WorkColumn` or
  `MobileShell`, plus the non-blocking `OfflineSheet`. Turn assembly lives
  here: `stt.final`/`turn.text` push user turns; `mediator.delta` streams;
  the reply commits to the log on `done`/`idle`/`interrupted` with meta
  chips accumulated from `meta_tool` end events, `memory.hits` counts and
  the turn's `e2e` latency. Also: per-turn waterfall (`turnLatency` from
  `latency`/`stt.final`/`mediator.done`/`tts.end`), live tool chip
  (`meta_tool` start/end), 1s ticker (runs only while something ticks),
  retry countdown that mirrors ws.js's documented 1→10s backoff (ws.js
  itself is untouched), memory-hit enrichment via `GET /memory/search`,
  height pinning + root-width observation, and localStorage prefs
  (`reducedMotion` — defaulting to the OS setting — and `volume`, which is
  still applied to the player even though the redesign has no volume UI).
- **`components/stage.js`** — turn strip (waterfall segments + labels ≥1280,
  compact e2e below), canvas stage (state caption with prototype microcopy,
  live meta-tool chip, INTELLIGENCE CORE / LATTICE·MODE labels),
  conversation log (role gutters YOU/JARVIS/SYSTEM, live italic partial with
  caret, streamed reply with the **currently-spoken sentence highlighted by
  matching `tts.start` text**, meta chips), composer (mic button + ring,
  input with ⌘K, Send, Interrupt — hot only while speaking, mode toggle,
  mic level meter, mic error/hint banner).
- **`components/memory.js`** — memory column / folded tab / mobile sheet:
  debounced `GET /memory/search` box (search results replace the
  recalled-this-turn list while a query is active), hit cards with score
  bar, confidence, updated, conflict badge, snippet.
- **`components/work.js`** — tabbed Work / Activity / System (+ Memory when
  folded), tab counts, status-weighted task cards (running/queued first;
  worker identity tag; elapsed ticking only while running; indeterminate
  sweep bar — `task.update` has no numeric fraction, so the bar only ever
  claims "running"; pause/resume/cancel/re-delegate/dismiss via
  `POST /tasks/{id}/control`; Detail toggle fetches `GET /tasks/{id}` for
  the event timeline, result and session id), activity stream with TRACE
  DETAIL toggle, system tab (health chips from `/health`, per-stage latency
  sparklines from a client-side rolling buffer of `latency` events, model
  residency + unified-memory bar, barge-in/error session counters).
- **`components/mobile.js`** — the <860px shell + bottom sheets.
- **`components/util.js`** — shared helpers (`cls`, duration/clock/ts
  parsing, chip/button class recipes, task sorting/counting, sparkline
  points).
- **`visualizer/core.js`** — the intelligence core: 2D-canvas port of the
  prototype's renderer. Fibonacci-sphere lattice (118 points, 3-NN edges
  precomputed once), rotating projection with vertex noise, horizon
  ellipses, particle field, cached radial-gradient sprites for atmosphere +
  nucleus (no per-frame gradients, no shadowBlur), 10 mode overlays for the
  15 states, exponential blending `1−e^(−dt/95)` (~300 ms settle, never
  snaps), one rAF, DPR cap 2, rAF pause on hidden tab, degradation ladder
  (drop particles → drop horizon → halve lattice) and reduced-motion static
  frame with dashed state ring. Speaking amplitude reads audio-out
  `getLevels()` (RMS + low/mid/high tilt the spectrum spokes) with server
  `tts.amp` as fallback; listening ripples ride the real mic rms; memory
  stars are the actual `memory.hits` items pulled inward on tethered arcs;
  `done` fires exactly one outward pulse ring.
- **`visualizer/states.js`** — the 15-state parameter table (verbatim from
  the prototype's `CORE`) + `STATE_META` caption microcopy + accent helper.
  `offline` is client-derived (WS not open); the other 14 come from the
  server FSM 1:1 — the UI never fakes states.
- **`visualizer/index.js`** — public API, UNCHANGED from the three.js era:
  `createVisualizer(canvas)` → `setState / onAmp / onMicLevel /
  onMemoryHits / setAudioSource / setReducedMotion / resize / destroy`.
  The visualizer is recreated when the layout crosses the 860px shell
  boundary (the canvas element changes); state is re-applied on rebind.
- **`store.js`** — pub/sub store + `useStore`, capped-array helper, rolling
  p50/p95 latency tracker (now also exposes `series(stage)` for the
  sparklines). High-frequency signals (mic rms ~20 Hz, tts.amp ~30 Hz,
  analyser levels per frame) still bypass the store entirely.
- **`ws.js`, `audio-in.js`, `audio-out.js`, `worklets/`, `sdk.js`, `h.js`**
  — UNTOUCHED battle-tested transport/audio layer (see §Mic behavior).

## Store shape

Pre-redesign keys are unchanged (`connection, offline, fsmState, fsmDetail,
sttPartial, sttFinal, mediatorText, ttsPlaying, micActive, micMode,
reducedMotion, volume, timeline, tasks, memoryHits, health, latency,
micError, micHint`) plus the redesign keys `tab · sheet · expandedTask ·
verbose` and supporting state (`w, turns, speakingText, toolChip, turnId,
turnLatency, taskDetail, memQuery, memResults, bargeIns, errCount, tick,
retryAttempt, retryAt, lastEventTs, offlineDismissed`).

## Keyboard & accessibility

Space = hold-to-talk (unchanged) · Esc = interrupt (barge_in + hardStop) ·
1·2·3 = Work/Activity/System tabs · ⌘K/Ctrl-K = focus composer. Mic button
carries `aria-pressed`; tabs are `role=tab` with `aria-selected`; partial
transcript, streamed reply and the state caption are `aria-live=polite`
regions; `:focus-visible` gets a 2px accent outline. Reduced motion (button
or OS preference) renders a static core frame with a dashed state ring and
stops all CSS animation; the offline card is a **non-blocking** status sheet
(pointer events pass through around it), never a modal.

## Protocol assumptions (beyond docs/SPEC.md)

Everything listed in the pre-redesign README still holds (`buildWsUrl`
fallback, `window.HERMES_BASE_PATH`, `GET /tasks` array-or-`{tasks}` shape,
local `updated_ts` stamping, `mode.set` not persisted). New ones:

- **Spoken-sentence highlight** matches the latest `tts.start` `text`
  against the streamed `mediatorText` with `indexOf`; if the sentence isn't
  in the stream yet, no highlight is shown (never guessed).
- **`memory.hits` enrichment**: the event only carries `{path,title,score}`,
  so the UI re-queries `GET /memory/search` (q = last user utterance, falls
  back to the first hit's title) and merges by path — event scores win,
  stale responses are dropped. Cards render fine without enrichment.
- **`GET /tasks/{id}`** is parsed defensively: events from `events` /
  `task_events`, task fields from the body or a nested `task`.
- **Task elapsed** prefers `started`/`created` timestamps (epoch s, epoch
  ms, or ISO — all parsed); falls back to the locally-stamped `updated_ts`.
- **Retry countdown** in the offline sheet mirrors ws.js's documented
  1→2→4→8→10s backoff client-side (ws.js exposes no timer); attempts are
  inferred from reconnect status transitions, so the number is a faithful
  approximation, not a server value.
- **Unified-memory bar** renders only when `/health` provides
  `ram.total_gb`; with `free_gb` alone it shows the number without a bar
  (nothing invented).
- **turn id** comes from the `turn_id` field any event may carry; "TURN —"
  until the first one arrives.

## Layout & host integration

The `:has(> #jarvis-voice-root)` wrapper-padding neutraliser and its
`@supports` fallback are KEPT VERBATIM in `src/style.css` (see that file's
comment for the rationale), and the JS viewport-height pinning stays in
`app.js` — the host mounts us under a `display:contents` parent whose block
wrapper is content-sized, so the root's height is pinned to
`window.innerHeight - top` on resize/mutation.

## Mic behavior

Unchanged from the pre-redesign implementation (click = toggle, Space =
true push-to-talk, AudioContext.resume() before getUserMedia, linear-interp
resampling at the real device rate, silence hint 2s after start, error
banner mapping). `node ui/test-resample.mjs` still unit-verifies the
worklet's resampling math. The mic level meter and mic-button ring are
written straight to the DOM at level-callback frequency; the visualizer
consumes the same rms via `onMicLevel`.

## Dev harness

`ui/dev-harness.html` (from `file://` or any static server, after
`npm install` + `./build.sh`):

- **Full-app mode** (default): mounts the real bundle's App with React 18
  UMD from `node_modules`, a fake WebSocket jarvisd feed and stubbed
  `/api/plugins/jarvis-voice/*` endpoints. Pills for all 15 states,
  ▶ RUN TURN scripted pipeline pass, `memory.hits` / `task.update`
  injectors, go-offline toggle (drives real reconnect + offline sheet), and
  width presets **1440 / 1024 / 390** for the responsive check.
- **Visualizer-only mode**: `?vis=1` — drives the core directly (state
  pills, mic slider, analyser stub, reduced-motion) with no React.
- Query params: `?vis=1 · ?state=<name> · ?demo=1 · ?w=390`.

## Build output (last verified)

```
index.js           ~75 KB raw / ~20 KB gzip   (was ~581 KB raw with three.js)
style.css          ~40 KB raw / ~8 KB gzip    (tokens + hand layer + utilities)
mic-worklet.js     ~2.3 KB
player-worklet.js  ~1.5 KB
```
