// visualizer/states.js — per-FSM-state parameter tables.
//
// State catalog = docs/SPEC.md §WebSocket `state.value` (14 server states)
// plus `offline`, which is client-derived from the WebSocket connection
// status (the server can't tell us it's unreachable).
//
// CORE_STATES is the original design-prototype table (design/"Jarvis Command
// Centre.dc.html"). The orb renderer no longer draws its lattice, but the row
// is kept because the DOM reads it: `mode` names the state family in the
// stage label, `col` is the dark-theme caption tint (stateAccent).
//
// ORB_STATES drives the luminous orb (core.js). Every field is blended
// continuously toward the active row, never snapped:
//   size    body radius multiplier
//   glow    halo/bloom intensity
//   flow    speed of the internal fluid (noise phase units / s)
//   swirl   vortex strength inside the body (0 still .. 1.4 strong swirl)
//   spin    rotation speed of the vortex (rad / s)
//   deform  organic edge wobble
//   bright  interior luminance
//   sat     saturation (offline drains to grey)
//   breath  breathing depth (slow 5 s cycle)
//   tone    theme token family: accent | ok | warn | danger | muted
//   cool    lean toward the theme's info blue (0..1)
//   flash   entry flash tone (interrupted/error): brief shift, then settle
//   pulse   one-shot swell on entry (done)
import { currentTheme, toneRgbString } from "./palette.js";

export var CORE_STATES = {
  idle:            { rad: 1.00, spin: 0.05, noise: 0.10, glow: 0.55, mode: "calm",     col: [79, 227, 224] },
  listening:       { rad: 1.09, spin: 0.09, noise: 0.16, glow: 0.88, mode: "open",     col: [110, 235, 225] },
  transcribing:    { rad: 1.02, spin: 0.15, noise: 0.30, glow: 0.76, mode: "resolve",  col: [130, 226, 236] },
  thinking:        { rad: 0.93, spin: 0.24, noise: 0.13, glow: 0.70, mode: "orbit",    col: [79, 210, 232] },
  memory:          { rad: 1.00, spin: 0.07, noise: 0.09, glow: 0.78, mode: "stars",    col: [96, 216, 206] },
  capability:      { rad: 0.97, spin: 0.12, noise: 0.09, glow: 0.72, mode: "radial",   col: [122, 222, 216] },
  tool:            { rad: 0.95, spin: 0.19, noise: 0.12, glow: 0.80, mode: "arc",      col: [79, 227, 224] },
  delegating:      { rad: 1.03, spin: 0.10, noise: 0.14, glow: 0.84, mode: "transfer", col: [86, 206, 234] },
  worker_progress: { rad: 0.91, spin: 0.06, noise: 0.07, glow: 0.58, mode: "arc",      col: [86, 206, 234] },
  speaking:        { rad: 1.05, spin: 0.07, noise: 0.10, glow: 1.00, mode: "bands",    col: [124, 240, 233] },
  interrupted:     { rad: 0.87, spin: 0.03, noise: 0.05, glow: 0.34, mode: "calm",     col: [150, 170, 176] },
  blocked:         { rad: 0.95, spin: 0.03, noise: 0.06, glow: 0.62, mode: "calm",     col: [242, 179, 92] },
  error:           { rad: 0.90, spin: 0.02, noise: 0.36, glow: 0.66, mode: "calm",     col: [255, 107, 107] },
  done:            { rad: 1.10, spin: 0.05, noise: 0.08, glow: 0.92, mode: "pulse",    col: [104, 234, 208] },
  offline:         { rad: 0.85, spin: 0.01, noise: 0.04, glow: 0.20, mode: "calm",     col: [110, 128, 133] },
};

export var ORB_STATES = {
  idle:            { size: 1.00, glow: 0.50, flow: 0.10, swirl: 0.20, spin: 0.05, deform: 0.030, bright: 0.66, sat: 1.00, breath: 1.0, tone: "accent", cool: 0.15 },
  listening:       { size: 1.05, glow: 0.78, flow: 0.18, swirl: 0.26, spin: 0.08, deform: 0.040, bright: 0.92, sat: 1.00, breath: 0.4, tone: "accent", cool: 0.05 },
  transcribing:    { size: 1.00, glow: 0.72, flow: 0.30, swirl: 0.55, spin: 0.22, deform: 0.035, bright: 0.92, sat: 1.00, breath: 0.2, tone: "accent", cool: 0.25 },
  thinking:        { size: 0.97, glow: 0.85, flow: 0.42, swirl: 1.15, spin: 0.55, deform: 0.045, bright: 1.05, sat: 1.00, breath: 0.2, tone: "accent", cool: 0.55 },
  memory:          { size: 0.99, glow: 0.82, flow: 0.30, swirl: 0.80, spin: 0.30, deform: 0.035, bright: 1.00, sat: 1.00, breath: 0.2, tone: "accent", cool: 0.30 },
  capability:      { size: 0.98, glow: 0.82, flow: 0.38, swirl: 0.95, spin: 0.45, deform: 0.040, bright: 1.02, sat: 1.00, breath: 0.2, tone: "accent", cool: 0.40 },
  tool:            { size: 0.97, glow: 0.88, flow: 0.50, swirl: 1.30, spin: 0.80, deform: 0.050, bright: 1.08, sat: 1.00, breath: 0.1, tone: "accent", cool: 0.45 },
  delegating:      { size: 1.00, glow: 0.86, flow: 0.40, swirl: 1.00, spin: -0.50, deform: 0.045, bright: 1.04, sat: 1.00, breath: 0.2, tone: "accent", cool: 0.75 },
  worker_progress: { size: 0.95, glow: 0.62, flow: 0.24, swirl: 0.75, spin: 0.25, deform: 0.030, bright: 0.90, sat: 0.95, breath: 0.5, tone: "accent", cool: 0.60 },
  speaking:        { size: 1.02, glow: 0.90, flow: 0.20, swirl: 0.35, spin: 0.10, deform: 0.030, bright: 1.00, sat: 1.00, breath: 0.0, tone: "accent", cool: 0.10 },
  interrupted:     { size: 0.93, glow: 0.42, flow: 0.08, swirl: 0.15, spin: 0.03, deform: 0.025, bright: 0.72, sat: 0.55, breath: 0.6, tone: "muted",  cool: 0.00, flash: "warn" },
  blocked:         { size: 0.97, glow: 0.62, flow: 0.08, swirl: 0.20, spin: 0.04, deform: 0.025, bright: 0.88, sat: 1.00, breath: 1.2, tone: "warn",   cool: 0.00 },
  error:           { size: 0.94, glow: 0.60, flow: 0.10, swirl: 0.20, spin: 0.03, deform: 0.040, bright: 0.85, sat: 0.90, breath: 0.6, tone: "danger", cool: 0.00, flash: "danger" },
  done:            { size: 1.02, glow: 0.78, flow: 0.12, swirl: 0.25, spin: 0.06, deform: 0.030, bright: 0.95, sat: 1.00, breath: 0.8, tone: "ok",     cool: 0.00, pulse: true },
  offline:         { size: 0.88, glow: 0.12, flow: 0.04, swirl: 0.12, spin: 0.02, deform: 0.015, bright: 0.32, sat: 0.10, breath: 0.5, tone: "muted",  cool: 0.00 },
};

// State captions — label + one-line hint microcopy, ported verbatim from the
// prototype's META table. Rendered under the core (stage.js / mobile.js).
export var STATE_META = {
  idle:            { label: "Idle",                hint: "Awake · nothing in flight" },
  listening:       { label: "Listening",           hint: "mic open · webrtcvad endpointing" },
  transcribing:    { label: "Transcribing",        hint: "faster-whisper base.en int8" },
  thinking:        { label: "Thinking",            hint: "gpt-oss-20b · 8k window" },
  memory:          { label: "Recalling",           hint: "Obsidian vault · FTS5 + vectors" },
  capability:      { label: "Matching capability", hint: "tools · skills · quick actions" },
  tool:            { label: "Running meta-tool",   hint: "server-reported action" },
  delegating:      { label: "Delegating",          hint: "handing the goal to a worker" },
  worker_progress: { label: "Worker running",      hint: "gpt-oss-20b worker session" },
  speaking:        { label: "Speaking",            hint: "kokoro-onnx · am_michael" },
  interrupted:     { label: "Interrupted",         hint: "playback stopped · mediator canceled" },
  blocked:         { label: "Blocked",             hint: "needs a decision from you" },
  error:           { label: "Error",               hint: "recoverable · see activity" },
  done:            { label: "Done",                hint: "turn complete" },
  offline:         { label: "Offline",             hint: "reconnecting to jarvisd" },
};

export var ALL_STATES = Object.keys(CORE_STATES);

// Accent color string for a state ("rgb(r,g,b)") — drives the state caption
// dot/label tint in the DOM, matching the core's target color.
// Dark theme keeps the tuned prototype colours; light theme derives the tint
// from the theme tokens so the caption holds contrast on a light ground and
// matches the orb.
export function stateAccent(state) {
  if (currentTheme() === "light") {
    var o = ORB_STATES[state] || ORB_STATES.idle;
    var s = toneRgbString(o.tone, o.cool);
    if (s) return s;
  }
  var c = (CORE_STATES[state] || CORE_STATES.idle).col;
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

export function stateMeta(state) {
  return STATE_META[state] || STATE_META.idle;
}
