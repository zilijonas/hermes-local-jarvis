// components/mobile.js — <860px single-column shell: header, intelligence
// core, active-task chip, conversation, thumb-reach composer (mic 64px), and
// Tasks / Memory / Activity as bottom sheets (safe-area padded, ≥44px touch
// targets). Ported from the prototype's mobile variant.
import { h } from "../h.js";
import { getHooks } from "../sdk.js";
import { useStore } from "../store.js";
import { cls } from "./util.js";
import { StateCaption, ToolChip, MicButton, MicBanner, FullscreenButton, derivedState } from "./stage.js";
import { TaskCardMobile, ActivityRows } from "./work.js";
import { MemorySheetContent } from "./memory.js";
import { statusChip, workerTag, countActionableTasks, visibleTasks } from "./util.js";

function ConnDot(props) {
  var conn = props.conn;
  var color = conn === "open" ? "var(--jv-accent)" : conn === "closed" ? "var(--jv-danger)" : "var(--jv-warn)";
  return h("div", {
    className: cls("w-[7px] h-[7px] rounded-full flex-none", conn !== "open" ? "jv-blink" : ""),
    style: { background: color, boxShadow: "0 0 9px 1px " + color },
    "aria-label": "Connection: " + conn,
  });
}

function ActiveTaskChip(props) {
  var s = props.s;
  var tasks = visibleTasks(s.tasks, s.dismissedTasks);
  var t = null;
  for (var i = 0; i < tasks.length; i++) {
    if (tasks[i].status === "running") {
      t = tasks[i];
      break;
    }
  }
  if (!t) {
    for (var j = 0; j < tasks.length; j++) {
      if (tasks[j].status === "needs_review") {
        t = tasks[j];
        break;
      }
    }
  }
  if (!t) return null;
  var chip = statusChip(t.status);
  var tag = workerTag(t.kind);
  return h(
    "div",
    { className: "flex-none mx-3 mt-[2px] px-3 py-[10px] rounded-md border border-[rgba(79,227,224,.2)] bg-[rgba(12,26,29,.6)]" },
    h(
      "div",
      { className: "flex items-center gap-2" },
      h("div", { className: chip.className }, chip.label),
      h("div", { className: "flex-1" }),
      h("div", { className: tag.className }, tag.label)
    ),
    h("div", { className: "mt-[6px] text-[12px] font-semibold leading-[1.4] text-text" }, t.title || t.goal || t.id),
    t.progress_note || t.result_summary
      ? h("div", { className: "mt-[5px] text-[11px] leading-[1.45] text-dim" }, t.progress_note || t.result_summary)
      : null
  );
}

function MobileConversation(props) {
  var s = props.s;
  var refs = props.refs;
  var hooks = getHooks();
  var useEffect = hooks.useEffect;
  useEffect(
    function () {
      var el = refs.logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    },
    [s.turns.length, s.mediatorText, s.sttPartial]
  );
  return h(
    "div",
    { ref: refs.logRef, className: "flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-2 flex flex-col gap-3", role: "log", "aria-label": "Conversation" },
    s.turns.slice(-10).map(function (t) {
      var role = t.role === "user" ? "YOU" : t.role === "jarvis" ? "JARVIS" : "SYSTEM";
      return h(
        "div",
        { key: t.id },
        h(
          "div",
          {
            className: cls(
              "text-[9px] tracking-[.14em]",
              t.role === "user" ? "text-accent" : t.role === "jarvis" ? "text-[#C8DBDE]" : "text-faint"
            ),
          },
          role
        ),
        h(
          "div",
          {
            className:
              t.role === "system"
                ? cls("mt-1 text-[11px] font-mono leading-normal", t.tone === "red" ? "text-[#FF8F8F]" : "text-micro")
                : cls("mt-1 text-[15px] leading-[1.55]", t.dim ? "text-faint" : t.role === "user" ? "text-[#C8DBDE]" : "text-text"),
          },
          t.text
        ),
        t.meta && t.meta.length
          ? h(
              "div",
              { className: "mt-[5px] flex flex-wrap gap-[6px]" },
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
      );
    }),
    s.sttPartial
      ? h(
          "div",
          { "aria-live": "polite" },
          h("div", { className: "text-[9px] tracking-[.14em] text-accent jv-blink" }, "YOU"),
          h("div", { className: "mt-1 text-[15px] leading-normal text-faint italic" }, s.sttPartial, h("span", { className: "jv-caret", "aria-hidden": "true" }))
        )
      : null,
    s.mediatorText
      ? h(
          "div",
          { "aria-live": "polite" },
          h("div", { className: "text-[9px] tracking-[.14em] text-[#C8DBDE]" }, "JARVIS"),
          h("div", { className: "mt-1 text-[15px] leading-[1.55] text-text" }, s.mediatorText)
        )
      : null
  );
}

// Fraction of the sheet's container height for the resting "half" snap —
// must match .jv-sheet-half in style.css (that class owns the actual CSS,
// this constant only drives the JS snap-distance comparison while dragging).
var SHEET_HALF_FRACTION = 0.62;
var SHEET_MIN_HEIGHT = 96; // px — never drag smaller than this before closing
var SHEET_CLOSE_DROP = 90; // px below the half snap that commits to closing

function Sheet(props) {
  var store = props.store;
  var s = props.s;
  var act = props.act;
  var hooks = getHooks();
  var useRef = hooks.useRef;
  var useState = hooks.useState;
  var useEffect = hooks.useEffect;

  var panelRef = useRef(null);
  var dragRef = useRef(null); // { pointerId, startY, startHeight, parentHeight }
  var snapPair = useState("half"); // 'half' | 'full' (resting point, no active drag)
  var snap = snapPair[0];
  var setSnap = snapPair[1];
  var dragPair = useState(null); // live px height while the handle is being dragged
  var dragHeight = dragPair[0];
  var setDragHeight = dragPair[1];

  // fresh sheet always opens at the half snap, never mid-drag
  useEffect(
    function () {
      setSnap("half");
      setDragHeight(null);
    },
    [s.sheet]
  );

  if (!s.sheet) return null;
  var title = s.sheet === "tasks" ? "TASKS & WORKERS" : s.sheet === "memory" ? "MEMORY" : "ACTIVITY";
  function close() {
    store.set({ sheet: null });
  }

  // Native-app-style drag: pointerdown on the handle captures the pointer,
  // pointermove drives a live pixel height (1:1 with the finger), pointerup
  // snaps to half/full or — if dragged down far enough — dismisses the
  // sheet outright. Pointer Events (not touch/mouse-specific handlers) so
  // this works identically for touch, mouse and pen with one code path.
  function onDragPointerDown(e) {
    var panel = panelRef.current;
    if (!panel) return;
    var parent = panel.parentElement;
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: panel.getBoundingClientRect().height,
      parentHeight: parent ? parent.getBoundingClientRect().height : window.innerHeight,
    };
    if (e.currentTarget.setPointerCapture) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture unsupported — drag still tracks via move/up */
      }
    }
  }
  function onDragPointerMove(e) {
    var d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    var dy = e.clientY - d.startY; // finger moved down => dy > 0
    var next = d.startHeight - dy; // dragging up (dy<0) grows the sheet
    var max = Math.max(SHEET_MIN_HEIGHT, d.parentHeight - 24);
    setDragHeight(Math.max(SHEET_MIN_HEIGHT, Math.min(max, next)));
  }
  function endDrag(e) {
    var d = dragRef.current;
    if (!d || (e && e.pointerId !== d.pointerId)) return;
    dragRef.current = null;
    var halfH = d.parentHeight * SHEET_HALF_FRACTION;
    var fullH = d.parentHeight - 24;
    var lastHeight = dragHeight != null ? dragHeight : d.startHeight;
    if (lastHeight < halfH - SHEET_CLOSE_DROP) {
      setDragHeight(null);
      close();
      return;
    }
    var nearFull = Math.abs(lastHeight - fullH) < Math.abs(lastHeight - halfH);
    setSnap(nearFull ? "full" : "half");
    setDragHeight(null);
  }

  var dragging = dragHeight != null;
  var panelClassName = cls(
    "flex-none flex flex-col rounded-t-[18px] border-t border-[rgba(120,190,200,.16)] bg-surface shadow-e2 jv-rise",
    !dragging ? (snap === "full" ? "jv-sheet-full" : "jv-sheet-half") : ""
  );
  var panelStyle = {
    transition: dragging || s.reducedMotion ? "none" : "height var(--jv-base) var(--jv-ease)",
  };
  if (dragging) panelStyle.height = dragHeight + "px";

  var tasks = visibleTasks(s.tasks, s.dismissedTasks);

  return h(
    "div",
    { className: "absolute inset-0 flex flex-col justify-end bg-[rgba(4,7,9,.6)] z-30" },
    h("div", { className: "flex-1", onClick: close, "aria-hidden": "true" }),
    h(
      "div",
      {
        ref: panelRef,
        role: "dialog",
        "aria-label": title,
        className: panelClassName,
        style: panelStyle,
      },
      h(
        "div",
        {
          className: "flex-none flex flex-col items-center pt-[9px] pb-1 cursor-grab active:cursor-grabbing touch-none",
          onPointerDown: onDragPointerDown,
          onPointerMove: onDragPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          "aria-hidden": "true",
        },
        h("div", { className: "w-[38px] h-1 rounded-[2px] bg-[rgba(120,190,200,.24)]" })
      ),
      h(
        "div",
        { className: "flex-none flex items-center gap-[10px] px-4 pt-[6px] pb-[10px]" },
        h("div", { className: "text-[11px] tracking-[.18em] text-dim font-semibold" }, title),
        h("div", { className: "flex-1" }),
        h(
          "button",
          {
            onClick: close,
            "aria-label": "Close panel",
            className:
              "w-11 h-11 -m-[7px] rounded-full border-0 bg-transparent text-dim text-[16px] cursor-pointer flex items-center justify-center",
          },
          "×"
        )
      ),
      h(
        "div",
        { className: "flex-1 min-h-0 overflow-y-auto px-[14px] pb-[calc(16px+env(safe-area-inset-bottom))] flex flex-col gap-[9px]" },
        s.sheet === "tasks"
          ? tasks.length === 0
            ? h("div", { className: "text-[13px] text-faint px-1 py-2" }, "No tasks yet.")
            : tasks.map(function (t) {
                return h(TaskCardMobile, { key: t.id, task: t, act: act });
              })
          : null,
        s.sheet === "memory" ? h(MemorySheetContent, { store: store }) : null,
        s.sheet === "activity"
          ? s.timeline.length === 0
            ? h("div", { className: "text-[13px] text-faint px-1 py-2" }, "Nothing yet this session.")
            : h(ActivityRows, { items: s.timeline, verbose: false })
          : null
      )
    )
  );
}

export function MobileShell(props) {
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
  var ram = s.health && s.health.ram && typeof s.health.ram.free_gb === "number" ? s.health.ram.free_gb.toFixed(1) + " GB" : "";

  function send() {
    var text = draft.trim();
    if (!text) return;
    act.submitText(text);
    setDraft("");
  }

  var sheetTabs = [
    ["tasks", "Tasks", countActionableTasks(s.tasks, s.dismissedTasks)],
    ["memory", "Memory", (s.memoryHits || []).length],
    ["activity", "Activity", s.timeline.length],
  ];

  return h(
    "div",
    // --jv-fs-top-clear is set by app.js only while CSS pseudo-fullscreen is
    // active, to keep our own header (incl. the fullscreen toggle itself)
    // out from under the host's fixed top chrome — see app.js for why a
    // padding on the root itself can't do this (position:absolute inset-0's
    // containing block is the root's padding box, unaffected by its own
    // padding value).
    { className: "absolute inset-0 flex flex-col", style: { paddingTop: "var(--jv-fs-top-clear, 0px)" } },
    h(
      "div",
      { className: "flex-none flex items-center gap-[9px] px-4 pt-[14px] pb-[10px]" },
      h("div", { className: "w-[7px] h-[7px] rounded-full bg-accent shadow-bloom" }),
      h("div", { className: "text-[11px] tracking-[.3em] font-semibold text-text" }, "JARVIS"),
      h("div", { className: "flex-1" }),
      ram ? h("div", { className: "text-[10px] font-mono text-micro" }, ram) : null,
      h(FullscreenButton, { active: s.fullscreen || s.pseudoFullscreen, pseudo: s.pseudoFullscreen, onClick: act.toggleFullscreen, mobile: true }),
      h(ConnDot, { conn: s.connection })
    ),
    h(
      "div",
      { className: "flex-[0_1_232px] min-h-[120px] relative" },
      h("canvas", { ref: refs.canvasRef, "aria-hidden": "true", className: "jv-canvas" }),
      h(
        "div",
        { className: "absolute left-0 right-0 bottom-1 flex flex-col items-center gap-[5px] pointer-events-none" },
        h(StateCaption, { s: s }),
        h(ToolChip, { s: s })
      )
    ),
    h(ActiveTaskChip, { s: s }),
    h(MobileConversation, { s: s, refs: refs }),
    h(
      "div",
      {
        className:
          "flex-none px-3 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))] border-t border-[rgba(120,190,200,.1)] bg-[rgba(8,12,14,.9)]",
      },
      h(
        "div",
        { className: "flex items-center gap-2" },
        sheetTabs.map(function (def) {
          return h(
            "button",
            {
              key: def[0],
              onClick: function () {
                store.set({ sheet: def[0] });
              },
              "aria-label": def[1] + " panel",
              className:
                "flex-1 inline-flex items-center justify-center gap-[6px] h-11 rounded-[8px] border border-[rgba(120,190,200,.14)] bg-[rgba(11,17,20,.7)] text-dim text-[12px] cursor-pointer",
            },
            def[1],
            def[2] ? h("span", { className: "text-[10px] font-mono text-accent" }, String(def[2])) : null
          );
        })
      ),
      h(
        "div",
        { className: "mt-[10px] flex items-center gap-[10px]" },
        h(
          "div",
          {
            className:
              "flex-1 min-w-0 flex items-center h-[46px] px-[14px] rounded-[23px] border border-[rgba(120,190,200,.16)] bg-[rgba(9,14,17,.85)] focus-within:border-[rgba(79,227,224,.5)]",
          },
          h("input", {
            value: draft,
            onChange: function (e) {
              setDraft(e.target.value);
            },
            onKeyDown: function (e) {
              if (e.key === "Enter") send();
            },
            placeholder: "Message Jarvis…",
            "aria-label": "Message Jarvis",
            className: "flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] text-text",
          })
        ),
        h(
          "button",
          {
            onClick: act.interrupt,
            "aria-label": "Interrupt Jarvis",
            className: cls(
              "w-[46px] h-[46px] rounded-[23px] flex-none border text-[11px] cursor-pointer",
              speaking
                ? "border-[rgba(242,179,92,.45)] bg-[rgba(242,179,92,.12)] text-warn"
                : "border-[rgba(120,190,200,.12)] bg-transparent text-micro"
            ),
          },
          "■"
        ),
        h(MicButton, { s: s, act: act, refs: refs, mobile: true })
      ),
      h(MicBanner, { store: store, s: s }),
      s.noSpeechHint
        ? h("div", { className: "mt-[6px] text-[11px] text-faint italic", role: "status", "aria-live": "polite" }, s.noSpeechHint)
        : null
    ),
    h(Sheet, { store: store, s: s, act: act })
  );
}

export { derivedState };
