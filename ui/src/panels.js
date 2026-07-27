// panels.js — right column (Activity timeline / Tasks board / Memory
// sources / Health), the settings popover, and the bottom text-input
// fallback. Everything here reads from the `store` (low-frequency app
// state) via useStore — none of it touches the visualizer directly.
import { h } from "./h.js";
import { getHooks } from "./sdk.js";
import { useStore } from "./store.js";
import { authedFetch } from "./sdk.js";

function useHooks() {
  return getHooks();
}

export function ConnectionBadge(props) {
  var status = props.status;
  var label = { open: "connected", connecting: "connecting…", reconnecting: "reconnecting…" }[status] || "offline";
  var cls = "jv-badge jv-badge--" + (status === "open" ? "ok" : status === "connecting" ? "info" : "warn");
  return h("span", { className: cls }, h("span", { className: "jv-badge-dot" }), label);
}

export function OfflineOverlay(props) {
  if (!props.visible) return null;
  return h(
    "div",
    { className: "jv-overlay" },
    h(
      "div",
      { className: "jv-overlay-card" },
      h("div", { className: "jv-overlay-title" }, "Jarvis service offline"),
      h("div", { className: "jv-overlay-sub" }, "Can't reach jarvisd through the dashboard proxy. Retrying automatically."),
      h("button", { className: "jv-btn jv-btn--primary", onClick: props.onRetry }, "Retry now")
    )
  );
}

export function TextInputBar(props) {
  var hooks = useHooks();
  var useState = hooks.useState;
  var s = useState("");
  var text = s[0];
  var setText = s[1];

  function submit() {
    var trimmed = text.trim();
    if (!trimmed) return;
    props.onSubmit(trimmed);
    setText("");
  }

  return h(
    "div",
    { className: "jv-textbar" },
    h("input", {
      className: "jv-textbar-input",
      type: "text",
      placeholder: "Type to Jarvis…",
      value: text,
      onChange: function (e) {
        setText(e.target.value);
      },
      onKeyDown: function (e) {
        if (e.key === "Enter") submit();
      },
    }),
    h("button", { className: "jv-btn", onClick: submit }, "Send")
  );
}

function fmtTime(ts) {
  var d = new Date(ts || Date.now());
  var hh = String(d.getHours()).padStart(2, "0");
  var mm = String(d.getMinutes()).padStart(2, "0");
  var ss = String(d.getSeconds()).padStart(2, "0");
  return hh + ":" + mm + ":" + ss;
}

function TimelineRow(props) {
  var hooks = useHooks();
  var useState = hooks.useState;
  var s = useState(false);
  var open = s[0];
  var setOpen = s[1];
  var item = props.item;

  return h(
    "div",
    { className: "jv-timeline-row" },
    h(
      "div",
      {
        className: "jv-timeline-head" + (item.expandable ? " jv-clickable" : ""),
        onClick: item.expandable
          ? function () {
              setOpen(!open);
            }
          : undefined,
      },
      h("span", { className: "jv-timeline-ts" }, fmtTime(item.ts)),
      h("span", { className: "jv-timeline-icon" }, item.icon || "•"),
      h("span", { className: "jv-timeline-label" }, item.label),
      item.expandable ? h("span", { className: "jv-timeline-chevron" }, open ? "▾" : "▸") : null
    ),
    open && item.details
      ? h("pre", { className: "jv-timeline-details" }, JSON.stringify(item.details, null, 2))
      : null
  );
}

export function ActivityTimeline(props) {
  var items = props.items;
  return h(
    "div",
    { className: "jv-panel" },
    h("div", { className: "jv-panel-title" }, "Activity"),
    h(
      "div",
      { className: "jv-timeline" },
      items.length === 0
        ? h("div", { className: "jv-empty" }, "No activity yet")
        : items
            .slice()
            .reverse()
            .map(function (item) {
              return h(TimelineRow, { key: item.id, item: item });
            })
    )
  );
}

var STATUS_LABEL = {
  queued: "queued",
  running: "running",
  paused: "paused",
  canceled: "canceled",
  done: "done",
  failed: "failed",
  needs_review: "needs review",
};

function TaskRow(props) {
  var t = props.task;
  function control(action) {
    authedFetch("/tasks/" + encodeURIComponent(t.id) + "/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action }),
    }).catch(function () {
      /* connection errors surface via the ConnectionBadge/overlay already */
    });
  }
  var canPause = t.status === "running";
  var canResume = t.status === "paused";
  var canCancel = t.status === "running" || t.status === "paused" || t.status === "queued";

  return h(
    "div",
    { className: "jv-task-row" },
    h(
      "div",
      { className: "jv-task-main" },
      h("span", { className: "jv-chip jv-chip--" + (t.status || "queued") }, STATUS_LABEL[t.status] || t.status),
      h("span", { className: "jv-task-title" }, t.title || t.goal || t.id),
      h("span", { className: "jv-task-kind" }, t.kind || "")
    ),
    t.progress_note ? h("div", { className: "jv-task-note" }, t.progress_note) : null,
    t.result_summary ? h("div", { className: "jv-task-note" }, t.result_summary) : null,
    h(
      "div",
      { className: "jv-task-controls" },
      canPause ? h("button", { className: "jv-btn jv-btn--tiny", onClick: function () { control("pause"); } }, "Pause") : null,
      canResume ? h("button", { className: "jv-btn jv-btn--tiny", onClick: function () { control("resume"); } }, "Resume") : null,
      canCancel ? h("button", { className: "jv-btn jv-btn--tiny jv-btn--danger", onClick: function () { control("cancel"); } }, "Cancel") : null
    )
  );
}

export function TasksBoard(props) {
  var tasks = Object.values(props.tasks || {}).sort(function (a, b) {
    return (b.updated_ts || 0) - (a.updated_ts || 0);
  });
  return h(
    "div",
    { className: "jv-panel" },
    h("div", { className: "jv-panel-title" }, "Tasks"),
    tasks.length === 0
      ? h("div", { className: "jv-empty" }, "No tasks")
      : tasks.map(function (t) {
          return h(TaskRow, { key: t.id, task: t });
        })
  );
}

export function MemorySources(props) {
  var items = props.items || [];
  return h(
    "div",
    { className: "jv-panel" },
    h("div", { className: "jv-panel-title" }, "Memory sources"),
    items.length === 0
      ? h("div", { className: "jv-empty" }, "No memory hits yet")
      : items.map(function (m, i) {
          return h(
            "div",
            { className: "jv-memory-row", key: i },
            h("div", { className: "jv-memory-title" }, m.title || m.path),
            h("div", { className: "jv-memory-path" }, m.path)
          );
        })
  );
}

function HealthChip(props) {
  var ok = props.ok;
  return h(
    "span",
    { className: "jv-chip jv-chip--" + (ok ? "done" : "failed") },
    props.name + (props.detail ? " (" + props.detail + ")" : "")
  );
}

export function HealthPanel(props) {
  var health = props.health;
  var latency = props.latency || {};
  var components = (health && health.components) || {};
  var names = Object.keys(components);

  return h(
    "div",
    { className: "jv-panel" },
    h("div", { className: "jv-panel-title" }, "Health"),
    !health
      ? h("div", { className: "jv-empty" }, "Waiting for /health…")
      : h(
          "div",
          { className: "jv-health-chips" },
          names.length === 0
            ? h("div", { className: "jv-empty" }, "No component detail")
            : names.map(function (name) {
                var c = components[name] || {};
                return h(HealthChip, { key: name, name: name, ok: !!c.ok, detail: c.detail });
              })
        ),
    h(
      "div",
      { className: "jv-latency" },
      Object.keys(latency).length === 0
        ? h("div", { className: "jv-empty" }, "No latency samples yet")
        : Object.keys(latency).map(function (stage) {
            var v = latency[stage];
            return h(
              "div",
              { className: "jv-latency-row", key: stage },
              h("span", { className: "jv-latency-stage" }, stage),
              h("span", { className: "jv-latency-value" }, "p50 " + (v.p50 == null ? "—" : v.p50 + "ms")),
              h("span", { className: "jv-latency-value" }, "p95 " + (v.p95 == null ? "—" : v.p95 + "ms"))
            );
          })
    )
  );
}

export function RightColumn(props) {
  var store = props.store;
  var s = useStore(store);

  if (s.rightCollapsed) {
    return h(
      "div",
      { className: "jv-rightcol jv-rightcol--collapsed" },
      h(
        "button",
        {
          className: "jv-collapse-btn",
          onClick: function () {
            store.set({ rightCollapsed: false });
          },
          title: "Expand panels",
        },
        "◂"
      )
    );
  }

  return h(
    "div",
    { className: "jv-rightcol" },
    h(
      "button",
      {
        className: "jv-collapse-btn",
        onClick: function () {
          store.set({ rightCollapsed: true });
        },
        title: "Collapse panels",
      },
      "▸"
    ),
    h(ActivityTimeline, { items: s.timeline }),
    h(TasksBoard, { tasks: s.tasks }),
    h(MemorySources, { items: s.memoryHits }),
    h(HealthPanel, { health: s.health, latency: s.latency })
  );
}

export function SettingsPopover(props) {
  if (!props.open) return null;
  var s = props.settings;
  return h(
    "div",
    { className: "jv-settings-popover" },
    h("div", { className: "jv-panel-title" }, "Settings"),
    h(
      "label",
      { className: "jv-settings-row" },
      h("span", null, "Voice mode"),
      h(
        "select",
        {
          value: s.micMode,
          onChange: function (e) {
            props.onMicModeChange(e.target.value);
          },
        },
        h("option", { value: "ptt" }, "Push-to-talk"),
        h("option", { value: "vad" }, "Continuous (experimental)")
      )
    ),
    h(
      "label",
      { className: "jv-settings-row" },
      h("span", null, "Reduced motion"),
      h("input", {
        type: "checkbox",
        checked: s.reducedMotion,
        onChange: function (e) {
          props.onReducedMotionChange(e.target.checked);
        },
      })
    ),
    h(
      "label",
      { className: "jv-settings-row" },
      h("span", null, "Volume"),
      h("input", {
        type: "range",
        min: "0",
        max: "1.5",
        step: "0.05",
        value: s.volume,
        onChange: function (e) {
          props.onVolumeChange(parseFloat(e.target.value));
        },
      })
    ),
    h("button", { className: "jv-btn", onClick: props.onClose }, "Close")
  );
}
