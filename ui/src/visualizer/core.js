// visualizer/core.js — the intelligence core: a 2D-canvas port of the design
// prototype's renderer (design/"Jarvis Command Centre.dc.html", Component
// _buildGeometry/_frame/_draw/_drawMode). Replaces the old three.js orb —
// one rAF, one 2D context, no WebGL.
//
// Ported from the prototype:
//   - fibonacci-sphere lattice (118 points, 3 nearest-neighbour edges,
//     precomputed once), rotating perspective projection with vertex noise
//   - horizon ellipses, drifting particle field
//   - all 10 mode overlays (calm/open/resolve/orbit/stars/radial/arc/
//     transfer/bands/pulse) for the 15 states in states.js
//   - exponential parameter blending 1−e^(−dt/95): ~300ms visual settle,
//     never snaps, fully settled well before 400ms
//   - reduced-motion: single static frame + dashed state ring
// Adapted for production:
//   - honest signals only: speaking amplitude comes from audio-out
//     getLevels() (RMS + low/mid/high of the audio actually heard, analyser
//     tap) with server tts.amp as fallback; listening from the mic worklet
//     rms; memory stars from real memory.hits items. The prototype's
//     simulated sine "signals" are gone.
//   - nucleus/atmosphere use cached radial-gradient sprites (regenerated
//     only when the blended color moves), no per-frame gradient allocation,
//     no shadowBlur.
//   - `done` renders ONE outward pulse ring (phase = time since state
//     entry), per the redesign spec — the prototype looped it.
//   - degradation ladder when frames run long: drop particle field → drop
//     horizon grid → halve the lattice.
//   - rAF pauses on hidden tab; DPR capped at 2.
import { CORE_STATES } from "./states.js";

var DPR_CAP = 2;
var BLEND_TAU_MS = 95; // --jv-core-blend
var GOLDEN_ANGLE = 2.399963229728653;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function createCore(canvas) {
  var state = "idle";
  var stateSince = 0; // seconds on the scene clock
  var reduced = false;
  var hits = []; // memory.hits items (stars mode)
  var getAudioLevels = null; // audio-out getLevels tap
  var destroyed = false;

  // signal envelopes (all driven by real inputs)
  var amp = 0; // TTS loudness envelope
  var ampFallback = 0; // decaying target fed by server tts.amp events
  var levels = null; // last {level,low,mid,high} from the analyser tap
  var mic = 0;
  var micTarget = 0;
  var ripples = [];
  var lastRippleT = 0;

  // blended state params (start at idle)
  var p = null;

  // ---- geometry (precomputed once — prototype _buildGeometry) -------------
  var N = 118;
  var pts = [];
  var edges = [];
  var parts = [];
  (function buildGeometry() {
    var i, j, k;
    for (i = 0; i < N; i++) {
      var y = 1 - (i / (N - 1)) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var th = i * GOLDEN_ANGLE;
      pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    var seen = {};
    for (i = 0; i < N; i++) {
      var d = [];
      for (j = 0; j < N; j++) {
        if (i === j) continue;
        var dx = pts[i][0] - pts[j][0];
        var dy = pts[i][1] - pts[j][1];
        var dz = pts[i][2] - pts[j][2];
        d.push([dx * dx + dy * dy + dz * dz, j]);
      }
      d.sort(function (a, b) {
        return a[0] - b[0];
      });
      for (k = 0; k < 3; k++) {
        j = d[k][1];
        var key = i < j ? i + ":" + j : j + ":" + i;
        if (!seen[key]) {
          seen[key] = true;
          edges.push([Math.min(i, j), Math.max(i, j)]);
        }
      }
    }
    for (i = 0; i < 84; i++) {
      parts.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, s: 0.2 + Math.random() * 0.8 });
    }
  })();
  var proj = new Array(N); // scratch projection buffer

  // ---- degradation ladder ---------------------------------------------------
  // 0 full · 1 no particle field · 2 no horizon grid · 3 half lattice.
  var degrade = 0;
  var slowFrames = 0;
  function noteFrameCost(dt) {
    if (dt > 26) {
      slowFrames++;
      if (slowFrames > 90 && degrade < 3) {
        degrade++;
        slowFrames = 0;
      }
    } else if (slowFrames > 0) {
      slowFrames--;
    }
  }

  // ---- cached gradient sprites (no per-frame createRadialGradient) ---------
  var SPRITE = 128;
  var atmosSprite = document.createElement("canvas");
  var nucSprite = document.createElement("canvas");
  atmosSprite.width = atmosSprite.height = SPRITE;
  nucSprite.width = nucSprite.height = SPRITE;
  var spriteKey = "";
  function rebuildSprites(r, g, b) {
    var key = r + "," + g + "," + b;
    if (key === spriteKey) return;
    spriteKey = key;
    var half = SPRITE / 2;
    // atmosphere: prototype stops 0.09 → 0.035 → 0 (glow applied via alpha)
    var a = atmosSprite.getContext("2d");
    a.clearRect(0, 0, SPRITE, SPRITE);
    var ga = a.createRadialGradient(half, half, SPRITE * 0.035, half, half, half);
    ga.addColorStop(0, "rgba(" + key + ",0.09)");
    ga.addColorStop(0.45, "rgba(" + key + ",0.035)");
    ga.addColorStop(1, "rgba(" + key + ",0)");
    a.fillStyle = ga;
    a.fillRect(0, 0, SPRITE, SPRITE);
    // nucleus: bright center bloom; per-frame intensity via globalAlpha
    var n = nucSprite.getContext("2d");
    n.clearRect(0, 0, SPRITE, SPRITE);
    var gn = n.createRadialGradient(half, half, 0, half, half, half);
    gn.addColorStop(0, "rgba(" + key + ",1)");
    gn.addColorStop(0.28, "rgba(" + key + ",0.38)");
    gn.addColorStop(1, "rgba(" + key + ",0)");
    n.fillStyle = gn;
    n.fillRect(0, 0, SPRITE, SPRITE);
  }

  // ---- canvas sizing --------------------------------------------------------
  function sizeCanvas() {
    if (!canvas.clientWidth) return;
    var dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    var w = Math.round(canvas.clientWidth * dpr);
    var h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // ---- frame loop -----------------------------------------------------------
  var raf = 0;
  var last = 0;
  var t0 = (window.performance || Date).now();

  function frame(now) {
    raf = destroyed ? 0 : requestAnimationFrame(frame);
    if (!canvas.clientWidth) return;
    if (canvas.width === 0) sizeCanvas();
    var dt = Math.min(64, now - (last || now));
    last = now;
    var t = (now - t0) / 1000;
    noteFrameCost(dt);

    // --- real signal envelopes ---
    var lv = getAudioLevels ? getAudioLevels() : null;
    if (lv) {
      levels = lv;
      var tgt = clamp01(lv.level + (lv.high || 0) * 0.3);
      amp += (tgt - amp) * 0.28;
    } else {
      levels = null;
      amp += (ampFallback - amp) * 0.28;
      ampFallback *= 0.88; // decay between server tts.amp events
    }
    mic += (micTarget - mic) * 0.2;
    micTarget *= 0.9; // decay between mic worklet callbacks
    if (mic > 0.42 && t - lastRippleT > 0.42) {
      lastRippleT = t;
      ripples.push({ r: 0.34, a: 0.42 });
    }

    // --- exponential blend toward the state's parameter row ---
    var target = CORE_STATES[state] || CORE_STATES.idle;
    if (!p) p = { rad: target.rad, spin: target.spin, noise: target.noise, glow: target.glow, mode: target.mode, col: target.col.slice() };
    var k = reduced ? 1 : 1 - Math.exp(-dt / BLEND_TAU_MS);
    p.rad += (target.rad - p.rad) * k;
    p.spin += (target.spin - p.spin) * k;
    p.noise += (target.noise - p.noise) * k;
    p.glow += (target.glow - p.glow) * k;
    for (var i = 0; i < 3; i++) p.col[i] += (target.col[i] - p.col[i]) * k;
    p.mode = target.mode;

    draw(t, dt);
  }

  function draw(t, dt) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    var W = canvas.width;
    var H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.scale(dpr, dpr);
    var w = W / dpr;
    var h = H / dpr;
    var cx = w / 2;
    var cy = h / 2 - 6;
    var R = Math.min(w, h) * 0.29;
    var cr = Math.round(p.col[0]);
    var cg = Math.round(p.col[1]);
    var cb = Math.round(p.col[2]);
    var col = function (a) {
      return "rgba(" + cr + "," + cg + "," + cb + "," + a + ")";
    };
    rebuildSprites(cr, cg, cb);
    var spinT = reduced ? 0.6 : t;

    // atmosphere (cached sprite, alpha = glow)
    var ar = R * 2.9;
    ctx.globalAlpha = clamp01(p.glow);
    ctx.drawImage(atmosSprite, cx - ar, cy - ar, ar * 2, ar * 2);
    ctx.globalAlpha = 1;

    // horizon grid
    if (degrade < 2) {
      ctx.lineWidth = 1;
      for (var gi = 0; gi < 3; gi++) {
        var rr = R * (1.5 + gi * 0.42);
        var tilt = 0.19 + gi * 0.02;
        var rot = spinT * (0.05 + gi * 0.015) * (gi % 2 ? -1 : 1);
        ctx.strokeStyle = col(0.05 - gi * 0.011);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr, rr * tilt, rot, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // particle field
    if (!reduced && degrade < 1) {
      for (var qi = 0; qi < parts.length; qi++) {
        var q = parts[qi];
        q.y -= 0.00012 * q.z * (dt / 16);
        if (q.y < -0.05) {
          q.y = 1.05;
          q.x = Math.random();
        }
        var px = q.x * w + Math.sin(spinT * 0.2 + q.z * 9) * 6;
        var py = q.y * h;
        ctx.fillStyle = col(0.05 + q.s * 0.1);
        ctx.fillRect(px, py, 1.1, 1.1);
      }
    }

    // lattice
    var yaw = spinT * p.spin * 2.2;
    var pitch = 0.42 + Math.sin(spinT * 0.24) * 0.1;
    var cyw = Math.cos(yaw);
    var syw = Math.sin(yaw);
    var cp = Math.cos(pitch);
    var sp = Math.sin(pitch);
    var rad = R * p.rad * (1 + amp * 0.14);
    var step = degrade >= 3 ? 2 : 1;
    for (var vi = 0; vi < N; vi += step) {
      var v = pts[vi];
      var n = reduced ? 0 : Math.sin(vi * 1.77 + spinT * 1.15) * 0.5 + Math.sin(vi * 4.13 - spinT * 0.7) * 0.5;
      var d = 1 + n * p.noise * 0.34 + amp * 0.1 * Math.sin(vi * 0.7 + spinT * 6);
      var x = v[0] * d;
      var y = v[1] * d;
      var z = v[2] * d;
      var x2 = x * cyw + z * syw;
      var z2 = -x * syw + z * cyw;
      var y2 = y * cp - z2 * sp;
      var z3 = y * sp + z2 * cp;
      var per = 2.7 / (2.7 - z3);
      proj[vi] = [cx + x2 * rad * per, cy + y2 * rad * per, z3, per];
    }
    ctx.lineWidth = 1;
    for (var ei = 0; ei < edges.length; ei += step) {
      var e = edges[ei];
      if (step > 1 && (e[0] % 2 || e[1] % 2)) continue;
      var a = proj[e[0]];
      var b = proj[e[1]];
      if (!a || !b) continue;
      var dep = (a[2] + b[2]) / 2;
      var al = (0.06 + Math.max(0, dep + 0.9) * 0.13) * (0.55 + p.glow * 0.6);
      ctx.strokeStyle = col(Math.min(0.5, al));
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    for (var pi = 0; pi < N; pi += step) {
      var pv = proj[pi];
      if (!pv || pv[2] < -0.25) continue;
      var s = 0.7 + pv[3] * 0.5;
      ctx.fillStyle = col(0.14 + Math.max(0, pv[2]) * 0.4);
      ctx.fillRect(pv[0] - s / 2, pv[1] - s / 2, s, s);
    }

    // nucleus (cached sprite bloom + vector ring — no shadowBlur)
    var nr = rad * (0.3 + amp * 0.22 + (p.mode === "pulse" ? 0.12 : 0));
    var nd = nr * 2.4;
    ctx.globalAlpha = Math.min(0.95, 0.5 + p.glow * 0.4 + amp * 0.3);
    ctx.drawImage(nucSprite, cx - nd, cy - nd, nd * 2, nd * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col(0.42 + amp * 0.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, nr * 0.72, 0, Math.PI * 2);
    ctx.stroke();

    if (reduced) {
      drawStaticRing(ctx, cx, cy, R, col);
      return;
    }
    drawMode(ctx, p.mode, cx, cy, R, t, col);
  }

  function drawStaticRing(ctx, cx, cy, R, col) {
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = col(0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawMode(ctx, mode, cx, cy, R, t, col) {
    var i, a, ph, rr, x, y, n;
    if (mode === "open") {
      // mic-reactive expanding rings + aperture arc (listening)
      for (i = ripples.length - 1; i >= 0; i--) {
        var rp = ripples[i];
        rp.r += 0.012;
        rp.a *= 0.965;
        if (rp.a < 0.01 || rp.r > 2.2) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = col(rp.a);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, R * rp.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      var arc = 0.5 + mic * 1.1;
      ctx.strokeStyle = col(0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.36, -Math.PI / 2 - arc / 2, -Math.PI / 2 + arc / 2);
      ctx.stroke();
    } else if (mode === "bands") {
      // radial spectrum spokes (speaking) — length rides the analyser's
      // real RMS; when the tap provides low/mid/high the spokes are tilted
      // by actual spectral content (lows at the bottom, highs at the top).
      n = 34;
      for (i = 0; i < n; i++) {
        a = (i / n) * Math.PI * 2 - Math.PI / 2;
        var band = Math.abs(Math.sin(i * 1.7 + t * 6.1)) * 0.5 + Math.abs(Math.sin(i * 0.9 + t * 11.3)) * 0.5;
        if (levels) {
          var vertical = (Math.sin(a) + 1) / 2; // 0 = top of the ring … 1 = bottom
          var spec = (levels.low || 0) * vertical + (levels.mid || 0) * (1 - Math.abs(vertical - 0.5) * 2) + (levels.high || 0) * (1 - vertical);
          band *= 0.4 + 1.1 * clamp01(spec);
        }
        var len = R * (0.16 + amp * band * 0.72);
        var r0 = R * 1.2;
        ctx.strokeStyle = col(0.14 + amp * band * 0.5);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        ctx.stroke();
      }
    } else if (mode === "orbit") {
      // three counter-rotating thought orbits (thinking)
      for (i = 0; i < 3; i++) {
        rr = R * (1.18 + i * 0.16);
        var spd = (i % 2 ? -1 : 1) * (0.5 + i * 0.22);
        n = 26 - i * 5;
        for (var j = 0; j < n; j++) {
          a = (j / n) * Math.PI * 2 + t * spd;
          var fl = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(a * 2 + t)), 2);
          ctx.fillStyle = col(0.1 + fl * 0.42);
          x = cx + Math.cos(a) * rr;
          y = cy + Math.sin(a) * rr * 0.34;
          ctx.beginPath();
          ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (mode === "resolve") {
      // settling waveform + converging droplets (transcribing)
      n = 40;
      ctx.strokeStyle = col(0.4);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (i = 0; i <= n; i++) {
        x = cx - R * 1.5 + (i / n) * R * 3;
        var decay = 1 - Math.abs(i / n - 0.5) * 1.6;
        y = cy + R * 1.62 + Math.sin(i * 0.9 + t * 9) * R * 0.16 * Math.max(0, decay);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (i = 0; i < 16; i++) {
        ph = (t * 0.55 + i / 16) % 1;
        a = i * 2.4;
        rr = R * (1.7 - ph * 1.3);
        ctx.fillStyle = col(0.5 * (1 - Math.abs(ph - 0.5) * 1.6));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mode === "stars") {
      // memory constellation: one node per real memory hit, pulled inward
      // along a tethered arc toward the core.
      var items = hits.length ? hits.slice(0, 6) : [0, 1, 2];
      for (i = 0; i < items.length; i++) {
        a = -Math.PI * 0.72 + i * 0.5 + Math.sin(t * 0.3 + i) * 0.05;
        ph = (t * 0.4 + i * 0.33) % 1;
        rr = R * (2.05 - ph * 0.72);
        x = cx + Math.cos(a) * rr;
        y = cy + Math.sin(a) * rr * 0.78;
        ctx.strokeStyle = col(0.1 + (1 - ph) * 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.fillStyle = col(0.35 + (1 - ph) * 0.45);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col(0.18);
        ctx.beginPath();
        ctx.arc(x, y, 6 + Math.sin(t * 2 + i) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (mode === "radial") {
      // capability scan: 12 spokes lighting up in rotation
      n = 12;
      for (i = 0; i < n; i++) {
        a = (i / n) * Math.PI * 2 + t * 0.12;
        var on = i % 3 === Math.floor(t * 1.6) % 3;
        var r0b = R * 1.24;
        var len2 = R * (on ? 0.4 : 0.2);
        ctx.strokeStyle = col(on ? 0.5 : 0.14);
        ctx.lineWidth = on ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0b, cy + Math.sin(a) * r0b * 0.9);
        ctx.lineTo(cx + Math.cos(a) * (r0b + len2), cy + Math.sin(a) * (r0b + len2) * 0.9);
        ctx.stroke();
        if (on) {
          ctx.fillStyle = col(0.6);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * (r0b + len2), cy + Math.sin(a) * (r0b + len2) * 0.9, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (mode === "arc") {
      // orbital progress arc (tool / worker_progress) — indeterminate, a
      // function of time-in-state only (no fabricated progress values)
      rr = R * 1.34;
      ctx.strokeStyle = col(0.1);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      var head = (t * 0.85) % (Math.PI * 2);
      ctx.strokeStyle = col(0.62);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, head, head + 1.05);
      ctx.stroke();
      ctx.fillStyle = col(0.8);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(head + 1.05) * rr, cy + Math.sin(head + 1.05) * rr, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (mode === "transfer") {
      // delegating: bezier channel opens toward the work column with
      // travelling packets
      var x1 = cx;
      var y1 = cy;
      var x2 = cx + R * 1.85;
      var y2 = cy + R * 0.9;
      ctx.strokeStyle = col(0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx + R, cy + R * 1.2, x2, y2);
      ctx.stroke();
      for (i = 0; i < 5; i++) {
        ph = (t * 0.65 + i / 5) % 1;
        var mt = 1 - ph;
        var bx = mt * mt * x1 + 2 * mt * ph * (cx + R) + ph * ph * x2;
        var by = mt * mt * y1 + 2 * mt * ph * (cy + R * 1.2) + ph * ph * y2;
        ctx.fillStyle = col(0.7 * (1 - ph * 0.7));
        ctx.beginPath();
        ctx.arc(bx, by, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = col(0.4);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x2, y2, 9 + Math.sin(t * 3) * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mode === "pulse") {
      // done: ONE outward pulse ring, phase = time since entering the state
      ph = (t - stateSince) * 0.9;
      if (ph >= 0 && ph <= 1) {
        ctx.strokeStyle = col(0.5 * (1 - ph));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.1 + ph * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // "calm": no overlay — the breathing lattice/nucleus carry the state
  }

  // ---- loop control ---------------------------------------------------------
  function startLoop() {
    if (destroyed || raf || reduced || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  function renderStatic() {
    // reduced motion: a single settled frame per state change
    sizeCanvas();
    var target = CORE_STATES[state] || CORE_STATES.idle;
    p = { rad: target.rad, spin: target.spin, noise: target.noise, glow: target.glow, mode: target.mode, col: target.col.slice() };
    var t = ((window.performance || Date).now() - t0) / 1000;
    draw(t, 16);
  }

  function onVisibility() {
    if (document.hidden) stopLoop();
    else if (!reduced) startLoop();
  }
  document.addEventListener("visibilitychange", onVisibility);

  var ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(function () {
      sizeCanvas();
      if (reduced) renderStatic();
    });
    ro.observe(canvas);
  } else {
    window.addEventListener("resize", sizeCanvas);
  }

  sizeCanvas();
  startLoop();

  // ---- API ------------------------------------------------------------------
  return {
    setState: function (v) {
      if (v === state) return;
      state = CORE_STATES[v] ? v : "idle";
      stateSince = ((window.performance || Date).now() - t0) / 1000;
      if (reduced) renderStatic();
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
      micTarget = clamp01(typeof v === "number" ? v : 0);
    },
    resize: function () {
      sizeCanvas();
      if (reduced) renderStatic();
    },
    destroy: function () {
      destroyed = true;
      stopLoop();
      document.removeEventListener("visibilitychange", onVisibility);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", sizeCanvas);
    },
  };
}
