// app.js — top-level component: wires store + ws + audio-in/out + visualizer
// + panels into the single-page layout described in the task spec (center
// stage canvas/PTT/transcript, right column panels, bottom text input,
// settings popover).
import { h } from "./h.js";
import { getHooks } from "./sdk.js";
import { createStore, useStore, pushCapped, createLatencyTracker } from "./store.js";
import { createJarvisSocket } from "./ws.js";
import { createMicInput } from "./audio-in.js";
import { createAudioOutput } from "./audio-out.js";
import { createVisualizer } from "./visualizer/index.js";
import { fetchJSON } from "./sdk.js";
import { ConnectionBadge, OfflineOverlay, TextInputBar, RightColumn, SettingsPopover } from "./panels.js";

var TIMELINE_MAX = 200;
var HEALTH_POLL_MS = 15000;

var TIMELINE_ICON = {
  state: "◆", // ◆
  "stt.final": "▤", // ▤
  "mediator.done": "▣", // ▣
  meta_tool: "⚙", // ⚙
  "tts.start": "♪", // ♪
  "tts.end": "♪",
  "task.update": "▦", // ▦
  "memory.hits": "▥", // ▥
  health: "♥",
  error: "✕", // ✕
  "turn.text": "✎",
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
    /* localStorage unavailable (private mode etc) — setting just won't persist */
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
    /* noop */
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  var tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function humanState(s) {
  return s
    .replace(/_/g, " ")
    .replace(/^./, function (c) {
      return c.toUpperCase();
    });
}

function tasksFromResponse(data) {
  var list = Array.isArray(data) ? data : data && Array.isArray(data.tasks) ? data.tasks : [];
  var map = {};
  list.forEach(function (t) {
    map[t.id] = t;
  });
  return map;
}

export function App() {
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
      micError: null,
      micHint: null,
    });
  }
  var store = storeRef.current;
  var s = useStore(store);

  var canvasRef = useRef(null);
  var visRef = useRef(null);
  var wsRef = useRef(null);
  var audioOutRef = useRef(null);
  var latencyRef = useRef(null);
  var micLevelBarRef = useRef(null);
  if (!latencyRef.current) latencyRef.current = createLatencyTracker(20);
  var pttRef = useRef({ start: function () {}, stop: function () {} });

  function pushTimeline(type, label, details) {
    store.set(function (st) {
      return {
        timeline: pushCapped(
          st.timeline,
          { id: type + ":" + Date.now() + ":" + Math.random(), ts: Date.now(), type: type, icon: TIMELINE_ICON[type] || "•", label: label, expandable: !!details, details: details },
          TIMELINE_MAX
        ),
      };
    });
  }

  function resync() {
    fetchJSON("/tasks")
      .then(function (data) {
        store.set({ tasks: tasksFromResponse(data) });
      })
      .catch(function () {
        /* offline overlay already reflects connectivity problems */
      });
    fetchJSON("/health")
      .then(function (data) {
        store.set({ health: data });
      })
      .catch(function () {
        /* noop */
      });
  }

  // Mount once: wire ws, audio, visualizer, health polling, keyboard PTT.
  useEffect(function () {
    var vis = createVisualizer(canvasRef.current);
    vis.setReducedMotion(store.get().reducedMotion);
    visRef.current = vis;

    var audioOut = createAudioOutput();
    audioOut.setGain(store.get().volume);
    audioOutRef.current = audioOut;
    // True voice sync: the orb reads the player's AnalyserNode once per
    // frame, so speaking-state motion follows the audio actually heard.
    // (tts.amp events remain the fallback when the analyser is unavailable.)
    vis.setAudioSource(audioOut.getLevels);

    // Client-side "is the mic actually producing signal" bookkeeping (see
    // README §Mic troubleshooting). Plain closure vars, not store state:
    // lastMicRms is written at mic-level frequency (~20Hz) and must never
    // trigger a React re-render — see store.js's header comment on why
    // high-frequency signals bypass the store entirely.
    var lastMicRms = 0;
    var micHeardActivity = false;
    var silenceCheckTimer = null;

    var mic = createMicInput({
      onChunk: function (buf) {
        var socket = wsRef.current;
        if (socket) socket.sendBinary(buf);
      },
      onLevel: function (rms) {
        vis.onMicLevel(rms);
        lastMicRms = rms;
        if (micLevelBarRef.current) {
          micLevelBarRef.current.style.width = Math.round(Math.min(1, rms) * 100) + "%";
        }
      },
      onError: function (message) {
        store.set({ micError: message });
        pushTimeline("error", message);
      },
    });

    // 2s after mic capture starts: if chunks are genuinely flowing locally
    // (proves getUserMedia/worklet/graph all work) but the level stayed
    // near-silent AND the server never showed real transcription activity,
    // the mic is very likely capturing the wrong/muted input device rather
    // than anything actually being broken in this UI.
    function armSilenceCheck() {
      clearTimeout(silenceCheckTimer);
      micHeardActivity = false;
      store.set({ micHint: null });
      silenceCheckTimer = setTimeout(function () {
        if (!store.get().micActive) return;
        if (mic.getChunkCount() > 0 && lastMicRms < 0.02 && !micHeardActivity) {
          store.set({ micHint: "Mic level is silent — check input device/permissions." });
        }
      }, 2000);
    }

    var offlineGraceTimer = setTimeout(function () {
      if (store.get().connection !== "open") store.set({ offline: true });
    }, 1500);

    function onEvent(msg) {
      if (!msg || !msg.t) return;
      switch (msg.t) {
        case "state":
          store.set({ fsmState: msg.value, fsmDetail: msg.detail || null });
          vis.setState(msg.value, msg.detail);
          pushTimeline("state", humanState(msg.value) + (msg.detail ? " — " + msg.detail : ""));
          // "listening" is just the immediate ack of mic.start, not proof
          // audio is really arriving — only states beyond that count as
          // evidence the pipeline is doing something with real input.
          if (msg.value !== "idle" && msg.value !== "listening") {
            micHeardActivity = true;
          }
          break;
        case "stt.partial":
          store.set({ sttPartial: msg.text || "" });
          micHeardActivity = true;
          if (store.get().micHint) store.set({ micHint: null });
          break;
        case "stt.final":
          store.set({ sttPartial: "", sttFinal: msg.text || "" });
          pushTimeline("stt.final", msg.text || "");
          micHeardActivity = true;
          if (store.get().micHint) store.set({ micHint: null });
          break;
        case "mediator.delta":
          store.set(function (st) {
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
          // binary framing handled in ws.js; nothing to render per-chunk.
          break;
        case "tts.amp":
          vis.onAmp(typeof msg.v === "number" ? msg.v : 0);
          break;
        case "tts.end":
          store.set({ ttsPlaying: false });
          break;
        case "task.update": {
          var updated = Object.assign({}, msg, { updated_ts: Date.now() });
          store.set(function (st) {
            var tasks = Object.assign({}, st.tasks);
            tasks[msg.id] = updated;
            return { tasks: tasks };
          });
          pushTimeline("task.update", (msg.title || msg.id) + " — " + msg.status);
          break;
        }
        case "memory.hits":
          store.set({ memoryHits: msg.items || [] });
          vis.onMemoryHits(msg.items || []);
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
      onEvent: onEvent,
      onBinary: function (buf) {
        audioOut.queueChunk(buf);
      },
      onStatus: function (status) {
        store.set({ connection: status });
        if (status === "open") {
          clearTimeout(offlineGraceTimer);
          store.set({ offline: false });
          resync();
        } else if (status === "reconnecting") {
          store.set({ offline: true });
        }
      },
      onOpen: function () {
        /* resync() already triggered from onStatus("open") above */
      },
    });
    wsRef.current = socket;

    function startPtt() {
      if (store.get().micActive) return;
      store.set({ micActive: true }); // immediate visual state, no server round-trip
      if (store.get().ttsPlaying) {
        audioOut.hardStop();
        socket.send({ t: "barge_in" });
      }
      socket.send({ t: "mic.start" });
      mic.start();
      armSilenceCheck();
    }
    function stopPtt() {
      if (!store.get().micActive) return;
      store.set({ micActive: false });
      mic.stop();
      socket.send({ t: "mic.stop" });
      clearTimeout(silenceCheckTimer);
      store.set({ micHint: null });
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

    var healthTimer = setInterval(function () {
      fetchJSON("/health")
        .then(function (data) {
          store.set({ health: data });
        })
        .catch(function () {
          /* connection status already reflects reachability */
        });
    }, HEALTH_POLL_MS);

    pttRef.current.start = startPtt;
    pttRef.current.stop = stopPtt;

    return function cleanup() {
      clearTimeout(offlineGraceTimer);
      clearInterval(healthTimer);
      clearTimeout(silenceCheckTimer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      socket.close();
      mic.teardown();
      vis.destroy();
    };
    // eslint-disable-next-line
  }, []);

  useEffect(
    function () {
      if (visRef.current) visRef.current.setReducedMotion(s.reducedMotion);
      saveLocalBool("jarvis-voice:reducedMotion", s.reducedMotion);
    },
    [s.reducedMotion]
  );
  useEffect(function () {
    // The host SPA mounts us under a `display: contents` parent inside a
    // content-sized block wrapper, so `height: 100%` resolves to content
    // height and the page silently clips. Pin the root to the real viewport
    // remainder (top offset accounts for header/banner, which can change).
    var root = document.getElementById("jarvis-voice-root");
    if (!root) return;
    function sync() {
      var top = root.getBoundingClientRect().top;
      root.style.height = Math.max(320, window.innerHeight - top) + "px";
    }
    sync();
    window.addEventListener("resize", sync);
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    if (ro && root.parentElement) ro.observe(document.body);
    var t = setTimeout(sync, 500); // banner/theme settle
    return function () {
      window.removeEventListener("resize", sync);
      if (ro) ro.disconnect();
      clearTimeout(t);
    };
  }, []);
  useEffect(
    function () {
      if (audioOutRef.current) audioOutRef.current.setGain(s.volume);
      saveLocalFloat("jarvis-voice:volume", s.volume);
    },
    [s.volume]
  );
  useEffect(
    function () {
      // Right-column collapse changes the canvas's available width — nudge
      // the visualizer to re-measure after the CSS transition settles.
      var id = setTimeout(function () {
        if (visRef.current) visRef.current.resize();
      }, 260);
      return function () {
        clearTimeout(id);
      };
    },
    [s.rightCollapsed]
  );

  // Desktop/mobile click on the mic button TOGGLES capture (first click
  // starts + streams until a second click stops it). The previous
  // pointerdown/pointerup wiring started capture on press and stopped it on
  // release — a normal desktop click (press+release ~50ms) started, then
  // immediately stopped, streaming zero audio. Space-bar hold (onKeyDown/
  // onKeyUp above) remains true push-to-talk for keyboard users; the server
  // VAD endpoints speech while toggled on, so leaving the mic open is fine.
  function onPttClick(e) {
    e.preventDefault();
    if (store.get().micActive) {
      pttRef.current.stop();
    } else {
      pttRef.current.start();
    }
  }

  function submitText(text) {
    if (wsRef.current) wsRef.current.send({ t: "turn.text", text: text });
    pushTimeline("turn.text", text);
  }

  function setMicMode(mode) {
    store.set({ micMode: mode });
    if (wsRef.current) wsRef.current.send({ t: "mode.set", mode: mode });
  }

  var transcriptText = s.sttFinal;
  var partialText = s.sttPartial;

  return h(
    "div",
    { className: "jv-root", id: "jarvis-voice-root" },
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
            onClick: function () {
              store.set({ settingsOpen: !s.settingsOpen });
            },
          },
          "⚙"
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
            onClick: onPttClick,
            "aria-label": s.micActive ? "Stop microphone" : "Start microphone",
            "aria-pressed": s.micActive,
          }, "●"),
          h("div", { className: "jv-ptt-label" }, s.micActive ? "Listening… (tap to stop)" : humanState(s.fsmState)),
          h(
            "div",
            { className: "jv-mic-level-track" },
            h("div", { className: "jv-mic-level-fill", ref: micLevelBarRef })
          ),
          h("div", { className: "jv-ptt-hint" }, "Click: toggle mic · Space: hold to talk"),
          h(
            "button",
            {
              className: "jv-mode-toggle" + (s.micMode === "vad" ? " jv-mode-toggle--active" : ""),
              onClick: function () {
                setMicMode(s.micMode === "ptt" ? "vad" : "ptt");
              },
              title: "Continuous listening mode (experimental)",
            },
            s.micMode === "vad" ? "VAD mode: on (experimental)" : "VAD mode: off"
          ),
          s.micError || s.micHint
            ? h(
                "div",
                { className: "jv-mic-banner" + (s.micError ? " jv-mic-banner--error" : " jv-mic-banner--hint") },
                h("span", null, s.micError || s.micHint),
                h(
                  "button",
                  {
                    className: "jv-mic-banner-close",
                    onClick: function () {
                      store.set({ micError: null, micHint: null });
                    },
                    "aria-label": "Dismiss",
                  },
                  "×"
                )
              )
            : null
        ),
        h(
          "div",
          { className: "jv-stage-text" },
          h(
            "div",
            { className: "jv-transcript" },
            partialText ? h("span", { className: "jv-transcript-partial" }, partialText) : null,
            !partialText && transcriptText ? h("span", { className: "jv-transcript-final" }, transcriptText) : null
          ),
          h("div", { className: "jv-mediator-text" }, s.mediatorText)
        )
      ),
      h(RightColumn, { store: store })
    ),
    h(TextInputBar, { onSubmit: submitText }),
    h(SettingsPopover, {
      open: s.settingsOpen,
      settings: s,
      onClose: function () {
        store.set({ settingsOpen: false });
      },
      onMicModeChange: setMicMode,
      onReducedMotionChange: function (v) {
        store.set({ reducedMotion: v });
      },
      onVolumeChange: function (v) {
        store.set({ volume: v });
      },
    }),
    h(OfflineOverlay, {
      visible: s.offline,
      onRetry: function () {
        if (wsRef.current) wsRef.current.forceReconnect();
      },
    })
  );
}
