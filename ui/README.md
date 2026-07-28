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

Run `node ui/test-resample.mjs` to unit-verify the mic-worklet's linear
resampling math in isolation (no browser/AudioWorklet runtime needed) — see
§Mic behavior.

## File map (`src/`)

- **`index.js`** — entry point. Guards on both host globals being present
  (mirrors the placeholder's contract), then registers `App` under the exact
  name `"jarvis-voice"`.
- **`app.js`** — top-level component. Wires `store` + `ws` + `audio-in` +
  `audio-out` + `visualizer` together and renders the overall layout: header
  (title, connection badge, settings gear), center stage (canvas, mic button +
  level meter, mode toggle, mic error/hint banner, scrollable transcript +
  mediator reply), right column, bottom text input, settings popover, offline
  overlay. Root element carries `id="jarvis-voice-root"` (see `style.css`
  below). Owns mic control (click-to-toggle + held Spacebar push-to-talk) and
  barge-in wiring — see §Mic behavior.
- **`ws.js`** — `createJarvisSocket()`: WebSocket client for
  `/api/plugins/jarvis-voice/ws` per `../docs/SPEC.md` §WebSocket. Handles the
  JSON/binary framing (a binary frame only means something right after a
  `tts.chunk_hdr` text frame) and capped-exponential-backoff reconnect
  (1s → 10s).
- **`audio-in.js`** — `createMicInput()`: `getUserMedia` → `mic-worklet.js` →
  16kHz mono s16le `ArrayBuffer` chunks (~40ms) + rms level callback + error
  callback. Builds the audio graph once and keeps it alive across
  toggle/PTT sessions; only a flag gates whether captured chunks are
  forwarded. See §Mic behavior for the capture-reliability fixes.
- **`style.css`** — also carries the host-integration rule that neutralizes
  the Hermes dashboard SPA's wrapper padding around this plugin (see §Layout
  & host integration below).
- **`audio-out.js`** — `createAudioOutput()`: queues incoming TTS PCM chunks
  into `player-worklet.js`'s ring buffer for gapless playback; `hardStop()`
  for barge-in; naive linear resample if the browser doesn't honor a 24kHz
  `AudioContext`. Also hosts the visualizer's AnalyserNode tap (worklet →
  gain → analyser → destination): `getLevels()` returns time-domain RMS +
  low/mid/high frequency bands of the audio actually being heard, read once
  per frame by the visualizer.
- **`visualizer/`** — `createVisualizer(canvas)`: Three.js cinematic orb
  scene (bundled `three`, tree-shaken + minified). The orb (noise-displaced
  wireframe icosahedron + backside additive Fresnel glow shell) and the
  background particle field are ported from jincocodev/openclaw-jarvis-ui
  (ISC — see `../THIRD_PARTY_LICENSES`). One distinct behavior per FSM state
  (`visualizer/states.js`), ≤300ms blended transitions, memory.hits
  constellation (`onMemoryHits`), DPR-capped rendering, hidden-tab pause,
  reduced-motion static mode, WebGL context-loss recovery. Same imperative
  `setState/onAmp/onMicLevel` API as before (plus `setAudioSource`,
  `onMemoryHits`), deliberately kept outside React state.
  Eyeball it without Hermes via `ui/dev-harness.html` (works from `file://`
  or any static server; `?state=<name>`, `?demo=1`).
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

## Layout & host integration

The Hermes dashboard host mounts this plugin's root directly inside a wrapper
`<div>` that carries Tailwind utility padding we cannot edit (host SPA source
is out of scope): classes include `... flex min-w-0 min-h-0 flex-1 flex-col
px-3 sm:px-6 pt-2 sm:pt-4 lg:pt-6`. `style.css` neutralizes exactly that
wrapper — and only that wrapper — with:

```css
div.flex-1.flex-col:has(> #jarvis-voice-root),
div:has(> #jarvis-voice-root) {
  padding: 0 !important;
}
```

The `:has(> #jarvis-voice-root)` guard is what makes this safe: it can only
ever match an element that is the direct parent of this plugin's uniquely-ID'd
root, so it never restyles any other host page or plugin regardless of how
loosely the left-hand class selector is written. A `@supports not
selector(:has(a))` fallback applies a matching negative margin directly on
`#jarvis-voice-root` for browsers without `:has()` support; it's gated so it
never doubles up once `:has()` does apply.

Layout is a strict flex column, sized to fill the host's `flex-1` column
(`.jv-root { flex: 1 1 auto; height: 100%; min-height: 0; overflow: hidden;
display: flex; }`) — **no document-level scrolling** on `/jarvis` at any
window size. The only scroll containers are:
- `.jv-rightcol` (Activity / Tasks / Memory / Health) — `overflow-y: auto;
  min-height: 0`.
- `.jv-stage-text` (transcript + mediator reply, wrapped together under the
  canvas) — capped at `min(40%, 18rem)` with its own `overflow-y: auto`, so a
  long reply scrolls internally instead of growing the page.

The bottom text-input bar (`.jv-textbar`) is `flex: none`, so it stays pinned
to the bottom of the column.

## Mic behavior

- **Click = toggle, Space = push-to-talk.** Clicking the mic button starts
  capture and streaming (`{"t":"mic.start"}`); a second click stops it
  (`{"t":"mic.stop"}`). Holding the Spacebar (when focus isn't in a text
  input) is separate, true push-to-talk: keydown starts, keyup stops — same
  underlying `startPtt`/`stopPtt` as the click toggle. This replaced the old
  pointerdown/pointerup wiring, where a normal desktop click (press+release,
  ~50ms) started capture on press and immediately stopped it on release,
  streaming zero audio — the exact "I cannot talk into it" bug this fixed.
  While toggled on, the server's VAD still endpoints individual utterances
  (`stt.final` etc.) even though the mic stays open the whole time.
- **AudioContext resume() happens first, inside the click/keydown call
  chain**, before `getUserMedia` is even requested — some browsers (Safari
  especially) can drop "user activation" if `resume()` has to wait behind a
  permission prompt that might sit open indefinitely. `audio-in.js` checks
  `ctx.state === "running"` after resuming and reports an error if it isn't.
- **Resampling never assumes 16kHz.** The real `AudioContext.sampleRate` is
  read back (Safari ignores a `sampleRate` hint on the constructor) and
  passed to the worklet via `processorOptions.sourceSampleRate`.
  `worklets/mic-worklet.js` resamples with **linear interpolation**, which
  handles non-integer ratios correctly (44100→16000 = 2.75625) — the previous
  accumulate-and-average decimator was replaced for exactly this reason.
  `ui/test-resample.mjs` unit-verifies the interpolation math in isolation
  (`node ui/test-resample.mjs`): correct output-length ratio, no NaN, no
  clipping, on more than one non-integer ratio.
- **Visible mic level meter** (`.jv-mic-level-track`/`-fill`, next to the mic
  button) is driven directly by the worklet's per-chunk `rms`, written
  straight to the DOM (`style.width`) at ~20Hz — bypassing React state
  entirely, same rationale as `visualizer.js`'s `onMicLevel()` (see
  `store.js`'s header comment). `vis.onMicLevel(rms)` still receives the same
  callback as before, so the canvas ripple is unaffected.
- **Error/hint banner** (`.jv-mic-banner`, next to the mic button) surfaces:
  - `getUserMedia` failures, mapped to plain language (permission denied, no
    device, device busy, unsupported constraints).
  - Insecure-context detection: if the page is served over plain `http://` on
    a non-localhost host, `getUserMedia` doesn't exist at all —
    `window.isSecureContext` is checked explicitly so this shows a clear
    message instead of a confusing `TypeError`.
  - Worklet load failures: `audioWorklet.addModule()` rejections are caught
    and re-thrown as `"mic init failed: <original error>"`.
  - A **silence hint**: if 2s after mic start, chunks are genuinely flowing
    (`getChunkCount() > 0`, proving the capture graph itself works) but the
    level stayed near-zero and the server never showed real transcription
    activity (`stt.partial`/`stt.final`, or an FSM `state` beyond the initial
    `listening` ack), the banner reads "Mic level is silent — check input
    device/permissions" — this is almost always the wrong/muted input device,
    not a bug in this UI.
  - The banner has a dismiss (×) button; it also self-clears once real STT
    activity is observed.

## Build output (last verified)

```
index.js           ~581 KB raw / ~150 KB gzip (three.js bundled, minified)
mic-worklet.js      ~2.3 KB
player-worklet.js  ~1.5 KB
style.css          ~15 KB
```
