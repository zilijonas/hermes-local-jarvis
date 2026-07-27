// audio-in.js — mic capture: getUserMedia -> AudioWorklet (decimates device
// rate down to 16kHz mono s16le) -> onChunk(ArrayBuffer)/onLevel(rms).
//
// The audio graph (getUserMedia + AudioContext + worklet) is built once and
// kept alive across push-to-talk presses — only a boolean `active` flag
// (checked inside the worklet-message handler) gates whether chunks are
// forwarded to the caller. This keeps repeat-PTT latency low: the first
// press pays for mic permission + graph setup, every press after that is
// just flipping a flag.
import { assetUrl } from "./sdk.js";

export function createMicInput(opts) {
  var onChunk = (opts && opts.onChunk) || function () {};
  var onLevel = (opts && opts.onLevel) || function () {};

  var audioCtx = null;
  var workletNode = null;
  var sourceNode = null;
  var stream = null;
  var active = false;
  var readyPromise = null;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);
  }

  function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })
      .then(function (s) {
        stream = s;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.audioWorklet.addModule(assetUrl("mic-worklet.js")).then(function () {
          sourceNode = audioCtx.createMediaStreamSource(stream);
          workletNode = new AudioWorkletNode(audioCtx, "mic-worklet", {
            processorOptions: { targetSampleRate: 16000 },
          });
          workletNode.port.onmessage = function (ev) {
            var data = ev.data;
            if (data.type === "chunk") {
              if (active) onChunk(data.buffer);
            } else if (data.type === "level") {
              onLevel(data.rms);
            }
          };
          // Intentionally not connected to audioCtx.destination — capture only,
          // no local monitoring/echo.
          sourceNode.connect(workletNode);
        });
      })
      .catch(function (err) {
        readyPromise = null; // allow retry on the next start()
        throw err;
      });
    return readyPromise;
  }

  // Fire-and-forget: `active` flips synchronously so a caller that already
  // sent {t:"mic.start"} won't race the (possibly slow, permission-gated)
  // graph setup — once the worklet starts producing chunks, `active` is
  // already true and they flow immediately.
  function start() {
    active = true;
    ensureReady()
      .then(function () {
        if (audioCtx.state === "suspended") return audioCtx.resume();
      })
      .catch(function () {
        active = false;
      });
  }

  function stop() {
    active = false;
  }

  function teardown() {
    active = false;
    if (workletNode) {
      try {
        workletNode.disconnect();
      } catch (e) {
        /* noop */
      }
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch (e) {
        /* noop */
      }
    }
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch (e) {
        /* noop */
      }
      audioCtx = null;
    }
    readyPromise = null;
  }

  return { start: start, stop: stop, teardown: teardown, isSupported: supported() };
}
