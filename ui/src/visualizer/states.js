// visualizer/states.js — per-FSM-state parameter table for the 2D-canvas
// intelligence core, ported VERBATIM from the design prototype
// (design/"Jarvis Command Centre.dc.html", Component.CORE / Component.META).
//
// State catalog = docs/SPEC.md §WebSocket `state.value` (14 server states)
// plus `offline`, which is client-derived from the WebSocket connection
// status (the server can't tell us it's unreachable).
//
//   rad   lattice radius multiplier
//   spin  rotation speed
//   noise vertex noise displacement
//   glow  atmosphere/nucleus intensity
//   mode  overlay renderer (core.js drawMode): calm|open|resolve|orbit|stars|
//         radial|arc|transfer|bands|pulse
//   col   [r,g,b] accent — blended continuously, never snapped

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

// State captions — label + one-line hint microcopy, ported verbatim from the
// prototype's META table. Rendered under the core (stage.js / mobile.js).
export var STATE_META = {
  idle:            { label: "Idle",                hint: "Awake · nothing in flight" },
  listening:       { label: "Listening",           hint: "mic open · webrtcvad endpointing" },
  transcribing:    { label: "Transcribing",        hint: "faster-whisper base.en int8" },
  thinking:        { label: "Thinking",            hint: "gemma4:e4b-it-qat · 8k ctx" },
  memory:          { label: "Recalling",           hint: "Obsidian vault · FTS5 + vectors" },
  capability:      { label: "Matching capability", hint: "tools · skills · quick actions" },
  tool:            { label: "Running meta-tool",   hint: "server-reported action" },
  delegating:      { label: "Delegating",          hint: "handing the goal to a worker" },
  worker_progress: { label: "Worker running",      hint: "granite4.1-local-64k session" },
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
export function stateAccent(state) {
  var c = (CORE_STATES[state] || CORE_STATES.idle).col;
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

export function stateMeta(state) {
  return STATE_META[state] || STATE_META.idle;
}
