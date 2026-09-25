// components/memory.js — Memory column / folded Memory tab / mobile sheet
// list: search box, "Recalled for this turn" vs "Search results", hit cards
// (score bar, confidence, updated, conflict badge, snippet), read-only
// footer.
//
// Data flow: `memoryHits` in the store comes from live memory.hits WS events
// (enriched via GET /memory/search in app.js). Typing in the search box
// drives api.js's useMemorySearch (UI.useEndpoint — shared cache, its own
// generation counter drops stale responses) whose results REPLACE the list
// while a query is committed; clearing it falls back to the recalled-this-
// turn hits.
import { UI } from "../hui.js";
import { useStore } from "../store.js";
import { parseTs } from "./util.js";
import { useMemorySearch } from "../api.js";

var html = UI.html;

function fmtUpdated(v) {
  if (v == null || v === "") return null;
  var ts = parseTs(v);
  if (ts == null) return String(v);
  return UI.format.relTime(ts);
}

function HitCard(props) {
  var m = props.hit;
  var conflict = !!m.conflict;
  var score = typeof m.score === "number" ? m.score : 0;
  var updated = fmtUpdated(m.updated);
  return html`
    <${UI.Card} variant="default" padding="sm" tone=${conflict ? "warn" : undefined}>
      <${UI.Row} justify="between" align="start" gap="sm">
        <span className="hui-t-body hui-t-clamp2" style=${{ fontWeight: 600 }}>${m.title || m.path}</span>
        <span className="hui-t-num hui-t-accent">${score.toFixed(2)}</span>
      <//>
      ${m.path ? html`<div className="hui-t-mono hui-t-faint hui-t-truncate">${m.path}</div>` : null}
      <${UI.Meter} value=${score * 100} max=${100} size="sm" tone=${conflict ? "warn" : "accent"} valueText="" />
      ${m.snippet ? html`<div className="hui-t-sub" style=${{ marginTop: 6 }}>${m.snippet}</div>` : null}
      <${UI.Row} justify="between" align="center" gap="sm" style=${{ marginTop: 6 }}>
        <span className="hui-t-micro">
          ${updated ? "updated " + updated : ""}
          ${typeof m.confidence === "number" ? " · conf " + m.confidence.toFixed(2) : ""}
        </span>
        ${conflict ? html`<${UI.Badge} tone="warn" icon="alert-triangle" size="sm">CONFLICT<//>` : null}
      <//>
    <//>`;
}

/** Search box + hit list. Reused by the desktop column, the folded Memory
 * tab and the mobile Memory sheet. */
export function MemoryPanel(props) {
  var store = props.store;
  var s = useStore(store);
  var pair = UI.useState(s.memQuery || "");
  var committed = pair[0];
  var setCommitted = pair[1];
  var search = useMemorySearch(committed);

  var searching = !!committed.trim();
  var items = searching ? search.data && search.data.hits || [] : s.memoryHits || [];

  return html`
    <${UI.Stack} gap="sm" style=${props.fill ? { flex: 1, minHeight: 0 } : undefined}>
      <${UI.SearchInput}
        value=${s.memQuery || ""}
        onChange=${function (v) { store.set({ memQuery: v }); }}
        onSearch=${setCommitted}
        debounceMs=${250}
        loading=${searching && search.loading}
        placeholder="Search vault…"
        aria-label="Search Obsidian memory" />
      <div className="hui-t-micro">${searching ? "SEARCH RESULTS" : "RECALLED FOR THIS TURN"}</div>
      ${items.length === 0
        ? searching
          ? search.loading
            ? html`<div className="hui-t-sub">Searching…</div>`
            : search.error
              ? html`<${UI.ErrorState} compact title="Search failed" error=${search.error} onRetry=${search.reload} />`
              : html`<div className="hui-t-sub">No matches in the vault.</div>`
          : html`<${UI.EmptyState} compact icon="brain" title="No recall this turn"
              hint="Memory is queried only when the mediator calls memory_recall." />`
        : html`<${UI.AnimatedList} items=${items} getKey=${function (m, i) { return (m.path || "hit") + ":" + i; }}>
            ${function (m) { return html`<${HitCard} hit=${m} />`; }}
          <//>`}
    <//>`;
}

/** Desktop >=1280 left column: header with live hit count, panel, footer. */
export function MemoryColumn(props) {
  var s = useStore(props.store);
  var count = (s.memoryHits || []).length;
  return html`
    <${UI.Stack} gap="md" style=${{ minHeight: 0, padding: "16px" }}>
      <${UI.Row} justify="between" align="center">
        <span className="hui-t-micro">MEMORY</span>
        <span className="hui-t-num hui-t-accent">${count ? count + " HITS" : "IDLE"}</span>
      <//>
      <${MemoryPanel} store=${props.store} fill />
      <${UI.Divider} />
      <${UI.Row} justify="between">
        <span className="hui-t-micro">Obsidian vault · FTS5 + nomic-embed</span>
        <span className="hui-t-micro">read-only</span>
      <//>
    <//>`;
}

/** Compact content for the mobile Memory sheet. */
export function MemorySheetContent(props) {
  return html`<${MemoryPanel} store=${props.store} fill />`;
}
