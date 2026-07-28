// components/work.js — right column: tabbed Work / Activity / System (plus
// Memory as a 4th tab when the dedicated column is folded at 860–1279px).
// Ported from the prototype's right column: status-weighted task cards with
// worker identity, live elapsed, honest progress notes, pause/resume/cancel,
// expandable event timeline + result; readable activity stream with a trace
// detail toggle; system health chips, per-stage latency sparklines (client
// rolling buffer), model residency + RAM.
import { h } from "../h.js";
import { useStore } from "../store.js";
import {
  cls,
  fmtDur,
  fmtClock,
  parseTs,
  statusChip,
  workerTag,
  toneIconClass,
  toneRowClass,
  sparkPoints,
  visibleTasks,
  countOpenTasks,
  BTN,
  BTN_PRIMARY,
  BTN_DANGER,
  BTN_WARN,
  MICRO_LABEL,
  taskElapsedSec,
} from "./util.js";
import { MemoryPanel } from "./memory.js";

// ---------------------------------------------------------------- tasks ----

function taskElapsedLabel(t) {
  if (t.status === "done") {
    var started = parseTs(t.started);
    var finished = parseTs(t.finished);
    if (started && finished && finished > started) return "took " + fmtDur((finished - started) / 1000);
    return "";
  }
  var sec = taskElapsedSec(t);
  if (sec == null) return "";
  return fmtDur(sec);
}

function eventTone(type) {
  var v = String(type || "").toLowerCase();
  if (v.indexOf("error") >= 0 || v.indexOf("fail") >= 0) return "red";
  if (v.indexOf("review") >= 0 || v.indexOf("cancel") >= 0 || v.indexOf("warn") >= 0 || v.indexOf("restart") >= 0) return "amber";
  if (v.indexOf("progress") >= 0 || v.indexOf("log") >= 0) return "dim";
  return "cyan";
}

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

function TaskEvents(props) {
  var detail = props.detail;
  if (!detail || detail.loading) {
    return h("div", { className: "text-[11px] text-faint" }, "Loading events…");
  }
  if (detail.error) {
    return h("div", { className: "text-[11px] text-warn" }, "Couldn't load task detail — " + detail.error);
  }
  var events = detail.events || [];
  var result = detail.result_text || detail.result_summary || "";
  return h(
    "div",
    { className: "flex flex-col gap-2" },
    h("div", { className: MICRO_LABEL }, "EVENT TIMELINE"),
    events.length === 0
      ? h("div", { className: "text-[11px] text-faint" }, "No events recorded for this task.")
      : events.map(function (ev, i) {
          var tone = eventTone(ev.type);
          var ts = parseTs(ev.ts);
          return h(
            "div",
            { key: "ev" + i, className: "grid grid-cols-[52px_10px_minmax(0,1fr)] gap-2 items-start" },
            h("div", { className: "text-[10px] font-mono text-micro" }, ts ? fmtClock(ts) : String(ev.ts || "")),
            h("div", {
              className: cls(
                "w-[5px] h-[5px] mt-[5px] rounded-full",
                tone === "amber" ? "bg-warn" : tone === "red" ? "bg-danger" : tone === "cyan" ? "bg-accent" : "bg-[rgba(120,190,200,.35)]"
              ),
            }),
            h("div", { className: "text-[11px] leading-[1.45] text-dim text-pretty break-words" }, eventLabel(ev))
          );
        }),
    result
      ? h(
          "div",
          null,
          h("div", { className: MICRO_LABEL + " mt-[2px]" }, "RESULT"),
          h(
            "div",
            {
              className:
                "mt-[6px] px-[9px] py-[7px] rounded-sm bg-[rgba(6,10,12,.7)] border border-[rgba(120,190,200,.1)] text-[10px] font-mono text-faint leading-[1.55] whitespace-pre-wrap break-words max-h-40 overflow-y-auto",
            },
            result
          )
        )
      : null,
    h("div", { className: MICRO_LABEL + " mt-[2px]" }, "SESSION"),
    h("div", { className: "text-[10px] font-mono text-faint break-all" }, detail.session_id || "—")
  );
}

export function TaskCard(props) {
  var t = props.task;
  var s = props.s;
  var act = props.act;
  var chip = statusChip(t.status);
  var tag = workerTag(t.kind);
  var expanded = s.expandedTask === t.id;
  var running = t.status === "running";
  var dimmed = t.status === "canceled" || t.status === "failed";
  var elapsed = taskElapsedLabel(t);
  var note = t.progress_note || t.result_summary || "";

  var actions = [];
  if (t.status === "running") actions.push(["Pause", BTN, "pause"]);
  if (t.status === "paused") actions.push(["Resume", BTN_PRIMARY, "resume"]);
  if (t.status === "running" || t.status === "paused" || t.status === "queued") actions.push(["Cancel", BTN_DANGER, "cancel"]);
  if (t.status === "needs_review") {
    actions.push(["Re-delegate", BTN_WARN, "resume"]);
    actions.push(["Dismiss", BTN, "dismiss"]);
  }
  // done/failed cards have nothing left to do but be cleared — "dismiss" is
  // a pseudo-action (act.dismissTask, client-side only) handled separately
  // from the real backend task-control actions above (see the click handler
  // below and app.js's dismissedTasks store key).
  if (t.status === "done" || t.status === "failed") {
    actions.push(["Dismiss", BTN, "dismiss"]);
  }

  return h(
    "div",
    {
      className: cls(
        "p-[13px] rounded-md border jv-rise",
        t.status === "needs_review"
          ? "border-[rgba(242,179,92,.28)] bg-[rgba(11,17,20,.7)]"
          : running
            ? "border-[rgba(79,227,224,.24)] bg-[rgba(11,20,23,.85)]"
            : "border-[rgba(120,190,200,.11)] bg-[rgba(11,17,20,.7)]",
        dimmed ? "opacity-60" : ""
      ),
    },
    h(
      "div",
      { className: "flex items-center gap-2" },
      h("div", { className: chip.className }, chip.label),
      h("div", { className: "flex-1" }),
      h("div", { className: tag.className }, tag.label),
      elapsed ? h("div", { className: "text-[10px] font-mono text-micro" }, elapsed) : null
    ),
    h("div", { className: "mt-2 text-[13px] font-semibold leading-[1.4] text-text text-pretty" }, t.title || t.goal || t.id),
    running
      ? h(
          "div",
          { className: "mt-[9px] h-[2px] rounded-[2px] bg-[rgba(120,190,200,.1)] overflow-hidden relative" },
          // task.update carries no numeric progress fraction — indeterminate
          // sweep, purely a "this is running" signal (see ui/README.md)
          h("div", { className: "jv-indeterminate absolute inset-y-0 w-2/5 rounded-[2px] bg-gradient-to-r from-accent-deep to-accent" })
        )
      : null,
    note ? h("div", { className: "mt-2 text-[12px] leading-normal text-dim text-pretty" }, note) : null,
    h(
      "div",
      { className: "mt-[10px] flex items-center gap-[6px]" },
      actions.map(function (a) {
        return h(
          "button",
          {
            key: a[0],
            className: a[1],
            "aria-label": a[0] + " task " + (t.title || t.id),
            onClick: function () {
              if (a[2] === "dismiss") act.dismissTask(t.id);
              else act.taskControl(t.id, a[2]);
            },
          },
          a[0]
        );
      }),
      h("div", { className: "flex-1" }),
      h(
        "button",
        {
          className:
            "h-[26px] px-[9px] rounded-sm border border-[rgba(120,190,200,.14)] bg-transparent text-faint text-[10px] tracking-[.06em] cursor-pointer hover:text-text hover:border-[rgba(79,227,224,.35)]",
          "aria-label": "Toggle task detail",
          "aria-expanded": expanded,
          onClick: function () {
            act.toggleTaskDetail(t.id);
          },
        },
        expanded ? "Hide detail" : "Detail"
      )
    ),
    expanded
      ? h(
          "div",
          { className: "mt-[11px] pt-[11px] border-t border-[rgba(120,190,200,.1)]" },
          h(TaskEvents, { detail: s.taskDetail[t.id] })
        )
      : null
  );
}

// Compact task card for the mobile Tasks sheet (≥44px touch targets).
export function TaskCardMobile(props) {
  var t = props.task;
  var act = props.act;
  var chip = statusChip(t.status);
  var tag = workerTag(t.kind);
  var elapsed = taskElapsedLabel(t);
  var note = t.progress_note || t.result_summary || "";
  var actions = [];
  if (t.status === "running") actions.push(["Pause", BTN, "pause"]);
  if (t.status === "paused") actions.push(["Resume", BTN_PRIMARY, "resume"]);
  if (t.status === "running" || t.status === "paused" || t.status === "queued") actions.push(["Cancel", BTN_DANGER, "cancel"]);
  if (t.status === "needs_review") {
    actions.push(["Re-delegate", BTN_WARN, "resume"]);
    actions.push(["Dismiss", BTN, "dismiss"]);
  }
  if (t.status === "done" || t.status === "failed") {
    actions.push(["Dismiss", BTN, "dismiss"]);
  }
  return h(
    "div",
    { className: "p-[13px] rounded-md border border-[rgba(120,190,200,.11)] bg-[rgba(11,17,20,.7)]" },
    h(
      "div",
      { className: "flex items-center gap-2" },
      h("div", { className: chip.className }, chip.label),
      h("div", { className: "flex-1" }),
      h("div", { className: tag.className }, tag.label),
      elapsed ? h("div", { className: "text-[10px] font-mono text-micro" }, elapsed) : null
    ),
    h("div", { className: "mt-2 text-[14px] font-semibold leading-[1.4] text-text" }, t.title || t.goal || t.id),
    note ? h("div", { className: "mt-[6px] text-[13px] leading-normal text-dim" }, note) : null,
    actions.length
      ? h(
          "div",
          { className: "mt-[11px] flex items-center gap-[7px]" },
          actions.map(function (a) {
            return h(
              "button",
              {
                key: a[0],
                className: a[1] + " !h-11 !px-[14px] !text-[13px]",
                "aria-label": a[0] + " task " + (t.title || t.id),
                onClick: function () {
                  if (a[2] === "dismiss") act.dismissTask(t.id);
                  else act.taskControl(t.id, a[2]);
                },
              },
              a[0]
            );
          })
        )
      : null
  );
}

// ------------------------------------------------------------- activity ----

export function ActivityRows(props) {
  var items = props.items.slice().reverse(); // newest first
  var verbose = props.verbose;
  return items.map(function (e) {
    return h(
      "div",
      { key: e.id, className: cls("px-2 py-[7px] rounded-[7px]", toneRowClass(e.tone)) },
      h(
        "div",
        { className: "grid grid-cols-[56px_14px_minmax(0,1fr)] gap-[9px] items-start" },
        h("div", { className: "text-[10px] font-mono text-micro pt-px" }, fmtClock(e.ts)),
        h("div", { className: cls("text-[10px] pt-[2px]", toneIconClass(e.tone)) }, e.icon || "•"),
        h(
          "div",
          { className: "min-w-0" },
          h("div", { className: "text-[12px] leading-[1.45] text-[#C8DBDE] text-pretty break-words" }, e.label),
          verbose && e.detail
            ? h(
                "div",
                {
                  className:
                    "mt-[5px] px-[9px] py-[7px] rounded-sm bg-[rgba(6,10,12,.7)] border border-[rgba(120,190,200,.1)] text-[10px] font-mono text-faint leading-[1.55] whitespace-pre-wrap break-words",
                },
                e.detail
              )
            : null
        )
      )
    );
  });
}

function ActivityTab(props) {
  var store = props.store;
  var s = props.s;
  return h(
    "div",
    { className: "flex flex-col gap-[9px]" },
    h(
      "div",
      { className: "flex items-center gap-2 px-[2px] pb-[6px] pt-[2px]" },
      h(
        "button",
        {
          className: cls(
            "h-[26px] px-[10px] rounded-sm border text-[10px] tracking-[.08em] cursor-pointer",
            s.verbose
              ? "border-[rgba(79,227,224,.34)] bg-[rgba(79,227,224,.1)] text-accent-soft"
              : "border-[rgba(120,190,200,.16)] bg-transparent text-faint hover:border-[rgba(79,227,224,.4)]"
          ),
          "aria-label": "Toggle trace detail",
          "aria-pressed": s.verbose,
          onClick: function () {
            store.set({ verbose: !s.verbose });
          },
        },
        s.verbose ? "TRACE DETAIL: ON" : "TRACE DETAIL: OFF"
      ),
      h("div", { className: "flex-1" }),
      h("div", { className: "text-[10px] font-mono text-micro" }, s.timeline.length + " events")
    ),
    s.timeline.length === 0
      ? h("div", { className: "text-[12px] text-faint px-1 py-2" }, "Nothing yet this session.")
      : h(ActivityRows, { items: s.timeline, verbose: s.verbose })
  );
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

  var card = "p-[13px] rounded-md border border-[rgba(120,190,200,.11)] bg-[rgba(11,17,20,.7)]";

  return h(
    "div",
    { className: "flex flex-col gap-[9px]" },
    h(
      "div",
      { className: card },
      h("div", { className: MICRO_LABEL }, "COMPONENT HEALTH"),
      h(
        "div",
        { className: "mt-[10px] flex flex-col gap-[7px]" },
        names.length === 0
          ? h("div", { className: "text-[11px] text-faint" }, "Waiting for /health…")
          : names.map(function (name) {
              var c = components[name] || {};
              var ok = !!c.ok;
              return h(
                "div",
                { key: name, className: "flex items-center gap-[9px]" },
                h("div", {
                  className: cls("w-[6px] h-[6px] rounded-full flex-none", ok ? "bg-accent shadow-bloom" : "bg-danger"),
                }),
                h("div", { className: "text-[12px] text-[#C8DBDE] w-[76px]" }, name),
                h(
                  "div",
                  { className: "flex-1 min-w-0 text-[11px] font-mono text-micro overflow-hidden text-ellipsis whitespace-nowrap" },
                  c.detail || ""
                ),
                h("div", { className: cls("text-[9px] tracking-[.1em]", ok ? "text-micro" : "text-[#FF8F8F]") }, ok ? "OK" : "ERR")
              );
            })
      )
    ),
    h(
      "div",
      { className: card },
      h(
        "div",
        { className: "flex items-center gap-2" },
        h("div", { className: MICRO_LABEL }, "LATENCY · LAST 20 TURNS"),
        h("div", { className: "flex-1" }),
        h("div", { className: "text-[9px] tracking-[.1em] text-micro" }, "p50 / p95")
      ),
      h(
        "div",
        { className: "mt-[11px] flex flex-col gap-[11px]" },
        LATENCY_STAGES.map(function (stage) {
          var key = stage[0];
          var lat = s.latency[key];
          var series = act.getSeries(key);
          var points = sparkPoints(series);
          return h(
            "div",
            { key: key },
            h(
              "div",
              { className: "flex items-baseline gap-2" },
              h("div", { className: "text-[11px] text-[#C8DBDE] flex-1" }, stage[1]),
              h("div", { className: "text-[11px] font-mono text-text" }, lat && lat.p50 != null ? lat.p50 + " ms" : "—"),
              h("div", { className: "text-[11px] font-mono text-faint" }, lat && lat.p95 != null ? lat.p95 + " ms" : "—")
            ),
            h(
              "svg",
              {
                viewBox: "0 0 100 18",
                preserveAspectRatio: "none",
                className: "block w-full h-[18px] mt-[5px] overflow-visible",
                "aria-hidden": "true",
              },
              points
                ? h("polyline", {
                    points: points,
                    fill: "none",
                    stroke: key === "e2e_first_audio" ? "var(--jv-accent)" : "rgba(120,190,200,0.55)",
                    strokeWidth: "1.1",
                    vectorEffect: "non-scaling-stroke",
                  })
                : null,
              h("line", { x1: "0", y1: "17.5", x2: "100", y2: "17.5", stroke: "rgba(120,190,200,0.1)", strokeWidth: "1", vectorEffect: "non-scaling-stroke" })
            )
          );
        })
      )
    ),
    h(
      "div",
      { className: card },
      h("div", { className: MICRO_LABEL }, "RESIDENCY & MEMORY"),
      h(
        "div",
        { className: "mt-[11px] flex flex-col gap-[9px]" },
        ["mediator", "worker"].map(function (role) {
          var m = models[role] || {};
          return h(
            "div",
            { key: role, className: "flex items-center gap-[9px]" },
            h("div", { className: "text-[11px] font-mono text-[#C8DBDE] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" }, m.name || role + " —"),
            h(
              "div",
              { className: cls("text-[10px] tracking-[.08em]", m.resident ? "text-accent" : "text-micro") },
              m.resident ? "RESIDENT" : "ON DEMAND"
            )
          );
        }),
        h(
          "div",
          { className: "mt-[2px]" },
          h(
            "div",
            { className: "flex items-baseline gap-2" },
            h("div", { className: "text-[11px] text-[#C8DBDE] flex-1" }, "Unified memory"),
            h(
              "div",
              { className: "text-[11px] font-mono text-text" },
              freeGb == null ? "—" : freeGb.toFixed(1) + " GB free" + (totalGb ? " / " + totalGb + " GB" : "")
            )
          ),
          freeGb != null && totalGb
            ? h(
                "div",
                { className: "mt-[6px] h-1 rounded-[2px] bg-[rgba(120,190,200,.1)] overflow-hidden" },
                h("div", {
                  className: "h-full rounded-[2px] bg-gradient-to-r from-accent-deep to-accent",
                  style: { width: Math.round(((totalGb - freeGb) / totalGb) * 100) + "%" },
                })
              )
            : null
        )
      )
    ),
    h(
      "div",
      { className: "grid grid-cols-2 gap-[9px]" },
      h(
        "div",
        { className: "px-[13px] py-3 rounded-md border border-[rgba(120,190,200,.11)] bg-[rgba(11,17,20,.7)]" },
        h("div", { className: MICRO_LABEL }, "BARGE-INS"),
        h("div", { className: "mt-[7px] text-[22px] font-semibold font-mono text-text" }, String(s.bargeIns)),
        h("div", { className: "mt-[3px] text-[10px] text-faint" }, "this session")
      ),
      h(
        "div",
        { className: "px-[13px] py-3 rounded-md border border-[rgba(120,190,200,.11)] bg-[rgba(11,17,20,.7)]" },
        h("div", { className: MICRO_LABEL }, "ERRORS"),
        h("div", { className: "mt-[7px] text-[22px] font-semibold font-mono text-text" }, String(s.errCount)),
        h("div", { className: "mt-[3px] text-[10px] text-faint" }, "recoverable")
      )
    )
  );
}

// --------------------------------------------------------------- column ----

export function WorkColumn(props) {
  var store = props.store;
  var act = props.act;
  var s = useStore(store);
  var showLeft = props.showLeft; // dedicated memory column visible (≥1280)

  var tabDef = [
    ["work", "Work", String(countOpenTasks(s.tasks) || "")],
    ["activity", "Activity", String(s.timeline.length || "")],
  ];
  if (!showLeft) tabDef.push(["memory", "Memory", String((s.memoryHits || []).length || "")]);
  tabDef.push(["system", "System", ""]);

  // if the memory tab was active and the column re-appears, fall back to work
  var tab = showLeft && s.tab === "memory" ? "work" : s.tab;

  var tasks = visibleTasks(s.tasks, s.dismissedTasks);

  return h(
    "div",
    {
      className:
        "min-h-0 flex flex-col border-l border-[rgba(120,190,200,.09)] bg-gradient-to-b from-[rgba(10,16,19,.6)] to-[rgba(7,10,12,.2)]",
    },
    h(
      "div",
      { className: "flex-none flex items-center gap-[2px] px-[14px] pt-3 pb-[10px]", role: "tablist", "aria-label": "Work panels" },
      tabDef.map(function (def) {
        var key = def[0];
        var active = tab === key;
        return h(
          "button",
          {
            key: key,
            role: "tab",
            "aria-selected": active,
            "aria-label": def[1] + " panel",
            className: cls(
              "inline-flex items-center gap-[7px] h-[30px] px-3 rounded-[6px] border text-[12px] cursor-pointer",
              active
                ? "border-[rgba(79,227,224,.3)] bg-[rgba(79,227,224,.09)] text-text font-semibold"
                : "border-transparent bg-transparent text-[#7FA0A5] hover:text-text"
            ),
            onClick: function () {
              store.set({ tab: key });
            },
          },
          def[1],
          def[2] ? h("span", { className: cls("text-[10px] font-mono", active ? "text-accent" : "text-micro") }, def[2]) : null
        );
      })
    ),
    h(
      "div",
      { className: "flex-1 min-h-0 overflow-y-auto px-[14px] pb-[14px] pt-[2px] flex flex-col gap-[9px]" },
      tab === "work"
        ? tasks.length === 0
          ? h("div", { className: "text-[12px] text-faint px-1 py-2" }, "No tasks yet. Delegate something.")
          : tasks.map(function (t) {
              return h(TaskCard, { key: t.id, task: t, s: s, act: act });
            })
        : null,
      tab === "activity" ? h(ActivityTab, { store: store, s: s }) : null,
      tab === "memory" && !showLeft ? h(MemoryPanel, { store: store, fill: true }) : null,
      tab === "system" ? h(SystemTab, { s: s, act: act }) : null
    )
  );
}
