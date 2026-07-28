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

  // AnalyserNode tap for the visualizer: worklet -> gain -> analyser ->
  // destination, so getLevels() measures the audio the user actually hears
  // (volume changes included) — not server-side amp events.
  var analyser = null;
  var freqData = null;
  var timeFloat = null;
  var timeByte = null;
  var bandBins = null; // [lowEnd, midEnd, highEnd] as bin indices
  var levelsOut = { level: 0, low: 0, mid: 0, high: 0 };

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
        try {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.5;
          freqData = new Uint8Array(analyser.frequencyBinCount);
          if (typeof analyser.getFloatTimeDomainData === "function") {
            timeFloat = new Float32Array(analyser.fftSize);
          } else {
            timeByte = new Uint8Array(analyser.fftSize);
          }
          // band edges in Hz -> bin indices for the actual context rate
          var binHz = audioCtx.sampleRate / analyser.fftSize;
          bandBins = [Math.round(250 / binHz), Math.round(2000 / binHz), Math.min(analyser.frequencyBinCount, Math.round(6000 / binHz))];
          workletNode.connect(gainNode);
          gainNode.connect(analyser);
          analyser.connect(audioCtx.destination);
        } catch (e) {
          // Analyser unavailable — playback still works, visualizer falls
          // back to server tts.amp events (getLevels() stays null).
          analyser = null;
          workletNode.connect(gainNode).connect(audioCtx.destination);
        }
      })
      .catch(function (err) {
        readyPromise = null; // allow retry on the next queueChunk()
        throw err;
      });
    return readyPromise;
  }

  // Called by the visualizer ONCE PER FRAME. Returns null when the analyser
  // tap isn't available/running (caller then falls back to tts.amp events).
  // The returned object is reused across calls — read, don't retain.
  function getLevels() {
    if (!analyser || !audioCtx || audioCtx.state !== "running") return null;
    var i;
    var rms = 0;
    if (timeFloat) {
      analyser.getFloatTimeDomainData(timeFloat);
      for (i = 0; i < timeFloat.length; i++) rms += timeFloat[i] * timeFloat[i];
      rms = Math.sqrt(rms / timeFloat.length);
    } else {
      analyser.getByteTimeDomainData(timeByte);
      for (i = 0; i < timeByte.length; i++) {
        var v = (timeByte[i] - 128) / 128;
        rms += v * v;
      }
      rms = Math.sqrt(rms / timeByte.length);
    }
    analyser.getByteFrequencyData(freqData);
    var sums = [0, 0, 0];
    var counts = [0, 0, 0];
    var band = 0;
    for (i = 0; i < bandBins[2]; i++) {
      while (band < 2 && i >= bandBins[band]) band++;
      sums[band] += freqData[i];
      counts[band]++;
    }
    levelsOut.level = Math.min(1, rms * 4.5);
    levelsOut.low = counts[0] ? sums[0] / (counts[0] * 255) : 0;
    levelsOut.mid = counts[1] ? sums[1] / (counts[1] * 255) : 0;
    levelsOut.high = counts[2] ? sums[2] / (counts[2] * 255) : 0;
    return levelsOut;
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

  return { queueChunk: queueChunk, hardStop: hardStop, setGain: setGain, getLevels: getLevels };
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
