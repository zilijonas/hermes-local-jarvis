// scope-css.mjs — scope a stylesheet under #jarvis-voice-root and verify no
// bare global selectors survive.
//
// Usage:  node scope-css.mjs <in.css> <out.css>
//
// Rules:
//   - every selector that does not already contain "#jarvis-voice-root" is
//     prefixed with "#jarvis-voice-root " (descendant combinator);
//   - selectors starting with ":root" / ":host" are rewritten to
//     #jarvis-voice-root itself;
//   - rules inside @keyframes / @font-face / @property / @page are left
//     untouched (keyframe steps are not selectors);
//   - @layer blocks are unwrapped (unlayered host CSS would otherwise beat
//     our layered rules regardless of specificity) — source order inside the
//     file is preserved, which is what Tailwind's utility ordering relies on.
// After transforming, the output is re-parsed and ASSERTED: every remaining
// style rule's selectors must contain "#jarvis-voice-root". The build fails
// otherwise, so a leaky selector can never ship.
import fs from "node:fs";
import postcss from "postcss";

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error("usage: node scope-css.mjs <in.css> <out.css>");
  process.exit(2);
}

const SCOPE = "#jarvis-voice-root";
const SKIP_AT = new Set(["keyframes", "font-face", "property", "page", "counter-style", "font-palette-values"]);

function insideSkippedAtRule(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule") {
      const name = p.name.replace(/^-\w+-/, ""); // -webkit-keyframes etc.
      if (SKIP_AT.has(name)) return true;
    }
  }
  return false;
}

function scopeSelector(sel) {
  const s = sel.trim();
  if (s.includes(SCOPE)) return s;
  if (/^:root\b/.test(s) || /^:host\b/.test(s)) {
    return s.replace(/^:root\b|^:host(\([^)]*\))?/, SCOPE);
  }
  return SCOPE + " " + s;
}

const css = fs.readFileSync(inFile, "utf8");
const root = postcss.parse(css, { from: inFile });

// unwrap @layer blocks (keep contents in place, drop layer statements)
root.walkAtRules("layer", (at) => {
  if (at.nodes && at.nodes.length) at.replaceWith(at.nodes);
  else at.remove();
});

root.walkRules((rule) => {
  if (insideSkippedAtRule(rule)) return;
  rule.selectors = rule.selectors.map(scopeSelector);
});

const out = root.toResult().css;

// ---- verification pass ----
const check = postcss.parse(out);
const leaks = [];
check.walkRules((rule) => {
  if (insideSkippedAtRule(rule)) return;
  for (const sel of rule.selectors) {
    if (!sel.includes(SCOPE)) leaks.push(sel);
  }
});
if (leaks.length) {
  console.error("scope-css: LEAKY SELECTORS (missing " + SCOPE + "):");
  for (const l of leaks.slice(0, 20)) console.error("  " + l);
  process.exit(1);
}

fs.writeFileSync(outFile, out);
console.log("scope-css: " + inFile + " -> " + outFile + " (all selectors scoped under " + SCOPE + ")");
