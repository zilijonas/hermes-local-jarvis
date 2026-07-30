// components/notices.js — notification rows (redesign spec §06).
//
// Rendered INSIDE the Work tab (desktop) and the Tasks sheet (mobile) —
// never floating over the intelligence core. Notices are derived in app.js
// from ACTIONABLE task states only — needs_review (approval) and failed
// (error); plain done/canceled stay task-cards, never notifications. They
// live in store.notices. Dismissal is CLIENT-SIDE only (localStorage, same
// idea as the existing dismissedTasks): the row hides, nothing is deleted.
//
// De-noise: notices sharing the same tone+title (e.g. many identical
// needs_review from re-queued tasks) collapse into ONE group row with a
// count badge ("×7") that expands on click to the individual rows, each
// still approvable/dismissable, plus Approve all / Dismiss all.
//
// Tone → border + icon: attention (amber ⚠) / error (red ✕) / info (▣).
// Approval rows (needs_review) get Approve / Decline; every row gets ×.
import { h } from "../h.js";
import { getHooks } from "../sdk.js";
import { cls, BTN, BTN_PRIMARY, BTN_DANGER } from "./util.js";

var TONE = {
  error: {
    icon: "✕",
    row: "border-[rgba(255,107,107,.28)] bg-[rgba(16,15,12,.75)]",
    icotext: "text-[#FF8F8F]",
    title: "text-[#FF8F8F]",
    badge: "border-[rgba(255,107,107,.35)] text-[#FF8F8F]",
  },
  attention: {
    icon: "⚠",
    row: "border-[rgba(242,179,92,.3)] bg-[rgba(16,15,12,.75)]",
    icotext: "text-warn",
    title: "text-warn",
    badge: "border-[rgba(242,179,92,.4)] text-warn",
  },
  info: {
    icon: "▣",
    row: "border-[rgba(120,190,200,.12)] bg-[rgba(11,17,20,.7)]",
    icotext: "text-dim",
    title: "text-[#C8DBDE]",
    badge: "border-[rgba(120,190,200,.25)] text-dim",
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

// Duplicate batching: notices sharing tone+title+approve collapse into one
// group, newest-first order preserved (groups sort by their newest member,
// which store.notices already guarantees — it's prepend-ordered).
export function groupNotices(list) {
  var groups = [];
  var byKey = {};
  list.forEach(function (n) {
    var key = (n.tone || "info") + "|" + (n.approve ? "1" : "0") + "|" + (n.title || "");
    var g = byKey[key];
    if (!g) {
      g = { key: key, tone: n.tone, title: n.title, approve: !!n.approve, items: [] };
      byKey[key] = g;
      groups.push(g);
    }
    g.items.push(n);
  });
  return groups;
}

// One collapsed batch of near-identical notices: tone row + title + count
// badge; expands on click to the individual rows (each still dismissable /
// approvable); Approve all / Dismiss all act on every member.
function NoticeGroup(props) {
  var g = props.group;
  var act = props.act;
  var mobile = props.mobile;
  var hooks = getHooks();
  var pair = hooks.useState(false);
  var open = pair[0];
  var setOpen = pair[1];
  var tone = TONE[g.tone] || TONE.info;
  var count = g.items.length;
  var btnSize = mobile ? " !h-9 !px-[14px] !text-[13px]" : "";

  function dismissAll() {
    g.items.forEach(function (n) {
      // dismissing an approval row counts as declining it (same as NoticeRow)
      if (n.approve) act.resolveNotice(n.id, false);
      else act.dismissNotice(n.id);
    });
  }
  function approveAll() {
    g.items.forEach(function (n) {
      act.resolveNotice(n.id, true);
    });
  }

  var batchActions = [];
  if (g.approve) batchActions.push(["Approve all", BTN_PRIMARY + btnSize, approveAll]);
  batchActions.push(["Dismiss all", BTN + btnSize, dismissAll]);

  return h(
    "div",
    { className: cls("flex flex-col px-3 py-[11px] rounded-md border jv-rise", tone.row) },
    h(
      "div",
      { className: "flex items-start gap-[10px]" },
      h("div", { className: cls("text-[11px] pt-[2px] flex-none", tone.icotext), "aria-hidden": "true" }, tone.icon),
      h(
        "div",
        { className: "flex-1 min-w-0" },
        h(
          "button",
          {
            className: "flex items-center gap-2 max-w-full bg-transparent border-none p-0 text-left cursor-pointer",
            "aria-expanded": open,
            "aria-label": (open ? "Collapse" : "Expand") + " " + count + " grouped notifications — " + g.title,
            onClick: function () {
              setOpen(!open);
            },
          },
          h("span", { className: cls("text-[12px] font-semibold leading-[1.4] min-w-0 break-words", tone.title) }, g.title),
          h(
            "span",
            { className: cls("flex-none px-[6px] py-[1px] rounded-[4px] border text-[10px] font-mono leading-[1.4]", tone.badge) },
            "×" + count
          ),
          h("span", { className: "flex-none text-[9px] text-faint", "aria-hidden": "true" }, open ? "▾" : "▸")
        ),
        h(
          "div",
          { className: cls("mt-1 leading-normal text-dim", mobile ? "text-[12px]" : "text-[11px]") },
          count + " identical notification" + (count === 1 ? "" : "s") + (open ? "" : " — click to review individually")
        ),
        h(
          "div",
          { className: "mt-[9px] flex items-center gap-[6px] flex-wrap" },
          batchActions.map(function (a) {
            return h(
              "button",
              {
                key: a[0],
                className: a[1],
                "aria-label": a[0] + " — " + g.title,
                onClick: a[2],
              },
              a[0]
            );
          })
        )
      ),
      h(
        "div",
        { className: "flex flex-col items-end gap-[6px] flex-none" },
        !mobile && g.items[0].ts ? h("div", { className: "text-[10px] font-mono text-micro" }, g.items[0].ts) : null,
        h(
          "button",
          {
            onClick: dismissAll,
            "aria-label": "Dismiss all " + count + " — " + g.title,
            className: cls(
              "flex-none rounded-[6px] border border-[rgba(120,190,200,.16)] bg-transparent text-faint leading-none cursor-pointer hover:text-text hover:border-[rgba(79,227,224,.35)] flex items-center justify-center",
              mobile ? "w-11 h-11 rounded-[10px] text-[16px] text-dim" : "w-6 h-6 text-[13px]"
            ),
          },
          "×"
        )
      )
    ),
    open
      ? h(
          "div",
          { className: "mt-[10px] pl-[21px] flex flex-col gap-[7px] border-t border-[rgba(120,190,200,.1)] pt-[10px]" },
          g.items.map(function (n) {
            return h(NoticeRow, { key: n.id, notice: n, act: act, mobile: mobile });
          })
        )
      : null
  );
}

// Header line + rows + trailing divider. Returns null when there's nothing
// to show, so callers can prepend it unconditionally. Duplicate notices are
// batched into NoticeGroup rows (see groupNotices).
export function NoticeRows(props) {
  var s = props.s;
  var act = props.act;
  var mobile = props.mobile;
  var list = visibleNotices(s);
  if (!list.length) return null;
  var summary = noticeSummary(s);
  var groups = groupNotices(list);
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
        list.length +
          (list.length === 1 ? " NOTIFICATION" : " NOTIFICATIONS") +
          (groups.length < list.length ? " · " + groups.length + " GROUP" + (groups.length === 1 ? "" : "S") : "")
      )
    ),
    groups.map(function (g) {
      return g.items.length === 1
        ? h(NoticeRow, { key: g.items[0].id, notice: g.items[0], act: act, mobile: mobile })
        : h(NoticeGroup, { key: g.key, group: g, act: act, mobile: mobile });
    }),
    h("div", { className: "h-px my-1 bg-gradient-to-r from-[rgba(120,190,200,.16)] to-transparent" })
  );
}
