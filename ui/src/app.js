// app.js — top-level component for the Jarvis Command Centre. Wires store +
// ws + audio-in/out + the 2D intelligence core together and renders the
// "anchored core, flanked context" layout: SystemBar . MemoryColumn (>=1280)
// . Stage . WorkColumn, with the single-column MobileShell + bottom sheets
// below 860px (root width, not viewport — measured via ResizeObserver).
//
// The transport/audio layer (ws.js, audio-in.js, audio-out.js, worklets/*)
// is untouched: mic toggle + Space push-to-talk + barge_in semantics, WS
// framing, reconnect, and POST task-control paths all behave exactly as
// before. Chrome (system bar, offline notice, tabs, task cards, notices,
// backend selector, gauges) now comes from window.HermesUI; see
// components/*.js.
import { UI } from "./hui.js";
import { fetchJSON } from "./sdk.js";
import { createStore, useStore, pushCapped, createLatencyTracker } from "./store.js";
import { createJarvisSocket } from "./ws.js";
import { createMicInput } from "./audio-in.js";
import { createAudioOutput } from "./audio-out.js";
import { createVisualizer } from "./visualizer/index.js";
import { Stage, derivedState, FullscreenButton } from "./components/stage.js";
import { MemoryColumn } from "./components/memory.js";
import { WorkColumn } from "./components/work.js";
import { MobileShell } from "./components/mobile.js";
import { BackendSelector, BACKEND_META } from "./components/backend.js";
import { isTerminalStatus, countOpenTasks } from "./components/util.js";
import { TASKS_URL, BACKENDS_URL, CREDITS_URL, tasksFromResponse, mergeTaskUpdate, useCredits } from "./api.js";

var html = UI.html;

var TIMELINE_MAX = 200;
var TURNS_MAX = 40;
var HEALTH_POLL_MS = 15000;
var MOBILE_BREAK = 860;
var LEFT_COL_BREAK = 1280;

// Monotonic token for selectBackend's optimistic POST lives in api.js now
// (useSelectBackend); nothing left to sequence here.

// Notices (components/notices.js) capped like the other rolling lists.
var NOTICES_MAX = 20;
// Persisted client-side notice dismissals — {noticeId: dismissedAtMs}. Ids
// are deterministic ("task:<id>:<status>"), so the same terminal state stays
// hidden across reloads while a NEW status mints a new id and reappears.
var DISMISSED_NOTICES_KEY = "jarvis-voice:dismissedNotices";
var DISMISSED_NOTICES_CAP = 100;

// task terminal status -> notice tone/title (notices derive from task.update
// terminal events + error events + tasks needing review). Only ACTIONABLE
// states become standing notice rows: needs_review (approval) and failed
// (error). Plain done/canceled are already visible as task cards.
var TASK_NOTICE = {
  failed: { tone: "error", title: "Task failed" },
  needs_review: { tone: "attention", title: "Needs review" },
};
function noticeForTask(task) {
  var def = TASK_NOTICE[task.status];
  if (!def) return null;
  return {
    id: "task:" + task.id + ":" + task.status,
    tone: def.tone,
    title: def.title + " · " + (task.title || task.goal || task.id),
    body:
      task.result_summary ||
      task.progress_note ||
      (task.status === "needs_review" ? "Waiting for your review — approve to re-delegate, or decline." : ""),
    ts: Date.now(),
    taskId: task.id,
    // needs_review rows are approval rows: Approve re-delegates, Decline hides
    approve: task.status === "needs_review",
  };
}

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
// Used for dismissedTasks: {taskId: statusAtDismissTime} — a plain array
// couldn't carry the "what status was it when the user hid it" bit that lets
// a genuinely new task.update status un-dismiss a card.
var DISMISSED_TASKS_KEY = "jarvis-voice:dismissedTasks";
function loadLocalJSON(key, fallback) {
  try {
    var v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    var parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveLocalJSON(key, v) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    /* localStorage unavailable (private mode etc) — setting just won't persist */
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  var tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function humanState(s) {
  return String(s)
    .replace(/_/g, " ")
    .replace(/^./, function (c) {
      return c.toUpperCase();
    });
}

function detailString(obj) {
  if (obj == null) return "";
  if (typeof obj === "string") return obj;
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

// mirrors ws.js's capped exponential backoff (1s->2s->4s->8s->10s) for the
// offline sheet's retry countdown — ws.js itself is deliberately untouched.
function backoffForAttempt(attempt) {
  return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 10000);
}

// Fullscreen targets the plugin root itself (not <html>/<body>) so it keeps
// its own background while fullscreen. webkit* fallback covers Safari, which
// still lacks the unprefixed Fullscreen API.
function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function supportsElementFullscreen(el) {
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}

// Some mobile browsers (iOS Safari pre-16.4, and various in-app webviews)
// never exposed requestFullscreen()/webkitRequestFullscreen() on ordinary
// elements at all, so the button used to silently no-op there. Feature-
// detect and, when the real API is missing (or a call to it gets rejected),
// fall back to a CSS-free "pseudo-fullscreen" (inline style on the root, see
// App()'s pseudoFullscreenStyle) that pins the root to the viewport at max
// z-index, so the button always visibly does something.
function toggleFullscreen(store) {
  var st = store && store.get();
  if (isFullscreenActive()) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    return;
  }
  if (st && st.pseudoFullscreen) {
    store.set({ pseudoFullscreen: false });
    return;
  }
  var root = document.getElementById("jarvis-voice-root");
  if (!root) return;
  if (supportsElementFullscreen(root)) {
    var req = root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen();
    if (req && typeof req.catch === "function") {
      req.catch(function () {
        console.info("[jarvis-voice] requestFullscreen() was rejected — falling back to pseudo-fullscreen.");
        if (store) store.set({ pseudoFullscreen: true });
      });
    }
    return;
  }
  console.info("[jarvis-voice] Fullscreen API unavailable on this browser (likely iOS Safari) — using pseudo-fullscreen instead.");
  if (store) store.set({ pseudoFullscreen: true });
}

var PSEUDO_FS_STYLE = { position: "fixed", inset: 0, top: 0, left: 0, margin: 0, width: "100vw", height: "100dvh", zIndex: 2147483647 };
var ROOT_BG = "radial-gradient(120% 90% at 50% 0%, var(--hui-surface-2) 0%, var(--hui-bg) 55%, var(--hui-bg) 100%)";

// ---------------------------------------------------------------------------

export function App() {
  var storeRef = UI.useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStore({
      // transport / turn state
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
      // no stored preference -> follow the OS-level reduced-motion setting
      reducedMotion: loadLocalBool(
        "jarvis-voice:reducedMotion",
        !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      ),
      volume: loadLocalFloat("jarvis-voice:volume", 1),
      timeline: [],
      // client-only Work-tab "Dismiss" — {taskId: statusAtDismissTime}; the
      // tasks themselves live in api.js's useTasks() (UI.useEndpoint cache).
      dismissedTasks: loadLocalJSON(DISMISSED_TASKS_KEY, {}),
      memoryHits: [],
      health: null,
      latency: {},
      micError: null,
      micHint: null,
      // notification rows (components/notices.js) + persisted dismissals
      notices: [],
      dismissedNotices: loadLocalJSON(DISMISSED_NOTICES_KEY, {}),
      tab: "work", // 'work' | 'activity' | 'system' | 'memory'
      sheet: null, // mobile bottom sheet: null | 'tasks' | 'memory' | 'activity' | 'backend'
      verbose: false,
      // supporting state
      w: typeof window !== "undefined" ? window.innerWidth : 1440,
      turns: [],
      speakingText: "",
      toolChip: null,
      turnId: null,
      turnLatency: {},
      memQuery: "",
      bargeIns: 0,
      errCount: 0,
      retryAttempt: 0,
      retryAt: 0,
      lastEventTs: 0,
      offlineDismissed: false,
      fullscreen: typeof document !== "undefined" && !!(document.fullscreenElement || document.webkitFullscreenElement),
      pseudoFullscreen: false,
      noSpeechHint: null,
    });
  }
  var store = storeRef.current;
  var s = useStore(store);

  var refsRef = UI.useRef(null);
  if (!refsRef.current) {
    refsRef.current = {
      canvasRef: { current: null },
      logRef: { current: null },
      levelRef: { current: null },
      micRingRef: { current: null },
      micRingMobileRef: { current: null },
      composerInputRef: { current: null },
    };
  }
  var refs = refsRef.current;

  var visRef = UI.useRef(null);
  var wsRef = UI.useRef(null);
  var audioOutRef = UI.useRef(null);
  var latencyRef = UI.useRef(null);
  if (!latencyRef.current) latencyRef.current = createLatencyTracker(20);
  var pttRef = UI.useRef({ start: function () {}, stop: function () {} });
  var turnMetaRef = UI.useRef([]);
  var lastUserTextRef = UI.useRef("");
  var memSeqRef = UI.useRef(0);
  // written on EVERY ws event (incl. tts.amp at ~30Hz) — kept out of the
  // store so it can't re-render the tree; copied in when going offline.
  var lastEventTsRef = UI.useRef(0);
  var noSpeechTimerRef = UI.useRef(null);

  function pushTimeline(type, label, detail, tone) {
    store.set(function (st) {
      return {
        timeline: pushCapped(
          st.timeline,
          { id: type + ":" + Date.now() + ":" + Math.random(), ts: Date.now(), type: type, label: label, detail: detailString(detail), tone: tone || "neutral" },
          TIMELINE_MAX
        ),
      };
    });
  }

  // opts: { dim, tone } — dim renders the turn faint (stt.ignored echoes),
  // tone "red" flags a system row as an error (turn failed / timed out).
  function pushTurn(role, text, meta, opts) {
    store.set(function (st) {
      return {
        turns: pushCapped(
          st.turns,
          { id: role + ":" + Date.now() + ":" + Math.random(), role: role, text: text, time: UI.format.clockTime(Date.now()), meta: meta || [], dim: !!(opts && opts.dim), tone: (opts && opts.tone) || null },
          TURNS_MAX
        ),
      };
    });
  }

  // Add/refresh a notification row (deduped by id; skipped when the user has
  // already dismissed that exact id).
  function pushNotice(notice) {
    if (!notice) return;
    store.set(function (st) {
      if (st.dismissedNotices && Object.prototype.hasOwnProperty.call(st.dismissedNotices, notice.id)) return {};
      var rest = (st.notices || []).filter(function (n) {
        return n.id !== notice.id;
      });
      return { notices: [notice].concat(rest).slice(0, NOTICES_MAX) };
    });
  }

  function dismissNotice(id) {
    store.set(function (st) {
      var dismissed = Object.assign({}, st.dismissedNotices);
      dismissed[id] = Date.now();
      var ids = Object.keys(dismissed);
      if (ids.length > DISMISSED_NOTICES_CAP) {
        ids
          .sort(function (a, b) {
            return dismissed[a] - dismissed[b];
          })
          .slice(0, ids.length - DISMISSED_NOTICES_CAP)
          .forEach(function (k) {
            delete dismissed[k];
          });
      }
      saveLocalJSON(DISMISSED_NOTICES_KEY, dismissed);
      return { dismissedNotices: dismissed, notices: (st.notices || []).filter(function (n) { return n.id !== id; }) };
    });
  }

  // move the streamed mediator reply into the conversation log once the turn
  // resolves (done / idle / interrupted)
  function commitReply(reason) {
    var st = store.get();
    var text = (st.mediatorText || "").trim();
    if (!text) return;
    var meta = turnMetaRef.current.slice();
    if (reason === "interrupted") meta.push("interrupted");
    var e2e = st.turnLatency && st.turnLatency.e2e_first_audio;
    if (typeof e2e === "number") meta.push("e2e " + (e2e / 1000).toFixed(2) + " s");
    pushTurn("jarvis", text, meta);
    turnMetaRef.current = [];
    store.set({ mediatorText: "", speakingText: "" });
  }

  function beginTurn() {
    turnMetaRef.current = [];
    store.set({ turnLatency: {} });
  }

  function recordLatency(stage, ms) {
    if (typeof ms !== "number") return;
    latencyRef.current.record(stage, ms);
    store.set(function (st) {
      var tl = Object.assign({}, st.turnLatency);
      tl[stage] = ms;
      return { latency: latencyRef.current.summary(), turnLatency: tl };
    });
  }

  // memory.hits arrives with {path,title,score} only — re-query the search
  // endpoint to enrich the cards with snippet/confidence/updated/conflict.
  // Event scores win; stale responses are dropped.
  function enrichMemoryHits(items) {
    if (!items.length) return;
    var seq = ++memSeqRef.current;
    var q = lastUserTextRef.current || items[0].title || items[0].path || "";
    if (!q) return;
    fetchJSON("/memory/search?q=" + encodeURIComponent(q) + "&k=" + Math.max(items.length, 3))
      .then(function (data) {
        if (seq !== memSeqRef.current) return;
        var byPath = {};
        ((data && data.hits) || []).forEach(function (hit) {
          if (hit && hit.path) byPath[hit.path] = hit;
        });
        var merged = items.map(function (it) {
          return Object.assign({}, byPath[it.path] || {}, it);
        });
        store.set({ memoryHits: merged });
      })
      .catch(function () {
        /* basic hits already shown; enrichment is best-effort */
      });
  }

  // "didn't catch that" — subtle, self-clearing composer hint. Re-triggering
  // restarts the 3s window rather than stacking timers.
  function showNoSpeechHint() {
    clearTimeout(noSpeechTimerRef.current);
    store.set({ noSpeechHint: "Didn't catch that." });
    noSpeechTimerRef.current = setTimeout(function () {
      store.set({ noSpeechHint: null });
    }, 3000);
  }

  function resync(announce) {
    UI.fetchJSON(TASKS_URL)
      .then(function (data) {
        UI.mutate(TASKS_URL, data);
        var map = tasksFromResponse(data);
        Object.values(map).forEach(function (t) {
          if (t.status === "needs_review") pushNotice(noticeForTask(t));
        });
        if (announce) {
          var open = countOpenTasks(map);
          pushTurn("system", "Session resumed · " + open + " open task" + (open === 1 ? "" : "s") + " replayed from jarvis.db");
        }
      })
      .catch(function () {
        /* offline sheet already reflects connectivity problems */
      });
    fetchJSON("/health")
      .then(function (data) {
        store.set({ health: data });
      })
      .catch(function () {
        /* noop */
      });
    UI.invalidate(BACKENDS_URL);
    UI.invalidate(CREDITS_URL);
  }

  // ---- mount once: ws, audio, mic, keyboard, timers -----------------------
  UI.useEffect(function () {
    var audioOut = createAudioOutput();
    audioOut.setGain(store.get().volume);
    audioOutRef.current = audioOut;

    // Client-side "is the mic actually producing signal" bookkeeping. Plain
    // closure vars — high-frequency signals never touch the store.
    var lastMicRms = 0;
    var micHeardActivity = false;
    var silenceCheckTimer = null;
    var ringLevel = 0;

    var mic = createMicInput({
      onChunk: function (buf) {
        var socket = wsRef.current;
        if (socket) socket.sendBinary(buf);
      },
      onLevel: function (rms) {
        var on = store.get().micActive;
        var v = on ? rms : 0;
        lastMicRms = rms;
        if (visRef.current) visRef.current.onMicLevel(v);
        ringLevel += (Math.min(1, v) - ringLevel) * 0.35;
        if (refs.levelRef.current) refs.levelRef.current.style.width = Math.round(Math.min(1, v) * 100) + "%";
        [refs.micRingRef.current, refs.micRingMobileRef.current].forEach(function (ring) {
          if (!ring) return;
          ring.style.opacity = on ? String(0.25 + ringLevel * 0.7) : "0";
          ring.style.transform = "scale(" + (on ? 1 + ringLevel * 0.16 : 0.9) + ")";
        });
      },
      onError: function (message) {
        store.set({ micError: message });
        pushTimeline("error", message, null, "danger");
      },
    });

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
      lastEventTsRef.current = Date.now();
      if (msg.turn_id != null && msg.turn_id !== store.get().turnId && msg.t !== "tts.amp") {
        store.set({ turnId: msg.turn_id });
      }
      switch (msg.t) {
        case "state":
          store.set({ fsmState: msg.value, fsmDetail: msg.detail || null });
          pushTimeline(
            "state",
            humanState(msg.value) + (msg.detail ? " — " + msg.detail : ""),
            null,
            msg.value === "error" ? "danger" : msg.value === "blocked" ? "warn" : "neutral"
          );
          if (msg.value === "listening") beginTurn();
          if (msg.value === "done" || msg.value === "idle") commitReply(msg.value);
          if (msg.value === "interrupted") commitReply("interrupted");
          if (msg.detail === "turn timed out") {
            pushTurn("system", "Turn failed: timed out waiting for a reply.", [], { tone: "red" });
            turnMetaRef.current = [];
            store.set({ mediatorText: "", speakingText: "" });
          } else if (msg.detail === "no speech recognized") {
            showNoSpeechHint();
          }
          if (msg.value !== "idle" && msg.value !== "listening") micHeardActivity = true;
          break;
        case "stt.partial":
          store.set({ sttPartial: msg.text || "" });
          micHeardActivity = true;
          if (store.get().micHint) store.set({ micHint: null });
          break;
        case "stt.final":
          store.set({ sttPartial: "", sttFinal: msg.text || "" });
          lastUserTextRef.current = msg.text || "";
          if (msg.text) pushTurn("user", msg.text);
          pushTimeline("stt.final", "Transcribed: “" + (msg.text || "") + "”", typeof msg.ms === "number" ? "stt.final ms: " + msg.ms : null, "neutral");
          recordLatency("stt", msg.ms);
          micHeardActivity = true;
          if (store.get().micHint) store.set({ micHint: null });
          break;
        case "stt.ignored":
          if (msg.text) {
            pushTurn("user", msg.text, ["ignored — " + (msg.reason || "echo")], { dim: true });
          }
          pushTimeline("stt.ignored", "Ignored: “" + (msg.text || "") + "” (" + (msg.reason || "echo") + ")", detailString(msg), "warn");
          micHeardActivity = true;
          break;
        case "mediator.delta":
          store.set(function (st) {
            return { mediatorText: st.mediatorText + (msg.text || "") };
          });
          break;
        case "mediator.done":
          store.set({ mediatorText: msg.text || "" });
          pushTimeline(
            "mediator.done",
            "Mediator replied · " + (msg.text || "").split(/\s+/).length + " words",
            detailString({ ms_first_token: msg.ms_first_token, ms_total: msg.ms_total }),
            "neutral"
          );
          recordLatency("mediator_first_token", msg.ms_first_token);
          break;
        case "meta_tool":
          if (msg.phase === "start") {
            store.set({ toolChip: { name: msg.name, start: Date.now() } });
          } else {
            store.set({ toolChip: null });
            turnMetaRef.current.push(msg.name + (typeof msg.ms === "number" ? " · " + msg.ms + " ms" : ""));
          }
          pushTimeline(
            "meta_tool",
            msg.name + (msg.phase === "end" ? (msg.result_summary ? " → " + msg.result_summary : " finished") : " started"),
            detailString({ args: msg.args, ms: msg.ms }),
            "accent"
          );
          break;
        case "tts.start":
          if (!store.get().ttsPlaying) {
            pushTimeline("tts.start", "TTS started · kokoro-onnx", null, "neutral");
          }
          store.set({ ttsPlaying: true, speakingText: msg.text || "" });
          break;
        case "tts.chunk_hdr":
          // binary framing handled in ws.js; nothing to render per-chunk.
          break;
        case "tts.amp":
          if (visRef.current) visRef.current.onAmp(typeof msg.v === "number" ? msg.v : 0);
          break;
        case "tts.end":
          store.set({ ttsPlaying: false, speakingText: "" });
          recordLatency("tts_first_chunk", msg.ms_first_chunk);
          break;
        case "task.update": {
          var merged = mergeTaskUpdate(msg);
          store.set(function (st) {
            var dismissedTasks = st.dismissedTasks;
            if (msg.status && dismissedTasks && Object.prototype.hasOwnProperty.call(dismissedTasks, msg.id) && dismissedTasks[msg.id] !== msg.status) {
              dismissedTasks = Object.assign({}, dismissedTasks);
              delete dismissedTasks[msg.id];
              saveLocalJSON(DISMISSED_TASKS_KEY, dismissedTasks);
            }
            return { dismissedTasks: dismissedTasks };
          });
          pushTimeline(
            "task.update",
            (msg.title || msg.id) + " → " + msg.status,
            detailString({ progress_note: msg.progress_note, result_summary: msg.result_summary }),
            msg.status === "failed" ? "danger" : msg.status === "needs_review" ? "warn" : "accent"
          );
          if (isTerminalStatus(msg.status)) pushNotice(noticeForTask(merged));
          break;
        }
        case "memory.hits": {
          var items = msg.items || [];
          store.set({ memoryHits: items });
          if (visRef.current) visRef.current.onMemoryHits(items);
          turnMetaRef.current.push("memory_recall · " + items.length + " hit" + (items.length === 1 ? "" : "s"));
          pushTimeline("memory.hits", "memory_recall → " + items.length + " hits", detailString(items), "accent");
          enrichMemoryHits(items);
          break;
        }
        case "latency":
          recordLatency(msg.stage, msg.ms);
          break;
        case "health":
          store.set({ health: msg });
          pushTimeline("health", "Health changed", detailString(msg.components), "warn");
          break;
        case "error":
          store.set(function (st) {
            return { errCount: st.errCount + 1 };
          });
          pushTimeline("error", msg.message || "error", detailString(msg), "danger");
          pushTurn("system", msg.message || "Turn failed — no reply.", [], { tone: "red" });
          turnMetaRef.current = [];
          store.set({ mediatorText: "", speakingText: "" });
          pushNotice({ id: "error:" + Date.now(), tone: "error", title: "Pipeline error", body: msg.message || "Turn failed — see the activity stream.", ts: Date.now(), approve: false });
          break;
        case "pong":
          break;
        default:
          pushTimeline(msg.t, msg.t, null, "neutral");
      }
    }

    var reconnectEvents = 0;
    var socket = createJarvisSocket({
      onEvent: onEvent,
      onBinary: function (buf) {
        audioOut.queueChunk(buf);
      },
      onStatus: function (status) {
        store.set({ connection: status });
        if (status === "open") {
          clearTimeout(offlineGraceTimer);
          reconnectEvents = 0;
          store.set({ offline: false, offlineDismissed: false, retryAttempt: 0, retryAt: 0 });
          resync(true);
        } else if (status === "reconnecting") {
          // ws.js emits "reconnecting" twice per retry cycle (on schedule +
          // on the attempt itself) — every 2nd event is one real attempt.
          reconnectEvents++;
          var attempt = Math.ceil(reconnectEvents / 2);
          store.set({
            offline: true,
            retryAttempt: attempt,
            retryAt: reconnectEvents % 2 === 1 ? Date.now() + backoffForAttempt(attempt) : store.get().retryAt,
            lastEventTs: lastEventTsRef.current,
          });
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
        store.set(function (st) {
          return { bargeIns: st.bargeIns + 1 };
        });
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
    pttRef.current.start = startPtt;
    pttRef.current.stop = stopPtt;

    function interrupt() {
      audioOut.hardStop();
      socket.send({ t: "barge_in" });
      store.set(function (st) {
        return { bargeIns: st.bargeIns + 1 };
      });
    }
    pttRef.current.interrupt = interrupt;

    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
        e.preventDefault();
        if (refs.composerInputRef.current) refs.composerInputRef.current.focus();
        return;
      }
      var typing = isTypingTarget(document.activeElement);
      if (e.code === "Space") {
        if (!document.hasFocus() || typing || e.repeat) return;
        e.preventDefault();
        startPtt();
        return;
      }
      if (e.key === "Escape") {
        interrupt();
        return;
      }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && String(e.key).toLowerCase() === "f") {
        e.preventDefault();
        toggleFullscreen(store);
        return;
      }
      if (!typing && ["1", "2", "3"].indexOf(e.key) >= 0) {
        store.set({ tab: ["work", "activity", "system"][+e.key - 1] });
      }
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

    return function cleanup() {
      clearTimeout(offlineGraceTimer);
      clearInterval(healthTimer);
      clearTimeout(silenceCheckTimer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      socket.close();
      mic.teardown();
      if (visRef.current) {
        visRef.current.destroy();
        visRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, []);

  // ---- fullscreen: sync store.fullscreen to the real DOM state -----------
  UI.useEffect(function () {
    function onFsChange() {
      store.set({ fullscreen: isFullscreenActive() });
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return function () {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // pseudo-fullscreen host-header clearance: scans for a top-anchored fixed/
  // sticky <header> OUTSIDE our root and publishes its bottom edge as
  // --jv-fs-top-clear, so our own header (incl. the fullscreen toggle) never
  // sits under host chrome while pseudo-fullscreen is pinned to the viewport.
  UI.useEffect(
    function () {
      var root = document.getElementById("jarvis-voice-root");
      if (!root) return;
      if (!s.pseudoFullscreen) {
        root.style.setProperty("--jv-fs-top-clear", "0px");
        return;
      }
      function measure() {
        var maxBottom = 0;
        document.querySelectorAll("header").forEach(function (el) {
          if (root.contains(el)) return;
          var cs = window.getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") return;
          var rect = el.getBoundingClientRect();
          if (rect.top > 4) return;
          if (rect.bottom > maxBottom) maxBottom = rect.bottom;
        });
        root.style.setProperty("--jv-fs-top-clear", (maxBottom > 0 ? maxBottom : 0) + "px");
      }
      measure();
      window.addEventListener("resize", measure);
      return function () {
        window.removeEventListener("resize", measure);
      };
    },
    [s.pseudoFullscreen]
  );

  // ---- root width (drives the 1280/860 layout modes) -----------------------
  UI.useEffect(function () {
    var root = document.getElementById("jarvis-voice-root");
    if (!root) return;
    function measure() {
      var w = root.clientWidth || window.innerWidth;
      if (Math.abs(w - store.get().w) > 4) store.set({ w: w });
    }
    measure();
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(root);
    window.addEventListener("resize", measure);
    return function () {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // ---- host integration: height pinning + padding neutraliser -------------
  UI.useEffect(function () {
    var root = document.getElementById("jarvis-voice-root");
    if (!root) return;
    var syncing = false;
    function sync() {
      if (syncing) return;
      syncing = true;
      var top = root.getBoundingClientRect().top;
      var h = Math.max(320, window.innerHeight - top);
      root.style.height = h + "px";
      var overflow = document.documentElement.scrollHeight - window.innerHeight;
      if (overflow > 1) root.style.height = Math.max(320, h - overflow) + "px";
      syncing = false;
    }
    sync();
    window.addEventListener("resize", sync);
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    if (ro) ro.observe(document.body);
    var t = setTimeout(sync, 500); // banner/theme settle
    var t2 = setTimeout(sync, 1500); // late host chrome (profile banner) settle

    // The host mounts this plugin inside a wrapper div that carries its own
    // padding we can't edit — zero it out only on the element that directly
    // contains our root, and restore its exact prior inline style on
    // unmount so a differently-styled plugin reusing this wrapper is never
    // left with our zeroed padding.
    var wrapper = root.parentElement;
    var prevWrapperStyle = wrapper ? wrapper.getAttribute("style") : null;
    if (wrapper) wrapper.style.padding = "0";

    return function () {
      window.removeEventListener("resize", sync);
      if (ro) ro.disconnect();
      clearTimeout(t);
      clearTimeout(t2);
      if (wrapper) {
        if (prevWrapperStyle == null) wrapper.removeAttribute("style");
        else wrapper.setAttribute("style", prevWrapperStyle);
      }
    };
  }, []);

  // ---- visualizer: (re)bind to whichever shell's canvas is mounted ---------
  var isMobile = s.w < MOBILE_BREAK;
  UI.useEffect(
    function () {
      var canvas = refs.canvasRef.current;
      if (!canvas) return;
      var vis = createVisualizer(canvas);
      visRef.current = vis;
      if (audioOutRef.current) vis.setAudioSource(audioOutRef.current.getLevels);
      vis.setReducedMotion(store.get().reducedMotion);
      vis.setState(derivedState(store.get()));
      vis.onMemoryHits(store.get().memoryHits);
      return function () {
        vis.destroy();
        if (visRef.current === vis) visRef.current = null;
      };
    },
    [isMobile]
  );

  // core follows the server FSM (plus client-derived offline) 1:1
  UI.useEffect(
    function () {
      if (visRef.current) visRef.current.setState(derivedState(s));
    },
    [s.fsmState, s.connection]
  );

  UI.useEffect(
    function () {
      if (visRef.current) visRef.current.setReducedMotion(s.reducedMotion);
      saveLocalBool("jarvis-voice:reducedMotion", s.reducedMotion);
      UI.motion.set(s.reducedMotion ? "off" : "system");
    },
    [s.reducedMotion]
  );
  UI.useEffect(
    function () {
      if (audioOutRef.current) audioOutRef.current.setGain(s.volume);
    },
    [s.volume]
  );

  // ---- actions passed down --------------------------------------------------
  var actRef = UI.useRef(null);
  if (!actRef.current) {
    actRef.current = {
      onMicClick: function (e) {
        // Click = toggle capture (press+release must NOT stop it); Space
        // hold stays true push-to-talk.
        if (e) e.preventDefault();
        if (store.get().micActive) pttRef.current.stop();
        else pttRef.current.start();
      },
      interrupt: function () {
        pttRef.current.interrupt();
      },
      submitText: function (text) {
        lastUserTextRef.current = text;
        beginTurn();
        pushTurn("user", text);
        if (wsRef.current) wsRef.current.send({ t: "turn.text", text: text });
        pushTimeline("turn.text", "Typed turn: " + text, null, "neutral");
      },
      setMicMode: function (mode) {
        store.set({ micMode: mode });
        if (wsRef.current) wsRef.current.send({ t: "mode.set", mode: mode });
      },
      // Client-side-only "Dismiss" for needs_review/done/failed cards.
      dismissTask: function (id) {
        store.set(function (st) {
          var dismissedTasks = Object.assign({}, st.dismissedTasks);
          dismissedTasks[id] = true;
          saveLocalJSON(DISMISSED_TASKS_KEY, dismissedTasks);
          return { dismissedTasks: dismissedTasks };
        });
      },
      dismissNotice: dismissNotice,
      // Approve on a needs_review approval row is handled by the caller
      // (which owns the taskControl re-delegate POST); this just does the
      // dismissal bookkeeping once that resolves (or immediately for Decline).
      resolveNotice: function (id) {
        dismissNotice(id);
      },
      getSeries: function (stage) {
        return latencyRef.current.series(stage);
      },
      toggleReduced: function () {
        store.set(function (st) {
          return { reducedMotion: !st.reducedMotion };
        });
      },
      toggleFullscreen: function () {
        toggleFullscreen(store);
      },
      // Shared activity-timeline logger for leaf components that own their
      // own HTTP actions now (backend selector, credits refresh).
      log: pushTimeline,
    };
  }
  var act = actRef.current;

  // ---- render ----------------------------------------------------------------
  var showLeft = s.w >= LEFT_COL_BREAK;
  var rootStyle = Object.assign({ background: ROOT_BG }, s.pseudoFullscreen ? PSEUDO_FS_STYLE : null);

  return html`
    <${UI.Root} id="jarvis-voice-root" fill style=${rootStyle}>
      ${isMobile
        ? html`<${MobileShell} store=${store} act=${act} refs=${refs} />`
        : html`
          <div style=${{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", paddingTop: "var(--jv-fs-top-clear, 0px)" }}>
            <${SystemBar} s=${s} act=${act} />
            <div style=${{ flex: "1 1 0%", minHeight: 0, display: "grid", gridTemplateColumns: showLeft ? "304px minmax(0,1fr) 372px" : "minmax(0,1fr) 344px" }}>
              ${showLeft ? html`<${MemoryColumn} store=${store} />` : null}
              <${Stage} store=${store} act=${act} refs=${refs} />
              <${WorkColumn} store=${store} act=${act} showLeft=${showLeft} />
            </div>
          </div>`}
      <${OfflineSheet} s=${s} store=${store} onRetry=${function () { if (wsRef.current) wsRef.current.forceReconnect(); }} />
    <//>`;
}

// ---------------------------------------------------------------------------

function SystemBar(props) {
  var s = props.s;
  var act = props.act;
  var creditsEp = useCredits();
  var credits = creditsEp.data || {};
  var models = (s.health && s.health.models) || {};
  var connState = s.connection === "open" ? "connected" : s.connection === "connecting" ? "connecting" : s.connection === "reconnecting" ? "reconnecting" : "disconnected";

  return html`
    <${UI.Row} align="center" gap="lg" style=${{ flex: "none", height: 52, padding: "0 18px", borderBottom: "1px solid var(--hui-line)", background: "var(--hui-surface)" }} wrap=${false}>
      <${UI.Row} align="center" gap="sm" wrap=${false}>
        <span className="hui-dot hui-dot--accent hui-dot--pulse" aria-hidden="true" />
        <span className="hui-t-title">JARVIS</span>
      <//>
      <${UI.Badge} icon="lock" size="sm">LOCAL ONLY<//>
      <${UI.Divider} orientation="vertical" />
      <${UI.Row} align="center" gap="lg" wrap=${false} style=${{ minWidth: 0, overflow: "hidden" }}>
        ${s.w >= 1280 ? html`<${UI.Stat} size="sm" variant="plain" label="Mediator" style=${{ minWidth: 64, flex: "none" }} value=${(models.mediator && models.mediator.name) || "—"} />` : null}
        ${s.w >= 1280 ? html`<${UI.Stat} size="sm" variant="plain" label="Worker" style=${{ minWidth: 64, flex: "none" }} value=${(models.worker && models.worker.name) || "—"} />` : null}
        ${s.w >= 1024
          ? html`<${UI.Stat} size="sm" variant="plain" label="E2E first audio" style=${{ minWidth: 64, flex: "none" }}
              value=${s.latency.e2e_first_audio && s.latency.e2e_first_audio.p50}
              format=${function (v) { return (v / 1000).toFixed(2) + " s"; }} />`
          : null}
        <${UI.Stat} size="sm" variant="plain" label="RAM free" style=${{ minWidth: 64, flex: "none" }} value=${s.health && s.health.ram && s.health.ram.free_gb}
          format=${function (v) { return v.toFixed(1) + " GB"; }} />
      <//>
      <div style=${{ flex: 1 }} />
      ${s.w >= 1180 && credits.backends
        ? html`
          <${UI.Row} gap="sm" wrap=${false}>
            ${Object.keys(BACKEND_META)
              .filter(function (id) { var cr = credits.backends[id]; return cr && cr.tier !== "free"; })
              .map(function (id) {
                var cr = credits.backends[id];
                var g = (cr.gauges || [])[0];
                var pct = g && typeof g.remaining_pct === "number" ? g.remaining_pct * 100 : 0;
                return html`<div key=${id} style=${{ width: 108, flex: "none" }}>
                  <${UI.Meter} size="sm" label=${BACKEND_META[id].name} value=${pct} max=${100} valueText=${Math.round(pct) + "%"} />
                </div>`;
              })}
          <//>`
        : null}
      <${BackendSelector} act=${act} />
      <${UI.ConnectionPill} state=${connState} attempt=${s.retryAttempt} />
      <${FullscreenButton} active=${s.fullscreen || s.pseudoFullscreen} pseudo=${s.pseudoFullscreen} onClick=${act.toggleFullscreen} />
      <${UI.Switch} checked=${!s.reducedMotion} onChange=${function () { act.toggleReduced(); }} label="Motion" />
    <//>`;
}

// Offline: a non-blocking floating notice (voice capture is paused but the
// rest of the UI stays usable).
function OfflineSheet(props) {
  var s = props.s;
  var store = props.store;
  UI.useNow(1000); // re-render each second for the countdown / last-event-ago
  var open = !!s.offline && !s.offlineDismissed;
  return html`
    <div style=${{ position: "absolute", insetInline: 0, bottom: 0, display: "flex", justifyContent: "center", paddingBottom: 24, pointerEvents: open ? "auto" : "none", zIndex: 40 }}>
      <div style=${{ width: "min(520px,86%)" }}>
        <${UI.Banner} tone="warn" variant="inline" open=${open} title="jarvisd unreachable through the dashboard proxy"
          action=${html`
            <${UI.Row} gap="sm">
              <${UI.Button} size="sm" variant="primary" onClick=${props.onRetry}>Retry now<//>
              <${UI.Button} size="sm" variant="secondary" onClick=${function () { store.set({ offlineDismissed: true }); }}>Work offline<//>
            <//>`}>
          <${UI.Stack} gap="sm">
            <span>
              Voice capture is paused. Task state is safe in <code className="hui-code">jarvis.db</code> and replays on reconnect. Retrying with backoff${s.retryAttempt ? " — attempt " + s.retryAttempt : ""}.
              ${s.retryAttempt && s.retryAt ? html` <${UI.Countdown} to=${s.retryAt} fallback="" />` : null}
            </span>
            ${s.lastEventTs ? html`<span className="hui-t-micro">last event <${UI.RelTime} at=${s.lastEventTs} /></span>` : null}
          <//>
        <//>
      </div>
    </div>`;
}
