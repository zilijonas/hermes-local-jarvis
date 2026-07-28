// components/memory.js — Memory column / folded Memory tab / mobile sheet
// list. Ported from the prototype's left column: search box, "RECALLED FOR
// THIS TURN", hit cards (score bar, confidence, updated, conflict badge,
// snippet), read-only footer.
//
// Data flow: `memoryHits` in the store comes from live memory.hits WS events
// (enriched via GET /memory/search in app.js). Typing in the search box runs
// a debounced GET /memory/search (sdk fetchJSON) whose results REPLACE the
// list while a query is active (`memResults`); clearing the query falls back
// to the recalled-this-turn hits.
import { h } from "../h.js";
import { getHooks, fetchJSON } from "../sdk.js";
import { useStore } from "../store.js";
import { cls, MICRO_LABEL, parseTs } from "./util.js";

function fmtUpdated(v) {
  if (v == null || v === "") return null;
  var ts = parseTs(v);
  if (ts == null) return String(v);
  var d = Math.max(0, Date.now() - ts);
  var days = Math.floor(d / 86400000);
  if (days > 0) return days + " d ago";
  var hours = Math.floor(d / 3600000);
  if (hours > 0) return hours + " h ago";
  var mins = Math.floor(d / 60000);
  return mins + " m ago";
}

function HitCard(props) {
  var m = props.hit;
  var conflict = !!m.conflict;
  var score = typeof m.score === "number" ? m.score : 0;
  var updated = fmtUpdated(m.updated);
  return h(
    "div",
    {
      className: cls(
        "p-[13px] pt-3 rounded-md border bg-[rgba(11,17,20,.75)] jv-rise",
        conflict ? "border-[rgba(242,179,92,.26)]" : "border-[rgba(120,190,200,.13)]"
      ),
    },
    h(
      "div",
      { className: "flex items-baseline gap-2" },
      h("div", { className: "flex-1 min-w-0 text-[13px] font-semibold text-text leading-[1.35] text-pretty" }, m.title || m.path),
      h("div", { className: "text-[10px] font-mono text-accent" }, score.toFixed(2))
    ),
    m.path ? h("div", { className: "mt-1 text-[10px] font-mono text-faint overflow-hidden text-ellipsis whitespace-nowrap" }, m.path) : null,
    h(
      "div",
      { className: "mt-2 h-[2px] rounded-[2px] bg-[rgba(120,190,200,.12)] overflow-hidden" },
      h("div", {
        className: cls(
          "h-full rounded-[2px]",
          conflict ? "bg-gradient-to-r from-[#8A6B33] to-warn" : "bg-gradient-to-r from-accent-deep to-accent"
        ),
        style: { width: Math.round(score * 100) + "%" },
      })
    ),
    m.snippet ? h("div", { className: "mt-[9px] text-[12px] text-dim leading-normal text-pretty" }, m.snippet) : null,
    h(
      "div",
      { className: "mt-[9px] flex items-center gap-2" },
      updated ? h("div", { className: "text-[10px] text-faint" }, "updated " + updated) : null,
      typeof m.confidence === "number" ? h("div", { className: "text-[10px] font-mono text-faint" }, "conf " + m.confidence.toFixed(2)) : null,
      h("div", { className: "flex-1" }),
      conflict
        ? h(
            "div",
            { className: "flex items-center gap-[5px] px-[7px] py-[2px] rounded-[4px] border border-[rgba(242,179,92,.35)] bg-[rgba(242,179,92,.08)]" },
            h("div", { className: "text-[9px] text-warn" }, "⚠"),
            h("div", { className: "text-[9px] tracking-[.1em] text-warn" }, "CONFLICT")
          )
        : null
    )
  );
}

function EmptyState() {
  return h(
    "div",
    { className: "px-3 py-4 border border-dashed border-[rgba(120,190,200,.14)] rounded-[8px] text-[12px] text-faint leading-normal" },
    "No recall this turn. Memory is queried only when the mediator calls ",
    h("span", { className: "font-mono text-faint" }, "memory_recall"),
    "."
  );
}

// Search box + hit list. Reused by the desktop column, the folded Memory tab
// (860–1279) and the mobile Memory sheet.
export function MemoryPanel(props) {
  var store = props.store;
  var s = useStore(store);
  var hooks = getHooks();
  var useRef = hooks.useRef;
  var timerRef = useRef(null);

  function runSearch(q) {
    clearTimeout(timerRef.current);
    store.set({ memQuery: q });
    if (!q.trim()) {
      store.set({ memResults: null });
      return;
    }
    timerRef.current = setTimeout(function () {
      var query = q.trim();
      fetchJSON("/memory/search?q=" + encodeURIComponent(query) + "&k=8")
        .then(function (data) {
          if (store.get().memQuery.trim() !== query) return; // stale response
          store.set({ memResults: (data && data.hits) || [] });
        })
        .catch(function () {
          if (store.get().memQuery.trim() !== query) return;
          store.set({ memResults: [] });
        });
    }, 250);
  }

  var searching = !!s.memQuery.trim();
  var items = searching ? s.memResults || [] : s.memoryHits || [];

  return h(
    "div",
    { className: "flex flex-col gap-[9px] min-h-0" + (props.fill ? " flex-1" : "") },
    h(
      "div",
      {
        className:
          "flex-none flex items-center gap-2 h-[34px] px-[10px] rounded-[7px] border border-[rgba(120,190,200,.14)] bg-[rgba(9,14,17,.8)] focus-within:border-[rgba(79,227,224,.5)]",
      },
      h("div", { className: "text-[11px] text-faint", "aria-hidden": "true" }, "⌕"),
      h("input", {
        value: s.memQuery,
        onChange: function (e) {
          runSearch(e.target.value);
        },
        placeholder: "Search vault…",
        "aria-label": "Search Obsidian memory",
        className: "flex-1 min-w-0 bg-transparent border-0 outline-none text-[12px] text-text",
      })
    ),
    h(
      "div",
      { className: "flex-1 min-h-0 overflow-y-auto flex flex-col gap-[9px]" },
      h("div", { className: MICRO_LABEL + " flex-none" }, searching ? "SEARCH RESULTS" : "RECALLED FOR THIS TURN"),
      items.length === 0
        ? searching
          ? h("div", { className: "text-[12px] text-faint px-1 py-2" }, s.memResults === null ? "Searching…" : "No matches in the vault.")
          : h(EmptyState)
        : items.map(function (m, i) {
            return h(HitCard, { key: (m.path || "hit") + ":" + i, hit: m });
          })
    )
  );
}

// Desktop ≥1280 left column: header with live hit count, panel, footer.
export function MemoryColumn(props) {
  var s = useStore(props.store);
  var count = (s.memoryHits || []).length;
  return h(
    "div",
    {
      className:
        "min-h-0 flex flex-col border-r border-[rgba(120,190,200,.09)] bg-gradient-to-b from-[rgba(10,16,19,.6)] to-[rgba(7,10,12,.2)]",
    },
    h(
      "div",
      { className: "flex-none flex items-center gap-[10px] px-4 pt-4 pb-[10px]" },
      h("div", { className: "text-[10px] tracking-[.2em] text-micro font-semibold" }, "MEMORY"),
      h("div", { className: "h-px flex-1 bg-gradient-to-r from-[rgba(120,190,200,.2)] to-transparent" }),
      h("div", { className: "text-[10px] font-mono text-accent" }, count ? count + " HITS" : "IDLE")
    ),
    h("div", { className: "flex-1 min-h-0 flex flex-col px-4 pb-4" }, h(MemoryPanel, { store: props.store, fill: true })),
    h(
      "div",
      { className: "flex-none px-4 py-[11px] border-t border-[rgba(120,190,200,.09)] flex items-center gap-2" },
      h("div", { className: "text-[10px] font-mono text-faint" }, "Obsidian vault · FTS5 + nomic-embed"),
      h("div", { className: "flex-1" }),
      h("div", { className: "text-[10px] text-faint" }, "read-only")
    )
  );
}

// Compact list for the mobile Memory sheet.
export function MemorySheetContent(props) {
  return h(MemoryPanel, { store: props.store, fill: true });
}
