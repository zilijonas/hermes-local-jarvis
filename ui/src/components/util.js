// components/util.js — tiny shared helpers + the Tailwind class recipes that
// repeat across panels (status chips, buttons). All class strings are full
// literals so the Tailwind v4 scanner picks every candidate up.

export function cls() {
  var out = [];
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i]) out.push(arguments[i]);
  }
  return out.join(" ");
}

// "42s" / "3m 12s" / "1h 4m" — prototype _fmt
export function fmtDur(sec) {
  var s = Math.max(0, Math.round(sec));
  if (s < 60) return s + "s";
  var m = Math.floor(s / 60);
  if (m < 60) return m + "m " + (s % 60) + "s";
  var h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

export function fmtClock(ts) {
  var d = new Date(ts || Date.now());
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(function (n) {
      return String(n).padStart(2, "0");
    })
    .join(":");
}

// Defensive timestamp parse — jarvisd rows may carry epoch seconds, epoch
// milliseconds, or ISO strings; returns ms epoch or null.
export function parseTs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (v > 1e12) return v; // ms epoch
    if (v > 1e9) return v * 1000; // s epoch
    return null; // small number: not a timestamp
  }
  var t = Date.parse(v);
  return isNaN(t) ? null : t;
}

// ---- status chips (prototype _statusStyle, as Tailwind recipes) ------------
var CHIP_BASE =
  "inline-flex items-center h-5 px-2 rounded-[4px] border text-[10px] tracking-[.08em] uppercase whitespace-nowrap";
var CHIP_STYLES = {
  running: ["border-[rgba(79,227,224,.4)] bg-[rgba(79,227,224,.1)] text-[#9DF0EC]", "running"],
  queued: ["border-[rgba(120,190,200,.24)] bg-[rgba(120,190,200,.06)] text-dim", "queued"],
  paused: ["border-[rgba(120,190,200,.24)] bg-[rgba(120,190,200,.06)] text-[#C8DBDE]", "paused"],
  done: ["border-[rgba(104,234,208,.34)] bg-[rgba(104,234,208,.08)] text-[#8DE8CE]", "done"],
  needs_review: ["border-[rgba(242,179,92,.42)] bg-[rgba(242,179,92,.1)] text-warn", "needs review"],
  failed: ["border-[rgba(255,107,107,.42)] bg-[rgba(255,107,107,.1)] text-[#FF8F8F]", "failed"],
  canceled: ["border-[rgba(120,190,200,.2)] bg-transparent text-micro", "canceled"],
};
export function statusChip(status) {
  var m = CHIP_STYLES[status] || ["border-line-strong bg-transparent text-dim", status || "—"];
  return { className: CHIP_BASE + " " + m[0], label: m[1] };
}

// ---- buttons (prototype _btn) ----------------------------------------------
var BTN_BASE = "h-[26px] px-[11px] rounded-sm text-[11px] cursor-pointer border";
export var BTN = BTN_BASE + " border-[rgba(120,190,200,.18)] bg-transparent text-[#C8DBDE] hover:brightness-125";
export var BTN_PRIMARY =
  BTN_BASE + " border-[rgba(79,227,224,.34)] bg-[rgba(79,227,224,.12)] text-accent-soft font-semibold hover:bg-[rgba(79,227,224,.2)]";
export var BTN_DANGER = BTN_BASE + " border-[rgba(255,107,107,.3)] bg-transparent text-[#FF8F8F] hover:brightness-125";
export var BTN_WARN =
  BTN_BASE + " border-[rgba(242,179,92,.4)] bg-[rgba(242,179,92,.1)] text-warn font-semibold hover:bg-[rgba(242,179,92,.2)]";

// micro section label ("MEMORY", "EVENT TIMELINE", …)
export var MICRO_LABEL = "text-[9px] tracking-[.16em] text-faint";

// worker identity tag (GRANITE / CODEX)
export function workerTag(kind) {
  return {
    className:
      "text-[9px] tracking-[.12em] px-[6px] py-[2px] rounded-[3px] border border-[rgba(120,190,200,.2)] " +
      (kind === "codex" ? "text-[#B9A6E8]" : "text-dim"),
    label: (kind || "").toUpperCase() || "—",
  };
}

// activity tone → icon color / row accents (prototype activity mapping)
export function toneIconClass(tone) {
  if (tone === "red") return "text-[#FF8F8F]";
  if (tone === "amber") return "text-warn";
  if (tone === "cyan") return "text-accent";
  return "text-faint";
}
export function toneRowClass(tone) {
  if (tone === "red") return "border border-[rgba(255,107,107,.2)] bg-[rgba(14,16,15,.6)]";
  if (tone === "amber") return "border border-[rgba(242,179,92,.18)] bg-[rgba(14,16,15,.6)]";
  return "border border-transparent";
}

// sparkline points for a 100x18 viewBox (prototype _spark)
export function sparkPoints(arr) {
  if (!arr || arr.length < 2) return "";
  var min = Math.min.apply(null, arr);
  var max = Math.max.apply(null, arr);
  var sp = max - min || 1;
  return arr
    .map(function (v, i) {
      return ((i / (arr.length - 1)) * 100).toFixed(1) + "," + (16 - ((v - min) / sp) * 14).toFixed(1);
    })
    .join(" ");
}

// Terminal task states — nothing left to control, only review/clear. Drives
// BOTH the Dismiss button (work.js) and notice derivation (app.js), so a new
// terminal status only needs adding here, never per-surface (the old
// per-surface enumeration is exactly how `canceled` lost its Dismiss).
var TERMINAL_STATUSES = { done: 1, failed: 1, needs_review: 1, canceled: 1 };
export function isTerminalStatus(status) {
  return !!TERMINAL_STATUSES[status];
}

// Status weight for the Work tab ordering: live work first.
var STATUS_WEIGHT = { running: 0, queued: 1, paused: 2, needs_review: 3, done: 4, failed: 5, canceled: 6 };
export function sortTasks(taskMap) {
  return Object.values(taskMap || {}).sort(function (a, b) {
    var wa = STATUS_WEIGHT[a.status] != null ? STATUS_WEIGHT[a.status] : 9;
    var wb = STATUS_WEIGHT[b.status] != null ? STATUS_WEIGHT[b.status] : 9;
    if (wa !== wb) return wa - wb;
    return (b.updated_ts || 0) - (a.updated_ts || 0);
  });
}
export function countOpenTasks(taskMap) {
  return Object.values(taskMap || {}).filter(function (t) {
    return t.status === "running" || t.status === "queued" || t.status === "paused";
  }).length;
}
export function countActionableTasks(taskMap, dismissedTasks) {
  return Object.values(taskMap || {}).filter(function (t) {
    if (isDismissed(dismissedTasks, t.id)) return false;
    return t.status === "running" || t.status === "queued" || t.status === "paused" || t.status === "needs_review";
  }).length;
}

// Client-side "Dismiss" (see components/work.js) hides needs_review/done/
// failed cards without any backend delete — dismissedTasks is a
// {taskId: statusAtDismissTime} map (persisted to localStorage by app.js) so
// a *genuinely new* status arriving via task.update can un-dismiss it later,
// while a plain re-render of the same status stays hidden.
export function isDismissed(dismissedTasks, id) {
  return !!(dismissedTasks && Object.prototype.hasOwnProperty.call(dismissedTasks, id));
}
export function visibleTasks(taskMap, dismissedTasks) {
  return sortTasks(taskMap).filter(function (t) {
    return !isDismissed(dismissedTasks, t.id);
  });
}

// Elapsed seconds for a task row; prefers real started/created timestamps,
// falls back to the locally-stamped updated_ts.
export function taskElapsedSec(t) {
  var base = parseTs(t.started) || parseTs(t.created) || t.updated_ts || null;
  if (!base) return null;
  return (Date.now() - base) / 1000;
}
