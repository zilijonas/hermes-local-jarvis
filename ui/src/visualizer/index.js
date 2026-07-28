// visualizer/index.js — public API for the intelligence core. The renderer
// itself lives in core.js (a 2D-canvas port of the design prototype's
// fibonacci-lattice core — three.js is gone, ~430KB off the bundle).
//
// Public API UNCHANGED from the previous three.js implementation, so app.js
// wiring stays thin:
//   createVisualizer(canvas) -> {
//     setState(state, detail)   FSM state from the server (SPEC §WebSocket;
//                               plus client-derived "offline")
//     onAmp(v)                  server tts.amp fallback (used only when the
//                               local AnalyserNode tap is unavailable)
//     onMicLevel(v)             mic worklet rms (drives the listening
//                               aperture + ripples)
//     onMemoryHits(items)       memory.hits payload -> constellation nodes
//     setAudioSource(fn)        audio-out.js getLevels; read ONCE per frame
//     setReducedMotion(v)       static frame + dashed state ring
//     resize() / destroy()
//   }
//
// Never fakes activity: every motion is a function of the server FSM state
// (+ time in state), the analyser level of audio actually being heard, the
// mic rms, or real memory hits. See core.js for the porting notes.
import { createCore } from "./core.js";

export function createVisualizer(canvas) {
  var core = createCore(canvas);

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
    },
  };
}
