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
  local: { name: "Local", caption: "≈30-60 s · offline fallback · no spend", sub: "gpt-oss-20b · free · on-box", tier: "free" },
  cloud: { name: "codecloud", caption: "≈5-30 s · full Hermes agent · OpenCode Go + Jev", sub: "codecloud · subscription", tier: "sub" },
  codex: { name: "Codex", caption: "≈4-20 s · coding agent · sub credits", sub: "codex · weekly credits", tier: "sub" },
  claude: { name: "Claude Code", caption: "≈4-20 s · coding agent · weekly + session", sub: "claude · weekly + session", tier: "sub" },
};
var BACKEND_ORDER = ["local", "cloud", "codex", "claude"];
var FOOTNOTE = "Applies to delegated tasks. Speech recognition and the voice always stay on this Mac; the brain is picked separately.";

function metaFor(id) {
  return BACKEND_META[id] || { name: id, caption: "", sub: "", tier: "sub" };
}
// GET /backends now may carry an optional `labels` map ({id: label}) —
// prefer it over BACKEND_META's hard-coded names whenever the server sets it
// (protocol v2), falling back to the static catalog for an older server.
function nameFor(backends, id) {
  return (backends && backends.labels && backends.labels[id]) || metaFor(id).name;
}
// Short chip tag for the compact header trigger/mobile chip — deliberately
// derived from the id/BACKEND_META catalog, NOT from nameFor()'s (possibly
// server-branded, longer) display name: a live server's `labels` override
// can read e.g. "Hermes codecloud" for id "codecloud", and trimming THAT to
// its first word would show the wrong half ("Hermes") — metaFor(id).name
// is either the curated short catalog name ("Local"/"Cloud"/"Codex"/"Claude
// Code") or, for an id the catalog doesn't know, the bare id itself
// ("codecloud"), which is already short. Either way this one first-word trim
// covers every case. The full server label stays in the button's
// title/aria-label and in full inside the popover/sheet rows (nameFor()).
function shortTag(id) {
  var s = metaFor(id).name;
  var sp = s.indexOf(" ");
  return sp === -1 ? s : s.slice(0, sp);
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
  if (phase === "refreshing") return "checking";
  if (phase === "loading") return "";
  if (phase === "error") return "check failed";
  var checked = creditsEp.data && creditsEp.data.checked_epoch;
  if (!checked) return phase === "stale" ? "stale" : "";
  return "checked " + UI.format.relTime(checked * 1000);
}

function tierBadge(tier) {
  return html`<${UI.Badge} tone=${tier === "free" ? "ok" : "warn"} size="sm">${(tier || "sub").toUpperCase()}<//>`;
}

// Single tiny inline tag — replaces the old two-line boxed NoteBlock. Full
// note text stays in the row's title tooltip (see BackendRow).
function NoteBlock(props) {
  var note = props.note || "";
  var short = note.split("·")[0].trim() || (props.tier === "free" ? "no spend" : (props.tier || "").toUpperCase());
  return html`<span className=${"hui-t-mono hui-t-micro" + (props.tier === "free" ? " hui-t-ok" : " hui-t-dim")} style=${{ whiteSpace: "nowrap" }}>${short}</span>`;
}

// Very small inline meter for one credit gauge: `size="sm"` gives a 5px
// track, and Meter's own head row (never suppressible via props — it always
// computes a valueText) already IS the "thin bar + short % text" the compact
// row needs — so this just feeds it label/valueText directly instead of
// wrapping a redundant custom label/value pair around it (that duplicated
// the text once). Never the big SpeedGauge arc; those are too spacious here.
function CompactGauge(props) {
  var g = props.gauge;
  var pct = typeof g.remaining_pct === "number" ? g.remaining_pct * 100 : 0;
  var tone = typeof g.remaining_pct !== "number" ? "neutral" : pct < 15 ? "danger" : pct < 35 ? "warn" : "accent";
  return html`
    <div style=${{ width: props.mobile ? 100 : 116 }}>
      <${UI.Meter} size="sm" value=${pct} max=${100} tone=${tone}
        label=${g.label || null} valueText=${g.value_label || null} indeterminate=${props.loading} />
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

  // Compact trailing: a thin inline meter per gauge (never the big SpeedGauge
  // arc — see CompactGauge above), stacked with a hairline gap when a
  // backend carries more than one live quota (e.g. Claude Code's weekly +
  // session). Loading/unavailable/free-tier all collapse to one small tag.
  var right;
  if (creditUnavailable) {
    right = html`<span className="hui-t-micro hui-t-dim" style=${{ whiteSpace: "nowrap" }}>unavailable</span>`;
  } else if (gauges.length) {
    var gaugeNodes = gauges.map(function (g, i) {
      return html`<${CompactGauge} key=${g.label || "g" + i} gauge=${g} mobile=${mobile} loading=${phase === "loading" || phase === "refreshing"} />`;
    });
    right = gaugeNodes.length > 1 ? html`<${UI.Stack} gap="2">${gaugeNodes}<//>` : gaugeNodes[0];
  } else if (!cr && (phase === "loading" || phase === "refreshing")) {
    right = html`<${UI.Spinner} size=${12} />`;
  } else {
    right = html`<${NoteBlock} note=${note} tier=${tier} mobile=${mobile} />`;
  }
  var displayName = nameFor(backends, id);
  // Full caption + live note stays in the row's title tooltip; the visible
  // description line is trimmed to one short clause ("label + tiny detail",
  // not the whole approx-metrics sentence).
  var shortCaption = meta.caption.split("·")[0].trim();
  var fullTitleText = displayName + (meta.caption ? ": " + meta.caption : "") + (note ? " · " + note : "");
  var title = html`
    <${UI.Row} gap="xs" align="center" wrap=${false}>
      <span style=${{ fontWeight: 600 }} title=${fullTitleText}>${displayName}<//>
      ${tierBadge(tier)}
    <//>`;

  return html`
    <${UI.ListItem}
      dense
      leading=${html`<${UI.StatusDot} tone=${active ? "accent" : available ? "neutral" : "danger"} />`}
      title=${title}
      description=${shortCaption}
      trailing=${right}
      selected=${active}
      style=${{ opacity: available ? 1 : 0.6, cursor: available ? "pointer" : "not-allowed", minHeight: mobile ? 44 : undefined }}
      onClick=${available
        ? function () {
            selectBackend.run(id);
            act.log("backend", "Worker backend set to " + displayName + (meta.sub ? " · " + meta.sub : ""), null, id === "local" ? "info" : "warn");
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
  var displayName = nameFor(backends, activeId);
  var fullLabel = "Worker backend: " + displayName + (meta.sub ? " · " + meta.sub : "");

  return html`
    <${UI.Popover} placement="bottom" align="end" panelClassName="jv-backend-pop"
      trigger=${html`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label=${fullLabel} title=${fullLabel}>
          <${UI.StatusDot} tone=${available ? "accent" : "danger"} />
          <span className="hui-btn__lead"><${UI.Icon} name="cpu" size=${13} /></span>
          <span className="hui-btn__label">${shortTag(activeId)}</span>
        </button>`}>
      ${function (bind) { return html`<div style=${{ width: 260 }}><${Rows} act=${act} onPicked=${bind.close} /></div>`; }}
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
  var displayName = nameFor(backends, activeId);
  var fullLabel = "Worker backend: " + displayName + (meta.sub ? " · " + meta.sub : "") + " · " + (tier || "").toUpperCase();

  return html`
    <button type="button" onClick=${props.onClick} aria-label=${fullLabel} title=${fullLabel}
      className="hui-btn hui-btn--secondary hui-btn--sm"
      style=${props.attention ? { borderColor: "var(--hui-warn)" } : undefined}>
      <${UI.StatusDot} tone="accent" />
      <span className="hui-btn__lead"><${UI.Icon} name="cpu" size=${13} /></span>
      <span className="hui-btn__label">${shortTag(activeId)}</span>
    </button>`;
}

export function BackendSheetContent(props) {
  return html`<${Rows} act=${props.act} mobile />`;
}
