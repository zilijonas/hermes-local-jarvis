// visualizer/core.js — the Jarvis orb: a soft luminous body with fluid
// internal motion, a breathing halo and a speech-driven outline. Replaces the
// fibonacci-lattice core (2026-09-28 redesign: no wireframes, rings or
// particles-on-lines).
//
// Renderer: WebGL fragment shader (orb-gl.js), Canvas 2D fallback
// (orb-2d.js) when WebGL is unavailable. This file owns everything else:
//
//   - honest signals only. Speaking = audio-out getLevels() (RMS + low/mid/
//     high of the audio actually heard, analyser tap), server tts.amp as the
//     fallback; listening = mic worklet rms; memory motes = real memory.hits
//     count. Every other motion is a function of FSM state + time in state.
//   - parameters (states.js ORB_STATES) and colours (palette.js, theme
//     tokens) blend exponentially toward the active state: never snap.
//   - one-shot envelopes keyed off time-in-state: interrupted/error flash
//     warm/red then settle, done swells once.
//   - phases are integrated per frame, so speed changes never jump.
//   - adaptive quality: sustained slow frames step the render scale down
//     (1 -> 0.8 -> 0.66 -> 0.5 of the DPR-capped size); long fast runs step
//     back up at most twice. DPR capped at 2.
//   - rAF pauses on hidden tabs; offline renders at half rate; reduced
//     motion renders one settled, state-coloured frame per change.
//   - no per-frame allocation in the hot path (reused typed arrays/objects).
import { ORB_STATES } from "./states.js";
import { buildPalettes, mix } from "./palette.js";
import { createGLRenderer } from "./orb-gl.js";
import { createCanvasRenderer } from "./orb-2d.js";

var DPR_CAP = 2;
var SCALES = [1, 0.8, 0.66, 0.5];
var PARAM_TAU_MS = 180;
var COLOR_TAU_MS = 240;
var KEYS = ["size", "glow", "flow", "swirl", "spin", "deform", "bright", "sat", "breath", "cool"];

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function now() {
  return (window.performance || Date).now();
}
function lerp3(out, target, k) {
  out[0] += (target[0] - out[0]) * k;
  out[1] += (target[1] - out[1]) * k;
  out[2] += (target[2] - out[2]) * k;
}

export function createCore(canvas) {
  var state = "idle";
  var forced = null; // QA override (window.__jarvisOrb.force)
  var stateSince = 0;
  var reduced = false;
  var hits = [];
  var getAudioLevels = null;
  var fakeLevels = null; // QA override (window.__jarvisOrb.levels)
  var destroyed = false;

  // ---- signal envelopes ----------------------------------------------------
  var amp = 0;
  var ampFallback = 0;
  var low = 0;
  var mid = 0;
  var high = 0;
  var mic = 0;
  var micTarget = 0;
  var micW = 0; // how much the mic drives the orb in this state (blended)
  var motesAmt = 0;

  // ---- blended state ---------------------------------------------------------
  var p = null;
  var palettes = buildPalettes();
  var colMain = [0, 0, 0];
  var colSoft = [0, 0, 0];
  var colDeep = [0, 0, 0];
  var colCool = [0, 0, 0];
  var tMain = [0, 0, 0];
  var flowPhase = 3.7;
  var spinPhase = 0.6;

  // reused frame parameter object handed to the renderer
  var U = {
    cx: 0, cy: 0, R: 1, maxD: 2, flow: 0, spin: 0, swirl: 0, deform: 0,
    bands: new Float32Array(4), glow: 0, bright: 1, sat: 1, light: false,
    main: colMain, soft: colSoft, deep: colDeep, cool: colCool, motes: new Float32Array(18),
  };

  var renderer = createGLRenderer(canvas) || createCanvasRenderer(canvas);

  // ---- adaptive quality ------------------------------------------------------
  var level = 0;
  var slowFrames = 0;
  var fastFrames = 0;
  var upgrades = 0;
  var warm = 0;
  var dts = new Float32Array(180);
  var dtN = 0;
  var ema = 16.7; // smoothed frame time (ms)
  function noteFrameCost(dt) {
    dts[dtN % dts.length] = dt;
    dtN++;
    if (warm < 30 || dt > 250) {
      warm++;
      return; // startup / tab-resume hitches say nothing about steady cost
    }
    ema += (dt - ema) * 0.05;
    // an EMA, not a per-frame vote: alternating 16/33 ms frames (a device
    // that can't hold 60) must still count as slow
    if (ema > 20.5) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 2);
    if (ema < 17.6) fastFrames++;
    else fastFrames = 0;
    if (slowFrames > 90 && level < SCALES.length - 1) {
      level++;
      slowFrames = 0;
      fastFrames = 0;
      sizeCanvas();
    } else if (fastFrames > 900 && level > 0 && upgrades < 2) {
      level--;
      upgrades++;
      fastFrames = 0;
      sizeCanvas();
    }
  }

  // ---- canvas sizing -----------------------------------------------------------
  var cssW = 0;
  var cssH = 0;
  var scale = 1; // device px per css px actually rendered
  function sizeCanvas() {
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    scale = Math.min(DPR_CAP, window.devicePixelRatio || 1) * SCALES[level];
    var w = Math.max(1, Math.round(cssW * scale));
    var h = Math.max(1, Math.round(cssH * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // ---- state helpers -----------------------------------------------------------
  function activeState() {
    return forced || state;
  }
  function targetRow() {
    return ORB_STATES[activeState()] || ORB_STATES.idle;
  }
  function tonePal(tone) {
    return palettes.tones[tone] || palettes.tones.accent;
  }
  function snapToTarget() {
    var row = targetRow();
    p = {};
    for (var i = 0; i < KEYS.length; i++) p[KEYS[i]] = row[KEYS[i]];
    var tp = tonePal(row.tone);
    var m = mix(tp.main, tp.cool, row.cool * 0.45);
    colMain[0] = m[0]; colMain[1] = m[1]; colMain[2] = m[2];
    colSoft[0] = tp.soft[0]; colSoft[1] = tp.soft[1]; colSoft[2] = tp.soft[2];
    colDeep[0] = tp.deep[0]; colDeep[1] = tp.deep[1]; colDeep[2] = tp.deep[2];
    colCool[0] = tp.cool[0]; colCool[1] = tp.cool[1]; colCool[2] = tp.cool[2];
  }
  snapToTarget();

  // ---- per-frame update --------------------------------------------------------
  function update(dt, t) {
    var row = targetRow();
    var st = activeState();
    var kP = reduced ? 1 : 1 - Math.exp(-dt / PARAM_TAU_MS);
    var kC = reduced ? 1 : 1 - Math.exp(-dt / COLOR_TAU_MS);
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      p[key] += (row[key] - p[key]) * kP;
    }

    // audio: real analyser levels first, server amp events as fallback
    var lv = fakeLevels ? fakeLevels() : getAudioLevels ? getAudioLevels() : null;
    var tLevel, tLow, tMid, tHigh;
    if (lv) {
      tLevel = clamp01(lv.level || 0);
      tLow = clamp01((lv.low || 0) * 1.8);
      tMid = clamp01((lv.mid || 0) * 2.6);
      tHigh = clamp01((lv.high || 0) * 4.5);
    } else {
      ampFallback *= Math.exp(-dt / 110);
      tLevel = ampFallback;
      tLow = ampFallback * 0.8;
      tMid = ampFallback * 0.55;
      tHigh = ampFallback * 0.3;
    }
    if (reduced) {
      amp = low = mid = high = 0;
    } else {
      var att = 1 - Math.exp(-dt / 40);
      var rel = 1 - Math.exp(-dt / 150);
      amp += (tLevel - amp) * (tLevel > amp ? att : rel);
      low += (tLow - low) * (tLow > low ? att : rel);
      mid += (tMid - mid) * (tMid > mid ? att : rel);
      high += (tHigh - high) * (tHigh > high ? att : rel);
    }

    // mic: full weight while listening, a hint in idle, none while speaking
    var micWT = st === "listening" ? 1 : st === "speaking" ? 0 : st === "idle" ? 0.45 : 0.2;
    micW += (micWT - micW) * kP;
    micTarget *= Math.exp(-dt / 160);
    var mk = 1 - Math.exp(-dt / (micTarget > mic ? 45 : 170));
    mic += (micTarget - mic) * mk;
    var micE = reduced ? 0 : mic * micW;

    // one-shot envelopes keyed off time in state
    var age = t - stateSince;
    var flash = 0;
    if (row.flash && !reduced) flash = Math.min(1, age / 0.07) * Math.exp(-age / 0.6);
    var pulse = row.pulse && !reduced && age < 1.1 ? Math.sin(Math.PI * Math.min(1, age / 1.1)) : 0;

    // colour: tone palette (+cool lean), flash tone mixed on top
    var tp = tonePal(row.tone);
    var cl = row.cool * 0.45;
    tMain[0] = tp.main[0] + (tp.cool[0] - tp.main[0]) * cl;
    tMain[1] = tp.main[1] + (tp.cool[1] - tp.main[1]) * cl;
    tMain[2] = tp.main[2] + (tp.cool[2] - tp.main[2]) * cl;
    lerp3(colMain, tMain, kC);
    lerp3(colSoft, tp.soft, kC);
    lerp3(colDeep, tp.deep, kC);
    lerp3(colCool, tp.cool, kC);

    // phases
    if (!reduced) {
      var ds = dt / 1000;
      flowPhase += ds * (p.flow + amp * 0.35 + micE * 0.25 + flash * 0.4);
      spinPhase += ds * p.spin;
      if (flowPhase > 4000) flowPhase -= 4000; // keeps float precision; noise has no period so one seam per ~3h
    }

    // memory motes: one per real hit (max 6), spiralling into the body
    motesAmt += ((st === "memory" && !reduced ? 1 : 0) - motesAmt) * (1 - Math.exp(-dt / 320));
    var n = Math.max(1, Math.min(6, hits.length || 2));
    for (var m = 0; m < 6; m++) {
      var o = m * 3;
      if (m >= n || motesAmt < 0.002) {
        U.motes[o + 2] = 0;
        continue;
      }
      var ph = (t * 0.28 + m / n) % 1;
      var rr = 1.9 - ph * 1.75;
      var an = m * 2.39996 + ph * 1.8 + t * 0.08;
      U.motes[o] = Math.cos(an) * rr;
      U.motes[o + 1] = Math.sin(an) * rr * 0.9;
      U.motes[o + 2] = motesAmt * Math.pow(Math.sin(ph * Math.PI), 1.5) * 0.85;
    }

    // compose frame parameters
    var breathS = reduced ? 0 : Math.sin((t * Math.PI * 2) / 5.2);
    var sizeMul = p.size * (1 + p.breath * 0.022 * breathS) + micE * 0.13 + amp * 0.07 + pulse * 0.07 - flash * 0.05;
    U.flow = flowPhase;
    U.spin = spinPhase;
    U.swirl = p.swirl + flash * 0.3;
    U.deform = p.deform + flash * 0.05;
    U.bands[0] = clamp01(low + micE * 0.75);
    U.bands[1] = clamp01(mid + micE * 0.45);
    U.bands[2] = clamp01(high + micE * 0.2);
    U.bands[3] = clamp01(amp);
    U.glow = p.glow * (1 + p.breath * 0.1 * breathS) + micE * 0.35 + amp * 0.3 + pulse * 0.35 + flash * 0.25;
    U.bright = p.bright + amp * 0.15 + micE * 0.1 + pulse * 0.2 + flash * 0.1;
    U.sat = p.sat;
    U.light = palettes.light;
    if (flash > 0.001) {
      // flash: pull main + cool toward the flash tone, without touching the
      // blended base colours (so it settles by itself)
      var fp = tonePal(row.flash);
      U.main = mixInto(flashMain, colMain, fp.main, flash * 0.85);
      U.cool = mixInto(flashCool, colCool, fp.cool, flash * 0.85);
      U.soft = mixInto(flashSoft, colSoft, fp.soft, flash * 0.6);
      U.sat = p.sat + (1 - p.sat) * flash;
    } else {
      U.main = colMain;
      U.cool = colCool;
      U.soft = colSoft;
    }
    U.deep = colDeep;
    return sizeMul;
  }
  var flashMain = [0, 0, 0];
  var flashCool = [0, 0, 0];
  var flashSoft = [0, 0, 0];
  function mixInto(out, a, b, k) {
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    out[2] = a[2] + (b[2] - a[2]) * k;
    return out;
  }

  // framing: centred, radius capped by both axes. Short canvases (the mobile
  // core strip) get a relatively larger orb; tall ones leave room for the
  // caption under it.
  function layout(sizeMul) {
    var w = cssW;
    var h = cssH;
    var compact = h < 300;
    var cx = w / 2;
    // tall stage: the caption block (~64px) overlays the bottom of the canvas
    var cy = compact ? h * 0.5 : (h - 64) / 2 + 6;
    var R = compact ? Math.min(w * 0.3, h * 0.33) : Math.min(w * 0.25, (h - 64) * 0.34, 200);
    var edge = Math.min(cx, cy, w - cx, h - cy);
    U.cx = cx * scale;
    U.cy = cy * scale;
    U.R = Math.max(4, R * sizeMul * scale);
    U.maxD = Math.max(1.15, (edge * scale) / U.R);
  }

  // ---- frame loop ----------------------------------------------------------------
  var raf = 0;
  var last = 0;
  var frameNo = 0;
  var t0 = now();

  function frame(ts) {
    raf = destroyed ? 0 : requestAnimationFrame(frame);
    if (!canvas.clientWidth || !renderer) return;
    if (canvas.width <= 1 || cssW !== canvas.clientWidth || cssH !== canvas.clientHeight) sizeCanvas();
    var dt = last ? ts - last : 16.7;
    last = ts;
    noteFrameCost(dt);
    dt = Math.min(64, dt);
    var t = (ts - t0) / 1000;
    var sizeMul = update(dt, t);
    frameNo++;
    // offline is near-still: half rate saves the battery
    if (activeState() === "offline" && frameNo & 1) return;
    layout(sizeMul);
    renderer.render(U);
  }

  function renderStatic() {
    if (!renderer) return;
    sizeCanvas();
    if (!cssW || !cssH) return;
    snapToTarget();
    var t = (now() - t0) / 1000;
    var sizeMul = update(16, t);
    layout(sizeMul);
    renderer.render(U);
  }

  function startLoop() {
    if (destroyed || raf || reduced || document.hidden) return;
    last = 0;
    warm = 0;
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function onVisibility() {
    if (document.hidden) stopLoop();
    else if (!reduced) startLoop();
  }
  document.addEventListener("visibilitychange", onVisibility);

  var ro = null;
  function onResize() {
    sizeCanvas();
    if (reduced) renderStatic();
  }
  if (window.ResizeObserver) {
    ro = new ResizeObserver(onResize);
    ro.observe(canvas);
  } else {
    window.addEventListener("resize", onResize);
  }

  var UI = window.HermesUI;
  var offTheme = null;
  if (UI && UI.onThemeChange) {
    offTheme = UI.onThemeChange(function () {
      palettes = buildPalettes();
      if (reduced) renderStatic();
    });
  }

  sizeCanvas();
  startLoop();

  function enterState(v) {
    void v;
    stateSince = (now() - t0) / 1000;
    if (reduced) renderStatic();
  }

  // ---- API ---------------------------------------------------------------------------
  return {
    setState: function (v) {
      var next = ORB_STATES[v] ? v : "idle";
      if (next === state) return;
      state = next;
      if (!forced) enterState(next);
    },
    setReducedMotion: function (v) {
      reduced = !!v;
      if (reduced) {
        stopLoop();
        renderStatic();
      } else {
        startLoop();
      }
    },
    setHits: function (items) {
      hits = Array.isArray(items) ? items : [];
    },
    setAudioSource: function (fn) {
      getAudioLevels = typeof fn === "function" ? fn : null;
    },
    onAmp: function (v) {
      ampFallback = clamp01(typeof v === "number" ? v : 0);
    },
    onMicLevel: function (v) {
      micTarget = Math.max(micTarget, clamp01(typeof v === "number" ? v : 0));
    },
    resize: function () {
      sizeCanvas();
      if (reduced) renderStatic();
    },
    // QA hooks (window.__jarvisOrb): pin a state / feed synthetic levels /
    // read frame timings. Inert unless called.
    debug: {
      force: function (v) {
        forced = v && ORB_STATES[v] ? v : null;
        enterState(forced || state);
      },
      levels: function (fn) {
        fakeLevels = typeof fn === "function" ? fn : null;
      },
      mic: function (v) {
        micTarget = clamp01(v);
      },
      stats: function () {
        var n = Math.min(dtN, dts.length);
        var arr = Array.prototype.slice.call(dts, 0, n).sort(function (a, b) {
          return a - b;
        });
        var sum = 0;
        for (var i = 0; i < n; i++) sum += arr[i];
        return {
          renderer: renderer ? renderer.kind : "none",
          scale: scale,
          level: level,
          emaMs: +ema.toFixed(2),
          canvas: [canvas.width, canvas.height],
          frames: n,
          avgMs: n ? +(sum / n).toFixed(2) : null,
          p95Ms: n ? +arr[Math.floor(n * 0.95)].toFixed(2) : null,
          maxMs: n ? +arr[n - 1].toFixed(2) : null,
        };
      },
    },
    destroy: function () {
      destroyed = true;
      stopLoop();
      document.removeEventListener("visibilitychange", onVisibility);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", onResize);
      if (offTheme) offTheme();
      if (renderer) renderer.destroy();
      renderer = null;
    },
  };
}
