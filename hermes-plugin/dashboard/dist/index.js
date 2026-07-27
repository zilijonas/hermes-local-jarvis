(() => {
  // src/sdk.js
  var API_BASE = "/api/plugins/jarvis-voice";
  function getSDK() {
    return window.__HERMES_PLUGIN_SDK__;
  }
  function getReact() {
    var sdk = getSDK();
    return sdk && sdk.React;
  }
  function getHooks() {
    var sdk = getSDK();
    return sdk && sdk.hooks || {};
  }
  function sessionToken() {
    return window.__HERMES_SESSION_TOKEN__;
  }
  function assetUrl(file) {
    var base = window.HERMES_BASE_PATH || "";
    return new URL(base + "/dashboard-plugins/jarvis-voice/dist/" + file, window.location.origin).toString();
  }
  function authedFetch(path, options) {
    var sdk = getSDK();
    var url = API_BASE + path;
    if (sdk && typeof sdk.authedFetch === "function") {
      return sdk.authedFetch(url, options);
    }
    var opts = Object.assign({}, options);
    opts.headers = Object.assign({}, opts.headers);
    var token = sessionToken();
    if (token) opts.headers["X-Hermes-Session-Token"] = token;
    if (!opts.credentials) opts.credentials = "include";
    return fetch(url, opts);
  }
  function fetchJSON(path) {
    var sdk = getSDK();
    if (sdk && typeof sdk.fetchJSON === "function") {
      return sdk.fetchJSON(API_BASE + path);
    }
    return authedFetch(path).then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
      return res.json();
    });
  }
  function buildSocketUrl() {
    var sdk = getSDK();
    var path = API_BASE + "/ws";
    if (sdk && typeof sdk.buildWsUrl === "function") {
      try {
        var url = sdk.buildWsUrl(path);
        if (typeof sdk.buildWsAuthParam === "function") {
          var auth = sdk.buildWsAuthParam();
          if (auth) url += (url.indexOf("?") === -1 ? "?" : "&") + auth;
        }
        return url;
      } catch (e) {
      }
    }
    var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    var token = sessionToken();
    var manual = proto + "//" + window.location.host + path;
    if (token) manual += "?token=" + encodeURIComponent(token);
    return manual;
  }

  // src/h.js
  function h() {
    var React = getReact();
    if (!React) throw new Error("jarvis-voice: SDK React not available");
    return React.createElement.apply(React, arguments);
  }

  // src/store.js
  function createStore(initial) {
    var state = initial;
    var listeners = /* @__PURE__ */ new Set();
    function get() {
      return state;
    }
    function set(patch) {
      state = Object.assign({}, state, typeof patch === "function" ? patch(state) : patch);
      listeners.forEach(function(fn) {
        fn(state);
      });
      return state;
    }
    function subscribe(fn) {
      listeners.add(fn);
      return function() {
        listeners.delete(fn);
      };
    }
    return { get, set, subscribe };
  }
  function useStore(store) {
    var hooks = getHooks();
    var useState = hooks.useState;
    var useEffect = hooks.useEffect;
    var pair = useState(store.get());
    var value = pair[0];
    var setValue = pair[1];
    useEffect(
      function() {
        setValue(store.get());
        return store.subscribe(setValue);
      },
      [store]
    );
    return value;
  }
  function pushCapped(arr, item, max) {
    var next = arr.concat([item]);
    if (next.length > max) next = next.slice(next.length - max);
    return next;
  }
  function createLatencyTracker(windowSize) {
    var size = windowSize || 20;
    var samples = {};
    function record(stage, ms) {
      var arr = (samples[stage] || []).concat([ms]);
      if (arr.length > size) arr = arr.slice(arr.length - size);
      samples[stage] = arr;
    }
    function percentile(stage, p) {
      var arr = samples[stage];
      if (!arr || !arr.length) return null;
      var sorted = arr.slice().sort(function(a, b) {
        return a - b;
      });
      var idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
      return Math.round(sorted[idx]);
    }
    function summary() {
      var out = {};
      Object.keys(samples).forEach(function(stage) {
        out[stage] = {
          p50: percentile(stage, 0.5),
          p95: percentile(stage, 0.95),
          n: samples[stage].length
        };
      });
      return out;
    }
    return { record, summary };
  }

  // src/ws.js
  var INITIAL_BACKOFF_MS = 1e3;
  var MAX_BACKOFF_MS = 1e4;
  function createJarvisSocket(handlers) {
    var onEvent = handlers && handlers.onEvent || function() {
    };
    var onBinary = handlers && handlers.onBinary || function() {
    };
    var onStatus = handlers && handlers.onStatus || function() {
    };
    var onOpen = handlers && handlers.onOpen || function() {
    };
    var ws = null;
    var backoffMs = INITIAL_BACKOFF_MS;
    var reconnectTimer = null;
    var closedByUser = false;
    var expectingBinary = false;
    function scheduleReconnect() {
      if (closedByUser) return;
      onStatus("reconnecting");
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
    function connect() {
      clearTimeout(reconnectTimer);
      closedByUser = false;
      onStatus(backoffMs > INITIAL_BACKOFF_MS ? "reconnecting" : "connecting");
      var socket;
      try {
        socket = new WebSocket(buildSocketUrl());
      } catch (e) {
        scheduleReconnect();
        return;
      }
      socket.binaryType = "arraybuffer";
      ws = socket;
      socket.onopen = function() {
        backoffMs = INITIAL_BACKOFF_MS;
        expectingBinary = false;
        onStatus("open");
        onOpen();
      };
      socket.onmessage = function(ev) {
        if (typeof ev.data === "string") {
          var msg;
          try {
            msg = JSON.parse(ev.data);
          } catch (e) {
            return;
          }
          if (msg && msg.t === "tts.chunk_hdr") {
            expectingBinary = true;
          }
          onEvent(msg);
        } else if (expectingBinary) {
          expectingBinary = false;
          onBinary(ev.data);
        }
      };
      socket.onclose = function() {
        if (ws === socket) ws = null;
        scheduleReconnect();
      };
      socket.onerror = function() {
        try {
          socket.close();
        } catch (e) {
        }
      };
    }
    function send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }
    function sendBinary(buf) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
    }
    function forceReconnect() {
      backoffMs = INITIAL_BACKOFF_MS;
      closedByUser = false;
      if (ws) {
        try {
          ws.close();
        } catch (e) {
        }
        ws = null;
      }
      connect();
    }
    function close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch (e) {
        }
        ws = null;
      }
    }
    connect();
    return { send, sendBinary, close, forceReconnect };
  }

  // src/audio-in.js
  function createMicInput(opts) {
    var onChunk = opts && opts.onChunk || function() {
    };
    var onLevel = opts && opts.onLevel || function() {
    };
    var audioCtx = null;
    var workletNode = null;
    var sourceNode = null;
    var stream = null;
    var active = false;
    var readyPromise = null;
    function supported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);
    }
    function ensureReady() {
      if (readyPromise) return readyPromise;
      readyPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16e3 },
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1
        }
      }).then(function(s) {
        stream = s;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.audioWorklet.addModule(assetUrl("mic-worklet.js")).then(function() {
          sourceNode = audioCtx.createMediaStreamSource(stream);
          workletNode = new AudioWorkletNode(audioCtx, "mic-worklet", {
            processorOptions: { targetSampleRate: 16e3 }
          });
          workletNode.port.onmessage = function(ev) {
            var data = ev.data;
            if (data.type === "chunk") {
              if (active) onChunk(data.buffer);
            } else if (data.type === "level") {
              onLevel(data.rms);
            }
          };
          sourceNode.connect(workletNode);
        });
      }).catch(function(err) {
        readyPromise = null;
        throw err;
      });
      return readyPromise;
    }
    function start() {
      active = true;
      ensureReady().then(function() {
        if (audioCtx.state === "suspended") return audioCtx.resume();
      }).catch(function() {
        active = false;
      });
    }
    function stop() {
      active = false;
    }
    function teardown() {
      active = false;
      if (workletNode) {
        try {
          workletNode.disconnect();
        } catch (e) {
        }
      }
      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch (e) {
        }
      }
      if (stream) {
        stream.getTracks().forEach(function(t) {
          t.stop();
        });
        stream = null;
      }
      if (audioCtx) {
        try {
          audioCtx.close();
        } catch (e) {
        }
        audioCtx = null;
      }
      readyPromise = null;
    }
    return { start, stop, teardown, isSupported: supported() };
  }

  // src/audio-out.js
  function createAudioOutput() {
    var TARGET_SOURCE_RATE = 24e3;
    var audioCtx = null;
    var workletNode = null;
    var gainNode = null;
    var readyPromise = null;
    var pendingGain = 1;
    function ensureReady() {
      if (readyPromise) return readyPromise;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SOURCE_RATE });
      } catch (e) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      readyPromise = audioCtx.audioWorklet.addModule(assetUrl("player-worklet.js")).then(function() {
        workletNode = new AudioWorkletNode(audioCtx, "player-worklet", { outputChannelCount: [1] });
        gainNode = audioCtx.createGain();
        gainNode.gain.value = pendingGain;
        workletNode.connect(gainNode).connect(audioCtx.destination);
      }).catch(function(err) {
        readyPromise = null;
        throw err;
      });
      return readyPromise;
    }
    function queueChunk(data) {
      ensureReady().then(function() {
        if (audioCtx.state === "suspended") audioCtx.resume();
        var int16 = data instanceof Int16Array ? data : new Int16Array(data);
        var float32 = int16ToFloat32(int16);
        var dstRate = audioCtx.sampleRate;
        var samples = dstRate === TARGET_SOURCE_RATE ? float32 : resampleLinear(float32, TARGET_SOURCE_RATE, dstRate);
        workletNode.port.postMessage({ type: "push", samples }, [samples.buffer]);
      }).catch(function() {
      });
    }
    function hardStop() {
      if (workletNode) workletNode.port.postMessage({ type: "clear" });
    }
    function setGain(v) {
      pendingGain = v;
      if (gainNode) gainNode.gain.value = v;
    }
    return { queueChunk, hardStop, setGain };
  }
  function int16ToFloat32(int16) {
    var out = new Float32Array(int16.length);
    for (var i = 0; i < int16.length; i++) {
      var s = int16[i];
      out[i] = s < 0 ? s / 32768 : s / 32767;
    }
    return out;
  }
  function resampleLinear(src, srcRate, dstRate) {
    var ratio = srcRate / dstRate;
    var outLen = Math.max(1, Math.round(src.length / ratio));
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var pos = i * ratio;
      var i0 = Math.floor(pos);
      var i1 = Math.min(i0 + 1, src.length - 1);
      var frac = pos - i0;
      out[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
    return out;
  }

  // src/visualizer.js
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
    done: { hue: 46, sat: 90, light: 66, spread: 0.6, rot: 0.12, mode: "flash" }
  };
  function createVisualizer(canvas) {
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
        cluster: Math.random() < 0.5 ? 0 : 1
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
      var h2 = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h2) canvas.height = h2;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
    }
    resize();
    window.addEventListener("resize", resize);
    if (window.matchMedia) {
      try {
        var battery = navigator.getBattery && navigator.getBattery();
        if (battery && battery.then) {
          battery.then(function(b) {
            function refresh() {
              lowPower = !b.charging && b.level < 0.2;
            }
            refresh();
            b.addEventListener("levelchange", refresh);
            b.addEventListener("chargingchange", refresh);
          });
        }
      } catch (e) {
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
        mode: toStyle.mode
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
      var w = canvas.width, h2 = canvas.height;
      ctx.clearRect(0, 0, w, h2);
      var cx = w / 2, cy = h2 / 2;
      var radius = Math.min(w, h2) * 0.14;
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
      for (var i2 = 0; i2 < ringCount; i2++) {
        var frac = (i2 + 1) / ringCount;
        var ringR = baseR * (0.55 + frac * 0.5) * style.spread * 1.4;
        var wobble = 0;
        if (style.mode === "breathe") {
          wobble = Math.sin(tSec * 0.6 + i2) * baseR * 0.03;
        } else if (style.mode === "waveform") {
          wobble = ampLevel * baseR * 0.25 * Math.sin(tSec * 6 + i2 * 2);
        } else if (style.mode === "ripple") {
          wobble = micLevel * baseR * 0.3 * Math.sin(tSec * 5 - i2 * 1.3);
        } else if (style.mode === "pulseSlow") {
          wobble = Math.sin(tSec * 1.2) * baseR * 0.05;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(4, ringR + wobble), 0, TWO_PI);
        ctx.strokeStyle = "hsla(" + style.hue + ", " + style.sat + "%, " + style.light + "%, " + (0.35 - i2 * 0.08) + ")";
        ctx.lineWidth = Math.max(1, baseR * 0.01);
        ctx.stroke();
      }
      if (style.mode === "scan") {
        var sweepY = cy - baseR + tSec * 160 % (baseR * 2);
        var grad = ctx.createLinearGradient(cx - baseR, sweepY - 6, cx - baseR, sweepY + 6);
        grad.addColorStop(0, "hsla(" + style.hue + ",90%,70%,0)");
        grad.addColorStop(0.5, "hsla(" + style.hue + ",90%,70%,0.5)");
        grad.addColorStop(1, "hsla(" + style.hue + ",90%,70%,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(cx - baseR, sweepY - 6, baseR * 2, 12);
      }
      if (style.mode === "radar") {
        var ang = tSec * 1.4 % TWO_PI;
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
        var frac2 = tSec * 0.25 % 1;
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
        var burst = Math.max(0, 1 - tSec % 2);
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
        alpha,
        scale
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
        for (var i2 = 0; i2 < positions.length; i2 += 7) {
          for (var j = i2 + 7; j < positions.length; j += 21) {
            var a = positions[i2], b = positions[j];
            var dx = a.x - b.x, dy = a.y - b.y;
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
      var w = canvas.width, h2 = canvas.height;
      ctx.clearRect(0, 0, w, h2);
      var cx = w / 2, cy = h2 / 2;
      var baseR = Math.min(w, h2) * 0.3;
      var tSec = t / 1e3;
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
          ctx.fillRect(0, 0, w, h2);
        }
      }
    }
    function frame(t) {
      if (!running) return;
      rafId = requestAnimationFrame(frame);
      if (document.hidden) return;
      var maxFps = lowPower || document.hidden ? MAX_FPS_LOW_POWER : MAX_FPS_NORMAL;
      var minGap = 1e3 / maxFps;
      if (t - lastFrameT < minGap) return;
      lastFrameT = t;
      micLevel = lerp(micLevel, micTarget, 0.35);
      ampLevel = lerp(ampLevel, ampTarget, 0.35);
      micTarget *= 0.9;
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
      setState,
      onAmp,
      onMicLevel,
      setReducedMotion,
      resize,
      destroy
    };
  }

  // src/panels.js
  function useHooks() {
    return getHooks();
  }
  function ConnectionBadge(props) {
    var status = props.status;
    var label = { open: "connected", connecting: "connecting\u2026", reconnecting: "reconnecting\u2026" }[status] || "offline";
    var cls = "jv-badge jv-badge--" + (status === "open" ? "ok" : status === "connecting" ? "info" : "warn");
    return h("span", { className: cls }, h("span", { className: "jv-badge-dot" }), label);
  }
  function OfflineOverlay(props) {
    if (!props.visible) return null;
    return h(
      "div",
      { className: "jv-overlay" },
      h(
        "div",
        { className: "jv-overlay-card" },
        h("div", { className: "jv-overlay-title" }, "Jarvis service offline"),
        h("div", { className: "jv-overlay-sub" }, "Can't reach jarvisd through the dashboard proxy. Retrying automatically."),
        h("button", { className: "jv-btn jv-btn--primary", onClick: props.onRetry }, "Retry now")
      )
    );
  }
  function TextInputBar(props) {
    var hooks = useHooks();
    var useState = hooks.useState;
    var s = useState("");
    var text = s[0];
    var setText = s[1];
    function submit() {
      var trimmed = text.trim();
      if (!trimmed) return;
      props.onSubmit(trimmed);
      setText("");
    }
    return h(
      "div",
      { className: "jv-textbar" },
      h("input", {
        className: "jv-textbar-input",
        type: "text",
        placeholder: "Type to Jarvis\u2026",
        value: text,
        onChange: function(e) {
          setText(e.target.value);
        },
        onKeyDown: function(e) {
          if (e.key === "Enter") submit();
        }
      }),
      h("button", { className: "jv-btn", onClick: submit }, "Send")
    );
  }
  function fmtTime(ts) {
    var d = new Date(ts || Date.now());
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    var ss = String(d.getSeconds()).padStart(2, "0");
    return hh + ":" + mm + ":" + ss;
  }
  function TimelineRow(props) {
    var hooks = useHooks();
    var useState = hooks.useState;
    var s = useState(false);
    var open = s[0];
    var setOpen = s[1];
    var item = props.item;
    return h(
      "div",
      { className: "jv-timeline-row" },
      h(
        "div",
        {
          className: "jv-timeline-head" + (item.expandable ? " jv-clickable" : ""),
          onClick: item.expandable ? function() {
            setOpen(!open);
          } : void 0
        },
        h("span", { className: "jv-timeline-ts" }, fmtTime(item.ts)),
        h("span", { className: "jv-timeline-icon" }, item.icon || "\u2022"),
        h("span", { className: "jv-timeline-label" }, item.label),
        item.expandable ? h("span", { className: "jv-timeline-chevron" }, open ? "\u25BE" : "\u25B8") : null
      ),
      open && item.details ? h("pre", { className: "jv-timeline-details" }, JSON.stringify(item.details, null, 2)) : null
    );
  }
  function ActivityTimeline(props) {
    var items = props.items;
    return h(
      "div",
      { className: "jv-panel" },
      h("div", { className: "jv-panel-title" }, "Activity"),
      h(
        "div",
        { className: "jv-timeline" },
        items.length === 0 ? h("div", { className: "jv-empty" }, "No activity yet") : items.slice().reverse().map(function(item) {
          return h(TimelineRow, { key: item.id, item });
        })
      )
    );
  }
  var STATUS_LABEL = {
    queued: "queued",
    running: "running",
    paused: "paused",
    canceled: "canceled",
    done: "done",
    failed: "failed",
    needs_review: "needs review"
  };
  function TaskRow(props) {
    var t = props.task;
    function control(action) {
      authedFetch("/tasks/" + encodeURIComponent(t.id) + "/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      }).catch(function() {
      });
    }
    var canPause = t.status === "running";
    var canResume = t.status === "paused";
    var canCancel = t.status === "running" || t.status === "paused" || t.status === "queued";
    return h(
      "div",
      { className: "jv-task-row" },
      h(
        "div",
        { className: "jv-task-main" },
        h("span", { className: "jv-chip jv-chip--" + (t.status || "queued") }, STATUS_LABEL[t.status] || t.status),
        h("span", { className: "jv-task-title" }, t.title || t.goal || t.id),
        h("span", { className: "jv-task-kind" }, t.kind || "")
      ),
      t.progress_note ? h("div", { className: "jv-task-note" }, t.progress_note) : null,
      t.result_summary ? h("div", { className: "jv-task-note" }, t.result_summary) : null,
      h(
        "div",
        { className: "jv-task-controls" },
        canPause ? h("button", { className: "jv-btn jv-btn--tiny", onClick: function() {
          control("pause");
        } }, "Pause") : null,
        canResume ? h("button", { className: "jv-btn jv-btn--tiny", onClick: function() {
          control("resume");
        } }, "Resume") : null,
        canCancel ? h("button", { className: "jv-btn jv-btn--tiny jv-btn--danger", onClick: function() {
          control("cancel");
        } }, "Cancel") : null
      )
    );
  }
  function TasksBoard(props) {
    var tasks = Object.values(props.tasks || {}).sort(function(a, b) {
      return (b.updated_ts || 0) - (a.updated_ts || 0);
    });
    return h(
      "div",
      { className: "jv-panel" },
      h("div", { className: "jv-panel-title" }, "Tasks"),
      tasks.length === 0 ? h("div", { className: "jv-empty" }, "No tasks") : tasks.map(function(t) {
        return h(TaskRow, { key: t.id, task: t });
      })
    );
  }
  function MemorySources(props) {
    var items = props.items || [];
    return h(
      "div",
      { className: "jv-panel" },
      h("div", { className: "jv-panel-title" }, "Memory sources"),
      items.length === 0 ? h("div", { className: "jv-empty" }, "No memory hits yet") : items.map(function(m, i) {
        return h(
          "div",
          { className: "jv-memory-row", key: i },
          h("div", { className: "jv-memory-title" }, m.title || m.path),
          h("div", { className: "jv-memory-path" }, m.path)
        );
      })
    );
  }
  function HealthChip(props) {
    var ok = props.ok;
    return h(
      "span",
      { className: "jv-chip jv-chip--" + (ok ? "done" : "failed") },
      props.name + (props.detail ? " (" + props.detail + ")" : "")
    );
  }
  function HealthPanel(props) {
    var health = props.health;
    var latency = props.latency || {};
    var components = health && health.components || {};
    var names = Object.keys(components);
    return h(
      "div",
      { className: "jv-panel" },
      h("div", { className: "jv-panel-title" }, "Health"),
      !health ? h("div", { className: "jv-empty" }, "Waiting for /health\u2026") : h(
        "div",
        { className: "jv-health-chips" },
        names.length === 0 ? h("div", { className: "jv-empty" }, "No component detail") : names.map(function(name) {
          var c = components[name] || {};
          return h(HealthChip, { key: name, name, ok: !!c.ok, detail: c.detail });
        })
      ),
      h(
        "div",
        { className: "jv-latency" },
        Object.keys(latency).length === 0 ? h("div", { className: "jv-empty" }, "No latency samples yet") : Object.keys(latency).map(function(stage) {
          var v = latency[stage];
          return h(
            "div",
            { className: "jv-latency-row", key: stage },
            h("span", { className: "jv-latency-stage" }, stage),
            h("span", { className: "jv-latency-value" }, "p50 " + (v.p50 == null ? "\u2014" : v.p50 + "ms")),
            h("span", { className: "jv-latency-value" }, "p95 " + (v.p95 == null ? "\u2014" : v.p95 + "ms"))
          );
        })
      )
    );
  }
  function RightColumn(props) {
    var store = props.store;
    var s = useStore(store);
    if (s.rightCollapsed) {
      return h(
        "div",
        { className: "jv-rightcol jv-rightcol--collapsed" },
        h(
          "button",
          {
            className: "jv-collapse-btn",
            onClick: function() {
              store.set({ rightCollapsed: false });
            },
            title: "Expand panels"
          },
          "\u25C2"
        )
      );
    }
    return h(
      "div",
      { className: "jv-rightcol" },
      h(
        "button",
        {
          className: "jv-collapse-btn",
          onClick: function() {
            store.set({ rightCollapsed: true });
          },
          title: "Collapse panels"
        },
        "\u25B8"
      ),
      h(ActivityTimeline, { items: s.timeline }),
      h(TasksBoard, { tasks: s.tasks }),
      h(MemorySources, { items: s.memoryHits }),
      h(HealthPanel, { health: s.health, latency: s.latency })
    );
  }
  function SettingsPopover(props) {
    if (!props.open) return null;
    var s = props.settings;
    return h(
      "div",
      { className: "jv-settings-popover" },
      h("div", { className: "jv-panel-title" }, "Settings"),
      h(
        "label",
        { className: "jv-settings-row" },
        h("span", null, "Voice mode"),
        h(
          "select",
          {
            value: s.micMode,
            onChange: function(e) {
              props.onMicModeChange(e.target.value);
            }
          },
          h("option", { value: "ptt" }, "Push-to-talk"),
          h("option", { value: "vad" }, "Continuous (experimental)")
        )
      ),
      h(
        "label",
        { className: "jv-settings-row" },
        h("span", null, "Reduced motion"),
        h("input", {
          type: "checkbox",
          checked: s.reducedMotion,
          onChange: function(e) {
            props.onReducedMotionChange(e.target.checked);
          }
        })
      ),
      h(
        "label",
        { className: "jv-settings-row" },
        h("span", null, "Volume"),
        h("input", {
          type: "range",
          min: "0",
          max: "1.5",
          step: "0.05",
          value: s.volume,
          onChange: function(e) {
            props.onVolumeChange(parseFloat(e.target.value));
          }
        })
      ),
      h("button", { className: "jv-btn", onClick: props.onClose }, "Close")
    );
  }

  // src/app.js
  var TIMELINE_MAX = 200;
  var HEALTH_POLL_MS = 15e3;
  var TIMELINE_ICON = {
    state: "\u25C6",
    // ◆
    "stt.final": "\u25A4",
    // ▤
    "mediator.done": "\u25A3",
    // ▣
    meta_tool: "\u2699",
    // ⚙
    "tts.start": "\u266A",
    // ♪
    "tts.end": "\u266A",
    "task.update": "\u25A6",
    // ▦
    "memory.hits": "\u25A5",
    // ▥
    health: "\u2665",
    error: "\u2715",
    // ✕
    "turn.text": "\u270E"
  };
  function loadLocalBool(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch (e) {
      return fallback;
    }
  }
  function saveLocalBool(key, v) {
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch (e) {
    }
  }
  function loadLocalFloat(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? fallback : parseFloat(v);
    } catch (e) {
      return fallback;
    }
  }
  function saveLocalFloat(key, v) {
    try {
      window.localStorage.setItem(key, String(v));
    } catch (e) {
    }
  }
  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }
  function humanState(s) {
    return s.replace(/_/g, " ").replace(/^./, function(c) {
      return c.toUpperCase();
    });
  }
  function tasksFromResponse(data) {
    var list = Array.isArray(data) ? data : data && Array.isArray(data.tasks) ? data.tasks : [];
    var map = {};
    list.forEach(function(t) {
      map[t.id] = t;
    });
    return map;
  }
  function App() {
    var hooks = getHooks();
    var useEffect = hooks.useEffect;
    var useRef = hooks.useRef;
    var storeRef = useRef(null);
    if (!storeRef.current) {
      storeRef.current = createStore({
        connection: "connecting",
        offline: false,
        fsmState: "idle",
        fsmDetail: null,
        sttPartial: "",
        sttFinal: "",
        mediatorText: "",
        ttsPlaying: false,
        micActive: false,
        micMode: "ptt",
        reducedMotion: loadLocalBool("jarvis-voice:reducedMotion", false),
        volume: loadLocalFloat("jarvis-voice:volume", 1),
        rightCollapsed: false,
        settingsOpen: false,
        timeline: [],
        tasks: {},
        memoryHits: [],
        health: null,
        latency: {},
        micError: null
      });
    }
    var store = storeRef.current;
    var s = useStore(store);
    var canvasRef = useRef(null);
    var visRef = useRef(null);
    var wsRef = useRef(null);
    var audioOutRef = useRef(null);
    var latencyRef = useRef(null);
    if (!latencyRef.current) latencyRef.current = createLatencyTracker(20);
    var pttRef = useRef({ start: function() {
    }, stop: function() {
    } });
    function pushTimeline(type, label, details) {
      store.set(function(st) {
        return {
          timeline: pushCapped(
            st.timeline,
            { id: type + ":" + Date.now() + ":" + Math.random(), ts: Date.now(), type, icon: TIMELINE_ICON[type] || "\u2022", label, expandable: !!details, details },
            TIMELINE_MAX
          )
        };
      });
    }
    function resync() {
      fetchJSON("/tasks").then(function(data) {
        store.set({ tasks: tasksFromResponse(data) });
      }).catch(function() {
      });
      fetchJSON("/health").then(function(data) {
        store.set({ health: data });
      }).catch(function() {
      });
    }
    useEffect(function() {
      var vis = createVisualizer(canvasRef.current);
      vis.setReducedMotion(store.get().reducedMotion);
      visRef.current = vis;
      var audioOut = createAudioOutput();
      audioOut.setGain(store.get().volume);
      audioOutRef.current = audioOut;
      var mic = createMicInput({
        onChunk: function(buf) {
          var socket2 = wsRef.current;
          if (socket2) socket2.sendBinary(buf);
        },
        onLevel: function(rms) {
          vis.onMicLevel(rms);
        }
      });
      var offlineGraceTimer = setTimeout(function() {
        if (store.get().connection !== "open") store.set({ offline: true });
      }, 1500);
      function onEvent(msg) {
        if (!msg || !msg.t) return;
        switch (msg.t) {
          case "state":
            store.set({ fsmState: msg.value, fsmDetail: msg.detail || null });
            vis.setState(msg.value);
            pushTimeline("state", humanState(msg.value) + (msg.detail ? " \u2014 " + msg.detail : ""));
            break;
          case "stt.partial":
            store.set({ sttPartial: msg.text || "" });
            break;
          case "stt.final":
            store.set({ sttPartial: "", sttFinal: msg.text || "" });
            pushTimeline("stt.final", msg.text || "");
            break;
          case "mediator.delta":
            store.set(function(st) {
              return { mediatorText: st.mediatorText + (msg.text || "") };
            });
            break;
          case "mediator.done":
            store.set({ mediatorText: msg.text || "" });
            pushTimeline("mediator.done", (msg.text || "").slice(0, 120));
            if (typeof msg.ms_first_token === "number") latencyRef.current.record("mediator_first_token", msg.ms_first_token);
            store.set({ latency: latencyRef.current.summary() });
            break;
          case "meta_tool":
            pushTimeline("meta_tool", msg.name + " (" + msg.phase + ")", { args: msg.args, result_summary: msg.result_summary, ms: msg.ms });
            break;
          case "tts.start":
            store.set({ ttsPlaying: true });
            pushTimeline("tts.start", "Speaking: " + (msg.text || "").slice(0, 80));
            break;
          case "tts.chunk_hdr":
            break;
          case "tts.amp":
            vis.onAmp(typeof msg.v === "number" ? msg.v : 0);
            break;
          case "tts.end":
            store.set({ ttsPlaying: false });
            break;
          case "task.update": {
            var updated = Object.assign({}, msg, { updated_ts: Date.now() });
            store.set(function(st) {
              var tasks = Object.assign({}, st.tasks);
              tasks[msg.id] = updated;
              return { tasks };
            });
            pushTimeline("task.update", (msg.title || msg.id) + " \u2014 " + msg.status);
            break;
          }
          case "memory.hits":
            store.set({ memoryHits: msg.items || [] });
            pushTimeline("memory.hits", (msg.items || []).length + " hit(s)", msg.items);
            break;
          case "latency":
            latencyRef.current.record(msg.stage, msg.ms);
            store.set({ latency: latencyRef.current.summary() });
            break;
          case "health":
            store.set({ health: msg });
            break;
          case "error":
            store.set({ micError: msg.message || "error" });
            pushTimeline("error", msg.message || "error", msg);
            break;
          case "pong":
            break;
          default:
            pushTimeline(msg.t, msg.t);
        }
      }
      var socket = createJarvisSocket({
        onEvent,
        onBinary: function(buf) {
          audioOut.queueChunk(buf);
        },
        onStatus: function(status) {
          store.set({ connection: status });
          if (status === "open") {
            clearTimeout(offlineGraceTimer);
            store.set({ offline: false });
            resync();
          } else if (status === "reconnecting") {
            store.set({ offline: true });
          }
        },
        onOpen: function() {
        }
      });
      wsRef.current = socket;
      function startPtt() {
        if (store.get().micActive) return;
        store.set({ micActive: true });
        if (store.get().ttsPlaying) {
          audioOut.hardStop();
          socket.send({ t: "barge_in" });
        }
        socket.send({ t: "mic.start" });
        mic.start();
      }
      function stopPtt() {
        if (!store.get().micActive) return;
        store.set({ micActive: false });
        mic.stop();
        socket.send({ t: "mic.stop" });
      }
      function onKeyDown(e) {
        if (e.code !== "Space") return;
        if (!document.hasFocus()) return;
        if (isTypingTarget(document.activeElement)) return;
        if (e.repeat) return;
        e.preventDefault();
        startPtt();
      }
      function onKeyUp(e) {
        if (e.code !== "Space") return;
        if (isTypingTarget(document.activeElement)) return;
        e.preventDefault();
        stopPtt();
      }
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      var healthTimer = setInterval(function() {
        fetchJSON("/health").then(function(data) {
          store.set({ health: data });
        }).catch(function() {
        });
      }, HEALTH_POLL_MS);
      pttRef.current.start = startPtt;
      pttRef.current.stop = stopPtt;
      return function cleanup() {
        clearTimeout(offlineGraceTimer);
        clearInterval(healthTimer);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        socket.close();
        mic.teardown();
        vis.destroy();
      };
    }, []);
    useEffect(
      function() {
        if (visRef.current) visRef.current.setReducedMotion(s.reducedMotion);
        saveLocalBool("jarvis-voice:reducedMotion", s.reducedMotion);
      },
      [s.reducedMotion]
    );
    useEffect(
      function() {
        if (audioOutRef.current) audioOutRef.current.setGain(s.volume);
        saveLocalFloat("jarvis-voice:volume", s.volume);
      },
      [s.volume]
    );
    useEffect(
      function() {
        var id = setTimeout(function() {
          if (visRef.current) visRef.current.resize();
        }, 260);
        return function() {
          clearTimeout(id);
        };
      },
      [s.rightCollapsed]
    );
    function onPointerDown(e) {
      e.preventDefault();
      pttRef.current.start();
    }
    function onPointerUp(e) {
      e.preventDefault();
      pttRef.current.stop();
    }
    function submitText(text) {
      if (wsRef.current) wsRef.current.send({ t: "turn.text", text });
      pushTimeline("turn.text", text);
    }
    function setMicMode(mode) {
      store.set({ micMode: mode });
      if (wsRef.current) wsRef.current.send({ t: "mode.set", mode });
    }
    var transcriptText = s.sttFinal;
    var partialText = s.sttPartial;
    return h(
      "div",
      { className: "jv-root" },
      h(
        "header",
        { className: "jv-header" },
        h("div", { className: "jv-header-title" }, "JARVIS"),
        h(
          "div",
          { className: "jv-header-right" },
          h(ConnectionBadge, { status: s.connection }),
          h(
            "button",
            {
              className: "jv-icon-btn",
              title: "Settings",
              onClick: function() {
                store.set({ settingsOpen: !s.settingsOpen });
              }
            },
            "\u2699"
          )
        )
      ),
      h(
        "div",
        { className: "jv-body" },
        h(
          "main",
          { className: "jv-stage" },
          h(
            "div",
            { className: "jv-stage-canvas-wrap" },
            h("canvas", { ref: canvasRef, className: "jv-canvas" })
          ),
          h(
            "div",
            { className: "jv-ptt-area" },
            h("button", {
              className: "jv-ptt-btn" + (s.micActive ? " jv-ptt-btn--active" : ""),
              onPointerDown,
              onPointerUp,
              onPointerLeave: function(e) {
                if (s.micActive) onPointerUp(e);
              },
              "aria-label": "Push to talk"
            }, "\u25CF"),
            h("div", { className: "jv-ptt-label" }, s.micActive ? "Listening\u2026" : humanState(s.fsmState)),
            h(
              "button",
              {
                className: "jv-mode-toggle" + (s.micMode === "vad" ? " jv-mode-toggle--active" : ""),
                onClick: function() {
                  setMicMode(s.micMode === "ptt" ? "vad" : "ptt");
                },
                title: "Continuous listening mode (experimental)"
              },
              s.micMode === "vad" ? "VAD mode: on (experimental)" : "VAD mode: off"
            )
          ),
          h(
            "div",
            { className: "jv-transcript" },
            partialText ? h("span", { className: "jv-transcript-partial" }, partialText) : null,
            !partialText && transcriptText ? h("span", { className: "jv-transcript-final" }, transcriptText) : null
          ),
          h("div", { className: "jv-mediator-text" }, s.mediatorText)
        ),
        h(RightColumn, { store })
      ),
      h(TextInputBar, { onSubmit: submitText }),
      h(SettingsPopover, {
        open: s.settingsOpen,
        settings: s,
        onClose: function() {
          store.set({ settingsOpen: false });
        },
        onMicModeChange: setMicMode,
        onReducedMotionChange: function(v) {
          store.set({ reducedMotion: v });
        },
        onVolumeChange: function(v) {
          store.set({ volume: v });
        }
      }),
      h(OfflineOverlay, {
        visible: s.offline,
        onRetry: function() {
          if (wsRef.current) wsRef.current.forceReconnect();
        }
      })
    );
  }

  // src/index.js
  (function boot() {
    if (!window.__HERMES_PLUGIN_SDK__ || !window.__HERMES_PLUGINS__) return;
    window.__HERMES_PLUGINS__.register("jarvis-voice", App);
  })();
})();
