// visualizer/palette.js — orb colours from the Hermes UI theme tokens.
//
// Canvas/WebGL cannot resolve CSS custom properties, so colours are read
// through window.HermesUI.token(name) (resolved against a live [data-hui]
// node, cached per theme by the library) and parsed to linear 0..1 RGB
// triples here. Everything is recomputed on a theme switch (onThemeChange),
// never per frame.
//
// Each state names a TONE (accent | ok | warn | danger | muted) plus a
// `cool` amount that leans the palette toward the theme's info blue. A tone
// becomes five colours the renderers use:
//   main  the body/halo colour (the token itself, lifted in light theme)
//   soft  bright highlight filaments + rim (main toward white)
//   deep  the shadowed volume inside the sphere (main toward the page ground)
//   cool  secondary swirl hue (main toward info, or warn<->danger)
//   bg    page ground (dark interior floor)

var FALLBACK = {
  bg: "#070A0C",
  accent: "#4FE3E0",
  "accent-soft": "#9DF0EC",
  "accent-deep": "#1E7C7E",
  ok: "#68EAD0",
  warn: "#F2B35C",
  danger: "#FF6B6B",
  info: "#8AA6FF",
  "text-faint": "#8FA3A8",
};

export function parseColor(str) {
  var s = String(str || "").trim();
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  return null;
}

function UIlib() {
  return typeof window !== "undefined" ? window.HermesUI : null;
}

export function currentTheme() {
  var UI = UIlib();
  try {
    return UI && UI.currentTheme ? UI.currentTheme() : "dark";
  } catch (e) {
    return "dark";
  }
}

function tok(name) {
  var UI = UIlib();
  var v = null;
  try {
    v = UI && UI.token ? parseColor(UI.token(name)) : null;
  } catch (e) {
    v = null;
  }
  return v || parseColor(FALLBACK[name]) || [0.5, 0.5, 0.5];
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

var WHITE = [1, 1, 1];

// Build the per-tone palettes for the current theme.
export function buildPalettes() {
  var light = currentTheme() === "light";
  var bg = tok("bg");
  var accent = tok("accent");
  var info = tok("info");
  var warn = tok("warn");
  var danger = tok("danger");
  var tones = {
    accent: { base: accent, deep: tok("accent-deep"), cool: mix(accent, info, 0.62) },
    ok: { base: tok("ok"), deep: null, cool: mix(tok("ok"), accent, 0.5) },
    warn: { base: warn, deep: null, cool: mix(warn, danger, 0.35) },
    danger: { base: danger, deep: null, cool: mix(danger, warn, 0.3) },
    muted: { base: tok("text-faint"), deep: null, cool: mix(tok("text-faint"), info, 0.25) },
  };
  var out = { light: light, bg: bg, info: info, tones: {} };
  Object.keys(tones).forEach(function (k) {
    var t = tones[k];
    var deepSrc = t.deep || mix(t.base, [0, 0, 0], 0.45);
    out.tones[k] = light
      ? {
          // light ground: a saturated marble, darker body, white filaments
          main: mix(t.base, WHITE, 0.12),
          soft: mix(t.base, WHITE, 0.82),
          deep: mix(deepSrc, t.base, 0.25),
          cool: mix(t.cool, WHITE, 0.1),
        }
      : {
          main: t.base,
          soft: mix(t.base, WHITE, 0.62),
          deep: mix(bg, deepSrc, 0.6),
          cool: t.cool,
        };
  });
  return out;
}

// "rgb(r,g,b)" for the DOM caption in light theme (dark keeps the tuned
// states.js colours). Returns null when no token is available.
export function toneRgbString(tone, cool) {
  var base = tok(tone === "muted" ? "text-faint" : tone);
  var c = cool ? mix(base, tok("info"), cool * 0.4) : base;
  return "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
}
