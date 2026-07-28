# OpenJarvis animation/visualization research

Date: 2026-07-28
Scope: locate the repo behind "OpenJarvis github repository ... animation and great looks," analyze the
visual/animation code, and assess porting it into `hermes-jarvis-voice`'s UI (esbuild IIFE, no React
framework dependency, host dashboard supplies React as a global for its own widgets only).

## 0. Bottom line

**"OpenJarvis" the exact name is a false lead.** `github.com/open-jarvis/OpenJarvis` (8.1k★, Stanford
Hazy Research / Scaling Intelligence Lab, Apache-2.0) is a serious local-first agent *framework* — its
web frontend is a plain utilitarian dashboard (Energy/Savings/Trace panels, React + Vite). There is no
orb, no shader, no particle system, no `three`/`webgl`/`shader`/`particle` anywhere in `frontend/src`
(confirmed by grep across the full tree — the only `webgl` hit is a throwaway GPU-vendor sniff in
`GetStartedPage.tsx`, unrelated to visualization).

The repo that actually matches "Jarvis-style voice assistant with a striking animated orb/HUD UI" is:

**`github.com/jincocodev/openclaw-jarvis-ui`** — a JARVIS-style HUD for OpenClaw agents, Three.js orb,
audio-reactive, exactly the aesthetic being described. It most likely got misremembered/mistagged as
"OpenJarvis" because it's a Jarvis-branded UI, small (26★), and its own `package.json` `description`
literally reads "OpenClaw 的互動介面原型（JARVIS 風格 HUD）" (JARVIS-style HUD interface prototype for
OpenClaw). This is the repo the rest of this document analyzes in depth.

Screenshot confirms the look (see `assets/images/desktop-red.png` in the clone, described in §4): a large
glowing wireframe icosahedron ("orb") with a soft red fresnel bloom, floating over a dim cityscape
background, surrounded by translucent dark HUD panels (System Status, Data Center/Tasks, Chat, Audio
spectrum) — cinematic Iron-Man-HUD look.

## 1. Repo identification

| Candidate | Stars | License | Verdict |
|---|---|---|---|
| `open-jarvis/OpenJarvis` | 8.1k | Apache-2.0 | Name matches exactly but **no animated UI** — utilitarian React dashboard. Ruled out. |
| `jincocodev/openclaw-jarvis-ui` | 26 | **ISC** | **Primary match.** Three.js orb + particle + audio-reactive HUD, exactly the described look. |
| `cyber1443/jarvis-ai-orb-web-animation` | 4 | MIT | Alternative — React component library, npm-installable. See §6. |
| `ethanplusai/jarvis` | 680 | Custom (non-commercial free, commercial needs license) | Alternative but license is a blocker for anything beyond personal use. See §6. |
| `lancejames221b/openjarvis` | — | — | Discord voice/text bot, no notable animated UI. Not relevant. |

Clones made under `/private/tmp/claude-502/-Users-agent-ai/a97ddb1a-d5ec-4391-a3a8-b1dc8cb73be2/scratchpad/openjarvis-research/`:
- `open-jarvis-OpenJarvis/` (depth 1, HEAD `08279e6b`, 2026-07-27)
- `jincocodev-openclaw-jarvis-ui/` (depth 1, HEAD `b1f212b8`, 2026-02-22, v1.0.3)

## 2. `jincocodev/openclaw-jarvis-ui` — license

**ISC License** (functionally equivalent to MIT — permissive, minimal conditions):

```
ISC License

Copyright (c) 2026 JincocoDev

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES...
```

**Reuse/porting: allowed**, commercially and non-commercially, with modification, with or without
attribution requirement beyond keeping the copyright+permission notice "in all copies" (i.e. keep the
LICENSE text alongside any copied source, or in a NOTICE/THIRD_PARTY_LICENSES file in the porting
target — do not need to preserve file structure or credit in the UI itself).

**Upstream provenance (important for attribution, not just the letter of the license):** the repo's own
README credits its origin explicitly:

> Based on the [Three.js Orb Visualizer](https://codepen.io/filipz/pen/yyyRgry) by
> [Filip Zrnzevic](https://codepen.io/filipz) — original concept, 3D orb design, and audio
> visualization. Adapted into an OpenClaw agent dashboard by Jincoco.

I could not confirm the CodePen pen's own license directly (codepen.io blocked the fetch, 403). CodePen's
platform default is that pen content is freely viewable/forkable but the pen author can set an explicit
license; absent verification, treat the *original CodePen concept* as "unclear license, common-knowledge
technique" and rely on the **ISC-licensed `openclaw-jarvis-ui` repo** as the actual code basis being
ported (it is a complete rewrite/adaptation, not a raw copy of the pen, and its ISC grant is what
legally covers copying its source). Recommendation: when porting, credit both in a NOTICE file — "orb
technique adapted from Filip Zrnzevic's Three.js Orb Visualizer (CodePen) via jincocodev/openclaw-jarvis-ui
(ISC)" — cheap insurance, costs nothing, avoids any ambiguity.

## 3. Where the animation code lives

Framework: **vanilla ES modules + Three.js (WebGL) + native Canvas2D + native Web Audio API.**
**No React anywhere in the animation/visual path** — this matters a lot for the porting question (§7).

```
src/core/scene.js       592 lines  — Three.js scene, camera, lights, the orb (shader-based), drag physics
src/core/particles.js    83 lines  — background particle field (Three.js Points, separate from DOM particles)
src/core/audio.js       342 lines  — Web Audio AnalyserNode setup, media-element source wiring, level calc
src/config/theme.js     128 lines  — HSL hue-rotation theme system (6 presets), CSS custom properties
src/components/spectrum.js 218 lines — Canvas2D: frequency bars, radial "ring" visualizer, oscilloscope waveform
src/main.js (excerpt)             — the rAF animation loop that ties audio analysis to scene + canvas draws
```

Not needed for porting just the orb/visualizer: `src/components/{chat,tasks,skills,memory,schedule,...}.js`
(OpenClaw-specific dashboard panels), `server/*` (Express+WebSocket backend for OpenClaw Gateway — entirely
inapplicable to us).

### How it works, mechanically

**The orb** (`scene.js`) is a `THREE.Group` containing two meshes sharing one radius (2 units):
1. **Outer wireframe sphere** — `IcosahedronGeometry` (detail = `resolution/8`, default resolution 32 → detail 4),
   rendered `wireframe: true`, with a custom `ShaderMaterial`. The vertex shader displaces each vertex along
   its normal by a **3D Simplex noise** (`snoise`, classic Ashima Arts implementation, inlined) function of
   position + slow time, scaled by a `distortion` uniform and `(1 + audioLevel)` — i.e. **louder audio = more
   distorted/spiky orb**. The fragment shader is a **Fresnel rim-light** (`pow(1 - dot(viewDir, normal), 2 +
   audioLevel*2)`) tinted by the theme's primary color, pulsing via `sin(time*2)`.
2. **Glow sphere** — a plain `SphereGeometry` 1.2× the radius, `THREE.BackSide`, `AdditiveBlending`,
   `depthWrite: false` — a second Fresnel shader (steeper power, 3 + audioLevel*3) that creates the soft
   outward bloom halo. This two-mesh (wireframe-core + backside-glow-shell) pattern is the actual "trick"
   behind the look — no post-processing bloom pass is used, it's a cheap geometric fake.

**Agent-state-driven "activity" (not audio):** a `setAgentState('idle'|'thinking'|'responding')` export, wired
to a `window` `CustomEvent('agent-state', ...)`, and `setStreamIntensity(val)` wired to `agent-stream` — this
is the exact hook a voice-assistant UI wants. Internally it computes a smoothed `agentActivity` scalar per
frame with different shaping per state (idle = 0; thinking = ramping value + layered irregular `sin` jitter to
read as "restless thinking"; responding = driven by `streamIntensity`, i.e. token-streaming speed, plus a slow
breathing sine) and a one-shot "done bloom" flash (exponential decay) when transitioning out of `responding`.
This `agentActivity` value currently feeds the *uniform* wiring only in comments/scaffolding (`agentActivity`
uniform exists in both shaders but the fragment/vertex code doesn't yet read it in the visible snapshot — the
real-time drive into the shaders is via the `audioLevel` uniform, with `agentActivitySmooth` computed but not
fully threaded into the shader math in this version. Worth checking the latest upstream commit if this
matters — it reads as a partially-wired feature).

**Background particles** (`createBackgroundParticles` in `scene.js`, 1000–3000 points depending on viewport):
a `THREE.Points` cloud with a `ShaderMaterial` — vertices drift via layered `sin/cos(time*0.1 + position*0.2)`,
fragment shader draws each point as a soft radial glow disc (`discard` outside radius 0.5, `pow(1-r*2, 2)`
falloff), `AdditiveBlending`. Colors are randomly assigned from the 3 theme colors (primary/secondary/tertiary).
A **second, independent** particle system (`src/core/particles.js`) exists as plain **DOM `div` elements**
(1000 of them, absolutely positioned, orbiting the screen center with per-particle noise + pulsing
size/opacity) — this is a CSS/DOM-based ambient background layer, separate from the WebGL one, presumably
for perf/parallax reasons or historical leftover from the original CodePen. For a from-scratch port, only one
of these two particle systems is needed (the WebGL one integrates better with the 3D orb's depth).

**Audio reactivity** (`audio.js` + `main.js` rAF loop): standard `AudioContext` → `AnalyserNode` (`fftSize =
2048`, `smoothingTimeConstant = 0.8`) → `createMediaElementSource(audioElement)` → analyser → destination.
Each frame: `analyser.getByteFrequencyData(frequencyData)` and `getByteTimeDomainData(audioData)` are read
**once** and fanned out to: `getAudioLevel()` (mean-normalized amplitude 0–1, feeds the orb's `audioLevel`
uniform and drives an "auto zoom-in" camera move via GSAP when audio starts/stops), the radial ring canvas,
the frequency-bar canvas, the oscilloscope canvas, and a DOM `#audio-wave` CSS transform/border-color pulse.
This "read once per frame, fan out everywhere" pattern is worth keeping — it's the right way to avoid
redundant `getByteFrequencyData` calls.

**Canvas2D visualizers** (`spectrum.js`): three independent HTML canvases —
- `drawSpectrumAnalyzer` — classic 256-bar frequency bar graph, per-bar hue offset (`hue + i/256*20`), grid
  lines + frequency axis labels (0/1K/2K/4K/8K/16K).
- `drawCircularVisualizer` — **3 concentric rings**, each sampling a different frequency band (low/mid/high
  split into thirds), radius modulated per-angle by the band's energy, radial gradient stroke + `shadowBlur:
  15` for glow. This is the "waveform rings around the orb" effect.
- `drawWaveform` — oscilloscope-style time-domain line; falls back to a synthetic 3-sine-wave squiggle with
  small random jitter when no audio is playing (keeps the UI alive/breathing even at idle).

**Theme/color system** (`theme.js`): a single `hue` (0–360, stored in `localStorage`) drives everything via
CSS custom properties computed with a hand-rolled `hslToRgb`. Formulas: `--accent-primary: hsl(hue, 100%,
63%)`, `--accent-secondary: hsl(hue, 62%, 47%)`, `--accent-tertiary: hsl(hue, 100%, 84%)`. 6 presets: red
(hue 5, the default/"Iron Man" red), orange (30), green (140), cyan (180), blue (220), purple (270). Changing
hue dispatches a `theme-change` event that `scene.js` listens for to rebuild the orb/particle materials with
new colors. Background is a fixed dark navy fog (`THREE.FogExp2(0x0a0e17, 0.05)`) regardless of theme.

## 4. Screenshots in the repo (visual reference)

`README.md` embeds (all under `assets/images/`):
- `desktop-red.png` — main preview, **fetched and viewed directly**: large wireframe-icosahedron orb with
  warm red/orange Fresnel glow bloom, floating mid-screen over a dim blue-toned cityscape photo background;
  four translucent dark HUD panels around it (top-left "SYSTEM STATUS" with CPU/memory/uptime/model/token
  bars; top-right "DATA CENTER" tabbed panel — Tasks/Skills/Memory/Schedule/Controls; bottom-left "CHAT" with
  bubble messages; bottom-right "AUDIO" with a live frequency-bar strip, demo track buttons, sensitivity
  slider). Faint scanning-text HUD flavor lines float behind the orb ("AUDIO FREQUENCY ANALYSIS: PEAK AT
  440HZ", "GSAP.TIMELINE({SMOOTHNESS: 0.85})", "SCANNING S..."). Overall read: dark cinematic sci-fi HUD,
  exactly the "Jarvis" aesthetic.
- `theme-cyan.png`, `theme-green.png` — same layout, different hue.
- `mobile.png` — responsive/mobile layout.
- `preview.png` — general preview (not individually inspected, redundant with desktop-red.png).

## 5. Core visual technique — key code

### 5a. The orb: noise-displaced wireframe + Fresnel glow shell (`src/core/scene.js`)

```js
function createAnomalyObject() {
  if (anomalyObject) scene.remove(anomalyObject);
  anomalyObject = new THREE.Group();
  const radius = 2;

  const outerGeometry = new THREE.IcosahedronGeometry(radius, Math.max(1, Math.floor(resolution / 8)));
  const outerMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new THREE.Color(themeColors.primary) },
      audioLevel: { value: 0 },
      distortion: { value: distortionAmount },
      agentActivity: { value: 0 },
    },
    vertexShader: `
      uniform float time; uniform float audioLevel; uniform float distortion; uniform float agentActivity;
      varying vec3 vNormal; varying vec3 vPosition;
      // --- classic Ashima Arts 3D simplex noise (snoise) inlined here, ~45 lines, omitted for brevity ---
      void main() {
        vNormal = normalize(normalMatrix * normal);
        float slowTime = time * 0.3;
        vec3 pos = position;
        float noise = snoise(vec3(position.x * 0.5, position.y * 0.5, position.z * 0.5 + slowTime));
        pos += normal * noise * 0.2 * distortion * (1.0 + audioLevel);
        vPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time; uniform vec3 color; uniform float audioLevel; uniform float agentActivity;
      varying vec3 vNormal; varying vec3 vPosition;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - max(0.0, dot(viewDirection, vNormal));
        fresnel = pow(fresnel, 2.0 + audioLevel * 2.0);
        float pulse = 0.8 + 0.2 * sin(time * 2.0);
        vec3 finalColor = color * fresnel * pulse * (1.0 + audioLevel * 0.8);
        float alpha = fresnel * (0.7 - audioLevel * 0.3);
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    wireframe: true,
    transparent: true,
  });
  const outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
  anomalyObject.add(outerSphere);
  scene.add(anomalyObject);

  // Glow sphere — the actual "bloom" fake: backside additive Fresnel shell, no post-processing needed
  const glowGeometry = new THREE.SphereGeometry(radius * 1.2, 32, 32);
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(themeColors.primary) },
                audioLevel: { value: 0 }, agentActivity: { value: 0 } },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vPosition; uniform float audioLevel; uniform float agentActivity;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position * (1.0 + audioLevel * 0.2);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal; varying vec3 vPosition;
      uniform vec3 color; uniform float time; uniform float audioLevel; uniform float agentActivity;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - max(0.0, dot(viewDirection, vNormal));
        fresnel = pow(fresnel, 3.0 + audioLevel * 3.0);
        float pulse = 0.5 + 0.5 * sin(time * 2.0);
        float audioFactor = 1.0 + audioLevel * 3.0;
        vec3 finalColor = color * fresnel * (0.8 + 0.2 * pulse) * audioFactor;
        float alpha = fresnel * (0.3 * audioFactor) * (1.0 - audioLevel * 0.2);
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glowSphere = new THREE.Mesh(glowGeometry, glowMaterial);
  anomalyObject.add(glowSphere);

  return function updateAnomaly(time, audioLevel) {
    // state → target activity shaping (idle/thinking/responding), smoothed, then pushed into uniforms
    // (full state machine ~40 lines, see src/core/scene.js:331-373 in the clone)
    outerMaterial.uniforms.time.value = time;
    outerMaterial.uniforms.audioLevel.value = audioLevel;
    glowMaterial.uniforms.time.value = time;
    glowMaterial.uniforms.audioLevel.value = audioLevel;
  };
}
```

### 5b. Agent-state → orb activity shaping (`src/core/scene.js:331-373`)

```js
if (agentActivity === 0) {
  targetActivity = 0;                                   // idle: still, like the original CodePen
} else if (agentActivity === 1) {                        // thinking: ramps up + irregular jitter
  const ramp = 0.5 + Math.min(elapsed / 10, 1) * 1.5;
  const jitter = Math.sin(elapsed * 2.3) * 0.12 + Math.sin(elapsed * 5.7) * 0.08 + Math.sin(elapsed * 11.3) * 0.04;
  targetActivity = ramp + jitter;
} else if (agentActivity === 2) {                        // responding: driven by token-stream speed
  streamIntensitySmooth += (streamIntensity - streamIntensitySmooth) * 0.1;
  targetActivity = 0.8 + streamIntensitySmooth * 1.5 + Math.sin(time * 1.2) * 0.1;
}
if (doneBloom > 0.01) { targetActivity += doneBloom * 2.5; doneBloom *= 0.95; } // one-shot flash on completion
const smoothSpeed = agentActivity === 0 ? 0.02 : 0.06;
agentActivitySmooth += (targetActivity - agentActivitySmooth) * smoothSpeed;
```

### 5c. Audio analyser wiring (`src/core/audio.js`, trimmed)

```js
audioContext = new (window.AudioContext || window.webkitAudioContext)();
audioAnalyser = audioContext.createAnalyser();
audioAnalyser.fftSize = 2048;
audioAnalyser.smoothingTimeConstant = 0.8;
audioData = new Uint8Array(audioAnalyser.frequencyBinCount);
frequencyData = new Uint8Array(audioAnalyser.frequencyBinCount);
audioAnalyser.connect(audioContext.destination);
// ...
audioSource = audioContext.createMediaElementSource(audioElement);
audioSource.connect(audioAnalyser);
// ...
export function getAudioLevel(audioSensitivity) {
  let sum = 0;
  for (let i = 0; i < frequencyData.length; i++) sum += frequencyData[i];
  return ((sum / frequencyData.length / 255) * audioSensitivity) / 5;
}
```

### 5d. Per-frame driver (`src/main.js`, the rAF loop)

```js
function animate(now) {
  requestAnimationFrame(animate);
  if (window.__jarvisHiddenPause?.()) return;               // pause when tab hidden
  if (isPowerSave() && now - lastFrameTime < 66) return;      // throttle to ~15fps in power-save
  const analyser = getAnalyser(), frequencyData = getFrequencyData(), audioData = getAudioData();
  let audioLevel = 0;
  if (analyser && !isPowerSave()) {
    analyser.getByteFrequencyData(frequencyData);             // read ONCE per frame
    analyser.getByteTimeDomainData(audioData);
    audioLevel = getAudioLevel(audioSensitivity);              // then fan out to everything below
    drawCircularVisualizer(frequencyData, audioSensitivity, audioReactivity);
    drawSpectrumAnalyzer(frequencyData, audioSensitivity);
    updateAudioWave(audioReactivity, audioSensitivity);
  }
  animateScene(audioLevel, rotationSpeed, audioReactivity);    // orb + particles + render
}
```

### 5e. Color/theme formula (`src/config/theme.js`)

```js
export function setThemeHue(hue) {
  root.style.setProperty('--hue', hue);
  const primary = hslToRgb(hue, 100, 63);     // --accent-primary
  const secondary = hslToRgb(hue, 62, 47);    // --accent-secondary
  const tertiary = hslToRgb(hue, 100, 84);    // --accent-tertiary
  // ... set CSS vars, persist to localStorage, dispatch 'theme-change' for scene.js to pick up
}
export const THEME_PRESETS = [
  { name: '紅色', hue: 5 }, { name: '橙色', hue: 30 }, { name: '綠色', hue: 140 },
  { name: '青色', hue: 180 }, { name: '藍色', hue: 220 }, { name: '紫色', hue: 270 },
];
```
Background fog/void color is fixed: `new THREE.FogExp2(0x0a0e17, 0.05)` — a near-black navy, independent of theme hue.

## 6. Alternatives surveyed

**`cyber1443/jarvis-ai-orb-web-animation`** (npm: `jarvis-ai-web-animation`, MIT, 4★): a React component
library — Three.js orbital rings + luminescent core + particle systems + bloom/glow, four mood states
(idle/thinking/success/alert) plus custom state objects (energy, rotation speed, particle velocity, bloom
intensity), three built-in palettes (Cyan/Aurora/Ember), device-adaptive quality (auto/ultra/high/balanced/
performance), pauses via `IntersectionObserver` when off-screen, respects `prefers-reduced-motion`, SSR-safe,
~210KB gzipped. MIT is maximally permissive. **Caveat: it's a React component** — usable only if the host
page's React (the "global React" hermes-jarvis-voice's dashboard host provides) is compatible and the
package's peer-dependency React version matches; otherwise it pulls in its own bundled React tree, working
against the "no React deps" goal. Reasonable fallback if a ready-made polished component is preferred over
hand-porting, but not obviously better than jincocodev's vanilla-JS code for the "own esbuild IIFE, no
framework" architecture goal.

**`ethanplusai/jarvis`** (680★, Three.js particle-based audio-reactive orb, "deforms and pulses in response
to audio," Vite+TypeScript+Three.js frontend): more popular and MCU-styled, but ships under a **custom
license — "Free for personal, non-commercial use. Commercial use requires a license."** That is a hard
blocker for anything beyond a private/non-commercial tool; do not port code from this repo without a
separate commercial license from the author. Mentioned for completeness, not recommended as a source.

Not deep-dived (time-boxed): `alexanderqchen/orb-ui` (React voice-AI component library w/ adapters for
Vapi/ElevenLabs/LiveKit/OpenAI Realtime — same "React dependency" caveat as cyber1443's), `aguscruiz/voiceorb`
(Three.js + custom GLSL "simple orb that reacts to voice," small/unaudited).

**Recommendation:** `jincocodev/openclaw-jarvis-ui`'s vanilla-JS core (§3) is the best fit for
hermes-jarvis-voice specifically because it has zero framework coupling already — no React to strip out,
no adapter layer to reverse-engineer. It is also the closest visual/behavioral match to what was described
(orb + HUD panels + audio-reactive rings, state-driven idle/thinking/responding).

## 7. Porting assessment — plain-JS canvas/WebGL bundle, no React

**Verdict: straightforward.** The entire visual/animation stack in `jincocodev/openclaw-jarvis-ui` is
already vanilla ES modules with zero React/framework dependency — this is not a "strip React out" job,
it's closer to a "copy files, swap the wiring" job.

**Dependencies actually used by the animation path:**
- `three` (^0.175.0) — core (`Scene`, `PerspectiveCamera`, `WebGLRenderer`, `IcosahedronGeometry`,
  `SphereGeometry`, `BufferGeometry`/`Points`, `ShaderMaterial`, `Group`, `Mesh`, `Color`, `Clock`,
  `FogExp2`, `AmbientLight`/`DirectionalLight`/`PointLight`, `Raycaster`, `Vector2`/`Vector3`) plus the
  `OrbitControls` addon (`three/addons/controls/OrbitControls.js` — only used with rotate/zoom/pan all
  disabled, purely for its damping-based idle micro-motion feel; could be dropped entirely and replaced
  with ~10 lines of manual camera easing if every KB matters).
- `gsap` (^3.14.2) — used for exactly one thing: tweening camera z/y position on audio start/stop
  (`zoomCameraForAudio`). Trivially replaceable with a hand-rolled `requestAnimationFrame` ease-out lerp
  (10-15 lines), dropping a ~40-50KB dependency entirely if desired.
- Native Web Audio (`AudioContext`, `AnalyserNode`) and native Canvas2D — zero dependency cost.

**Bundle size estimate for an esbuild IIFE build:** `three` tree-shakes reasonably well for this feature
set (no loaders, no post-processing, no advanced materials) — expect roughly 130-180KB min+gzip for the
`three` core subset actually imported, +~5-8KB for `OrbitControls` if kept, +~10-20KB for the ported
scene/particles/audio/spectrum glue code. Dropping GSAP saves ~40-50KB. **All-in estimate: ~150-220KB
gzipped** as a single bundled asset — reasonable for a voice-assistant UI loaded once, not embedded
per-request.

**Integration points that map cleanly onto a typical voice-assistant state machine:**
- `setAgentState('idle'|'thinking'|'responding')` — already shaped exactly like listening/thinking/speaking.
- `setStreamIntensity(val)` — natural hook for LLM token-streaming rate if the UI streams text.
- `audio.js`'s `setupAudioSource(audioElement)` — for **agent speech (TTS) reactivity**, point it at
  whatever `<audio>` element plays TTS output. For **user mic reactivity** (if the UI should also react
  to the user talking, not just the agent), swap `createMediaElementSource` for
  `createMediaStreamSource(micStream)` on a second analyser, or multiplex one analyser between sources
  depending on who's "speaking" — not present in the original (it's TTS-out only), a genuine gap to
  design for if bidirectional reactivity is wanted.
- Theme system (`theme.js`) is a single `hue` (0-360) driving 3 CSS custom properties — trivial to wire to
  a brand color or make user-configurable; the shaders read colors via `themeColors.primary/secondary/
  tertiary` computed from those CSS vars, so no shader changes needed to reskin.

**What needs rewriting rather than copying verbatim:**
- Anything in `src/components/*` (chat/tasks/skills/memory/schedule) — those are OpenClaw-Gateway-specific
  dashboard panels, not applicable; skip entirely, keep only `core/` + `config/theme.js` +
  `components/spectrum.js`.
- HTML/CSS scaffolding (`index.html`, `style.css`) assumes specific element IDs
  (`three-container`, `spectrum-canvas`, `circular-canvas`, `waveform-canvas`, `audio-wave`,
  `rotation-slider`, `file-label`) — the port needs to either adopt these IDs or thread the DOM refs through
  as constructor params instead of hardcoded `document.getElementById` calls (the current code
  hardcodes IDs at module-load time in a couple of spots — worth refactoring to accept elements as
  arguments so it's embeddable as a self-contained widget rather than assuming it owns the whole page).
- The `agentActivity` uniform is declared in both shaders but not fully read in the shader math shown
  above (only `audioLevel` is) — if state-driven visual distinction (not just audio-driven) matters, that
  wiring needs finishing as part of the port, not just copied as-is.

**No React stripping needed** — restates the main finding: this specific source tree never imported React,
so the "esbuild IIFE, host supplies React only for its own widgets" constraint is satisfied automatically
by choosing this codebase over the React-based alternatives (cyber1443, alexanderqchen) in §6.

## 8. License compliance checklist for the port

1. Copy the ISC `LICENSE` text (or a summary + link) into a `THIRD_PARTY_LICENSES` / `NOTICE` file in
   `hermes-jarvis-voice`, attributing `jincocodev/openclaw-jarvis-ui`.
2. Add a one-line credit for the original CodePen concept (Filip Zrnzevic, "Three.js Orb Visualizer") —
   not strictly required by ISC but closes the provenance chain the upstream README itself documents, and
   costs nothing.
3. Do not import anything from `open-jarvis/OpenJarvis` (Apache-2.0) — it was investigated but nothing
   from it is being used, so its (heavier) Apache-2.0 NOTICE/attribution requirements don't apply.
4. If `ethanplusai/jarvis` is ever referenced for inspiration, do not copy its code — its license
   prohibits commercial use without a separate license from the author.
