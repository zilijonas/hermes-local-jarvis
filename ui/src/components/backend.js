// components/backend.js — worker-backend selector + credit surfaces.
//
// Desktop: a system-bar trigger (dot . BACKEND . active name . tier . chevron)
// opening a popover with one row per backend; each row shows availability,
// name, tier badge, a caption of approx metrics + the live /credits note,
// and its fuel gauge(s) on the right (window.HermesUI's SpeedGauge). Mobile:
// a header chip opens a bottom sheet with the same rows at touch size.
//
// Data: GET /backends + GET /credits are fetched on mount and WS reconnect
// only (api.js's useBackends/useCredits, never polled — see api.js). The
// REFRESH button calls useRefreshCredits() -> GET /credits?refresh=true.
// BACKEND_META is jarvisd's own backend catalog (names/approx metrics); it
// stays here because it is domain data, not chrome.
import { UI } from "../hui.js";
import { useBackends, useCredits, useSelectBackend, useRefreshCredits } from "../api.js";

var html = UI.html;

export var BACKEND_META = {
  local: { name: "Local", caption: "≈2–6 s · 64k ctx · no spend", sub: "gpt-oss-20b · free · on-box", tier: "free" },
  cloud: { name: "Cloud", caption: "≈1–3 s · $ per call · weekly cap", sub: "cloud · uses limit", tier: "limit" },
  codex: { name: "Codex", caption: "≈4–20 s · coding agent · sub credits", sub: "codex · weekly credits", tier: "sub" },
  claude: { name: "Claude Code", caption: "≈4–20 s · coding agent · weekly + session", sub: "claude · weekly + session", tier: "sub" },
};
var BACKEND_ORDER = ["local", "cloud", "codex", "claude"];
var FOOTNOTE = "Selection applies to delegated tasks and tool calls. Mediator, transcription and speech always stay on-box.";

function metaFor(id) {
  return BACKEND_META[id] || { name: id, caption: "", sub: "", tier: "sub" };
}
export function backendIds(backends, credits) {
  var list = backends && Array.isArray(backends.backends) ? backends.backends : BACKEND_ORDER;
  return list.filter(function (id) {
    return BACKEND_META[id] || (credits && credits.backends && credits.backends[id]);
  });
}
function creditFor(credits, id) {
  return (credits && credits.backends && credits.backends[id]) || null;
}

// "ok" | "refreshing" | "loading" | "stale" | "error"
function creditsPhase(creditsEp, refreshing) {
  if (refreshing) return "refreshing";
  if (creditsEp.loading) return "loading";
  if (creditsEp.error && !creditsEp.data) return "error";
  if (creditsEp.stale || (creditsEp.data && creditsEp.data.stale)) return "stale";
  return "ok";
}
function creditsAgeLabel(creditsEp, phase) {
  if (phase === "refreshing") return "checking…";
  if (phase === "loading") return "";
  if (phase === "error") return "check failed";
  var checked = creditsEp.data && creditsEp.data.checked_epoch;
  if (!checked) return phase === "stale" ? "stale" : "";
  return "checked " + UI.format.relTime(checked * 1000);
}

function tierBadge(tier) {
  return html`<${UI.Badge} tone=${tier === "free" ? "ok" : "warn"} size="sm">${(tier || "sub").toUpperCase()}<//>`;
}

function NoteBlock(props) {
  var note = props.note || "";
  var parts = note.split("·").map(function (x) { return x.trim(); });
  var line1 = parts[0] || (props.tier === "free" ? "no spend" : (props.tier || "").toUpperCase());
  var line2 = parts.slice(1).join(" · ");
  return html`
    <div style=${{ textAlign: "center", width: props.mobile ? 88 : 96, flex: "none" }}>
      <div className=${"hui-t-mono" + (props.tier === "free" ? " hui-t-ok" : " hui-t-dim")} style=${{ fontSize: 11 }}>${line1}</div>
      ${line2 ? html`<div className="hui-t-mono hui-t-micro" style=${{ fontSize: 9 }}>${line2}</div>` : null}
    </div>`;
}

function BackendRow(props) {
  var id = props.id;
  var backends = props.backends;
  var credits = props.credits;
  var phase = props.phase;
  var selectBackend = props.selectBackend;
  var mobile = props.mobile;
  var act = props.act;
  var meta = metaFor(id);
  var cr = creditFor(credits, id);
  var active = backends.active === id || (!backends.active && id === "local");
  var available = !backends.available || backends.available[id] !== false;
  var tier = (cr && cr.tier) || meta.tier;
  var note = cr && cr.note;
  var gauges = (cr && cr.gauges) || [];
  var creditUnavailable = !!cr && cr.available === false;

  var right;
  if (creditUnavailable) {
    right = html`<${UI.SpeedGauge} label=${meta.name} value="unavailable" sub=${note} small=${mobile} />`;
  } else if (gauges.length) {
    right = gauges.map(function (g, i) {
      return html`<${UI.SpeedGauge} key=${g.label || "g" + i} label=${g.label} remaining=${g.remaining_pct}
        value=${g.value_label} sub=${phase === "stale" ? "stale · refresh" : UI.format.untilTime(g.reset_epoch ? g.reset_epoch * 1000 : null)}
        loading=${phase === "loading" || phase === "refreshing"} small=${mobile} />`;
    });
  } else if (!cr && (phase === "loading" || phase === "refreshing")) {
    right = html`<${UI.SpeedGauge} label=${meta.name} loading small=${mobile} />`;
  } else {
    right = html`<${NoteBlock} note=${note} tier=${tier} mobile=${mobile} />`;
  }
  var caption = meta.caption + (note && gauges.length ? " · " + note : "");
  var title = html`
    <${UI.Row} gap="sm" align="center">
      <span style=${{ fontWeight: 600 }}>${meta.name}</span>
      ${tierBadge(tier)}
    <//>`;

  return html`
    <${UI.ListItem}
      leading=${html`<${UI.StatusDot} tone=${active ? "accent" : available ? "neutral" : "danger"} />`}
      title=${title}
      description=${caption}
      trailing=${right}
      selected=${active}
      style=${{ opacity: available ? 1 : 0.6, cursor: available ? "pointer" : "not-allowed", minHeight: mobile ? 44 : undefined }}
      onClick=${available
        ? function () {
            selectBackend.run(id);
            act.log("backend", "Worker backend set to " + meta.name + (meta.sub ? " · " + meta.sub : ""), null, id === "local" ? "info" : "warn");
            if (props.onPicked) props.onPicked();
          }
        : undefined} />`;
}

function RefreshButton(props) {
  return html`
    <${UI.Button} size=${props.mobile ? "md" : "sm"} variant="secondary" icon="refresh" loading=${props.refreshing} onClick=${props.onClick}>
      Refresh
    <//>`;
}

function Rows(props) {
  var mobile = props.mobile;
  var act = props.act;
  var backendsEp = useBackends();
  var creditsEp = useCredits();
  var selectBackend = useSelectBackend();
  var refreshCredits = useRefreshCredits();
  var backends = backendsEp.data || {};
  var credits = creditsEp.data || {};
  var phase = creditsPhase(creditsEp, refreshCredits.pending);

  return html`
    <${UI.Stack} gap="sm">
      <${UI.Row} justify="between" align="center">
        <span className="hui-t-micro">${mobile ? "" : "WORKER BACKEND"}</span>
        <${UI.Row} gap="sm" align="center">
          <span className="hui-t-micro">${creditsAgeLabel(creditsEp, phase)}</span>
          <${RefreshButton} mobile=${mobile} refreshing=${phase === "refreshing"}
            onClick=${function () { refreshCredits.run(); act.log("credits", "Checked subscription credits", "manual refresh · not polled", "info"); }} />
        <//>
      <//>
      ${backendIds(backends, credits).map(function (id) {
        return html`<${BackendRow} key=${id} id=${id} backends=${backends} credits=${credits} phase=${phase}
          selectBackend=${selectBackend} act=${act} mobile=${mobile} onPicked=${props.onPicked} />`;
      })}
      <div className="hui-t-micro" style=${{ lineHeight: 1.5 }}>${FOOTNOTE}</div>
    <//>`;
}

/** Desktop: system-bar trigger + popover. */
export function BackendSelector(props) {
  var act = props.act;
  var backendsEp = useBackends();
  var creditsEp = useCredits();
  var backends = backendsEp.data || {};
  var credits = creditsEp.data || {};
  var activeId = backends.active || "local";
  var meta = metaFor(activeId);
  var cr = creditFor(credits, activeId);
  var tier = (cr && cr.tier) || meta.tier;
  var available = !backends.available || backends.available[activeId] !== false;

  return html`
    <${UI.Popover} placement="bottom" align="end" panelClassName="jv-backend-pop"
      trigger=${html`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label="Choose worker backend">
          <${UI.StatusDot} tone=${available ? "accent" : "danger"} />
          <span style=${{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
            <span className="hui-t-micro">BACKEND</span>
            <span style=${{ fontWeight: 600 }}>${meta.name}</span>
          </span>
          ${tierBadge(tier)}
        </button>`}>
      ${function (bind) { return html`<div style=${{ width: 380 }}><${Rows} act=${act} onPicked=${bind.close} /></div>`; }}
    <//>`;
}

/** Mobile: header chip that opens the "backend" sheet. */
export function BackendChipMobile(props) {
  var backendsEp = useBackends();
  var creditsEp = useCredits();
  var backends = backendsEp.data || {};
  var activeId = backends.active || "local";
  var meta = metaFor(activeId);
  var cr = creditFor(creditsEp.data, activeId);
  var tier = (cr && cr.tier) || meta.tier;

  return html`
    <button type="button" onClick=${props.onClick} aria-label="Worker backend and credits"
      className="hui-btn hui-btn--secondary hui-btn--sm"
      style=${props.attention ? { borderColor: "var(--hui-warn)" } : undefined}>
      <${UI.StatusDot} tone="accent" />
      <span style=${{ fontWeight: 600 }}>${meta.name}</span>
      ${tierBadge(tier)}
    </button>`;
}

export function BackendSheetContent(props) {
  return html`<${Rows} act=${props.act} mobile />`;
}
