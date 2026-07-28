// visualizer/index.js — Three.js cinematic orb scene, replacing the old 2D
// canvas engine. Orb + background field ported from
// jincocodev/openclaw-jarvis-ui (ISC, see THIRD_PARTY_LICENSES); state
// choreography, overlays and the memory constellation are local.
//
// Public API (superset of the old visualizer, so app.js wiring stays thin):
//   createVisualizer(canvas) -> {
//     setState(state, detail)   FSM state from the server (SPEC §WebSocket)
//     onAmp(v)                  server tts.amp fallback (used only when the
//                               local AnalyserNode tap is unavailable)
//     onMicLevel(v)             mic worklet rms (drives listening ripple)
//     onMemoryHits(items)       memory.hits payload -> constellation
//     setAudioSource(fn)        audio-out.js getLevels; read ONCE per frame
//     setReducedMotion(v)       static orb + text state instead of animation
//     resize() / destroy()
//   }
//
// Never fakes activity: every motion is a function of the server FSM state
// (+ time in state), the analyser level of audio actually being heard, the
// mic rms, or one-shot impulses triggered by real state entries.
import { WebGLRenderer, Scene, PerspectiveCamera, Color } from "three";
import { STATE_STYLES, DEFAULT_STYLE, driveTarget } from "./states.js";
import { createOrb } from "./orb.js";
import { createParticleField, createThinkingKnot } from "./particles.js";
import { createRipples, createProgressArc, createSatellites, makeGlowTexture } from "./effects.js";
import { createConstellation } from "./constellation.js";

var TRANSITION_MS = 280; // ≤300ms state morph per spec
var DPR_CAP = 2;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
function humanState(s) {
  return String(s).replace(/_/g, " ");
}

var BLEND_KEYS = ["glow", "distortion", "rot", "orbScale", "knot", "scan", "sweep", "arc", "ripple", "satellites"];

function copyStyle(style) {
  var out = { color: style.color.clone() };
  for (var i = 0; i < BLEND_KEYS.length; i++) out[BLEND_KEYS[i]] = style[BLEND_KEYS[i]];
  return out;
}

export function createVisualizer(canvas) {
  var wrap = canvas.parentElement || canvas;

  // ---- input state --------------------------------------------------------
  var state = "idle";
  var stateEnteredMs = nowMs();
  var fromStyle = copyStyle(DEFAULT_STYLE);
  var toStyle = STATE_STYLES.idle;
  var blended = copyStyle(DEFAULT_STYLE); // scratch, mutated per frame

  var micLevel = 0;
  var micTarget = 0;
  var ampLevel = 0;
  var ampTarget = 0;
  var drive = 0;
  var burst = 0; // interrupted impulse (decays)
  var bloom = 0; // done flash (decays)
  var getAudioLevels = null;

  var reducedMotion = false;
  var disposed = false;
  var ctxLost = false;
  var rafId = null;
  var lastFrameMs = 0;
  var tSec = 0; // scene clock, only advances while rendering

  // ---- static-state label (reduced motion) --------------------------------
  var label = document.createElement("div");
  label.className = "jv-vis-static-label";
  label.textContent = humanState(state);
  wrap.appendChild(label);

  // ---- GL scene ------------------------------------------------------------
  var renderer = null;
  var scene = null;
  var camera = null;
  var orb = null;
  var field = null;
  var knot = null;
  var ripples = null;
  var arc = null;
  var sats = null;
  var constellation = null;
  var glowTexture = null;
  var glSupported = true;

  function nowMs() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function particleCount() {
    var rect = wrap.getBoundingClientRect();
    var area = Math.max(1, rect.width * rect.height);
    return Math.max(900, Math.min(2600, Math.floor(area / 900)));
  }

  function initGL() {
    try {
      renderer = new WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        stencil: false,
      });
    } catch (e) {
      glSupported = false;
      label.classList.add("jv-vis-static-label--visible");
      return;
    }
    renderer.setClearColor(0x000000, 0);

    scene = new Scene();
    camera = new PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(0, 0, 7.4);

    glowTexture = makeGlowTexture();
    orb = createOrb();
    scene.add(orb.group);
    field = createParticleField(particleCount());
    scene.add(field.points);
    knot = createThinkingKnot();
    scene.add(knot.points);
    ripples = createRipples();
    scene.add(ripples.group);
    arc = createProgressArc();
    scene.add(arc.group);
    sats = createSatellites(glowTexture);
    scene.add(sats.group);
    constellation = createConstellation();
    scene.add(constellation.group);

    measure();
  }

  function teardownGL() {
    if (!renderer) return;
    if (orb) orb.dispose();
    if (field) field.dispose();
    if (knot) knot.dispose();
    if (ripples) ripples.dispose();
    if (arc) arc.dispose();
    if (sats) sats.dispose();
    if (constellation) constellation.dispose();
    if (glowTexture) glowTexture.dispose();
    renderer.dispose();
    renderer = null;
    scene = null;
    camera = null;
    orb = field = knot = ripples = arc = sats = constellation = null;
    glowTexture = null;
  }

  function measure() {
    if (!renderer || !camera) return;
    var rect = wrap.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(DPR_CAP, Math.max(1, window.devicePixelRatio || 1));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false); // CSS keeps the canvas at inset:0/100%
    var aspect = w / h;
    camera.aspect = aspect;
    // pull the camera back on narrow canvases so the orb + halo always fit
    camera.position.z = Math.min(18, 7.4 * Math.max(1, 1.15 / Math.max(0.2, aspect)));
    camera.updateProjectionMatrix();
  }

  // ---- state blending -------------------------------------------------------
  function blendParams(atMs) {
    var t = smoothstep(Math.min(1, (atMs - stateEnteredMs) / TRANSITION_MS));
    for (var i = 0; i < BLEND_KEYS.length; i++) {
      var k = BLEND_KEYS[i];
      blended[k] = lerp(fromStyle[k], toStyle[k], t);
    }
    blended.color.lerpColors(fromStyle.color, toStyle.color, t);
    return blended;
  }

  // ---- per-frame ------------------------------------------------------------
  function renderFrame(dtSec) {
    var elapsedSec = (nowMs() - stateEnteredMs) / 1000;
    var style = blendParams(nowMs());

    // read the analyser tap ONCE per frame; fall back to server tts.amp
    var audio = getAudioLevels ? getAudioLevels() : null;
    if (audio) {
      ampLevel = clamp01(audio.level + (audio.high || 0) * 0.3);
    } else {
      ampLevel += (ampTarget - ampLevel) * 0.35;
      ampTarget *= 0.85; // decay between server amp events
    }
    micLevel += (micTarget - micLevel) * 0.35;
    micTarget *= 0.9; // decay between mic rms callbacks

    var target = driveTarget(state, tSec, elapsedSec, ampLevel, micLevel, burst, bloom);
    drive += (target - drive) * Math.min(1, dtSec * 10);
    burst *= Math.exp(-dtSec * 3.2);
    bloom *= Math.exp(-dtSec * 2.6);

    orb.update(tSec, dtSec, drive, style, bloom);
    field.update(tSec, burst, style.color);
    knot.update(tSec, style.knot, style.color);
    ripples.update(dtSec, style.ripple, micLevel, style.color);
    arc.update(tSec, style.arc, style.color);
    sats.update(tSec, style.satellites, style.color);
    constellation.update(tSec, dtSec);

    renderer.render(scene, camera);
  }

  function frame(t) {
    rafId = null;
    if (disposed || reducedMotion || ctxLost || document.hidden || !renderer) return;
    rafId = requestAnimationFrame(frame);
    var dt = lastFrameMs ? Math.min(0.05, (t - lastFrameMs) / 1000) : 1 / 60;
    lastFrameMs = t;
    tSec += dt;
    renderFrame(dt);
  }

  function startLoop() {
    if (disposed || rafId !== null || reducedMotion || ctxLost || document.hidden || !renderer) return;
    lastFrameMs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // Reduced motion: a single static frame (orb in state color, no time
  // animation, no overlays' motion) + the text state label.
  function renderStatic() {
    if (!renderer) return;
    fromStyle = copyStyle(toStyle); // no transition in static mode
    stateEnteredMs = nowMs() - TRANSITION_MS;
    var style = blendParams(nowMs());
    orb.update(0.7, 0, 0.05, style, 0);
    field.update(0.7, 0, style.color);
    knot.update(0.7, style.knot * 0.5, style.color);
    ripples.update(0, 0, 0, style.color);
    arc.update(0.7, style.arc, style.color);
    sats.update(0.7, style.satellites, style.color);
    constellation.update(tSec, 0);
    renderer.render(scene, camera);
  }

  // ---- events ---------------------------------------------------------------
  function onVisibility() {
    if (document.hidden) stopLoop();
    else startLoop();
  }
  document.addEventListener("visibilitychange", onVisibility);

  function onContextLost(e) {
    e.preventDefault(); // required for webglcontextrestored to ever fire
    ctxLost = true;
    stopLoop();
  }
  function onContextRestored() {
    if (disposed) return;
    // three's WebGLRenderer handles the GL-level re-init itself on restore
    // (resources re-upload lazily on the next render) — tearing down and
    // rebuilding here would delete objects on the wrong context. We only
    // need to resume driving frames.
    ctxLost = false;
    if (reducedMotion) renderStatic();
    else startLoop();
  }
  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);

  var ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(function () {
      measure();
      if (reducedMotion) renderStatic();
    });
    ro.observe(wrap);
  } else {
    window.addEventListener("resize", measure);
  }

  // ---- public API -----------------------------------------------------------
  function setState(nextState, detail) {
    void detail; // reserved: overlays currently key off state alone
    var style = STATE_STYLES[nextState] || STATE_STYLES.idle;
    if (nextState === state) return;
    // capture the mid-transition look so back-to-back changes stay smooth
    fromStyle = copyStyle(blendParams(nowMs()));
    toStyle = style;
    stateEnteredMs = nowMs();

    // one-shot impulses on real state entries
    if (nextState === "interrupted") burst = 1;
    if (nextState === "done") bloom = 1;
    if (constellation) constellation.onStateChange(tSec);

    state = nextState;
    label.textContent = humanState(nextState);
    if (reducedMotion && !ctxLost) renderStatic();
  }

  function onAmp(v) {
    ampTarget = clamp01(typeof v === "number" ? v : 0);
  }

  function onMicLevel(v) {
    micTarget = clamp01(typeof v === "number" ? v : 0);
  }

  function onMemoryHits(items) {
    if (!constellation || reducedMotion) return;
    constellation.show(items, tSec, blendParams(nowMs()).color);
  }

  function setAudioSource(fn) {
    getAudioLevels = typeof fn === "function" ? fn : null;
  }

  function setReducedMotion(v) {
    reducedMotion = !!v;
    if (reducedMotion) {
      stopLoop();
      label.classList.add("jv-vis-static-label--visible");
      if (!ctxLost) renderStatic();
    } else {
      if (glSupported) label.classList.remove("jv-vis-static-label--visible");
      startLoop();
    }
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onContextLost, false);
    canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
    if (ro) ro.disconnect();
    else window.removeEventListener("resize", measure);
    teardownGL();
    if (label.parentElement) label.parentElement.removeChild(label);
  }

  // ---- boot -----------------------------------------------------------------
  initGL();
  startLoop();

  return {
    setState: setState,
    onAmp: onAmp,
    onMicLevel: onMicLevel,
    onMemoryHits: onMemoryHits,
    setAudioSource: setAudioSource,
    setReducedMotion: setReducedMotion,
    resize: measure,
    destroy: destroy,
  };
}
