# jarvis-voice dashboard UI

Real frontend for the Jarvis voice assistant Hermes dashboard plugin. Bundled
with esbuild into a single IIFE plus two standalone AudioWorklet files;
consumed by `hermes-plugin/dashboard/manifest.json` (`entry`/`css`) and the
Hermes dashboard host, which injects `window.__HERMES_PLUGIN_SDK__` /
`window.__HERMES_PLUGINS__` before loading the script (see
`../docs/hermes-plugin-api.md` §Frontend SDK).

React is **not bundled** — components are built with a tiny `h()` helper
(`src/h.js`) bound to `window.__HERMES_PLUGIN_SDK__.React.createElement` at
runtime, so the shipped bundle only contains this plugin's own code.

## Build

```sh
cd ui
npm install     # once — installs the esbuild devDependency
./build.sh
```

`build.sh` uses `node` at `/opt/homebrew/bin/node` by default (override with
`NODE_BIN=...`), but in current esbuild versions `node_modules/esbuild/bin/esbuild`
is a native binary invoked directly, not a Node script.

Output goes to `../hermes-plugin/dashboard/dist/`:

| File | What |
|---|---|
| `index.js` | IIFE bundle of `src/index.js` and everything it imports. Registers via `window.__HERMES_PLUGINS__.register("jarvis-voice", App)`. |
| `style.css` | Copied verbatim from `src/style.css`. |
| `mic-worklet.js` | `AudioWorkletProcessor` bundle, loaded at runtime via `audioContext.audioWorklet.addModule(...)`. Self-contained (no imports). |
| `player-worklet.js` | Same, for TTS playback. |

`build.sh` fails the build if `dist/index.js` doesn't contain the literal
registration call, so a broken bundle can't silently ship.

## File map (`src/`)

- **`index.js`** — entry point. Guards on both host globals being present
  (mirrors the placeholder's contract), then registers `App` under the exact
  name `"jarvis-voice"`.
- **`app.js`** — top-level component. Wires `store` + `ws` + `audio-in` +
  `audio-out` + `visualizer` together and renders the overall layout: header
  (title, connection badge, settings gear), center stage (canvas, PTT button,
  mode toggle, transcript, mediator reply), right column, bottom text input,
  settings popover, offline overlay. Owns push-to-talk (pointer + held
  Spacebar) and barge-in wiring.
- **`ws.js`** — `createJarvisSocket()`: WebSocket client for
  `/api/plugins/jarvis-voice/ws` per `../docs/SPEC.md` §WebSocket. Handles the
  JSON/binary framing (a binary frame only means something right after a
  `tts.chunk_hdr` text frame) and capped-exponential-backoff reconnect
  (1s → 10s).
- **`audio-in.js`** — `createMicInput()`: `getUserMedia` → `mic-worklet.js` →
  16kHz mono s16le `ArrayBuffer` chunks (~40ms) + rms level callback. Builds
  the audio graph once and keeps it alive across PTT presses; only a flag
  gates whether captured chunks are forwarded.
- **`audio-out.js`** — `createAudioOutput()`: queues incoming TTS PCM chunks
  into `player-worklet.js`'s ring buffer for gapless playback; `hardStop()`
  for barge-in; naive linear resample if the browser doesn't honor a 24kHz
  `AudioContext`.
- **`visualizer.js`** — `createVisualizer(canvas)`: the cinematic
  particle/ring canvas engine, one render mode per FSM state, with a
  `setState/onAmp/onMicLevel` imperative API deliberately kept outside React
  state (see the file's header comment for why).
- **`panels.js`** — right column (Activity timeline, Tasks board, Memory
  sources, Health), the settings popover, the bottom text-input bar, and the
  connection badge / offline overlay.
- **`store.js`** — tiny framework-agnostic pub/sub store plus a `useStore()`
  hook, a capped-array helper for the timeline, and a rolling p50/p95 latency
  tracker.
- **`sdk.js`** — all access to `window.__HERMES_PLUGIN_SDK__` /
  `__HERMES_PLUGINS__` / `__HERMES_SESSION_TOKEN__` goes through here:
  `fetchJSON`, `authedFetch`, `buildSocketUrl` (prefers the SDK's
  `buildWsUrl`/`buildWsAuthParam` if present, else builds the URL manually),
  `assetUrl` (worklet file URLs).
- **`h.js`** — `h(type, props, ...children)` bound to the SDK's React.
- **`worklets/mic-worklet.js`**, **`worklets/player-worklet.js`** —
  `AudioWorkletProcessor` sources. Bundled separately (not part of the main
  IIFE) since worklets run in their own global scope.

## Protocol assumptions made (verify against a live jarvisd if behavior looks off)

- **`buildWsUrl`/`buildWsAuthParam`**: documented in `../docs/hermes-plugin-api.md`
  but not found anywhere in the actual Hermes source available at build time
  (only in this repo's own docs). `sdk.js` calls them if present and falls
  back to manually building `ws(s)://<host>/api/plugins/jarvis-voice/ws?token=...`
  from `window.__HERMES_SESSION_TOKEN__` if not — this is the fallback the
  task spec itself calls for.
- **`window.HERMES_BASE_PATH`**: does not exist anywhere in the current
  Hermes build or any sibling plugin (`crypto-trader`, `signal-engine`) —
  those hardcode `/dashboard-plugins/<plugin>/dist/...`. `assetUrl()` still
  checks it defensively (`window.HERMES_BASE_PATH || ""`) as a no-cost hook
  in case a path prefix is added later.
- **`GET /tasks` response shape**: SPEC.md says "task list" without pinning
  down whether it's a bare array or `{tasks: [...]}`. `app.js`'s
  `tasksFromResponse()` accepts either.
- **`task.update` ordering**: the store stamps a local `updated_ts` on
  receipt (the wire event has no timestamp field) so the Tasks board can sort
  by most-recently-touched.
- **`mode.set` persistence**: intentionally NOT persisted to localStorage
  (unlike `reducedMotion` and `volume`, which the task spec explicitly calls
  out) — VAD mode is marked experimental, so every fresh page load starts
  back in push-to-talk as the conservative default.
- **`worker_progress` visual**: SPEC's `task.update` payload has no numeric
  progress fraction, so this state renders an indeterminate rotating progress
  arc rather than a value-driven one — it's still purely a function of the
  FSM state (a real server-pushed signal), not fabricated per-frame data.

## Build output (last verified)

```
index.js           ~47 KB
mic-worklet.js      ~2 KB
player-worklet.js  ~1.5 KB
style.css          ~11 KB
```
