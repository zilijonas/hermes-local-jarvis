// components/notices.js — notification rows (redesign spec §06).
//
// Rendered INSIDE the Work tab (desktop) and the Tasks sheet (mobile) —
// never floating over the intelligence core. Notices are derived in app.js
// from task.update events reaching a terminal state, server `error` events,
// and (for now) any task sitting in needs_review; they live in
// store.notices. Dismissal is CLIENT-SIDE only (localStorage, same idea as
// the existing dismissedTasks): the row hides, nothing is deleted.
//
// Tone → border + icon: attention (amber ⚠) / error (red ✕) / info (▣).
// Approval rows (needs_review) get Approve / Decline; every row gets ×.
import { h } from "../h.js";
import { cls, BTN_PRIMARY, BTN_DANGER } from "./util.js";

var TONE = {
  error: {
    icon: "✕",
    row: "border-[rgba(255,107,107,.28)] bg-[rgba(16,15,12,.75)]",
    icotext: "text-[#FF8F8F]",
    title: "text-[#FF8F8F]",
  },
  attention: {
    icon: "⚠",
    row: "border-[rgba(242,179,92,.3)] bg-[rgba(16,15,12,.75)]",
    icotext: "text-warn",
    title: "text-warn",
  },
  info: {
    icon: "▣",
    row: "border-[rgba(120,190,200,.12)] bg-[rgba(11,17,20,.7)]",
    icotext: "text-dim",
    title: "text-[#C8DBDE]",
  },
};

export function isNoticeDismissed(dismissedNotices, id) {
  return !!(dismissedNotices && Object.prototype.hasOwnProperty.call(dismissedNotices, id));
}

export function visibleNotices(s) {
  return (s.notices || []).filter(function (n) {
    return !isNoticeDismissed(s.dismissedNotices, n.id);
  });
}

// Tab-label dot summary: red if any error notice, amber if any attention,
// null when clear (info-only lists don't demand attention).
export function noticeSummary(s) {
  var list = visibleNotices(s);
  var hasError = false;
  var hasAttention = false;
  list.forEach(function (n) {
    if (n.tone === "error") hasError = true;
    else if (n.tone === "attention") hasAttention = true;
  });
  return {
    count: list.length,
    tone: hasError ? "var(--jv-danger)" : hasAttention ? "var(--jv-warn)" : null,
  };
}

// The colored dot rendered inside the Work / Tasks tab label.
export function NoticeDot(props) {
  if (!props.tone) return null;
  return h("span", {
    className: "w-[6px] h-[6px] rounded-full flex-none inline-block",
    style: { background: props.tone, boxShadow: "0 0 8px 1px " + props.tone },
    "aria-hidden": "true",
  });
}

function NoticeRow(props) {
  var n = props.notice;
  var act = props.act;
  var mobile = props.mobile;
  var tone = TONE[n.tone] || TONE.info;
  var btnSize = mobile ? " !h-9 !px-[14px] !text-[13px]" : "";
  var actions = n.approve
    ? [
        ["Approve", BTN_PRIMARY + btnSize, true],
        ["Decline", BTN_DANGER + btnSize, false],
      ]
    : [];
  return h(
    "div",
    { className: cls("flex items-start gap-[10px] px-3 py-[11px] rounded-md border jv-rise", tone.row) },
    h("div", { className: cls("text-[11px] pt-[2px] flex-none", tone.icotext), "aria-hidden": "true" }, tone.icon),
    h(
      "div",
      { className: "flex-1 min-w-0" },
      h("div", { className: cls("text-[12px] font-semibold leading-[1.4]", tone.title) }, n.title),
      n.body
        ? h("div", { className: cls("mt-1 leading-normal text-dim text-pretty break-words", mobile ? "text-[12px]" : "text-[11px]") }, n.body)
        : null,
      actions.length
        ? h(
            "div",
            { className: "mt-[9px] flex items-center gap-[6px]" },
            actions.map(function (a) {
              return h(
                "button",
                {
                  key: a[0],
                  className: a[1],
                  "aria-label": a[0] + " — " + n.title,
                  onClick: function () {
                    act.resolveNotice(n.id, a[2]);
                  },
                },
                a[0]
              );
            })
          )
        : null
    ),
    h(
      "div",
      { className: "flex flex-col items-end gap-[6px] flex-none" },
      !mobile && n.ts ? h("div", { className: "text-[10px] font-mono text-micro" }, n.ts) : null,
      h(
        "button",
        {
          onClick: function () {
            // dismissing an approval row counts as declining it
            if (n.approve) act.resolveNotice(n.id, false);
            else act.dismissNotice(n.id);
          },
          "aria-label": n.approve ? "Decline and dismiss — " + n.title : "Dismiss notification — " + n.title,
          className: cls(
            "flex-none rounded-[6px] border border-[rgba(120,190,200,.16)] bg-transparent text-faint leading-none cursor-pointer hover:text-text hover:border-[rgba(79,227,224,.35)] flex items-center justify-center",
            mobile ? "w-11 h-11 rounded-[10px] text-[16px] text-dim" : "w-6 h-6 text-[13px]"
          ),
        },
        "×"
      )
    )
  );
}

// Header line + rows + trailing divider. Returns null when there's nothing
// to show, so callers can prepend it unconditionally.
export function NoticeRows(props) {
  var s = props.s;
  var act = props.act;
  var mobile = props.mobile;
  var list = visibleNotices(s);
  if (!list.length) return null;
  var summary = noticeSummary(s);
  return h(
    "div",
    { className: "flex flex-col gap-[9px]" },
    h(
      "div",
      { className: "flex items-center gap-2 px-[2px] pb-[2px]" },
      h(NoticeDot, { tone: summary.tone }),
      h(
        "div",
        { className: cls("tracking-[.16em] text-faint", mobile ? "text-[10px]" : "text-[9px]") },
        list.length + (list.length === 1 ? " NOTIFICATION" : " NOTIFICATIONS")
      )
    ),
    list.map(function (n) {
      return h(NoticeRow, { key: n.id, notice: n, act: act, mobile: mobile });
    }),
    h("div", { className: "h-px my-1 bg-gradient-to-r from-[rgba(120,190,200,.16)] to-transparent" })
  );
}
