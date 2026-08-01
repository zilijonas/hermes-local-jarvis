// app.js — top-level component for the Jarvis Command Centre redesign.
// Wires store + ws + audio-in/out + the 2D intelligence core together and
// renders the "anchored core, flanked context" layout from the design
// prototype: SystemBar · MemoryColumn (≥1280) · Stage · WorkColumn, with the
// single-column MobileShell + bottom sheets below 860px (root width, not
// viewport — measured via ResizeObserver like the prototype).
//
// The transport/audio layer (ws.js, audio-in.js, audio-out.js, worklets/*)
// is untouched: mic toggle + Space push-to-talk + barge_in semantics, WS
// framing, reconnect, and POST task-control paths all behave exactly as
// before the redesign.
import { h } from "./h.js";
import { getHooks, fetchJSON, authedFetch } from "./sdk.js";
import { createStore, useStore, pushCapped, createLatencyTracker } from "./store.js";
import { createJarvisSocket } from "./ws.js";
import { createMicInput } from "./audio-in.js";
import { createAudioOutput } from "./audio-out.js";
import { createVisualizer } from "./visualizer/index.js";
import { Stage, derivedState, FullscreenButton } from "./components/stage.js";
import { MemoryColumn } from "./components/memory.js";
import { WorkColumn } from "./components/work.js";
import { MobileShell } from "./components/mobile.js";
import { BackendSelector, BACKEND_META, creditsPhase } from "./components/backend.js";
import { BarGauge } from "./components/gauge.js";
import { cls, fmtClock, fmtDur, countOpenTasks, isTerminalStatus } from "./components/util.js";

var TIMELINE_MAX = 200;
var TURNS_MAX = 40;
var HEALTH_POLL_MS = 15000;
var MOBILE_BREAK = 860;
var LEFT_COL_BREAK = 1280;

// Monotonic token for selectBackend's optimistic POST — only the latest
// in-flight request may write its response into the store.
var selectBackendSeq = 0;

var TIMELINE_ICON = {
  state: "◆",
  "stt.final": "▤",
  "mediator.done": "▣",
  meta_tool: "⚙",
  "tts.start": "♪",
  "tts.end": "♪",
  "task.update": "▦",
  "memory.hits": "▥",
  health: "♥",
  error: "✕",
  "turn.text": "✎",
  "stt.ignored": "⊘",
  backend: "◇",
  credits: "⟳",
};

// Notices (components/notices.js) capped like the other rolling lists.
var NOTICES_MAX = 20;
// Persisted client-side notice dismissals — {noticeId: dismissedAtMs}. Ids
// are deterministic ("task:<id>:<status>"), so the same terminal state stays
// hidden across reloads while a NEW status mints a new id and reappears.
var DISMISSED_NOTICES_KEY = "jarvis-voice:dismissedNotices";
var DISMISSED_NOTICES_CAP = 100;

// task terminal status → notice tone/title (spec §06: notices derive from
// task.update terminal events + error events + tasks needing review).
// Only ACTIONABLE states become standing notice rows: needs_review (approval)
// and failed (error). Plain done/canceled are already visible as task cards —
// mirroring them as notifications too just made the Work tab a wall of noise.
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
    ts: fmtClock(Date.now()),
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
// couldn't carry the "what status was it when the user hid it" bit that
// lets a genuinely new task.update status un-dismiss a card (see the
// task.update handler below and components/work.js's Dismiss buttons).
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

function tasksFromResponse(data) {
  var list = Array.isArray(data) ? data : data && Array.isArray(data.tasks) ? data.tasks : [];
  var map = {};
  list.forEach(function (t) {
    map[t.id] = t;
  });
  return map;
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

// mirrors ws.js's capped exponential backoff (1s→2s→4s→8s→10s) for the
// offline sheet's retry countdown — ws.js itself is deliberately untouched.
function backoffForAttempt(attempt) {
  return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 10000);
}

// Fullscreen targets the plugin root itself (not <html>/<body>) so it keeps
// its own background while fullscreen (see ui/README.md — bg lives on
// #jarvis-voice-root already). webkit* fallback covers Safari, which still
// lacks the unprefixed Fullscreen API.
function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function supportsElementFullscreen(el) {
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}

// Some mobile browsers (iOS Safari pre-16.4, and various in-app webviews)
// never exposed requestFullscreen()/webkitRequestFullscreen() on ordinary
// elements at all, so the button used to silently no-op there — tapping it
// did nothing, with no error and no feedback. Feature-detect and, when the
// real API is missing (or a call to it gets rejected — e.g. a permissions
// policy denial), fall back to a CSS-only "pseudo-fullscreen" (store flag
// -> #jarvis-voice-root.jv-pseudo-fullscreen in style.css) that pins the
// root to the viewport at max z-index, so the button always visibly does
// something. `store` is optional so this stays callable exactly like
// before wherever only the native path is relevant.
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
        console.info("[jarvis-voice] requestFullscreen() was rejected — falling back to CSS pseudo-fullscreen.");
        if (store) store.set({ pseudoFullscreen: true });
      });
    }
    return;
  }
  console.info("[jarvis-voice] Fullscreen API unavailable on this browser (likely iOS Safari) — using CSS pseudo-fullscreen instead.");
  if (store) store.set({ pseudoFullscreen: true });
}

// ---------------------------------------------------------------------------

export function App() {
  var hooks = getHooks();
  var useEffect = hooks.useEffect;
  var useRef = hooks.useRef;

  var storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStore({
      // transport / turn state (unchanged shape)
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
      // no stored preference → follow the OS-level reduced-motion setting
      reducedMotion: loadLocalBool(
        "jarvis-voice:reducedMotion",
        !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      ),
      volume: loadLocalFloat("jarvis-voice:volume", 1),
      timeline: [],
      tasks: {},
      // client-only Work-tab "Dismiss" — {taskId: statusAtDismissTime}, see
      // components/work.js and the task.update handler below.
      dismissedTasks: loadLocalJSON(DISMISSED_TASKS_KEY, {}),
      memoryHits: [],
      health: null,
      latency: {},
      micError: null,
      micHint: null,
      // worker backend + subscription credits (spec §06/§07) — read on mount
      // and manual refresh only, never polled (§08)
      worker_backend: null, // active backend id from GET/POST /backends
      backends: null, // full GET /backends payload {active, available, backends}
      credits: null, // full GET /credits payload
      creditsPhase: "idle", // 'idle' | 'refreshing' | 'ok' | 'stale' | 'error'
      // notification rows (components/notices.js) + persisted dismissals
      notices: [],
      dismissedNotices: loadLocalJSON(DISMISSED_NOTICES_KEY, {}),
      // redesign keys
      tab: "work", // 'work' | 'activity' | 'system' | 'memory'
      sheet: null, // mobile bottom sheet: null | 'tasks' | 'memory' | 'activity'
      expandedTask: null,
      verbose: false,
      // supporting state
      w: typeof window !== "undefined" ? window.innerWidth : 1440,
      turns: [],
      speakingText: "",
      toolChip: null,
      turnId: null,
      turnLatency: {},
      taskDetail: {},
      memQuery: "",
      memResults: null,
      bargeIns: 0,
      errCount: 0,
      tick: 0,
      retryAttempt: 0,
      retryAt: 0,
      lastEventTs: 0,
      offlineDismissed: false,
      fullscreen: typeof document !== "undefined" && !!(document.fullscreenElement || document.webkitFullscreenElement),
      // CSS-only fallback fullscreen for browsers without a working
      // Fullscreen API on arbitrary elements (see toggleFullscreen above).
      pseudoFullscreen: false,
      noSpeechHint: null,
    });
  }
  var store = storeRef.current;
  var s = useStore(store);

  var refsRef = useRef(null);
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

  var visRef = useRef(null);
  var wsRef = useRef(null);
  var audioOutRef = useRef(null);
  var latencyRef = useRef(null);
  if (!latencyRef.current) latencyRef.current = createLatencyTracker(20);
  var pttRef = useRef({ start: function () {}, stop: function () {} });
  var turnMetaRef = useRef([]);
  var lastUserTextRef = useRef("");
  var memSeqRef = useRef(0);
  // written on EVERY ws event (incl. tts.amp at ~30Hz) — kept out of the
  // store so it can't re-render the tree; copied in when going offline.
  var lastEventTsRef = useRef(0);
  var noSpeechTimerRef = useRef(null);

  function pushTimeline(type, label, detail, tone) {
    store.set(function (st) {
      return {
        timeline: pushCapped(
          st.timeline,
          {
            id: type + ":" + Date.now() + ":" + Math.random(),
            ts: Date.now(),
            type: type,
            icon: TIMELINE_ICON[type] || "•",
            label: label,
            detail: detailString(detail),
            tone: tone || "dim",
          },
          TIMELINE_MAX
        ),
      };
    });
  }

  // opts: { dim, tone } — dim renders the turn faint (stt.ignored echoes),
  // tone "red" flags a system row as an error (turn failed / timed out) so
  // the conversation always shows why nothing was answered, never silence.
  function pushTurn(role, text, meta, opts) {
    store.set(function (st) {
      return {
        turns: pushCapped(
          st.turns,
          {
            id: role + ":" + Date.now() + ":" + Math.random(),
            role: role,
            text: text,
            time: fmtClock(Date.now()),
            meta: meta || [],
            dim: !!(opts && opts.dim),
            tone: (opts && opts.tone) || null,
          },
          TURNS_MAX
        ),
      };
    });
  }

  // Add/refresh a notification row (deduped by id; skipped when the user has
  // already dismissed that exact id — see DISMISSED_NOTICES_KEY).
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
      // prune the oldest persisted dismissals past the cap
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
      return {
        dismissedNotices: dismissed,
        notices: (st.notices || []).filter(function (n) {
          return n.id !== id;
        }),
      };
    });
  }

  // ---- worker backend + credits (mount + reconnect + manual refresh ONLY;
  // no polling per spec §08) --------------------------------------------------
  function loadBackends() {
    fetchJSON("/backends")
      .then(function (data) {
        store.set({ backends: data, worker_backend: (data && data.active) || store.get().worker_backend });
      })
      .catch(function () {
        /* selector renders from static metadata until this succeeds */
      });
  }
  function loadCredits(refresh) {
    if (refresh) {
      if (store.get().creditsPhase === "refreshing") return;
      store.set({ creditsPhase: "refreshing" });
    }
    fetchJSON("/credits" + (refresh ? "?refresh=true" : ""))
      .then(function (data) {
        store.set({ credits: data, creditsPhase: data && data.stale ? "stale" : "ok" });
      })
      .catch(function () {
        store.set(function (st) {
          // keep showing the last payload (marked stale) rather than wiping it
          return { creditsPhase: st.credits ? "stale" : "error" };
        });
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
  // endpoint (per spec) to enrich the cards with snippet/confidence/updated/
  // conflict. Event scores win; stale responses are dropped.
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

  // "didn't catch that" — subtle, self-clearing composer hint for the
  // server's "no speech recognized" state detail. Re-triggering restarts the
  // 3s window rather than stacking timers.
  function showNoSpeechHint() {
    clearTimeout(noSpeechTimerRef.current);
    store.set({ noSpeechHint: "Didn't catch that." });
    noSpeechTimerRef.current = setTimeout(function () {
      store.set({ noSpeechHint: null });
    }, 3000);
  }

  function resync(announce) {
    fetchJSON("/tasks")
      .then(function (data) {
        var map = tasksFromResponse(data);
        store.set({ tasks: map });
        // (for now) any task needing review surfaces as an approval notice,
        // including on reload — terminal task.update events handle the rest
        // live (spec §06).
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
    loadBackends();
    loadCredits(false); // cached server-side; manual ⟳ passes refresh=true
  }

  // ---- mount once: ws, audio, mic, keyboard, timers -----------------------
  useEffect(function () {
    var audioOut = createAudioOutput();
    audioOut.setGain(store.get().volume);
    audioOutRef.current = audioOut;

    // Client-side "is the mic actually producing signal" bookkeeping (see
    // ui/README.md §Mic behavior). Plain closure vars — high-frequency
    // signals never touch the store (see store.js header).
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
        pushTimeline("error", message, null, "red");
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
            msg.value === "error" ? "red" : msg.value === "blocked" ? "amber" : "dim"
          );
          if (msg.value === "listening") beginTurn();
          if (msg.value === "done" || msg.value === "idle") commitReply(msg.value);
          if (msg.value === "interrupted") commitReply("interrupted");
          // Detail-driven outcomes, independent of msg.value — a timeout or
          // no-speech result can ride on any state value the server chooses,
          // so match on the detail string itself rather than enumerating
          // (state, detail) pairs.
          if (msg.detail === "turn timed out") {
            pushTurn("system", "Turn failed: timed out waiting for a reply.", [], { tone: "red" });
            turnMetaRef.current = [];
            store.set({ mediatorText: "", speakingText: "" });
          } else if (msg.detail === "no speech recognized") {
            showNoSpeechHint();
          }
          // "listening" is just the mic.start ack — only states beyond it
          // prove the pipeline heard real input (silence-hint logic).
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
          pushTimeline("stt.final", "Transcribed: “" + (msg.text || "") + "”", typeof msg.ms === "number" ? "stt.final ms: " + msg.ms : null, "dim");
          recordLatency("stt", msg.ms);
          micHeardActivity = true;
          if (store.get().micHint) store.set({ micHint: null });
          break;
        case "stt.ignored":
          // Backend decided this was an echo of Jarvis's own speech (barge-in
          // false-positive) and dropped it before the turn pipeline — the
          // transcript must still show it happened, just visibly discarded,
          // rather than vanishing with no trace.
          if (msg.text) {
            pushTurn("user", msg.text, ["ignored — " + (msg.reason || "echo")], { dim: true });
          }
          pushTimeline(
            "stt.ignored",
            "Ignored: “" + (msg.text || "") + "” (" + (msg.reason || "echo") + ")",
            detailString(msg),
            "amber"
          );
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
            "dim"
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
            "cyan"
          );
          break;
        case "tts.start":
          if (!store.get().ttsPlaying) {
            pushTimeline("tts.start", "TTS started · kokoro-onnx", null, "dim");
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
          var updated = Object.assign({}, msg, { updated_ts: Date.now() });
          store.set(function (st) {
            var tasks = Object.assign({}, st.tasks);
            tasks[msg.id] = Object.assign({}, tasks[msg.id] || {}, updated);
            // A dismissed task un-hides itself only if it genuinely moved to
            // a new status since the user hid it (e.g. re-delegated
            // elsewhere and now running again) — a repeat of the same
            // status it was dismissed at stays hidden.
            var dismissedTasks = st.dismissedTasks;
            if (
              msg.status &&
              dismissedTasks &&
              Object.prototype.hasOwnProperty.call(dismissedTasks, msg.id) &&
              dismissedTasks[msg.id] !== msg.status
            ) {
              dismissedTasks = Object.assign({}, dismissedTasks);
              delete dismissedTasks[msg.id];
              saveLocalJSON(DISMISSED_TASKS_KEY, dismissedTasks);
            }
            return { tasks: tasks, dismissedTasks: dismissedTasks };
          });
          pushTimeline(
            "task.update",
            (msg.title || msg.id) + " → " + msg.status,
            detailString({ progress_note: msg.progress_note, result_summary: msg.result_summary }),
            msg.status === "failed" ? "red" : msg.status === "needs_review" ? "amber" : "cyan"
          );
          // actionable terminal states surface as notification rows (spec
          // §06) — noticeForTask returns null for done/canceled, which stay
          // task-cards only; merged task fields so title/result_summary
          // survive partial updates
          if (isTerminalStatus(msg.status)) {
            pushNotice(noticeForTask(Object.assign({}, store.get().tasks[msg.id] || {}, updated)));
          }
          break;
        }
        case "memory.hits": {
          var items = msg.items || [];
          store.set({ memoryHits: items });
          if (visRef.current) visRef.current.onMemoryHits(items);
          turnMetaRef.current.push("memory_recall · " + items.length + " hit" + (items.length === 1 ? "" : "s"));
          pushTimeline("memory.hits", "memory_recall → " + items.length + " hits", detailString(items), "cyan");
          enrichMemoryHits(items);
          break;
        }
        case "latency":
          recordLatency(msg.stage, msg.ms);
          break;
        case "health":
          store.set({ health: msg });
          pushTimeline("health", "Health changed", detailString(msg.components), "amber");
          break;
        case "error":
          store.set(function (st) {
            return { errCount: st.errCount + 1 };
          });
          pushTimeline("error", msg.message || "error", detailString(msg), "red");
          // Every server "error" event is a turn/pipeline failure reported
          // over the socket (distinct from the local mic onError callback
          // below) — it must land in the conversation too, not just the
          // timeline, so the transcript never just goes quiet.
          pushTurn("system", msg.message || "Turn failed — no reply.", [], { tone: "red" });
          turnMetaRef.current = [];
          store.set({ mediatorText: "", speakingText: "" });
          // error events also land as a dismissable notification row
          pushNotice({
            id: "error:" + Date.now(),
            tone: "error",
            title: "Pipeline error",
            body: msg.message || "Turn failed — see the activity stream.",
            ts: fmtClock(Date.now()),
            approve: false,
          });
          break;
        case "pong":
          break;
        default:
          pushTimeline(msg.t, msg.t, null, "dim");
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

    // 1s ticker — drives ticking task elapsed / tool chip / retry countdown,
    // and ONLY runs a re-render when something actually needs it.
    var tickTimer = setInterval(function () {
      var st = store.get();
      var anyRunning = Object.values(st.tasks || {}).some(function (t) {
        return t.status === "running";
      });
      if (anyRunning || st.toolChip || st.connection !== "open") {
        store.set(function (prev) {
          return { tick: prev.tick + 1 };
        });
      }
    }, 1000);

    return function cleanup() {
      clearTimeout(offlineGraceTimer);
      clearInterval(healthTimer);
      clearInterval(tickTimer);
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
  // Covers all exit paths (Esc key, browser chrome, programmatic exit
  // elsewhere) — not just our own toggle button/keybinding.
  useEffect(function () {
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

  // CSS pseudo-fullscreen (see toggleFullscreen above) pins the root to
  // position:fixed/inset:0 — which, verified live, can trade one problem
  // for a worse one: the host dashboard's own fixed top chrome (a <header>
  // living outside our subtree entirely) no longer sits above us in normal
  // document flow, and — because our root is nested inside a host ancestor
  // that establishes its own (lower) stacking context — our max z-index
  // still can't out-rank that header's, so it paints on top and swallows
  // clicks meant for our own fullscreen toggle button. Left unfixed, a user
  // could tap into pseudo-fullscreen and have no way back out via the UI.
  // Measure any such top-anchored fixed/sticky header outside our root and
  // publish the clearance as a CSS custom property (inherited regardless of
  // layout/positioning, unlike a padding on the root itself — the mobile
  // shell's and desktop grid's own top-level wrappers are `position:
  // absolute; inset:0`, whose containing block is the root's *padding box*,
  // so padding on the root wouldn't actually push their content down; both
  // consume --jv-fs-top-clear as their own paddingTop instead). A no-op
  // whenever pseudo-fullscreen is off or no such header exists.
  useEffect(
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
          if (root.contains(el)) return; // our own chrome, not host chrome
          var cs = window.getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") return;
          var rect = el.getBoundingClientRect();
          if (rect.top > 4) return; // not anchored to the viewport top
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

  // ---- root width (drives the 1280/860 layout modes, prototype-style) -----
  useEffect(function () {
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

  // ---- height pinning ------------------------------------------------------
  useEffect(function () {
    // The host SPA mounts us under a `display: contents` parent inside a
    // content-sized block wrapper that ALSO carries its own bottom padding
    // (pb-[2rem+safe-area]) on an ancestor we can't neutralise from a direct-
    // child :has() rule. So `innerHeight - top` alone still leaves the page a
    // few rem taller than the viewport (the user had to scroll to the bottom).
    // Pin to the viewport remainder, then shrink by any residual page overflow
    // so the document itself never scrolls — robust to the banner, safe-area
    // insets, and whatever host chrome is above/below us.
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
    var t = setTimeout(sync, 500);   // banner/theme settle
    var t2 = setTimeout(sync, 1500); // late host chrome (profile banner) settle
    return function () {
      window.removeEventListener("resize", sync);
      if (ro) ro.disconnect();
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, []);

  // ---- visualizer: (re)bind to whichever shell's canvas is mounted ---------
  var isMobile = s.w < MOBILE_BREAK;
  useEffect(
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
  useEffect(
    function () {
      if (visRef.current) visRef.current.setState(derivedState(s));
    },
    [s.fsmState, s.connection]
  );

  useEffect(
    function () {
      if (visRef.current) visRef.current.setReducedMotion(s.reducedMotion);
      saveLocalBool("jarvis-voice:reducedMotion", s.reducedMotion);
    },
    [s.reducedMotion]
  );
  useEffect(
    function () {
      if (audioOutRef.current) audioOutRef.current.setGain(s.volume);
    },
    [s.volume]
  );

  // ---- actions passed down --------------------------------------------------
  var actRef = useRef(null);
  if (!actRef.current) {
    actRef.current = {
      onMicClick: function (e) {
        // Click = toggle capture (press+release must NOT stop it — see
        // ui/README.md §Mic behavior); Space hold stays true push-to-talk.
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
        pushTimeline("turn.text", "Typed turn: " + text, null, "dim");
      },
      setMicMode: function (mode) {
        store.set({ micMode: mode });
        if (wsRef.current) wsRef.current.send({ t: "mode.set", mode: mode });
      },
      taskControl: function (id, action) {
        pushTimeline("task.update", "task_control(" + action + ") → " + id, null, action === "cancel" ? "amber" : "cyan");
        authedFetch("/tasks/" + encodeURIComponent(id) + "/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action }),
        })
          .then(function (res) {
            return res.ok ? res.json() : null;
          })
          .then(function (data) {
            if (data && data.status) {
              store.set(function (st) {
                var tasks = Object.assign({}, st.tasks);
                if (tasks[id]) tasks[id] = Object.assign({}, tasks[id], { status: data.status, updated_ts: Date.now() });
                return { tasks: tasks };
              });
            }
          })
          .catch(function () {
            /* task.update events / connection status carry the truth */
          });
      },
      // Client-side-only "Dismiss" for needs_review/done/failed cards — no
      // backend delete exists (or is needed): just hide it locally and
      // persist the hide across reloads (see components/work.js).
      dismissTask: function (id) {
        store.set(function (st) {
          var task = st.tasks[id];
          var dismissedTasks = Object.assign({}, st.dismissedTasks);
          dismissedTasks[id] = (task && task.status) || true;
          saveLocalJSON(DISMISSED_TASKS_KEY, dismissedTasks);
          return { dismissedTasks: dismissedTasks };
        });
      },
      toggleTaskDetail: function (id) {
        var st = store.get();
        var next = st.expandedTask === id ? null : id;
        store.set({ expandedTask: next });
        if (next && !st.taskDetail[id]) {
          store.set(function (prev) {
            var d = Object.assign({}, prev.taskDetail);
            d[id] = { loading: true };
            return { taskDetail: d };
          });
          fetchJSON("/tasks/" + encodeURIComponent(id))
            .then(function (data) {
              var task = (data && (data.task || data)) || {};
              store.set(function (prev) {
                var d = Object.assign({}, prev.taskDetail);
                d[id] = {
                  loading: false,
                  events: (data && (data.events || data.task_events)) || task.events || [],
                  result_text: task.result_text || "",
                  result_summary: task.result_summary || "",
                  session_id: task.session_id || task.session || "",
                };
                return { taskDetail: d };
              });
            })
            .catch(function (err) {
              store.set(function (prev) {
                var d = Object.assign({}, prev.taskDetail);
                d[id] = { loading: false, error: (err && err.message) || "request failed" };
                return { taskDetail: d };
              });
            });
        }
      },
      // POST /backends {backend} — optimistic UI, reverted on failure. The
      // server persists the choice; the response's `backend` is authoritative.
      // Sequenced: two quick picks race their POSTs, and whichever response
      // lands LAST would otherwise overwrite the user's actual final choice —
      // only the latest request may touch the store (same token pattern as
      // enrichMemoryHits / memory runSearch).
      selectBackend: function (name) {
        var prev = store.get().worker_backend;
        if (prev === name) return;
        var seq = (selectBackendSeq += 1);
        store.set({ worker_backend: name });
        var meta = BACKEND_META[name] || { name: name, sub: "" };
        pushTimeline("backend", "Worker backend set to " + meta.name + (meta.sub ? " · " + meta.sub : ""), null, name === "granite" ? "cyan" : "amber");
        authedFetch("/backends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backend: name }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
          })
          .then(function (data) {
            if (seq !== selectBackendSeq) return;
            if (data && data.backend) store.set({ worker_backend: data.backend });
          })
          .catch(function () {
            if (seq !== selectBackendSeq) return;
            store.set({ worker_backend: prev });
            pushTimeline("error", "Couldn't set worker backend to " + name, null, "red");
          });
      },
      // manual ⟳ only — /credits is never polled (spec §08)
      refreshCredits: function () {
        pushTimeline("credits", "Checked subscription credits", "manual refresh · not polled", "dim");
        loadCredits(true);
      },
      dismissNotice: dismissNotice,
      // Approve on a needs_review approval row re-delegates the task (same
      // backend path as the card's Re-delegate button); Decline just hides.
      resolveNotice: function (id, approved) {
        var notice = (store.get().notices || []).find(function (n) {
          return n.id === id;
        });
        if (approved && notice && notice.taskId) {
          actRef.current.taskControl(notice.taskId, "resume");
        }
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
    };
  }
  var act = actRef.current;

  // ---- render ----------------------------------------------------------------
  var showLeft = s.w >= LEFT_COL_BREAK;

  return h(
    "div",
    { className: cls("jv-root", s.pseudoFullscreen ? "jv-pseudo-fullscreen" : ""), id: "jarvis-voice-root" },
    isMobile
      ? h(MobileShell, { store: store, act: act, refs: refs })
      : h(
          "div",
          { className: "absolute inset-0 flex flex-col", style: { paddingTop: "var(--jv-fs-top-clear, 0px)" } },
          h(SystemBar, { s: s, act: act }),
          h(
            "div",
            {
              className: cls("flex-1 min-h-0 grid", showLeft ? "grid-cols-[304px_minmax(0,1fr)_372px]" : "grid-cols-[minmax(0,1fr)_344px]"),
            },
            showLeft ? h(MemoryColumn, { store: store }) : null,
            h(Stage, { store: store, act: act, refs: refs }),
            h(WorkColumn, { store: store, act: act, showLeft: showLeft })
          )
        ),
    h(OfflineSheet, { s: s, store: store, act: act, onRetry: function () {
      if (wsRef.current) wsRef.current.forceReconnect();
    } })
  );
}

// ---------------------------------------------------------------------------

function SystemBar(props) {
  var s = props.s;
  var act = props.act;
  var conn = { open: ["#4FE3E0", "connected"], connecting: ["#F2B35C", "connecting…"], reconnecting: ["#F2B35C", "reconnecting…"], closed: ["#FF6B6B", "offline"] }[s.connection] || ["#FF6B6B", "offline"];
  var models = (s.health && s.health.models) || {};
  var ram = s.health && s.health.ram && typeof s.health.ram.free_gb === "number" ? s.health.ram.free_gb.toFixed(1) + " GB" : "—";
  var e2e = s.latency.e2e_first_audio && s.latency.e2e_first_audio.p50 != null ? (s.latency.e2e_first_audio.p50 / 1000).toFixed(2) + " s" : "—";

  function stat(label, value, mono) {
    return h(
      "div",
      { className: "flex-none whitespace-nowrap" },
      h("div", { className: "text-[9px] tracking-[.16em] text-faint" }, label),
      h("div", { className: cls("text-[11px] mt-[2px]", mono ? "font-mono" : "", value === "—" ? "text-faint" : "text-text") }, value)
    );
  }

  return h(
    "div",
    {
      className:
        "flex-none h-[52px] flex items-center gap-5 px-[18px] border-b border-[rgba(120,190,200,.10)] bg-gradient-to-b from-[rgba(14,22,26,.9)] to-[rgba(8,12,14,.9)]",
    },
    h(
      "div",
      { className: "flex items-center gap-[10px]" },
      h("div", { className: "w-2 h-2 rounded-full bg-accent shadow-bloom" }),
      h("div", { className: "text-[12px] tracking-[.36em] font-semibold text-text" }, "JARVIS")
    ),
    h(
      "div",
      { className: "flex items-center gap-[6px] px-2 py-1 border border-[rgba(120,190,200,.16)] rounded-[4px] whitespace-nowrap flex-none" },
      h("div", { className: "text-[9px] tracking-[.14em] text-[#7FA0A5]" }, "LOCAL ONLY"),
      h("div", { className: "text-[9px] text-accent" }, "◆")
    ),
    h("div", { className: "w-px h-[22px] bg-[rgba(120,190,200,.12)]" }),
    h(
      "div",
      { className: "flex items-center gap-[22px] min-w-0 overflow-hidden" },
      s.w >= 1280 ? stat("MEDIATOR", (models.mediator && models.mediator.name) || "—", true) : null,
      s.w >= 1280 ? stat("WORKER", (models.worker && models.worker.name) || "—", true) : null,
      s.w >= 1024 ? stat("E2E FIRST AUDIO", e2e, true) : null,
      stat("RAM FREE", ram, true)
    ),
    h("div", { className: "flex-1" }),
    // compact credit strip (≥1180): one chip per subscription/limit backend
    s.w >= 1180 && s.credits && s.credits.backends
      ? h(
          "div",
          { className: "flex items-center gap-[7px] flex-none" },
          Object.keys(BACKEND_META)
            .filter(function (id) {
              var cr = s.credits.backends[id];
              return cr && cr.tier !== "free";
            })
            .map(function (id) {
              return h(BarGauge, {
                key: id,
                name: BACKEND_META[id].name,
                credit: s.credits.backends[id],
                phase: creditsPhase(s),
                active: s.worker_backend === id,
                reduced: s.reducedMotion,
              });
            })
        )
      : null,
    h(BackendSelector, { s: s, act: act }),
    h(
      "div",
      { className: "flex items-center gap-[7px] px-[10px] py-[5px] rounded-full border border-[rgba(120,190,200,.14)]" },
      h("div", {
        className: cls("w-[7px] h-[7px] rounded-full flex-none", s.connection !== "open" ? "jv-blink" : ""),
        style: { background: conn[0], boxShadow: "0 0 9px 1px " + conn[0] + "66" },
      }),
      h("div", { className: "text-[11px] text-[#C8DBDE] tracking-[.02em]" }, conn[1])
    ),
    h(FullscreenButton, { active: s.fullscreen || s.pseudoFullscreen, pseudo: s.pseudoFullscreen, onClick: act.toggleFullscreen }),
    h(
      "button",
      {
        onClick: act.toggleReduced,
        "aria-label": "Toggle reduced motion",
        "aria-pressed": s.reducedMotion,
        className: cls(
          "h-7 px-[10px] rounded-[6px] border text-[10px] tracking-[.12em] cursor-pointer whitespace-nowrap flex-none",
          s.reducedMotion
            ? "border-[rgba(242,179,92,.4)] bg-[rgba(242,179,92,.1)] text-warn"
            : "border-[rgba(120,190,200,.16)] bg-[rgba(20,32,36,.6)] text-dim hover:border-[rgba(79,227,224,.45)] hover:text-text"
        ),
      },
      s.reducedMotion ? "MOTION OFF" : "MOTION ON"
    )
  );
}

// Offline: a NON-BLOCKING bottom sheet (pointer events pass through around
// the card) — voice capture is paused but the rest of the UI stays usable.
function OfflineSheet(props) {
  var s = props.s;
  var store = props.store;
  if (!s.offline || s.offlineDismissed) return null;
  void s.tick; // re-render each second for the countdown
  var retryIn = s.retryAt ? Math.max(0, Math.ceil((s.retryAt - Date.now()) / 1000)) : null;
  var lastAgo = s.lastEventTs ? fmtDur((Date.now() - s.lastEventTs) / 1000) : null;
  return h(
    "div",
    { className: "absolute inset-x-0 bottom-0 flex justify-center pb-[110px] pointer-events-none z-40" },
    h(
      "div",
      {
        role: "status",
        className:
          "pointer-events-auto w-[min(520px,86%)] px-5 py-[18px] rounded-lg border border-[rgba(242,179,92,.3)] bg-[rgba(14,16,15,.96)] shadow-e2 jv-rise",
      },
      h(
        "div",
        { className: "flex items-center gap-[10px]" },
        h("div", { className: "w-[7px] h-[7px] rounded-full bg-warn jv-blink" }),
        h("div", { className: "text-[14px] font-semibold text-[#F7DCAE]" }, "jarvisd unreachable through the dashboard proxy")
      ),
      h(
        "div",
        { className: "mt-[9px] text-[13px] leading-[1.55] text-[#B7A98F]" },
        "Voice capture is paused. Task state is safe in ",
        h("span", { className: "font-mono" }, "jarvis.db"),
        " and replays on reconnect. Retrying with backoff",
        s.retryAttempt ? " — attempt " + s.retryAttempt + (retryIn != null ? ", next in " + retryIn + "s" : "") : "",
        "."
      ),
      h(
        "div",
        { className: "mt-[14px] flex items-center gap-2" },
        h(
          "button",
          {
            onClick: props.onRetry,
            "aria-label": "Retry now",
            className:
              "h-[34px] px-[15px] rounded-[7px] border border-[rgba(242,179,92,.4)] bg-[rgba(242,179,92,.14)] text-[#F7DCAE] text-[12px] font-semibold cursor-pointer hover:bg-[rgba(242,179,92,.22)]",
          },
          "Retry now"
        ),
        h(
          "button",
          {
            onClick: function () {
              store.set({ offlineDismissed: true });
            },
            "aria-label": "Continue offline",
            className:
              "h-[34px] px-[15px] rounded-[7px] border border-[rgba(120,190,200,.16)] bg-transparent text-dim text-[12px] cursor-pointer hover:text-text",
          },
          "Work offline"
        ),
        h("div", { className: "flex-1" }),
        lastAgo ? h("div", { className: "text-[10px] font-mono text-[#6E6154]" }, "last event " + lastAgo + " ago") : null
      )
    )
  );
}
