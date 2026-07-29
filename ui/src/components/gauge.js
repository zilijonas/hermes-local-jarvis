// components/gauge.js — subscription-credit fuel gauges (redesign spec §06).
//
// Two renderers:
//   FuelGauge — 180° arc + needle (SVG, static — redrawn only on re-render,
//     never animated per §08 perf: credits are read on mount + manual refresh
//     only). Colour interpolates low→mid→full by remaining_pct (more
//     remaining = fuller + greener). value_label + relative reset time
//     beneath the arc. Phases: ok / refreshing (grey needle, "checking…") /
//     stale (60% opacity, "stale · refresh") / unavailable (empty track, no
//     needle, word only).
//   BarGauge — compact chip for the desktop system bar (≥1180px): name +
//     44px fill bar + numeric %.
//
// A11y (§09): gauges are never colour-alone — the fill LENGTH and the
// numeric/value label carry the same information, and unavailable renders an
// empty track plus the word. The SVG itself is aria-hidden; the wrapper
// carries a full aria-label.
import { h } from "../h.js";
import { cls } from "./util.js";

// Numeric mirrors of the CSS gauge tokens (tokens.css) — the arc colour is
// interpolated in JS, which CSS var() strings can't do:
//   --jv-gauge-low #FF6B6B · --jv-gauge-mid #F2B35C · --jv-gauge-full #68EAD0
var G_LOW = [255, 107, 107];
var G_MID = [242, 179, 92];
var G_FULL = [104, 234, 208];
var ARC_LEN = 87.96; // r=28 half-circumference of the 180° track path

function mix(a, b, t) {
  return [0, 1, 2].map(function (i) {
    return Math.round(a[i] + (b[i] - a[i]) * t);
  });
}

// remaining_pct (0..1) → interpolated rgb() low→mid→full
export function gaugeRGB(pct) {
  var p = Math.max(0, Math.min(1, pct));
  var c = p <= 0.5 ? mix(G_LOW, G_MID, p / 0.5) : mix(G_MID, G_FULL, (p - 0.5) / 0.5);
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

// reset_epoch (unix seconds) → relative "4d 2h left" / "2h 10m left" / null
export function fmtReset(resetEpoch) {
  if (typeof resetEpoch !== "number" || !resetEpoch) return null;
  var delta = resetEpoch * 1000 - Date.now();
  if (delta <= 0) return "resets soon";
  var m = Math.floor(delta / 60000);
  var hTotal = Math.floor(m / 60);
  var d = Math.floor(hTotal / 24);
  var hRem = hTotal % 24;
  if (d > 0) return d + "d" + (hRem ? " " + hRem + "h" : "") + " left";
  if (hTotal > 0) return hTotal + "h " + (m % 60) + "m left";
  return m + "m left";
}

var REFRESHING_COL = "rgba(120,190,200,.45)";

function arcSvg(opts) {
  // opts: { color, pct (0..1 or null), showNeedle, mobile }
  var pct = typeof opts.pct === "number" ? Math.max(0, Math.min(1, opts.pct)) : null;
  var dash = pct == null ? "0 200" : (pct * ARC_LEN).toFixed(1) + " 200";
  var kids = [
    // track — --jv-gauge-track
    h("path", {
      d: "M8 38 A 28 28 0 0 1 64 38",
      fill: "none",
      style: { stroke: "var(--jv-gauge-track)" },
      strokeWidth: "6",
      strokeLinecap: "round",
    }),
    h("path", {
      d: "M8 38 A 28 28 0 0 1 64 38",
      fill: "none",
      stroke: opts.color,
      strokeWidth: "6",
      strokeLinecap: "round",
      strokeDasharray: dash,
    }),
  ];
  if (opts.showNeedle && pct != null) {
    kids.push(
      h("line", {
        x1: "36",
        y1: "38",
        x2: "36",
        y2: "20",
        stroke: opts.color,
        strokeWidth: "1.4",
        strokeLinecap: "round",
        transform: "rotate(" + (-90 + pct * 180).toFixed(1) + " 36 38)",
      })
    );
    kids.push(h("circle", { cx: "36", cy: "38", r: "2.2", fill: opts.color }));
  }
  if (!opts.mobile) {
    kids.push(h("text", { x: "7", y: "43", fill: "var(--jv-text-micro)", fontSize: "7", fontFamily: "var(--jv-mono)" }, "E"));
    kids.push(h("text", { x: "62", y: "43", fill: "var(--jv-text-micro)", fontSize: "7", fontFamily: "var(--jv-mono)" }, "F"));
  }
  return h.apply(
    null,
    [
      "svg",
      {
        viewBox: "0 0 72 44",
        className: cls("block", opts.mobile ? "w-16 h-[38px]" : "w-[66px] h-10"),
        "aria-hidden": "true",
      },
    ].concat(kids)
  );
}

// One fuel gauge.
//   props.gauge: { label, remaining_pct, value_label, reset_epoch } from
//     GET /credits (may be null for the unavailable placeholder)
//   props.phase: "ok" | "refreshing" | "stale" | "unavailable"
//   props.note:  backend note (shown as the reset line when unavailable)
//   props.mobile: sheet-sized variant (no E/F letters)
export function FuelGauge(props) {
  var g = props.gauge || {};
  var phase = props.phase || "ok";
  var mobile = props.mobile;
  var wrapBase = cls("flex flex-col items-center gap-[3px] flex-none", mobile ? "w-[88px]" : "w-24");

  if (phase === "unavailable") {
    // empty track + the word — never colour-alone (§09)
    return h(
      "div",
      { className: wrapBase, "aria-label": (props.name || "") + " credits unavailable — " + (props.note || "not linked") },
      arcSvg({ color: "var(--jv-gauge-idle)", pct: null, showNeedle: false, mobile: mobile }),
      h("div", { className: "text-[9.5px] font-mono leading-[1.35] text-center text-faint" }, "unavailable"),
      h("div", { className: "text-[9px] font-mono leading-[1.3] text-center text-micro" }, props.note || "not linked")
    );
  }

  var pct = typeof g.remaining_pct === "number" ? g.remaining_pct : null;
  var refreshing = phase === "refreshing";
  var color = pct == null ? "var(--jv-gauge-idle)" : refreshing ? REFRESHING_COL : gaugeRGB(pct);
  var reset = refreshing ? "checking…" : phase === "stale" ? "stale · refresh" : fmtReset(g.reset_epoch);
  var resetLine = (g.label ? g.label + (reset ? " · " : "") : "") + (reset || "");
  var aria =
    (props.name ? props.name + " " : "") +
    (g.label ? g.label + " credits: " : "credits: ") +
    (g.value_label || (pct != null ? Math.round(pct * 100) + "% left" : "no meter")) +
    (reset ? " · " + reset : "");

  return h(
    "div",
    {
      className: cls(wrapBase, phase === "stale" ? "opacity-60" : ""),
      style: { transition: "opacity .22s" },
      "aria-label": aria,
    },
    arcSvg({ color: color, pct: pct, showNeedle: pct != null && !refreshing, mobile: mobile }),
    h(
      "div",
      {
        className: "text-[9.5px] font-mono leading-[1.35] text-center",
        style: { color: phase === "ok" && pct != null ? color : "var(--jv-text-faint)" },
      },
      g.value_label || (pct != null ? Math.round(pct * 100) + "% left" : "—")
    ),
    resetLine ? h("div", { className: "text-[9px] font-mono leading-[1.3] text-center text-micro" }, resetLine) : null
  );
}

// Compact system-bar chip (≥1180px): NAME + 44px fill bar + numeric %.
//   props: { name, credit (per-backend /credits payload), phase, active }
export function BarGauge(props) {
  var cr = props.credit || {};
  var phase = props.phase || "ok";
  var available = cr.available !== false;
  var firstGauge = (cr.gauges || [])[0] || null;
  var pct = available && firstGauge && typeof firstGauge.remaining_pct === "number" ? Math.max(0, Math.min(1, firstGauge.remaining_pct)) : null;
  var color = !available ? "var(--jv-gauge-idle)" : phase === "refreshing" ? REFRESHING_COL : pct != null ? gaugeRGB(pct) : "var(--jv-gauge-idle)";
  var pctLabel = !available ? "—" : pct != null ? Math.round(pct * 100) + "%" : cr.tier === "sub" ? "sub" : "—";
  var title =
    props.name +
    " · " +
    (!available
      ? "unavailable — " + (cr.note || "not linked")
      : (firstGauge ? firstGauge.value_label + (fmtReset(firstGauge.reset_epoch) ? " · " + fmtReset(firstGauge.reset_epoch) : "") : cr.note || cr.tier || ""));
  return h(
    "div",
    {
      className: cls(
        "flex-none px-[9px] py-1 rounded-[6px] border",
        props.active ? "border-[rgba(79,227,224,.3)] bg-[rgba(79,227,224,.07)]" : "border-[rgba(120,190,200,.12)] bg-transparent",
        phase === "stale" ? "opacity-60" : ""
      ),
      title: title,
      "aria-label": title,
    },
    h("div", { className: "text-[9px] tracking-[.14em] text-faint" }, props.name.toUpperCase()),
    h(
      "div",
      { className: "flex items-center gap-[6px] mt-[3px]" },
      h(
        "div",
        { className: "w-11 h-1 rounded-[2px] overflow-hidden", style: { background: "var(--jv-gauge-track)" } },
        h("div", {
          className: "h-full rounded-[2px]",
          style: { width: (pct != null ? Math.round(pct * 100) : 0) + "%", background: color, transition: "width .3s,background .3s" },
        })
      ),
      h("div", { className: "text-[10px] font-mono", style: { color: pct != null ? color : "var(--jv-text-faint)" } }, pctLabel)
    )
  );
}
