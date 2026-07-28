// visualizer/states.js — per-FSM-state visual parameter table.
//
// Every field except `color` is a plain number so the whole style can be
// linearly blended during the ≤300ms state transition (see index.js
// blendParams). Overlay intensities (scan/sweep/arc/ripple/knot/satellites)
// are lerped 0↔1, which is what makes overlays fade in/out smoothly instead
// of popping.
//
// State catalog mirrors docs/SPEC.md §WebSocket `state.value` exactly:
// idle|listening|transcribing|thinking|memory|capability|tool|delegating|
// worker_progress|speaking|interrupted|blocked|error|done.
import { Color } from "three";

function S(hex, overrides) {
  var base = {
    color: new Color(hex),
    glow: 0.8, // glow-shell strength multiplier
    distortion: 0.6, // noise displacement base
    rot: 0.5, // rotation speed multiplier
    orbScale: 1, // thinking tightens the orb slightly
    knot: 0, // inner fast-orbit particle knot (thinking)
    scan: 0, // vertical scan band on the wireframe (transcribing)
    sweep: 0, // radar sweep highlight (capability)
    arc: 0, // orbital progress arc (worker_progress)
    ripple: 0, // expanding mic-reactive rings (listening)
    satellites: 0, // fission satellites (delegating)
  };
  return Object.assign(base, overrides);
}

export var STATE_STYLES = {
  idle: S(0x2aa5b8, { glow: 0.55, distortion: 0.55, rot: 0.3 }),
  listening: S(0x22d3ee, { glow: 0.9, distortion: 0.75, rot: 0.55, ripple: 1 }),
  transcribing: S(0x5ee1f0, { glow: 0.8, distortion: 0.6, rot: 0.45, scan: 1 }),
  thinking: S(0x8b5cf6, { glow: 0.95, distortion: 0.85, rot: 2.4, orbScale: 0.88, knot: 1 }),
  memory: S(0x7ea8ff, { glow: 0.85, distortion: 0.6, rot: 0.5 }),
  capability: S(0x2dd4bf, { glow: 0.85, distortion: 0.6, rot: 0.8, sweep: 1 }),
  tool: S(0xfbbf24, { glow: 0.85, distortion: 0.7, rot: 0.5 }),
  delegating: S(0xa78bfa, { glow: 0.9, distortion: 0.7, rot: 1.0, satellites: 1 }),
  worker_progress: S(0xf59e0b, { glow: 0.85, distortion: 0.6, rot: 0.7, arc: 1 }),
  speaking: S(0xffb454, { glow: 1.0, distortion: 0.9, rot: 0.4 }),
  interrupted: S(0xf87171, { glow: 0.9, distortion: 1.0, rot: 1.4 }),
  blocked: S(0xdc2626, { glow: 0.6, distortion: 0.4, rot: 0.1 }),
  error: S(0xef4444, { glow: 0.65, distortion: 0.45, rot: 0.1 }),
  done: S(0xfcd34d, { glow: 1.0, distortion: 0.6, rot: 0.6 }),
};

export var DEFAULT_STYLE = STATE_STYLES.idle;

// Per-frame "drive" envelope: how energetic the orb is right now. This is
// the ONLY place ambient per-state motion is shaped, and every branch is a
// function of real inputs: the server-pushed FSM state (+ time in state),
// the analyser level of audio actually playing, the mic worklet rms, and
// one-shot impulses (burst on `interrupted` entry, bloom on `done` entry).
// Nothing here invents fake "activity" while the system is quiet.
//
// thinking's ramp+jitter shaping is ported from
// jincocodev/openclaw-jarvis-ui core/scene.js (updateAnomaly state machine).
export function driveTarget(state, tSec, elapsedSec, audioLevel, micLevel, burst, bloom) {
  switch (state) {
    case "listening":
      return 0.1 + micLevel * 1.5;
    case "transcribing":
      return 0.18 + 0.06 * Math.sin(tSec * 2.4);
    case "thinking": {
      var ramp = 0.35 + Math.min(elapsedSec / 8, 1) * 0.5;
      var jitter = Math.sin(elapsedSec * 2.3) * 0.12 + Math.sin(elapsedSec * 5.7) * 0.08 + Math.sin(elapsedSec * 11.3) * 0.04;
      return ramp + jitter * 0.8;
    }
    case "memory":
      return 0.16 + 0.05 * Math.sin(tSec * 1.2);
    case "capability":
      return 0.18 + 0.04 * Math.sin(tSec * 1.6);
    case "tool": {
      // mechanical pulse: hard-edged tick instead of a smooth breath
      var ph = 0.5 + 0.5 * Math.sin(tSec * 5.2);
      var mech = ph < 0.6 ? 0 : (ph - 0.6) / 0.4;
      return 0.12 + mech * mech * 0.55;
    }
    case "delegating":
      return 0.26 + 0.05 * Math.sin(tSec * 1.6);
    case "worker_progress":
      return 0.2 + 0.04 * Math.sin(tSec * 2.0);
    case "speaking":
      return 0.12 + audioLevel * 1.2;
    case "interrupted":
      return 0.12 + burst * 1.2;
    case "blocked":
    case "error":
      // slow red pulse (~0.35Hz)
      return 0.06 + 0.06 * (0.5 + 0.5 * Math.sin(tSec * 2.2));
    case "done":
      return 0.12 + bloom * 1.6;
    case "idle":
    default:
      // slow breath
      return 0.05 + 0.04 * Math.sin(tSec * 0.5);
  }
}
