// components/backend.js — worker-backend selector + credit surfaces
// (redesign spec §06).
//
// Desktop: a system-bar button (status dot · BACKEND · active name · tier ·
// ▾) opening a ~430px popover with one row per backend; each row shows the
// availability dot (from GET /backends.available), name, tier badge, a mono
// caption of approx metrics + the live /credits note, and its fuel gauge(s)
// on the right. Mobile: a header chip that opens a dedicated bottom sheet
// (44px rows). Selecting a row POSTs /backends (persisted server-side).
//
// Data flow (§08 perf): /backends + /credits are fetched by app.js on mount
// and WS reconnect only — NEVER polled. The ⟳ REFRESH button calls
// act.refreshCredits() → GET /credits?refresh=true.
import { h } from "../h.js";
import { getHooks } from "../sdk.js";
import { cls } from "./util.js";
import { FuelGauge } from "./gauge.js";

// Static per-backend metadata (names / approx metrics), mirroring the design
// prototype's BACKENDS table. Live tier/note/gauges come from GET /credits;
// the tier here is only the pre-fetch fallback.
export var BACKEND_META = {
  granite: { name: "Granite", caption: "≈2–6 s · 64k ctx · no spend", sub: "local · free · on-box", tier: "free" },
  cloud: { name: "Cloud", caption: "≈1–3 s · $ per call · weekly cap", sub: "cloud · uses limit", tier: "limit" },
  codex: { name: "Codex", caption: "≈4–20 s · coding agent · sub credits", sub: "codex · weekly credits", tier: "sub" },
  claude: { name: "Claude Code", caption: "≈4–20 s · coding agent · weekly + session", sub: "claude · weekly + session", tier: "sub" },
};
var BACKEND_ORDER = ["granite", "cloud", "codex", "claude"];

export function backendIds(s) {
  var list = s.backends && Array.isArray(s.backends.backends) ? s.backends.backends : BACKEND_ORDER;
  return list.filter(function (id) {
    return BACKEND_META[id] || (s.credits && s.credits.backends && s.credits.backends[id]);
  });
}

function metaFor(id) {
  return BACKEND_META[id] || { name: id, caption: "", sub: "", tier: "sub" };
}

function creditFor(s, id) {
  return (s.credits && s.credits.backends && s.credits.backends[id]) || null;
}

// Global credits phase: "refreshing" while a manual refresh is in flight,
// "stale" when the payload says so, else "ok" ("idle" before first load).
export function creditsPhase(s) {
  if (s.creditsPhase === "refreshing") return "refreshing";
  if (s.credits && s.credits.stale) return "stale";
  return s.creditsPhase === "idle" ? "idle" : "ok";
}

export function creditsAgeLabel(s) {
  var phase = creditsPhase(s);
  if (phase === "refreshing") return "checking…";
  if (phase === "stale") return "stale";
  var checked = s.credits && s.credits.checked_epoch;
  if (!checked) return "";
  var sec = Math.max(0, Math.round(Date.now() / 1000 - checked));
  var label = sec < 60 ? "just now" : sec < 3600 ? Math.floor(sec / 60) + " m ago" : Math.floor(sec / 3600) + " h ago";
  return "checked " + label;
}

function tierBadge(tier, mobile) {
  var free = tier === "free";
  return h(
    "div",
    {
      className: cls(
        "text-[9px] tracking-[.12em] px-[6px] py-[2px] rounded-[3px] flex-none border uppercase",
        free
          ? "border-[rgba(104,234,208,.4)] bg-[rgba(104,234,208,.08)] text-ok"
          : "border-[rgba(242,179,92,.38)] bg-[rgba(242,179,92,.08)] text-warn",
        mobile ? "" : ""
      ),
    },
    (tier || "sub").toUpperCase()
  );
}

// Availability dot: reachability from GET /backends.available; the ACTIVE
// backend glows accent.
function availDot(available, active) {
  var bg = active ? "var(--jv-accent)" : available ? "rgba(120,190,200,.45)" : "var(--jv-danger)";
  return h("div", {
    className: "w-[7px] h-[7px] rounded-full flex-none",
    style: { background: bg, boxShadow: active ? "0 0 10px 2px rgba(79,227,224,.45)" : "none" },
    "aria-hidden": "true",
  });
}

// Right side of a row when the backend has no gauges but IS available
// (granite "on-device · free", codex "PLUS plan · limits not exposed"):
// the note stacked in two mono lines — first segment highlighted.
function NoteBlock(props) {
  var note = props.note || "";
  var parts = note.split("·").map(function (x) {
    return x.trim();
  });
  var line1 = parts[0] || (props.tier === "free" ? "no spend" : (props.tier || "").toUpperCase());
  var line2 = parts.slice(1).join(" · ");
  return h(
    "div",
    { className: cls("flex-none flex flex-col items-center gap-[3px] text-center", props.mobile ? "w-[88px]" : "w-24") },
    h("div", { className: cls("font-mono leading-[1.3]", props.mobile ? "text-[12px]" : "text-[11px]", props.tier === "free" ? "text-ok" : "text-dim") }, line1),
    line2 ? h("div", { className: cls("font-mono leading-[1.3] text-micro", props.mobile ? "text-[10px]" : "text-[9px]") }, line2) : null
  );
}

function BackendRow(props) {
  var s = props.s;
  var act = props.act;
  var id = props.id;
  var mobile = props.mobile;
  var meta = metaFor(id);
  var cr = creditFor(s, id);
  var active = s.worker_backend === id;
  var available = !s.backends || !s.backends.available || s.backends.available[id] !== false;
  var phase = creditsPhase(s);
  var tier = (cr && cr.tier) || meta.tier;
  var note = cr && cr.note;
  var gauges = (cr && cr.gauges) || [];
  var creditUnavailable = !!cr && cr.available === false;

  var right;
  if (creditUnavailable) {
    right = [h(FuelGauge, { key: "una", phase: "unavailable", note: note, name: meta.name, mobile: mobile })];
  } else if (gauges.length) {
    right = gauges.map(function (g, i) {
      return h(FuelGauge, { key: g.label || "g" + i, gauge: g, phase: phase === "idle" ? "ok" : phase, name: meta.name, mobile: mobile });
    });
  } else {
    right = [h(NoteBlock, { key: "note", note: note, tier: tier, mobile: mobile })];
  }

  // caption: approx metrics + the live note when the note isn't already the
  // right-side block (i.e. when gauges are shown)
  var caption = meta.caption + (note && gauges.length ? " · " + note : "");

  return h(
    "button",
    {
      onClick: function () {
        if (!available) return;
        act.selectBackend(id);
        if (props.onPicked) props.onPicked();
      },
      "aria-label": "Use " + meta.name + " — " + meta.sub + (available ? "" : " (unavailable)"),
      "aria-pressed": active,
      disabled: !available,
      className: cls(
        "w-full flex items-center gap-3 text-left rounded-md border transition-colors duration-200",
        mobile ? "px-3 py-3 min-h-11" : "px-3 py-[11px]",
        active ? "border-[rgba(79,227,224,.42)] bg-[rgba(79,227,224,.08)]" : "border-[rgba(120,190,200,.12)] bg-[rgba(11,17,20,.7)]",
        available ? "cursor-pointer hover:border-[rgba(79,227,224,.32)]" : "cursor-not-allowed opacity-60"
      ),
    },
    h(
      "div",
      { className: "flex-1 min-w-0 flex flex-col items-start gap-1" },
      h(
        "div",
        { className: "flex items-center gap-2" },
        availDot(available, active),
        h("div", { className: cls("font-semibold text-text", mobile ? "text-[15px]" : "text-[13px]") }, meta.name),
        tierBadge(tier, mobile)
      ),
      h(
        "div",
        { className: cls("font-mono text-faint text-left max-w-full overflow-hidden text-ellipsis whitespace-nowrap", mobile ? "text-[11px]" : "text-[10px]") },
        caption
      )
    ),
    right
  );
}

function RefreshButton(props) {
  var refreshing = props.refreshing;
  return h(
    "button",
    {
      onClick: props.onClick,
      "aria-label": "Refresh credit balances",
      className: cls(
        "flex items-center justify-center gap-[6px] rounded-[6px] border border-[rgba(120,190,200,.16)] bg-transparent cursor-pointer",
        props.mobile ? "h-11 px-[14px] text-[12px]" : "h-[26px] px-[9px] text-[10px] tracking-[.08em]",
        refreshing ? "text-accent" : "text-dim hover:border-[rgba(79,227,224,.4)] hover:text-text"
      ),
    },
    "⟳ " + (props.mobile ? "Refresh" : "REFRESH")
  );
}

var FOOTNOTE = "Selection applies to delegated tasks and tool calls. Mediator, transcription and speech always stay on-box.";

// ---- desktop: system-bar button + popover ----------------------------------

export function BackendSelector(props) {
  var s = props.s;
  var act = props.act;
  var hooks = getHooks();
  var useState = hooks.useState;
  var useEffect = hooks.useEffect;
  var useRef = hooks.useRef;
  var pair = useState(false);
  var open = pair[0];
  var setOpen = pair[1];
  var boxRef = useRef(null);

  // close on outside pointerdown (popover only — sheets have a scrim)
  useEffect(
    function () {
      if (!open) return;
      function onDown(e) {
        if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
      }
      document.addEventListener("pointerdown", onDown);
      return function () {
        document.removeEventListener("pointerdown", onDown);
      };
    },
    [open]
  );

  var activeId = s.worker_backend || (s.backends && s.backends.active) || "granite";
  var meta = metaFor(activeId);
  var cr = creditFor(s, activeId);
  var tier = (cr && cr.tier) || meta.tier;
  var available = !s.backends || !s.backends.available || s.backends.available[activeId] !== false;
  var phase = creditsPhase(s);

  return h(
    "div",
    { className: "relative flex-none", ref: boxRef },
    h(
      "button",
      {
        onClick: function () {
          setOpen(!open);
        },
        "aria-label": "Choose worker backend",
        "aria-expanded": open,
        "aria-haspopup": "true",
        className: cls(
          "flex items-center gap-2 h-[30px] px-[10px] rounded-[7px] border cursor-pointer whitespace-nowrap flex-none",
          open
            ? "border-[rgba(79,227,224,.45)] bg-[rgba(79,227,224,.1)]"
            : "border-[rgba(120,190,200,.16)] bg-[rgba(20,32,36,.6)] hover:border-[rgba(79,227,224,.45)]"
        ),
      },
      availDot(available, true),
      h(
        "div",
        { className: "flex flex-col items-start" },
        h("div", { className: "text-[8px] tracking-[.16em] text-faint leading-none" }, "BACKEND"),
        h("div", { className: "text-[11px] font-semibold text-text leading-[1.2]" }, meta.name)
      ),
      tierBadge(tier),
      h("div", { className: "text-[8px] text-faint", "aria-hidden": "true" }, "▾")
    ),
    open
      ? h(
          "div",
          {
            role: "menu",
            "aria-label": "Worker backends",
            className:
              "absolute top-[38px] right-0 z-[60] w-[430px] p-[14px] rounded-lg border border-[rgba(120,190,200,.18)] bg-surface shadow-e2 flex flex-col gap-2 jv-rise",
          },
          h(
            "div",
            { className: "flex items-center gap-[10px] pb-[2px]" },
            h("div", { className: "text-[10px] tracking-[.18em] text-dim font-semibold" }, "WORKER BACKEND"),
            h("div", { className: "flex-1" }),
            h("div", { className: "text-[9px] font-mono text-micro" }, creditsAgeLabel(s)),
            h(RefreshButton, { refreshing: phase === "refreshing", onClick: act.refreshCredits })
          ),
          backendIds(s).map(function (id) {
            return h(BackendRow, {
              key: id,
              id: id,
              s: s,
              act: act,
              onPicked: function () {
                setOpen(false);
              },
            });
          }),
          h("div", { className: "text-[10px] leading-normal text-micro pt-[2px]" }, FOOTNOTE)
        )
      : null
  );
}

// ---- mobile: header chip + sheet content ------------------------------------

export function BackendChipMobile(props) {
  var s = props.s;
  var activeId = s.worker_backend || (s.backends && s.backends.active) || "granite";
  var meta = metaFor(activeId);
  var cr = creditFor(s, activeId);
  var tier = (cr && cr.tier) || meta.tier;
  var attention = props.attention;
  return h(
    "button",
    {
      onClick: props.onClick,
      "aria-label": "Worker backend and credits",
      className: cls(
        "flex items-center gap-[6px] h-7 px-[9px] rounded-[7px] border cursor-pointer flex-none bg-[rgba(20,32,36,.6)]",
        attention ? "border-[rgba(242,179,92,.3)]" : "border-[rgba(120,190,200,.16)]"
      ),
    },
    availDot(true, true),
    h("div", { className: "text-[11px] font-semibold text-text" }, meta.name),
    tierBadge(tier, true)
  );
}

export function BackendSheetContent(props) {
  var s = props.s;
  var act = props.act;
  var phase = creditsPhase(s);
  return h(
    "div",
    { className: "flex flex-col gap-[9px]" },
    h(
      "div",
      { className: "flex items-center gap-[9px] px-[2px] pb-1" },
      h("div", { className: "text-[10px] font-mono text-micro" }, creditsAgeLabel(s)),
      h("div", { className: "flex-1" }),
      h(RefreshButton, { refreshing: phase === "refreshing", onClick: act.refreshCredits, mobile: true })
    ),
    backendIds(s).map(function (id) {
      return h(BackendRow, { key: id, id: id, s: s, act: act, mobile: true });
    }),
    h("div", { className: "text-[11px] leading-[1.55] text-micro px-[2px] pt-[2px]" }, FOOTNOTE)
  );
}
