// components/stage.js — the center stage: per-turn latency waterfall strip,
// intelligence-core canvas with state caption + live meta-tool chip,
// conversation log (role gutters, live partial with caret, streamed reply
// with the currently-spoken sentence highlighted), and the composer (mic
// toggle + level meter + text input + interrupt + mode toggle).
// Ported from the prototype's center column; every dynamic element is driven
// by real server events (see app.js onEvent).
import { h } from "../h.js";
import { getHooks } from "../sdk.js";
import { useStore } from "../store.js";
import { stateMeta, stateAccent, CORE_STATES } from "../visualizer/states.js";
import { cls, fmtDur, MICRO_LABEL } from "./util.js";

export function derivedState(s) {
  return s.connection === "open" ? s.fsmState : "offline";
}

var PULSING = { listening: 1, speaking: 1, thinking: 1, tool: 1, worker_progress: 1 };

// ---- turn strip (per-turn waterfall) ---------------------------------------

var WF_STAGES = [
  ["STT", "stt"],
  ["MED", "mediator_first_token"],
  ["TTS", "tts_first_chunk"],
];

function waterfallSegments(turnLatency) {
  var segs = [];
  var sum = 0;
  WF_STAGES.forEach(function (st) {
    var ms = turnLatency[st[1]];
    if (typeof ms === "number") {
      segs.push({ label: st[0], ms: ms, hot: st[1] === "mediator_first_token" });
      sum += ms;
    }
  });
  var e2e = turnLatency.e2e_first_audio;
  if (typeof e2e === "number" && e2e - sum > 0 && segs.length) {
    segs.push({ label: "PLAY", ms: Math.round(e2e - sum), hot: false });
  }
  var total = typeof e2e === "number" ? e2e : sum;
  segs.forEach(function (sg) {
    sg.frac = total > 0 ? sg.ms / total : 0;
  });
  return segs;
}

export function TurnStrip(props) {
  var s = useStore(props.store);
  var segs = waterfallSegments(s.turnLatency || {});
  var e2e = (s.turnLatency || {}).e2e_first_audio;
  var e2eLabel =
    typeof e2e === "number"
      ? (e2e / 1000).toFixed(2) + " s"
      : s.latency.e2e_first_audio && s.latency.e2e_first_audio.p50 != null
        ? (s.latency.e2e_first_audio.p50 / 1000).toFixed(2) + " s"
        : "—";
  var wide = s.w >= 1280; // single e2e figure <1280 per redesign spec

  return h(
    "div",
    { className: "flex-none flex items-center gap-[14px] px-5 py-[10px] border-b border-[rgba(120,190,200,.07)]" },
    h("div", { className: MICRO_LABEL + " whitespace-nowrap" }, "TURN " + (s.turnId != null ? "#" + s.turnId : "—")),
    h(
      "div",
      { className: "flex-1 flex items-center gap-[3px] h-4 min-w-0" },
      segs.length === 0
        ? h("div", { className: "h-[3px] flex-1 rounded-[2px] bg-[rgba(120,190,200,.08)]" })
        : segs.map(function (sg, i) {
            return h("div", {
              key: sg.label + i,
              title: sg.label + " " + sg.ms + "ms",
              className: cls("h-[3px] rounded-[2px]", sg.hot ? "bg-gradient-to-r from-accent-deep to-accent" : "bg-[rgba(120,190,200,.22)]"),
              style: { flex: String(Math.max(0.04, sg.frac)) },
            });
          })
    ),
    wide && segs.length
      ? segs.map(function (sg, i) {
          return h(
            "div",
            { key: "lbl" + sg.label + i, className: "flex items-center gap-[5px] whitespace-nowrap" },
            h("div", { className: cls("w-1 h-1 rounded-full", sg.hot ? "bg-accent" : "bg-[rgba(120,190,200,.35)]") }),
            h("div", { className: "text-[10px] tracking-[.1em] text-micro" }, sg.label),
            h("div", { className: "text-[10px] font-mono text-[#B8CCD0]" }, sg.ms + "ms")
          );
        })
      : h("div", { className: "text-[10px] font-mono text-[#B8CCD0] whitespace-nowrap" }, "e2e " + e2eLabel)
  );
}

// ---- canvas stage -----------------------------------------------------------

export function StateCaption(props) {
  var s = props.s;
  var ui = derivedState(s);
  var meta = stateMeta(ui);
  var accent = stateAccent(ui);
  var hint = s.fsmDetail && s.connection === "open" ? meta.hint + " · " + s.fsmDetail : meta.hint;
  return h(
    "div",
    { className: "flex flex-col items-center gap-[7px] pointer-events-none", "aria-live": "polite" },
    h(
      "div",
      { className: "flex items-center gap-[9px]" },
      h("div", {
        className: cls("w-[6px] h-[6px] rounded-full", PULSING[ui] && !s.reducedMotion ? "jv-blink" : ""),
        style: { background: accent, boxShadow: "0 0 10px 2px " + accent.replace("rgb(", "rgba(").replace(")", ",.4)") },
      }),
      h(
        "div",
        {
          className: "text-[15px] font-semibold tracking-[.14em] uppercase",
          style: { color: accent, textShadow: "0 0 18px " + accent.replace("rgb(", "rgba(").replace(")", ",.33)") },
        },
        meta.label
      )
    ),
    h("div", { className: "text-[12px] text-[#7FA0A5] tracking-[.02em]" }, hint)
  );
}

export function ToolChip(props) {
  var s = props.s;
  if (!s.toolChip) return null;
  var elapsed = fmtDur((Date.now() - s.toolChip.start) / 1000);
  return h(
    "div",
    {
      className:
        "mt-[3px] flex items-center gap-[9px] px-[11px] py-[5px] rounded-[6px] border border-[rgba(79,227,224,.28)] bg-[rgba(12,26,29,.75)] jv-rise pointer-events-none",
    },
    h("div", { className: "text-[10px] text-accent", "aria-hidden": "true" }, "⚙"),
    h("div", { className: "text-[11px] font-mono text-[#D8ECEE]" }, s.toolChip.name),
    h("div", { className: "w-px h-[11px] bg-[rgba(120,190,200,.2)]" }),
    h("div", { className: "text-[11px] font-mono text-accent" }, elapsed)
  );
}

function CanvasStage(props) {
  var store = props.store;
  var refs = props.refs;
  var s = useStore(store);
  var ui = derivedState(s);
  var coreMode = (CORE_STATES[ui] || CORE_STATES.idle).mode.toUpperCase();

  return h(
    "div",
    { className: "flex-[1.05] min-h-0 relative flex items-center justify-center" },
    h("canvas", { ref: refs.canvasRef, "aria-hidden": "true", className: "jv-canvas" }),
    h(
      "div",
      { className: "absolute left-0 right-0 bottom-[14px] flex flex-col items-center gap-[7px] pointer-events-none" },
      h(StateCaption, { s: s }),
      h(ToolChip, { s: s })
    ),
    h(
      "div",
      { className: "absolute left-5 top-4 flex flex-col gap-[5px] pointer-events-none" },
      h("div", { className: MICRO_LABEL.replace("text-faint", "text-micro") }, "INTELLIGENCE CORE"),
      h("div", { className: "text-[9px] tracking-[.16em] text-micro" }, (s.reducedMotion ? "STATIC · " : "LATTICE · ") + coreMode)
    )
  );
}

// ---- conversation log --------------------------------------------------------

function roleLabel(role) {
  return role === "user" ? "YOU" : role === "jarvis" ? "JARVIS" : "SYSTEM";
}
function roleGutterClass(role) {
  return cls(
    "text-[9px] tracking-[.14em]",
    role === "user" ? "text-accent" : role === "jarvis" ? "text-[#C8DBDE]" : "text-faint"
  );
}

// Split the streamed reply into (already spoken | currently spoken | not yet
// spoken) by matching the tts.start sentence text inside the stream.
function splitStream(streamText, speakingText) {
  if (!speakingText) return { done: streamText, now: "", rest: "" };
  var idx = streamText.indexOf(speakingText);
  if (idx < 0) {
    var trimmed = speakingText.trim();
    idx = trimmed ? streamText.indexOf(trimmed) : -1;
    if (idx < 0) return { done: streamText, now: "", rest: "" };
    speakingText = trimmed;
  }
  return {
    done: streamText.slice(0, idx),
    now: speakingText,
    rest: streamText.slice(idx + speakingText.length),
  };
}

export function ConversationLog(props) {
  var store = props.store;
  var refs = props.refs;
  var s = useStore(store);
  var hooks = getHooks();
  var useEffect = hooks.useEffect;

  // keep the log pinned to the bottom as turns/stream/partial grow
  useEffect(
    function () {
      var el = refs.logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    },
    [s.turns.length, s.mediatorText, s.sttPartial]
  );

  var stream = splitStream(s.mediatorText || "", s.ttsPlaying ? s.speakingText : "");

  return h(
    "div",
    {
      ref: refs.logRef,
      className:
        "flex-1 min-h-[132px] overflow-y-auto px-[22px] pt-1 pb-3 flex flex-col gap-[14px] border-t border-[rgba(120,190,200,.07)]",
      role: "log",
      "aria-label": "Conversation",
    },
    s.turns.slice(-14).map(function (t) {
      return h(
        "div",
        { key: t.id, className: "grid grid-cols-[62px_minmax(0,1fr)] gap-[14px] items-start" },
        h(
          "div",
          { className: "flex flex-col gap-[3px] pt-[2px]" },
          h("div", { className: roleGutterClass(t.role) }, roleLabel(t.role)),
          h("div", { className: "text-[9px] font-mono text-micro" }, t.time)
        ),
        h(
          "div",
          { className: "min-w-0" },
          h(
            "div",
            {
              className:
                t.role === "system"
                  ? cls("text-[12px] font-mono leading-normal", t.tone === "red" ? "text-[#FF8F8F]" : "text-micro")
                  : cls(
                      "text-[16px] leading-[1.55] text-pretty",
                      t.dim ? "text-faint" : t.role === "user" ? "text-[#C8DBDE]" : "text-text"
                    ),
            },
            t.text
          ),
          t.meta && t.meta.length
            ? h(
                "div",
                { className: "mt-[6px] flex flex-wrap gap-[6px]" },
                t.meta.map(function (mi, i) {
                  return h(
                    "div",
                    {
                      key: "m" + i,
                      className:
                        "flex items-center gap-[6px] px-[7px] py-[2px] rounded-[4px] border border-[rgba(120,190,200,.14)] bg-[rgba(14,22,26,.6)] text-[10px] font-mono text-faint",
                    },
                    mi
                  );
                })
              )
            : null
        )
      );
    }),
    s.sttPartial
      ? h(
          "div",
          { className: "grid grid-cols-[62px_minmax(0,1fr)] gap-[14px] items-start", "aria-live": "polite" },
          h("div", { className: "text-[9px] tracking-[.14em] text-accent pt-[2px] jv-blink" }, "YOU"),
          h(
            "div",
            { className: "text-[16px] leading-normal text-faint italic text-pretty" },
            s.sttPartial,
            h("span", { className: "jv-caret", "aria-hidden": "true" })
          )
        )
      : null,
    s.mediatorText
      ? h(
          "div",
          { className: "grid grid-cols-[62px_minmax(0,1fr)] gap-[14px] items-start", "aria-live": "polite" },
          h("div", { className: "text-[9px] tracking-[.14em] text-[#C8DBDE] pt-[2px]" }, "JARVIS"),
          h(
            "div",
            { className: "text-[16px] leading-[1.55] text-text text-pretty" },
            stream.done,
            stream.now ? h("span", { className: "jv-spoken" }, stream.now) : null,
            stream.rest ? h("span", { className: "text-faint" }, stream.rest) : null
          )
        )
      : null
  );
}

// ---- composer -----------------------------------------------------------------

function MicIcon(props) {
  return h(
    "svg",
    { width: props.size || 19, height: props.size || 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", "aria-hidden": "true" },
    h("path", { d: "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z" }),
    h("path", { d: "M5.5 11.5a6.5 6.5 0 0 0 13 0" }),
    h("path", { d: "M12 18v2.5" })
  );
}
export { MicIcon };

// ⛶-style fullscreen glyph: 4 corner brackets, pointing outward when idle
// (expand) and inward once fullscreen is active (compress) — swapped by the
// `active` flag, which app.js keeps synced to document.fullscreenElement via
// the fullscreenchange listener (see app.js).
function FullscreenIcon(props) {
  var size = props.size || 13;
  var svgProps = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  return props.active
    ? h(
        "svg",
        svgProps,
        h("path", { d: "M8 3v3a2 2 0 0 1-2 2H3" }),
        h("path", { d: "M21 8h-3a2 2 0 0 1-2-2V3" }),
        h("path", { d: "M3 16h3a2 2 0 0 1 2 2v3" }),
        h("path", { d: "M16 21v-3a2 2 0 0 1 2-2h3" })
      )
    : h(
        "svg",
        svgProps,
        h("path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }),
        h("path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }),
        h("path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }),
        h("path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" })
      );
}

export function FullscreenButton(props) {
  var active = props.active;
  var mobile = props.mobile;
  return h(
    "button",
    {
      onClick: props.onClick,
      "aria-label": "Toggle fullscreen",
      "aria-pressed": active,
      className: cls(
        "flex-none flex items-center justify-center cursor-pointer border",
        mobile ? "w-7 h-7 rounded-[6px]" : "h-7 w-7 rounded-[6px]",
        active
          ? "border-[rgba(79,227,224,.4)] bg-[rgba(79,227,224,.1)] text-accent-soft"
          : "border-[rgba(120,190,200,.16)] bg-[rgba(20,32,36,.6)] text-dim hover:border-[rgba(79,227,224,.45)] hover:text-text"
      ),
    },
    h(FullscreenIcon, { active: active, size: mobile ? 14 : 13 })
  );
}

export function MicButton(props) {
  var s = props.s;
  var act = props.act;
  var refs = props.refs;
  var mobile = props.mobile;
  var size = mobile ? "w-16 h-16" : "w-[52px] h-[52px]";
  return h(
    "div",
    { className: cls("relative flex-none", size) },
    h("div", {
      ref: mobile ? refs.micRingMobileRef : refs.micRingRef,
      className: "absolute -inset-[6px] rounded-full border border-[rgba(79,227,224,.5)] opacity-0 scale-90 pointer-events-none",
      "aria-hidden": "true",
    }),
    h(
      "button",
      {
        onClick: act.onMicClick,
        "aria-label": s.micActive ? "Stop microphone" : "Start microphone",
        "aria-pressed": s.micActive,
        className: cls(
          "absolute inset-0 flex items-center justify-center rounded-full cursor-pointer border transition-colors duration-[220ms] hover:brightness-110 active:scale-95",
          s.micActive
            ? "border-[rgba(79,227,224,.7)] bg-[radial-gradient(circle_at_50%_35%,rgba(79,227,224,.34),rgba(10,26,28,.9))] text-[#EAFFFE] shadow-[0_0_26px_rgba(79,227,224,.3)]"
            : "border-[rgba(120,190,200,.22)] bg-[radial-gradient(circle_at_50%_35%,rgba(30,50,54,.9),rgba(10,16,19,.95))] text-dim"
        ),
      },
      h(MicIcon, { size: mobile ? 24 : 19 })
    )
  );
}

export function MicBanner(props) {
  var store = props.store;
  var s = props.s;
  if (!s.micError && !s.micHint) return null;
  var isError = !!s.micError;
  return h(
    "div",
    {
      className: cls(
        "mt-2 flex items-center gap-2 px-[10px] py-[6px] rounded-[7px] border text-[12px] leading-snug",
        isError ? "border-[rgba(255,107,107,.35)] bg-[rgba(14,16,15,.8)] text-[#FF8F8F]" : "border-[rgba(242,179,92,.35)] bg-[rgba(14,16,15,.8)] text-warn"
      ),
      role: "status",
    },
    h("span", null, s.micError || s.micHint),
    h(
      "button",
      {
        className: "ml-auto bg-transparent border-0 text-inherit cursor-pointer text-[14px] leading-none p-0",
        onClick: function () {
          store.set({ micError: null, micHint: null });
        },
        "aria-label": "Dismiss",
      },
      "×"
    )
  );
}

export function Composer(props) {
  var store = props.store;
  var act = props.act;
  var refs = props.refs;
  var s = useStore(store);
  var hooks = getHooks();
  var useState = hooks.useState;
  var pair = useState("");
  var draft = pair[0];
  var setDraft = pair[1];
  var speaking = s.fsmState === "speaking" && s.connection === "open";

  function send() {
    var text = draft.trim();
    if (!text) return;
    act.submitText(text);
    setDraft("");
  }

  return h(
    "div",
    {
      className:
        "flex-none px-[22px] pt-3 pb-4 border-t border-[rgba(120,190,200,.09)] bg-gradient-to-b from-transparent to-[rgba(10,16,19,.7)]",
    },
    h(
      "div",
      { className: "flex items-center gap-3" },
      h(MicButton, { s: s, act: act, refs: refs }),
      h(
        "div",
        { className: "flex-1 min-w-0 flex flex-col gap-[7px]" },
        h(
          "div",
          { className: "flex items-center gap-[9px]" },
          h(
            "div",
            {
              className:
                "flex-1 min-w-0 flex items-center gap-[9px] h-11 px-[14px] rounded-md border border-[rgba(120,190,200,.15)] bg-[rgba(9,14,17,.85)] focus-within:border-[rgba(79,227,224,.5)]",
            },
            h("input", {
              ref: refs.composerInputRef,
              value: draft,
              onChange: function (e) {
                setDraft(e.target.value);
              },
              onKeyDown: function (e) {
                if (e.key === "Enter") send();
              },
              placeholder: "Type to Jarvis, or hold Space to talk…",
              "aria-label": "Message Jarvis",
              className: "flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-text",
            }),
            h("div", { className: "text-[10px] font-mono text-micro", "aria-hidden": "true" }, "⌘K")
          ),
          h(
            "button",
            {
              onClick: send,
              "aria-label": "Send",
              className:
                "h-11 px-[18px] rounded-md border border-[rgba(79,227,224,.3)] bg-[rgba(79,227,224,.1)] text-accent-soft text-[13px] font-semibold cursor-pointer hover:bg-[rgba(79,227,224,.18)] hover:text-text",
            },
            "Send"
          ),
          h(
            "button",
            {
              onClick: act.interrupt,
              "aria-label": "Interrupt Jarvis",
              className: cls(
                "h-11 px-[15px] rounded-md border text-[12px] font-semibold",
                speaking
                  ? "cursor-pointer border-[rgba(242,179,92,.45)] bg-[rgba(242,179,92,.12)] text-warn hover:brightness-110"
                  : "cursor-not-allowed border-[rgba(120,190,200,.12)] bg-transparent text-micro"
              ),
            },
            "Interrupt"
          )
        ),
        h(
          "div",
          { className: "flex items-center gap-[14px]" },
          h(
            "button",
            {
              onClick: function () {
                act.setMicMode(s.micMode === "ptt" ? "vad" : "ptt");
              },
              "aria-label": "Toggle voice mode",
              "aria-pressed": s.micMode === "vad",
              className: cls(
                "h-[26px] px-[10px] rounded-sm border text-[10px] tracking-[.08em] cursor-pointer whitespace-nowrap",
                s.micMode === "vad"
                  ? "border-[rgba(242,179,92,.4)] bg-[rgba(242,179,92,.09)] text-warn"
                  : "border-[rgba(120,190,200,.16)] bg-transparent text-dim hover:border-[rgba(79,227,224,.4)]"
              ),
            },
            s.micMode === "vad" ? "VAD · continuous (experimental)" : "PUSH-TO-TALK"
          ),
          h(
            "div",
            { className: "flex-1 h-[3px] rounded-[2px] bg-[rgba(120,190,200,.1)] overflow-hidden" },
            h("div", {
              ref: refs.levelRef,
              className: "h-full w-0 rounded-[2px] bg-gradient-to-r from-accent-deep to-accent",
            })
          ),
          h(
            "div",
            { className: "text-[10px] font-mono text-micro whitespace-nowrap max-[1100px]:hidden" },
            "SPACE hold to talk · ESC interrupt · 1·2·3 panels"
          )
        ),
        h(MicBanner, { store: store, s: s }),
        s.noSpeechHint
          ? h("div", { className: "mt-[6px] text-[11px] text-faint italic", role: "status", "aria-live": "polite" }, s.noSpeechHint)
          : null
      )
    )
  );
}

// ---- stage assembly ------------------------------------------------------------

export function Stage(props) {
  return h(
    "div",
    { className: "min-h-0 flex flex-col relative min-w-0" },
    h(TurnStrip, { store: props.store }),
    h(CanvasStage, { store: props.store, refs: props.refs }),
    h(ConversationLog, { store: props.store, refs: props.refs }),
    h(Composer, { store: props.store, act: props.act, refs: props.refs })
  );
}
