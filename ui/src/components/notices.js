// components/notices.js — notification rows (approval queue + errors),
// rendered with the library's NotificationCard. Grouping, dismissal
// bookkeeping and the approve->re-delegate domain rule stay in the plugin;
// everything visual (severity color, dismiss animation, count badge/expand,
// batch-action bar) comes from window.HermesUI.
//
// Notices are derived in app.js from ACTIONABLE task states only —
// needs_review (approval) and failed (error); plain done/canceled stay
// task-cards, never notifications. They live in store.notices. Dismissal is
// CLIENT-SIDE only (localStorage, same idea as dismissedTasks): the row
// hides, nothing is deleted server-side.
//
// De-noise: notices sharing the same tone+title (e.g. many identical
// needs_review from re-queued tasks) collapse into ONE NotificationCard with
// a count badge ("x7") that expands to the individual labels, plus a group-
// level Approve all / Dismiss all action row.
import { UI } from "../hui.js";
import { useTaskControl } from "../api.js";

var html = UI.html;

var SEVERITY = { error: "danger", attention: "warn", info: "info" };

export function isNoticeDismissed(dismissedNotices, id) {
  return !!(dismissedNotices && Object.prototype.hasOwnProperty.call(dismissedNotices, id));
}

export function visibleNotices(s) {
  return (s.notices || []).filter(function (n) {
    return !isNoticeDismissed(s.dismissedNotices, n.id);
  });
}

// Tab-label dot summary: "danger" if any error notice, "warn" if any
// attention, null when clear (info-only lists don't demand attention).
export function noticeSummary(s) {
  var list = visibleNotices(s);
  var hasError = false;
  var hasAttention = false;
  list.forEach(function (n) {
    if (n.tone === "error") hasError = true;
    else if (n.tone === "attention") hasAttention = true;
  });
  return { count: list.length, tone: hasError ? "danger" : hasAttention ? "warn" : null };
}

/** Small colored dot for a tab label (null tone renders nothing). */
export function NoticeDot(props) {
  if (!props.tone) return null;
  return html`<${UI.StatusDot} tone=${props.tone} pulse />`;
}

// Duplicate batching: notices sharing tone+title+approve collapse into one
// group, newest-first order preserved (store.notices is prepend-ordered).
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

// One group (or single notice, group.items.length === 1) as a
// NotificationCard. Its own useTaskControl() instance keeps the loading
// state scoped to just this card, not the whole list.
function NoticeGroupCard(props) {
  var g = props.group;
  var act = props.act;
  var mobile = props.mobile;
  var taskControl = useTaskControl();
  var single = g.items.length === 1;
  var n = g.items[0];

  function approve(notice) {
    if (notice.taskId) {
      taskControl.run(notice.taskId, "resume").then(
        function () { act.resolveNotice(notice.id, true); },
        function () { /* useTaskControl already toasted; leave it up to retry */ }
      );
    } else {
      act.resolveNotice(notice.id, true);
    }
  }
  function decline(notice) {
    act.resolveNotice(notice.id, false);
  }
  function dismiss(notice) {
    if (notice.approve) decline(notice);
    else act.dismissNotice(notice.id);
  }

  var actions = null;
  if (single && n.approve) {
    actions = html`
      <${UI.Row} gap="sm">
        <${UI.Button} size="sm" variant="primary" loading=${taskControl.pending} onClick=${function () { approve(n); }}>Approve<//>
        <${UI.Button} size="sm" variant="danger" onClick=${function () { decline(n); }}>Decline<//>
      <//>`;
  } else if (!single) {
    var kids = [];
    if (g.approve) {
      kids.push(html`<${UI.Button} key="aa" size="sm" variant="primary" loading=${taskControl.pending}
        onClick=${function () { g.items.forEach(approve); }}>Approve all<//>`);
    }
    kids.push(html`<${UI.Button} key="da" size="sm" variant="secondary"
      onClick=${function () { g.items.forEach(dismiss); }}>Dismiss all<//>`);
    actions = html`<${UI.Row} gap="sm">${kids}<//>`;
  }

  return html`
    <${UI.NotificationCard}
      severity=${SEVERITY[g.tone] || "info"}
      title=${g.title}
      body=${single ? n.body : undefined}
      time=${single && !mobile ? n.ts : undefined}
      count=${g.items.length}
      items=${single ? undefined : g.items.map(function (it) {
        var itemActions = it.approve
          ? html`
              <${UI.Row} gap="xs">
                <${UI.Button} size="sm" variant="primary" loading=${taskControl.pending} onClick=${function () { approve(it); }}>Approve<//>
                <${UI.Button} size="sm" variant="danger" onClick=${function () { decline(it); }}>Decline<//>
              <//>`
          : undefined;
        return { id: it.id, label: it.body || it.title, actions: itemActions };
      })}
      actions=${actions}
      onDismiss=${function () { g.items.forEach(dismiss); }}
    />`;
}

/** Rows for the Work tab (desktop) and the mobile Tasks sheet. Returns null
 * when there's nothing to show, so callers can render it unconditionally. */
export function NoticeRows(props) {
  var s = props.s;
  var act = props.act;
  var mobile = props.mobile;
  var list = visibleNotices(s);
  if (!list.length) return null;
  var groups = groupNotices(list);

  return html`
    <${UI.Stack} gap="sm">
      <div className="hui-t-micro">
        ${UI.format.plural(list.length, "notification")}${groups.length < list.length ? " · " + UI.format.plural(groups.length, "group") : ""}
      </div>
      ${groups.map(function (g) {
        return html`<${NoticeGroupCard} key=${g.key} group=${g} act=${act} mobile=${mobile} />`;
      })}
    <//>`;
}
