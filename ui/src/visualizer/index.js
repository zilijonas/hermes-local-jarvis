// visualizer/index.js — public API for the Jarvis orb. The renderer lives in
// core.js (WebGL shader orb-gl.js, Canvas 2D fallback orb-2d.js); state
// tables in states.js; theme colours in palette.js.
//
// Public API unchanged, so app.js wiring stays thin:
//   createVisualizer(canvas) -> {
//     setState(state, detail)   FSM state from the server (SPEC §WebSocket;
//                               plus client-derived "offline")
//     onAmp(v)                  server tts.amp fallback (used only when the
//                               local AnalyserNode tap is unavailable)
//     onMicLevel(v)             mic worklet rms (listening swell)
//     onMemoryHits(items)       memory.hits payload -> memory motes
//     setAudioSource(fn)        audio-out.js getLevels; read ONCE per frame
//     setReducedMotion(v)       one static, state-coloured frame per change
//     resize() / destroy()
//   }
//
// Never fakes activity: every motion is a function of the server FSM state
// (+ time in state), the analyser level of audio actually being heard, the
// mic rms, or real memory hits.
//
// QA hook: the most recent instance is exposed as window.__jarvisOrb
// ({ force(state|null), levels(fn|null), mic(v), stats() }). Inert unless
// called; cleared on destroy.
import { createCore } from "./core.js";

export function createVisualizer(canvas) {
  var core = createCore(canvas);
  if (typeof window !== "undefined") window.__jarvisOrb = core.debug;

  return {
    setState: function (state, detail) {
      void detail; // caption text renders the detail; the core keys off state
      core.setState(state);
    },
    onAmp: function (v) {
      core.onAmp(v);
    },
    onMicLevel: function (v) {
      core.onMicLevel(v);
    },
    onMemoryHits: function (items) {
      core.setHits(items);
    },
    setAudioSource: function (fn) {
      core.setAudioSource(fn);
    },
    setReducedMotion: function (v) {
      core.setReducedMotion(v);
    },
    resize: function () {
      core.resize();
    },
    destroy: function () {
      core.destroy();
      if (typeof window !== "undefined" && window.__jarvisOrb === core.debug) window.__jarvisOrb = null;
    },
  };
}
