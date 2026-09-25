// components/util.js — domain helpers that stay in the plugin: jarvisd's
// task-shape parsing/sorting/dismissal bookkeeping. Formatting (durations,
// clock time, sparkline points) and chrome (status chips, buttons, tone
// classes) now come from window.HermesUI (UI.format.*, Badge, Sparkline).

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

// status -> {label, tone} for UI.Badge (tone runs through UI's normTone).
var STATUS_TONE = {
  running: "accent",
  queued: "neutral",
  paused: "neutral",
  done: "ok",
  needs_review: "warn",
  failed: "danger",
  canceled: "neutral",
};
export function statusMeta(status) {
  return { label: (status || "—").replace(/_/g, " "), tone: STATUS_TONE[status] || "neutral" };
}

// worker identity tag (GRANITE / CODEX) -> {label, tone}
export function workerMeta(kind) {
  return { label: (kind || "").toUpperCase() || "—", tone: kind === "codex" ? "info" : "neutral" };
}

// activity/task-event tone -> UI tone name
export function eventTone(type) {
  var v = String(type || "").toLowerCase();
  if (v.indexOf("error") >= 0 || v.indexOf("fail") >= 0) return "danger";
  if (v.indexOf("review") >= 0 || v.indexOf("cancel") >= 0 || v.indexOf("warn") >= 0 || v.indexOf("restart") >= 0) return "warn";
  if (v.indexOf("progress") >= 0 || v.indexOf("log") >= 0) return "neutral";
  return "accent";
}

// Terminal task states — nothing left to control, only review/clear. Drives
// BOTH the Dismiss button (work.js) and notice derivation (app.js), so a new
// terminal status only needs adding here, never per-surface.
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
