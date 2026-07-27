// audio-out.js — low-latency TTS playback: queueChunk(int16 PCM @24kHz) ->
// AudioWorklet ring buffer -> speakers, with a hardStop() for barge-in
// (<150ms local silence per docs/SPEC.md, before the server even sees
// {"t":"barge_in"}).
//
// Tries to open the AudioContext at 24000Hz (matching the wire format
// exactly, so the worklet just plays samples 1:1 with no resampling cost).
// Not all browsers honor a requested sampleRate (notably Safari can ignore
// it) — when the context lands on a different rate we naive-linear-resample
// each incoming chunk on the main thread before handing it to the worklet.
import { assetUrl } from "./sdk.js";

export function createAudioOutput() {
  var TARGET_SOURCE_RATE = 24000;
  var audioCtx = null;
  var workletNode = null;
  var gainNode = null;
  var readyPromise = null;
  var pendingGain = 1;

  function ensureReady() {
    if (readyPromise) return readyPromise;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SOURCE_RATE });
    } catch (e) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    readyPromise = audioCtx.audioWorklet
      .addModule(assetUrl("player-worklet.js"))
      .then(function () {
        workletNode = new AudioWorkletNode(audioCtx, "player-worklet", { outputChannelCount: [1] });
        gainNode = audioCtx.createGain();
        gainNode.gain.value = pendingGain;
        workletNode.connect(gainNode).connect(audioCtx.destination);
      })
      .catch(function (err) {
        readyPromise = null; // allow retry on the next queueChunk()
        throw err;
      });
    return readyPromise;
  }

  // `data` is an ArrayBuffer/Int16Array of 24kHz mono s16le PCM (one TTS
  // chunk). Converts to Float32 and, if the context didn't land on 24kHz,
  // naive-linear-resamples to the context's actual rate before queueing.
  function queueChunk(data) {
    ensureReady()
      .then(function () {
        if (audioCtx.state === "suspended") audioCtx.resume();
        var int16 = data instanceof Int16Array ? data : new Int16Array(data);
        var float32 = int16ToFloat32(int16);
        var dstRate = audioCtx.sampleRate;
        var samples = dstRate === TARGET_SOURCE_RATE ? float32 : resampleLinear(float32, TARGET_SOURCE_RATE, dstRate);
        workletNode.port.postMessage({ type: "push", samples: samples }, [samples.buffer]);
      })
      .catch(function () {
        // addModule/AudioContext failure — already reflected via connection
        // status elsewhere; drop this chunk rather than throwing unhandled.
      });
  }

  // Barge-in: clear the worklet's ring buffer immediately. The message hits
  // the worklet's port within a single ~2.7-5.8ms render quantum, well under
  // the 150ms budget.
  function hardStop() {
    if (workletNode) workletNode.port.postMessage({ type: "clear" });
  }

  function setGain(v) {
    pendingGain = v;
    if (gainNode) gainNode.gain.value = v;
  }

  return { queueChunk: queueChunk, hardStop: hardStop, setGain: setGain };
}

function int16ToFloat32(int16) {
  var out = new Float32Array(int16.length);
  for (var i = 0; i < int16.length; i++) {
    var s = int16[i];
    out[i] = s < 0 ? s / 32768 : s / 32767;
  }
  return out;
}

function resampleLinear(src, srcRate, dstRate) {
  var ratio = srcRate / dstRate;
  var outLen = Math.max(1, Math.round(src.length / ratio));
  var out = new Float32Array(outLen);
  for (var i = 0; i < outLen; i++) {
    var pos = i * ratio;
    var i0 = Math.floor(pos);
    var i1 = Math.min(i0 + 1, src.length - 1);
    var frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}
