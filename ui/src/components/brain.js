// components/brain.js — brain selector (protocol v2), a lightweight sibling
// of components/backend.js's worker-backend selector. "Brain" picks which
// model the MEDIATOR itself runs on (e.g. "Fast · local" vs "Smart · cloud")
// — distinct from the worker backend, which only applies to delegated tasks
// and tool calls (see backend.js's FOOTNOTE).
//
// GET /brains -> {active, brains:[{id,label,detail,available}]}
// POST /brains {brain} -> persists server-side (optimistic, like backend.js).
// `brain.changed` (WS) keeps every subscriber's cache live — see
// api.js's mergeBrainChanged(), called from app.js's onEvent.
//
// Tolerant of an older server that doesn't implement /brains at all: the
// endpoint 404s/502s, useBrains() reports the error, and the trigger simply
// shows a "?" — never a crash.
import { UI } from "../hui.js";
import { useBrains, useSelectBrain } from "../api.js";

var html = UI.html;

// Fallback labels for a server that answers with bare ids and no label/
// detail (older jarvisd) — never invented for an id we don't recognize.
var FALLBACK_LABEL = { fast: "Fast · local", smart: "Smart · cloud", local: "Fast · local", cloud: "Smart · cloud" };
var FALLBACK_SHORT = { fast: "Local", smart: "Cloud", local: "Local", cloud: "Cloud" };

function labelFor(b) {
  return (b && b.label) || (b && FALLBACK_LABEL[b.id]) || (b && b.id) || "?";
}

// Short chip tag for the compact header trigger/mobile chip: scans the
// server's own label+detail text for "local"/"cloud" wording (real servers
// so far always say one or the other — "gpt-oss ... on-box" vs "OpenCode
// Go"/"cloud") before falling back to a known id, then to the first word of
// the full label. Never invents a tag unrelated to what the server said.
function shortTag(b) {
  var hay = (((b && b.label) || "") + " " + ((b && b.detail) || "")).toLowerCase();
  if (/\blocal\b|on-box|on box/.test(hay)) return "Local";
  if (/\bcloud\b|opencode/.test(hay)) return "Cloud";
  if (b && FALLBACK_SHORT[b.id]) return FALLBACK_SHORT[b.id];
  var full = labelFor(b);
  return full.split(/[·\s]+/)[0] || full;
}

function Rows(props) {
  var act = props.act;
  var brainsEp = useBrains();
  var selectBrain = useSelectBrain();
  var data = brainsEp.data || {};
  var brains = Array.isArray(data.brains) ? data.brains : [];

  return html`
    <${UI.Stack} gap="sm">
      <span className="hui-t-micro">${props.mobile ? "" : "BRAIN"}</span>
      <${UI.DataState} state=${brainsEp} emptyText="jarvisd didn't report any brains.">
        ${function () {
          if (!brains.length) return html`<${UI.EmptyState} compact title="No brains reported" />`;
          return html`<${UI.Stack} gap="xs">
            ${brains.map(function (b) {
              var active = data.active === b.id;
              var available = b.available !== false;
              var full = labelFor(b);
              return html`
                <${UI.ListItem} key=${b.id}
                  dense
                  leading=${html`<${UI.StatusDot} tone=${active ? "accent" : available ? "neutral" : "danger"} />`}
                  title=${html`<span title=${full + (b.detail ? ": " + b.detail : "")}>${full}<//>`}
                  description=${b.detail || ""}
                  selected=${active}
                  style=${{ opacity: available ? 1 : 0.6, cursor: available ? "pointer" : "not-allowed", minHeight: props.mobile ? 44 : undefined }}
                  onClick=${available
                    ? function () {
                        selectBrain.run(b.id);
                        if (act) act.log("brain", "Brain set to " + labelFor(b), b.detail || null, "info");
                        if (props.onPicked) props.onPicked();
                      }
                    : undefined} />`;
            })}
          <//>`;
        }}
      <//>
    <//>`;
}

/** Desktop: system-bar trigger + popover, same shape as BackendSelector. */
export function BrainSelector(props) {
  var act = props.act;
  var brainsEp = useBrains();
  var data = brainsEp.data || {};
  var brains = Array.isArray(data.brains) ? data.brains : [];
  var active = brains.filter(function (b) {
    return b.id === data.active;
  })[0];
  var fullLabel = active ? "Brain: " + labelFor(active) + (active.detail ? ": " + active.detail : "") : "Brain: " + (data.active || "?");

  return html`
    <${UI.Popover} placement="bottom" align="end" panelClassName="jv-brain-pop"
      trigger=${html`
        <button type="button" className="hui-btn hui-btn--secondary hui-btn--sm" aria-label=${fullLabel} title=${fullLabel}>
          <${UI.StatusDot} tone="accent" />
          <span className="hui-btn__lead"><${UI.Icon} name="brain" size=${13} /></span>
          <span className="hui-btn__label">${active ? shortTag(active) : "Brain"}</span>
        </button>`}>
      ${function (bind) {
        return html`<div style=${{ width: 240 }}><${Rows} act=${act} onPicked=${bind.close} /></div>`;
      }}
    <//>`;
}

/** Mobile: header chip that opens the "brain" sheet. */
export function BrainChipMobile(props) {
  var brainsEp = useBrains();
  var data = brainsEp.data || {};
  var brains = Array.isArray(data.brains) ? data.brains : [];
  var active = brains.filter(function (b) {
    return b.id === data.active;
  })[0];
  var fullLabel = active ? "Brain: " + labelFor(active) + (active.detail ? ": " + active.detail : "") : "Brain: " + (data.active || "?");
  return html`
    <button type="button" onClick=${props.onClick} aria-label=${fullLabel} title=${fullLabel} className="hui-btn hui-btn--secondary hui-btn--sm">
      <${UI.StatusDot} tone="accent" />
      <span className="hui-btn__lead"><${UI.Icon} name="brain" size=${13} /></span>
      <span className="hui-btn__label">${active ? shortTag(active) : "Brain"}</span>
    </button>`;
}

export function BrainSheetContent(props) {
  return html`<${Rows} act=${props.act} mobile />`;
}
