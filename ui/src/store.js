// store.js — tiny framework-agnostic pub/sub state container, plus a React
// hook to subscribe to it.
//
// High-frequency signals (mic rms ~20Hz, tts.amp ~30Hz) deliberately bypass
// this store entirely and are pushed straight into visualizer.js's imperative
// onAmp()/onMicLevel() API — routing those through React state would mean
// 20-30 re-renders/sec of the whole panel tree for data only the canvas
// needs. Only the lower-frequency application state that panels/transcript
// text actually render from lives here.
import { getHooks } from "./sdk.js";

export function createStore(initial) {
  var state = initial;
  var listeners = new Set();

  function get() {
    return state;
  }
  function set(patch) {
    state = Object.assign({}, state, typeof patch === "function" ? patch(state) : patch);
    listeners.forEach(function (fn) {
      fn(state);
    });
    return state;
  }
  function subscribe(fn) {
    listeners.add(fn);
    return function () {
      listeners.delete(fn);
    };
  }
  return { get: get, set: set, subscribe: subscribe };
}

export function useStore(store) {
  var hooks = getHooks();
  var useState = hooks.useState;
  var useEffect = hooks.useEffect;
  var pair = useState(store.get());
  var value = pair[0];
  var setValue = pair[1];
  useEffect(
    function () {
      setValue(store.get());
      return store.subscribe(setValue);
    },
    [store]
  );
  return value;
}

// Append-with-cap helper for timeline/log-like lists.
export function pushCapped(arr, item, max) {
  var next = arr.concat([item]);
  if (next.length > max) next = next.slice(next.length - max);
  return next;
}

// Rolling p50/p95 tracker per named latency stage (e2e_first_audio, stt,
// mediator_first_token, ...) fed by `latency` events per docs/SPEC.md.
export function createLatencyTracker(windowSize) {
  var size = windowSize || 20;
  var samples = {};

  function record(stage, ms) {
    var arr = (samples[stage] || []).concat([ms]);
    if (arr.length > size) arr = arr.slice(arr.length - size);
    samples[stage] = arr;
  }
  function percentile(stage, p) {
    var arr = samples[stage];
    if (!arr || !arr.length) return null;
    var sorted = arr.slice().sort(function (a, b) {
      return a - b;
    });
    var idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return Math.round(sorted[idx]);
  }
  function summary() {
    var out = {};
    Object.keys(samples).forEach(function (stage) {
      out[stage] = {
        p50: percentile(stage, 0.5),
        p95: percentile(stage, 0.95),
        n: samples[stage].length,
      };
    });
    return out;
  }
  return { record: record, summary: summary };
}
