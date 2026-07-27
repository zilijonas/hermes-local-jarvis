// visualizer.js — cinematic canvas orb + rings, one render system driving
// every FSM state 1:1 (docs/SPEC.md §WebSocket `state.value`). Deliberately
// event-driven only: idle/thinking/etc ambient motion is the *intended*
// per-state animation the spec calls for (e.g. "idle: slow breathing ring"),
// but amplitude-reactive states (listening ripple, speaking waveform bloom)
// are modulated ONLY by real onMicLevel()/onAmp() values — never fabricated.
//
// Public API: createVisualizer(canvas) -> { setState, onAmp, onMicLevel,
// setReducedMotion, resize, destroy }.
var TWO_PI = Math.PI * 2;
var TRANSITION_MS = 300;
var PARTICLE_COUNT = 460;
var MAX_FPS_NORMAL = 60;
var MAX_FPS_LOW_POWER = 30;

var STYLES = {
  idle: { hue: 190, sat: 55, light: 55, spread: 0.5, rot: 0.04, mode: "breathe" },
  listening: { hue: 190, sat: 85, light: 62, spread: 0.72, rot: 0.1, mode: "ripple" },
  transcribing: { hue: 196, sat: 75, light: 65, spread: 0.6, rot: 0.06, mode: "scan" },
  thinking: { hue: 266, sat: 70, light: 62, spread: 0.32, rot: 0.65, mode: "swirl" },
  memory: { hue: 210, sat: 55, light: 68, spread: 0.62, rot: 0.1, mode: "constellation" },
  capability: { hue: 174, sat: 60, light: 60, spread: 0.58, rot: 0.18, mode: "radar" },
  tool: { hue: 44, sat: 70, light: 58, spread: 0.55, rot: 0.1, mode: "pulse" },
  delegating: { hue: 280, sat: 60, light: 62, spread: 0.55, rot: 0.22, mode: "split" },
  worker_progress: { hue: 30, sat: 65, light: 55, spread: 0.6, rot: 0.16, mode: "progress" },
  speaking: { hue: 36, sat: 85, light: 60, spread: 0.68, rot: 0.06, mode: "waveform" },
  interrupted: { hue: 4, sat: 80, light: 55, spread: 0.85, rot: 0.35, mode: "scatter" },
  blocked: { hue: 2, sat: 65, light: 45, spread: 0.5, rot: 0.02, mode: "pulseSlow" },
  error: { hue: 2, sat: 70, light: 45, spread: 0.5, rot: 0.02, mode: "pulseSlow" },
  done: { hue: 46, sat: 90, light: 66, spread: 0.6, rot: 0.12, mode: "flash" },
};

export function createVisualizer(canvas) {
  var ctx = canvas.getContext("2d");
  var reducedMotion = false;
  var lowPower = false;

  var state = "idle";
  var stateEnteredAt = now();
  var fromStyle = STYLES.idle;
  var toStyle = STYLES.idle;

  var micLevel = 0;
  var ampLevel = 0;
  var micTarget = 0;
  var ampTarget = 0;

  var particles = [];
  for (var i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      a: Math.random() * TWO_PI,
      r: 0.35 + Math.random() * 0.65,
      speed: 0.15 + Math.random() * 0.5,
      size: 0.6 + Math.random() * 1.8,
      phase: Math.random() * TWO_PI,
      cluster: Math.random() < 0.5 ? 0 : 1,
    });
  }

  var rafId = null;
  var running = true;
  var lastFrameT = now();

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }
  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }
  function stateLabel(s) {
    return s.replace(/_/g, " ");
  }

  function resize() {
    var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : canvas.getBoundingClientRect();
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
  }
  resize();
  window.addEventListener("resize", resize);

  if (window.matchMedia) {
    try {
      var battery = navigator.getBattery && navigator.getBattery();
      if (battery && battery.then) {
        battery.then(function (b) {
          function refresh() {
            lowPower = !b.charging && b.level < 0.2;
          }
          refresh();
          b.addEventListener("levelchange", refresh);
          b.addEventListener("chargingchange", refresh);
        });
      }
    } catch (e) {
      /* battery API unavailable — ignore, low-power cap stays off */
    }
  }

  function currentLerpedStyle() {
    var elapsed = now() - stateEnteredAt;
    var t = smoothstep(Math.min(1, elapsed / TRANSITION_MS));
    return {
      hue: lerp(fromStyle.hue, toStyle.hue, t),
      sat: lerp(fromStyle.sat, toStyle.sat, t),
      light: lerp(fromStyle.light, toStyle.light, t),
      spread: lerp(fromStyle.spread, toStyle.spread, t),
      rot: lerp(fromStyle.rot, toStyle.rot, t),
      mode: toStyle.mode,
    };
  }

  function setState(nextState) {
    if (!STYLES[nextState]) nextState = "idle";
    if (nextState === state) return;
    fromStyle = currentLerpedStyle();
    toStyle = STYLES[nextState];
    state = nextState;
    stateEnteredAt = now();
  }
  function onAmp(v) {
    ampTarget = clamp01(v);
  }
  function onMicLevel(v) {
    micTarget = clamp01(v);
  }
  function setReducedMotion(v) {
    reducedMotion = !!v;
  }

  function drawReducedMotion(style) {
    var w = canvas.width,
      h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2,
      cy = h / 2;
    var radius = Math.min(w, h) * 0.14;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.strokeStyle = "hsl(" + style.hue + ", " + style.sat + "%, " + style.light + "%)";
    ctx.lineWidth = Math.max(2, radius * 0.08);
    ctx.stroke();
    ctx.fillStyle = "rgba(229,231,235,0.85)";
    ctx.font = Math.max(12, radius * 0.22) + "px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(stateLabel(state), cx, cy + radius + 24);
  }

  function drawRings(style, cx, cy, baseR, tSec) {
    var ringCount = 3;
    for (var i = 0; i < ringCount; i++) {
      var frac = (i + 1) / ringCount;
      var ringR = baseR * (0.55 + frac * 0.5) * style.spread * 1.4;
      var wobble = 0;

      if (style.mode === "breathe") {
        wobble = Math.sin(tSec * 0.6 + i) * baseR * 0.03;
      } else if (style.mode === "waveform") {
        wobble = ampLevel * baseR * 0.25 * Math.sin(tSec * 6 + i * 2);
      } else if (style.mode === "ripple") {
        wobble = micLevel * baseR * 0.3 * Math.sin(tSec * 5 - i * 1.3);
      } else if (style.mode === "pulseSlow") {
        wobble = Math.sin(tSec * 1.2) * baseR * 0.05;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, ringR + wobble), 0, TWO_PI);
      ctx.strokeStyle = "hsla(" + style.hue + ", " + style.sat + "%, " + style.light + "%, " + (0.35 - i * 0.08) + ")";
      ctx.lineWidth = Math.max(1, baseR * 0.01);
      ctx.stroke();
    }

    if (style.mode === "scan") {
      var sweepY = cy - baseR + ((tSec * 160) % (baseR * 2));
      var grad = ctx.createLinearGradient(cx - baseR, sweepY - 6, cx - baseR, sweepY + 6);
      grad.addColorStop(0, "hsla(" + style.hue + ",90%,70%,0)");
      grad.addColorStop(0.5, "hsla(" + style.hue + ",90%,70%,0.5)");
      grad.addColorStop(1, "hsla(" + style.hue + ",90%,70%,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - baseR, sweepY - 6, baseR * 2, 12);
    }

    if (style.mode === "radar") {
      var ang = (tSec * 1.4) % TWO_PI;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, baseR * 1.3, -0.35, 0);
      ctx.closePath();
      ctx.fillStyle = "hsla(" + style.hue + ",70%,60%,0.18)";
      ctx.fill();
      ctx.restore();
    }

    if (style.mode === "progress") {
      var frac2 = (tSec * 0.25) % 1;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 1.25, -Math.PI / 2, -Math.PI / 2 + frac2 * TWO_PI);
      ctx.strokeStyle = "hsla(" + style.hue + ",80%,60%,0.9)";
      ctx.lineWidth = Math.max(2, baseR * 0.03);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  function particlePos(p, style, cx, cy, baseR, tSec, mode) {
    var angle = p.a + tSec * style.rot * (0.5 + p.speed);
    var radius = baseR * style.spread * p.r;
    var alpha = 0.55;
    var scale = 1;
    var ox = cx;

    if (mode === "swirl") {
      radius *= 0.5 + 0.15 * Math.sin(tSec * 2 + p.phase);
      angle += Math.sin(tSec * 0.7) * 0.5;
    } else if (mode === "ripple") {
      radius += micLevel * baseR * 0.4 * Math.sin(p.a * 3 - tSec * 4);
      alpha = 0.4 + micLevel * 0.4;
    } else if (mode === "waveform") {
      radius += ampLevel * baseR * 0.35 * Math.sin(p.a * 5 + tSec * 8);
      alpha = 0.45 + ampLevel * 0.45;
    } else if (mode === "scatter") {
      var burst = Math.max(0, 1 - (tSec % 2));
      radius *= 1 + burst * 1.4 * (0.5 + p.speed);
      alpha = 0.3 + burst * 0.5;
    } else if (mode === "pulse") {
      var tick = (Math.sin(tSec * 3 + p.phase) + 1) / 2;
      scale = 0.6 + tick * 0.8;
      alpha = 0.3 + tick * 0.4;
    } else if (mode === "pulseSlow") {
      var tick2 = (Math.sin(tSec * 1.1 + p.phase) + 1) / 2;
      alpha = 0.25 + tick2 * 0.3;
    } else if (mode === "split") {
      var side = p.cluster === 0 ? -1 : 1;
      ox = cx + side * baseR * 0.55;
      angle = p.a + tSec * style.rot * (0.5 + p.speed) * side;
      radius = baseR * 0.35 * p.r;
    } else if (mode === "flash") {
      alpha = 0.5;
      scale = 1.1;
    } else if (mode === "breathe") {
      radius *= 0.9 + 0.1 * Math.sin(tSec * 0.6 + p.phase);
    }

    return {
      x: ox + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      alpha: alpha,
      scale: scale,
    };
  }

  function drawParticles(style, cx, cy, baseR, tSec) {
    var mode = style.mode;
    var color = "hsl(" + style.hue + ", " + style.sat + "%, " + style.light + "%)";
    var positions = new Array(particles.length);
    for (var k = 0; k < particles.length; k++) {
      positions[k] = particlePos(particles[k], style, cx, cy, baseR, tSec, mode);
    }

    if (mode === "constellation") {
      ctx.strokeStyle = "hsla(" + style.hue + ", " + style.sat + "%, " + style.light + "%, 0.18)";
      ctx.lineWidth = 1;
      var linkDistSq = baseR * 0.9 * (baseR * 0.9);
      for (var i = 0; i < positions.length; i += 7) {
        for (var j = i + 7; j < positions.length; j += 21) {
          var a = positions[i],
            b = positions[j];
          var dx = a.x - b.x,
            dy = a.y - b.y;
          if (dx * dx + dy * dy < linkDistSq) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }

    for (var m = 0; m < particles.length; m++) {
      var p = particles[m];
      var pos = positions[m];
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, p.size * pos.scale, 0, TWO_PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = pos.alpha;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render(style, t) {
    var w = canvas.width,
      h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2,
      cy = h / 2;
    var baseR = Math.min(w, h) * 0.3;
    var tSec = t / 1000;

    drawRings(style, cx, cy, baseR, tSec);
    drawParticles(style, cx, cy, baseR, tSec);

    if (style.mode === "flash") {
      var localT = now() - stateEnteredAt;
      var flashAlpha = Math.max(0, 1 - localT / 500);
      if (flashAlpha > 0) {
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 2.2);
        g.addColorStop(0, "hsla(46,95%,70%," + 0.5 * flashAlpha + ")");
        g.addColorStop(1, "hsla(46,95%,70%,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  function frame(t) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (document.hidden) return;

    var maxFps = lowPower || document.hidden ? MAX_FPS_LOW_POWER : MAX_FPS_NORMAL;
    var minGap = 1000 / maxFps;
    if (t - lastFrameT < minGap) return;
    lastFrameT = t;

    micLevel = lerp(micLevel, micTarget, 0.35);
    ampLevel = lerp(ampLevel, ampTarget, 0.35);
    micTarget *= 0.9; // decays toward 0 between fresh onMicLevel() calls
    ampTarget *= 0.85;

    var style = currentLerpedStyle();
    if (reducedMotion) {
      drawReducedMotion(style);
    } else {
      render(style, t);
    }
  }

  rafId = requestAnimationFrame(frame);

  function destroy() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
  }

  return {
    setState: setState,
    onAmp: onAmp,
    onMicLevel: onMicLevel,
    setReducedMotion: setReducedMotion,
    resize: resize,
    destroy: destroy,
  };
}
