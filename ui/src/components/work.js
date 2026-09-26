// components/work.js — right column: tabbed Work / Activity / System (plus
// Memory as a 4th tab when the dedicated column is folded at 860-1279px).
// Status-weighted task cards with worker identity, live elapsed, honest
// progress notes, pause/resume/cancel, an expandable event timeline+result;
// an activity feed; system health/latency/residency/counters. Chrome comes
// from window.HermesUI; task-control POSTs go through UI.useAction so a
// failure now shows a toast and a disabled/loading button instead of
// disappearing silently.
import { UI } from "../hui.js";
import { useStore } from "../store.js";
import {
  parseTs,
  statusMeta,
  workerMeta,
  eventTone,
  visibleTasks,
  countOpenTasks,
  taskElapsedSec,
  isTerminalStatus,
} from "./util.js";
import { useTasks, useTaskDetail, useTaskControl } from "../api.js";
import { MemoryPanel } from "./memory.js";
import { NoticeRows, NoticeDot, noticeSummary, visibleNotices } from "./notices.js";

var html = UI.html;

// ---------------------------------------------------------------- tasks ----

function eventLabel(ev) {
  var payload = ev.payload;
  var text = "";
  if (payload != null) {
    if (typeof payload === "string") text = payload;
    else if (payload.message) text = payload.message;
    else if (payload.note) text = payload.note;
    else {
      try {
        text = JSON.stringify(payload);
      } catch (e) {
        text = "";
      }
    }
  }
  var type = ev.type || ev.kind || "event";
  return text ? type + " · " + text : type;
}

function normalizeTaskDetail(raw) {
  var task = (raw && (raw.task || raw)) || {};
  return {
    events: (raw && (raw.events || raw.task_events)) || task.events || [],
    result_text: task.result_text || "",
    result_summary: task.result_summary || "",
    session_id: task.session_id || task.session || "",
  };
}

function TaskDetail(props) {
  var detail = props.detail;
  return html`
    <${UI.DataState} state=${detail} emptyText="No task detail" compact>
      ${function (raw) {
        var data = normalizeTaskDetail(raw);
        var events = data.events || [];
        var result = data.result_text || data.result_summary || "";
        return html`
          <${UI.Stack} gap="sm">
            <div className="hui-t-micro">EVENT TIMELINE</div>
            ${events.length === 0
              ? html`<div className="hui-t-sub">No events recorded for this task.</div>`
              : html`<${UI.ActivityFeed} items=${events.map(function (ev, i) {
                  return { id: i, at: parseTs(ev.ts) || Date.now(), title: eventLabel(ev), tone: eventTone(ev.type) };
                })} />`}
            ${result
              ? html`<${UI.Stack} gap="sm"><div className="hui-t-micro">RESULT</div><${UI.CodeBlock} maxHeight=${160}>${result}<//><//>`
              : null}
            <${UI.KeyValue} label="Session" value=${data.session_id || "—"} mono copyable=${!!data.session_id} />
          <//>`;
      }}
    <//>`;
}

export function TaskCard(props) {
  var t = props.task;
  var act = props.act;
  var mobile = props.mobile;
  var status = statusMeta(t.status);
  var worker = workerMeta(t.kind);
  var running = t.status === "running";
  var note = t.progress_note || t.result_summary || "";
  var taskControl = useTaskControl();
  var openPair = UI.useState(false);
  var detail = useTaskDetail(!mobile && openPair[0] ? t.id : null);

  var elapsed = null;
  if (t.status === "done") {
    var started = parseTs(t.started);
    var finished = parseTs(t.finished);
    if (started && finished && finished > started) elapsed = "took " + UI.format.duration(finished - started);
  } else {
    var base = parseTs(t.started) || parseTs(t.created) || t.updated_ts;
    if (base) elapsed = html`<${UI.RelTime} at=${base} />`;
  }

  var actions = [];
  if (t.status === "running") actions.push({ label: "Pause", variant: "secondary", run: "pause" });
  if (t.status === "paused") actions.push({ label: "Resume", variant: "primary", run: "resume" });
  if (t.status === "running" || t.status === "paused" || t.status === "queued") actions.push({ label: "Cancel", variant: "danger", run: "cancel" });
  if (t.status === "needs_review") actions.push({ label: "Re-delegate", variant: "primary", run: "resume" });
  if (isTerminalStatus(t.status)) actions.push({ label: "Dismiss", variant: "secondary", run: "dismiss" });

  return html`
    <${UI.Card} padding="sm" tone=${t.status === "needs_review" ? "warn" : undefined}>
      <${UI.Row} justify="between" align="center" gap="sm">
        <${UI.Badge} tone=${status.tone}>${status.label}<//>
        <${UI.Row} gap="sm" align="center">
          <${UI.Badge} tone=${worker.tone} variant="outline" size="sm">${worker.label}<//>
          ${elapsed ? html`<span className="hui-t-num hui-t-micro">${elapsed}</span>` : null}
        <//>
      <//>
      <div className="hui-t-body" style=${{ marginTop: 8, fontWeight: 600 }}>${t.title || t.goal || t.id}</div>
      ${running ? html`<${UI.Meter} indeterminate size="sm" style=${{ marginTop: 8 }} />` : null}
      ${note ? html`<div className="hui-t-sub" style=${{ marginTop: 8 }}>${note}</div>` : null}
      <${UI.Row} gap="sm" style=${{ marginTop: 10 }}>
        ${actions.map(function (a) {
          var pending = taskControl.pending && a.run !== "dismiss";
          return html`
            <${UI.Button} key=${a.label} size=${mobile ? "md" : "sm"} variant=${a.variant} loading=${a.run !== "dismiss" && pending}
              onClick=${function () {
                if (a.run === "dismiss") act.dismissTask(t.id);
                else taskControl.run(t.id, a.run);
              }}>${a.label}<//>`;
        })}
      <//>
      ${!mobile
        ? html`
          <${UI.Disclosure} title="Detail" open=${openPair[0]} onOpenChange=${openPair[1]} className="jv-task-detail">
            ${openPair[0] ? html`<${TaskDetail} detail=${detail} />` : null}
          <//>`
        : null}
    <//>`;
}

export function TaskCardMobile(props) {
  return html`<${TaskCard} task=${props.task} act=${props.act} mobile />`;
}

// ------------------------------------------------------------- activity ----

export function ActivityRows(props) {
  var items = props.items.slice().reverse(); // newest first
  return html`
    <${UI.ActivityFeed} items=${items.map(function (e) {
      return { id: e.id, at: e.ts, title: e.label, tone: e.tone, body: props.verbose ? e.detail : undefined };
    })} />`;
}

function ActivityTab(props) {
  var store = props.store;
  var s = props.s;
  return html`
    <${UI.Stack} gap="sm">
      <${UI.Row} justify="between" align="center">
        <${UI.Button} size="sm" variant=${s.verbose ? "primary" : "secondary"} aria-pressed=${s.verbose}
          onClick=${function () { store.set({ verbose: !s.verbose }); }}>
          ${s.verbose ? "Trace detail: on" : "Trace detail: off"}
        <//>
        <span className="hui-t-num hui-t-micro">${UI.format.plural(s.timeline.length, "event")}</span>
      <//>
      ${s.timeline.length === 0
        ? html`<${UI.EmptyState} compact icon="activity" title="Nothing yet this session" />`
        : html`<${ActivityRows} items=${s.timeline} verbose=${s.verbose} />`}
    <//>`;
}

// --------------------------------------------------------------- system ----

var LATENCY_STAGES = [
  ["stt", "stt final"],
  ["mediator_first_token", "mediator first token"],
  ["tts_first_chunk", "tts first chunk"],
  ["e2e_first_audio", "end-to-end first audio"],
];

function SystemTab(props) {
  var s = props.s;
  var act = props.act;
  var health = s.health || {};
  var components = health.components || {};
  var names = Object.keys(components);
  var models = health.models || {};
  var ram = health.ram || {};
  var freeGb = typeof ram.free_gb === "number" ? ram.free_gb : null;
  var totalGb = typeof ram.total_gb === "number" ? ram.total_gb : null;

  return html`
    <${UI.Stack} gap="sm">
      <${UI.Card} title="Component health" padding="sm">
        ${names.length === 0
          ? html`<${UI.EmptyState} compact title="Waiting for /health…" />`
          : html`<${UI.List} dense items=${names.map(function (name) {
              var c = components[name] || {};
              return {
                id: name,
                leading: html`<${UI.StatusDot} tone=${c.ok ? "accent" : "danger"} />`,
                title: name,
                description: c.detail || "",
                trailing: html`<${UI.Badge} tone=${c.ok ? "ok" : "danger"} size="sm">${c.ok ? "OK" : "ERR"}<//>`,
              };
            })} />`}
      <//>
      <${UI.Card} title="Latency · last 20 turns" padding="sm">
        <${UI.Stack} gap="md">
          ${LATENCY_STAGES.map(function (stage) {
            var key = stage[0];
            var lat = s.latency[key];
            var series = act.getSeries(key);
            return html`
              <div key=${key}>
                <${UI.Row} justify="between" align="baseline">
                  <span className="hui-t-sub" style=${{ flex: 1 }}>${stage[1]}</span>
                  <span className="hui-t-num">${lat && lat.p50 != null ? lat.p50 + " ms" : "—"}</span>
                  <span className="hui-t-num hui-t-faint">${lat && lat.p95 != null ? lat.p95 + " ms" : "—"}</span>
                <//>
                <${UI.Sparkline} data=${series} height=${18} tone=${key === "e2e_first_audio" ? "accent" : false} />
              </div>`;
          })}
        <//>
      <//>
      <${UI.Card} title="Residency & memory" padding="sm">
        <${UI.Stack} gap="sm">
          <${UI.KVList} items=${["mediator", "worker"].map(function (role) {
            var m = models[role] || {};
            return { label: role, value: (m.name || role + " —") + (m.resident ? " · resident" : " · on demand") };
          })} />
          <${UI.Meter}
            label="Unified memory"
            value=${freeGb != null && totalGb ? totalGb - freeGb : 0}
            max=${totalGb || 1}
            indeterminate=${freeGb == null || !totalGb}
            valueText=${freeGb == null ? "—" : freeGb.toFixed(1) + " GB free" + (totalGb ? " / " + totalGb + " GB" : "")} />
        <//>
      <//>
      <${UI.KpiRow} size="sm" items=${[
        { label: "Barge-ins", value: s.bargeIns, sub: "this session" },
        { label: "Errors", value: s.errCount, sub: "recoverable" },
      ]} />
    <//>`;
}

// --------------------------------------------------------------- column ----

export function WorkColumn(props) {
  var store = props.store;
  var act = props.act;
  var s = useStore(store);
  var tasksEp = useTasks();
  var showLeft = props.showLeft; // dedicated memory column visible (>=1280)

  var notices = noticeSummary(s);
  var tabs = [
    { id: "work", label: html`<${UI.Row} gap="sm" align="center"><${NoticeDot} tone=${notices.tone} /><span>Work</span><//>`, badge: countOpenTasks(tasksEp.tasks) || undefined },
    { id: "activity", label: "Activity", badge: s.timeline.length || undefined },
  ];
  if (!showLeft) tabs.push({ id: "memory", label: "Memory", badge: (s.memoryHits || []).length || undefined });
  tabs.push({ id: "system", label: "System" });

  // if the memory tab was active and the column re-appears, fall back to work
  // (display-only override; store.tab itself only changes on a real click)
  var tab = showLeft && s.tab === "memory" ? "work" : s.tab;

  var tasks = visibleTasks(tasksEp.tasks, s.dismissedTasks);

  return html`
    <div style=${{ minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--hui-line)" }}>
      <${UI.Tabs} className="jv-work-tabs" items=${tabs} value=${tab} onChange=${function (id) { store.set({ tab: id }); }}
        ariaLabel="Work panels" idPrefix="jv-work" />
      <${UI.ScrollArea} style=${{ flex: 1, minHeight: 0, padding: "10px 14px 14px" }}>
        <${UI.TabPanel} when="work" value=${tab} idPrefix="jv-work">
          <${UI.ErrorBoundary}>
            <${UI.Stack} gap="sm">
              <${WorkToolbar} s=${s} act=${act} tasks=${tasks} />
              <${NoticeRows} s=${s} act=${act} />
              <${UI.DataState} state=${tasksEp} empty=${function () { return tasks.length === 0 && !notices.count; }}
                emptyText="No tasks yet. Delegate something.">
                ${function () { return html`<${UI.AnimatedList} items=${tasks} getKey=${function (t) { return t.id; }}>
                  ${function (t) { return html`<${TaskCard} task=${t} act=${act} />`; }}
                <//>`; }}
              <//>
            <//>
          <//>
        <//>
        <${UI.TabPanel} when="activity" value=${tab} idPrefix="jv-work">
          <${UI.ErrorBoundary}><${ActivityTab} store=${store} s=${s} /><//>
        <//>
        ${!showLeft
          ? html`<${UI.TabPanel} when="memory" value=${tab} idPrefix="jv-work"><${UI.ErrorBoundary}><${MemoryPanel} store=${store} fill /><//><//>`
          : null}
        <${UI.TabPanel} when="system" value=${tab} idPrefix="jv-work">
          <${UI.ErrorBoundary}><${SystemTab} s=${s} act=${act} /><//>
        <//>
      <//>
    </div>`;
}

// Bulk clear row: finished tasks and/or all notices, with Undo.
var FINISHED = { done: 1, failed: 1, error: 1, cancelled: 1, canceled: 1, completed: 1 };
export function WorkToolbar(props) {
  var s = props.s, act = props.act;
  var notices = visibleNotices(s);
  var finished = (props.tasks || []).filter(function (t) { return FINISHED[t.status]; });
  if (!notices.length && !finished.length) return null;
  function clear(noticeIds, taskIds, what) {
    var restore = act.clearWork(noticeIds, taskIds);
    UI.toast.success("Cleared " + what, { action: { label: "Undo", onClick: restore }, duration: 6000 });
  }
  var allNotices = notices.map(function (n) { return n.id; });
  var allFinished = finished.map(function (t) { return t.id; });
  var items = [];
  if (finished.length) items.push({ id: "fin", icon: "check", label: "Clear finished tasks (" + finished.length + ")", onSelect: function () { clear([], allFinished, UI.format.plural(finished.length, "finished task")); } });
  if (notices.length) items.push({ id: "not", icon: "bell", label: "Clear notifications (" + notices.length + ")", onSelect: function () { clear(allNotices, [], UI.format.plural(notices.length, "notification")); } });
  if (notices.length && finished.length) {
    items.push({ separator: true });
    items.push({ id: "all", icon: "trash", danger: true, label: "Clear all", onSelect: function () { clear(allNotices, allFinished, "everything"); } });
  }
  return html`
    <${UI.Row} gap="sm" align="center" justify="between" wrap=${false}>
      <span className="hui-t-micro">
        ${[notices.length ? UI.format.plural(notices.length, "notification") : null, finished.length ? finished.length + " finished" : null].filter(Boolean).join(" · ")}
      </span>
      <${UI.Row} gap="xs" align="center" wrap=${false}>
        ${finished.length ? html`<${UI.Button} size="sm" variant="secondary" icon="check"
          title="Hide every done, failed or cancelled task"
          onClick=${function () { clear([], allFinished, UI.format.plural(finished.length, "finished task")); }}>Clear finished (${finished.length})<//>` : null}
        <${UI.Menu} placement="bottom" align="end" items=${items}
          trigger=${html`<${UI.IconButton} size="sm" variant="ghost" icon="more-horizontal" label="More clear options" />`} />
      <//>
    <//>`;
}
