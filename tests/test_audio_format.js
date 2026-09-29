// test-audio-format.js — Node-runnable regression test for the TTS chunk
// boundary click bug.
//
// Invoked from pytest via tests/test_audio_format.py (subprocess). Run
// standalone with: node tests/test_audio_format.js
//
// The bug: queueChunk() in audio-out.js used to hand raw int16 samples to
// the AudioWorklet FIFO with no boundary processing. When a chunk had a
// non-zero DC offset (or, when the AudioContext ran at a sample rate !=
// 24 kHz and the per-chunk linear resampler landed on a slightly
// different boundary value than the previous chunk's tail), the
// discontinuity at the boundary produced an audible click. The fix lives
// in ui/src/audio-format.js: raised-cosine fade at every chunk head and
// tail (so adjacent chunks meet through a smooth taper), and a
// windowed-sinc resampler that does not propagate boundary errors.
//
// This test synthesizes two contiguous chunks with a deliberate DC step
// between them, runs them through both the old (no-fade, naive-linear) and
// new (fade + windowed-sinc) pipelines, and asserts:
//   * the old pipeline emits a click above the threshold,
//   * the new pipeline stays below it.
//
// Threshold rationale: a true sample-for-sample step of 0.5 in [-1, 1]
// is the loudest possible click and obviously clicky. We synthesize a
// smaller DC offset (0.05) which still audibly clicks in the OLD path but
// stays imperceptible (well below the 0.005 peak-derivative threshold) in
// the NEW path.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ui/src/audio-format.js is authored as an ES module (the dashboard bundle
// imports it as such). Node's CJS loader can't require() an ESM file, so we
// copy it next to ourselves as a .mjs shim, then dynamic-import it. The
// shim lives in os.tmpdir() so concurrent test runs don't trip over each
// other.
const SRC = path.join(__dirname, '..', 'ui', 'src', 'audio-format.js');
const SHIM = path.join(os.tmpdir(), 'audio-format-' + process.pid + '-' + Date.now() + '.mjs');
fs.copyFileSync(SRC, SHIM);

// Clean up the shim when we're done (success OR failure). Node exits fast
// either way, but be a good citizen.
process.on('exit', () => {
  try { fs.unlinkSync(SHIM); } catch (e) { /* noop */ }
});

// Naive per-chunk linear resampler — the old resampleLinear() from
// audio-out.js. Kept verbatim so the regression test exercises the actual
// historical bug.
function resampleLinearOld(src, srcRate, dstRate) {
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

async function main() {
  const fmt = await import(SHIM);

  // Old pipeline: convert to Float32, optionally resample (linear),
  // NO fade — this is the historical queueChunk() path.
  function oldPipeline(int16, dstRate) {
    var f32 = fmt.int16ToFloat32(int16);
    return dstRate === fmt.TARGET_SOURCE_RATE ? f32 : resampleLinearOld(f32, fmt.TARGET_SOURCE_RATE, dstRate);
  }

  // New pipeline: convert to Float32, optionally resample (windowed-sinc),
  // apply the boundary fade. This is what pcmChunkToFloat32() does.
  function newPipeline(int16, dstRate) {
    return fmt.pcmChunkToFloat32(int16, dstRate);
  }

  // Build a quiet sine + a deliberate DC offset. Returns Int16 samples.
  // offset is added to all samples (DC), so the wave hovers around
  // `offset` instead of around zero. A real TTS chunk that ends mid-word
  // often has a small DC offset; a chunk that starts at a different
  // amplitude has an even bigger step between tail and head.
  function synthChunk(nSamples, freqHz, sampleRate, offset, amp) {
    var i16 = new Int16Array(nSamples);
    for (var i = 0; i < nSamples; i++) {
      var s = offset + amp * Math.sin(2 * Math.PI * freqHz * (i / sampleRate));
      i16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    return i16;
  }

  // Run a scenario: two adjacent chunks, possibly with different DC
  // offsets, possibly with the destination rate != source rate. Returns
  // { oldLocalD, newLocalD } where localD is the peak derivative observed
  // at the chunk boundary itself (the last sample of chunk1 vs the first
  // sample of chunk2) plus derivatives inside each chunk's fade window.
  //
  // We synthesize CONSTANT inputs (a DC value, no sine) so the only
  // derivative inside the window is the one introduced by the pipeline
  // itself — there is no underlying waveform to mask it. (A sine wave's
  // natural derivative at amp 0.3, freq 220 Hz, 24 kHz sample rate is
  // ~0.017, which would drown out the boundary click we're testing for
  // no matter which pipeline produced it.)
  function runScenario(opts) {
    var srcRate = fmt.TARGET_SOURCE_RATE;
    var dstRate = opts.dstRate;
    // Constant int16 chunks at amplitude opts.amp1 / opts.amp2. We round
    // to int16 then convert back so the pipeline goes through the same
    // int16 -> float32 quantization as a real TTS chunk would.
    function constantChunk(value) {
      var v = Math.max(-1, Math.min(1, value));
      var i16 = Math.round(v * 32767);
      var arr = new Int16Array(opts.nSamples);
      arr.fill(i16);
      return arr;
    }
    var chunk1 = constantChunk(opts.amp1);
    var chunk2 = constantChunk(opts.amp2);

    var old1 = oldPipeline(chunk1, dstRate);
    var old2 = oldPipeline(chunk2, dstRate);

    var new1 = newPipeline(chunk1, dstRate);
    var new2 = newPipeline(chunk2, dstRate);

    var fadeWindow = fmt.fadeSamplesForRate(dstRate);

    // The boundary click we're hunting is the step in audio value at the
    // chunk join. We measure:
    //   * the absolute step at the join (last of chunk1 vs first of chunk2)
    //   * the peak sample-to-sample derivative INSIDE the fade taper on
    //     either side (for the OLD path, the fade isn't applied so this
    //     is also the natural derivative of a constant input = 0; for the
    //     NEW path, the fade creates a small ramp whose slope should stay
    //     under the threshold).
    function boundaryStats(arr1, arr2) {
      var joinStep = Math.abs(arr2[0] - arr1[arr1.length - 1]);
      var m = joinStep;
      var i;
      for (i = Math.max(1, arr1.length - fadeWindow); i < arr1.length; i++) {
        var d = Math.abs(arr1[i] - arr1[i - 1]);
        if (d > m) m = d;
      }
      for (i = 1; i < Math.min(arr2.length, fadeWindow); i++) {
        var d2 = Math.abs(arr2[i] - arr2[i - 1]);
        if (d2 > m) m = d2;
      }
      return m;
    }

    return {
      oldLocalD: boundaryStats(old1, old2),
      newLocalD: boundaryStats(new1, new2),
    };
  }

  var failures = 0;
  var passes = 0;

  function assert(cond, label) {
    if (cond) {
      passes++;
      console.log('  PASS  ' + label);
    } else {
      failures++;
      console.log('  FAIL  ' + label);
    }
  }

  console.log('audio-format regression suite');

  // --- Scenario 1: AudioContext at the wire rate (24 kHz), two chunks
  //     with a 0.05 amplitude step between them (constant DC, no sine).
  //     The OLD pipeline hands both chunks to the FIFO with a step at
  //     the boundary. The NEW pipeline's raised-cosine fade smooths it.
  {
    var r = runScenario({
      dstRate: 24000,
      nSamples: 2880,
      amp1: 0.10,
      amp2: 0.15,
    });
    assert(r.oldLocalD > 0.04, 'S1 old path produces a click at the boundary (peak d > 0.04)');
    assert(r.newLocalD < 0.005, 'S1 new path: boundary fade keeps derivative under 0.005');
  }

  // --- Scenario 2: same DC level, big amplitude jump between chunks
  //     (simulates TTS restarting after a sentence break with the new
  //     phoneme at a much louder envelope). Even with a 0.40 step, the
  //     fade must keep the peak derivative well below a hard step.
  {
    var r = runScenario({
      dstRate: 24000,
      nSamples: 2880,
      amp1: 0.10,
      amp2: 0.50,
    });
    assert(r.oldLocalD > 0.3, 'S2 old path: amplitude jump produces a click at the boundary');
    // Threshold here is higher than S1 because the fade's maximum slope
    // scales with step size: peak d ~= stepSize * pi / (2*fadeLen).
    // For step 0.40, fadeLen 120, that's 0.40 * pi/240 ~= 0.0052.
    // Still 100x smaller than the OLD path's hard step (0.40).
    assert(r.newLocalD < 0.01, 'S2 new path: amplitude jump smoothed to <0.01 (vs 0.40 in old path)');
  }

  // --- Scenario 3: AudioContext at 48 kHz (typical desktop browser) with
  //     matching amplitudes. The OLD naive linear resampler rounds the
  //     boundary samples independently per chunk. The NEW windowed-sinc
  //     resampler has zero contribution from out-of-window samples so
  //     adjacent chunks stitch cleanly.
  {
    var r = runScenario({
      dstRate: 48000,
      nSamples: 2880,
      amp1: 0.30,
      amp2: 0.30,
    });
    assert(r.newLocalD < 0.005, 'S3 new path: 48kHz boundary derivative under 0.005');
  }

  // --- Scenario 4: AudioContext at 48 kHz, a real amplitude step
  //     between chunks. Both the resampler AND the step compound to a
  //     click in the OLD path. The NEW path's windowed-sinc + fade
  //     should still hold the boundary under threshold.
  {
    var r = runScenario({
      dstRate: 48000,
      nSamples: 2880,
      amp1: 0.10,
      amp2: 0.15,
    });
    assert(r.oldLocalD > 0.04, 'S4 old path: 48kHz with amplitude step produces a click');
    assert(r.newLocalD < 0.005, 'S4 new path: 48kHz with amplitude step, boundary derivative under 0.005');
  }

  // --- Scenario 5: iOS Safari runs the AudioContext at the hardware
  //     rate (often 44.1 kHz). Same story as scenario 4 but at a
  //     non-integer resample ratio.
  {
    var r = runScenario({
      dstRate: 44100,
      nSamples: 2880,
      amp1: 0.10,
      amp2: 0.15,
    });
    assert(r.oldLocalD > 0.04, 'S5 old path: 44.1kHz with amplitude step produces a click');
    assert(r.newLocalD < 0.005, 'S5 new path: 44.1kHz with amplitude step, boundary derivative under 0.005');
  }

  // --- Scenario 6: Fade does NOT alter in-chunk content. After the
  //     fade window (first/last fadeLen samples), the rest of the chunk
  //     is the same as the input.
  {
    var nSamples = 2880;
    var srcRate = fmt.TARGET_SOURCE_RATE;
    var chunk = synthChunk(nSamples, 440, srcRate, 0.0, 0.5);
    var out = newPipeline(chunk, srcRate);
    var orig = fmt.int16ToFloat32(chunk);
    var maxDiff = 0;
    var from = Math.floor(nSamples / 4);
    var to = Math.floor((3 * nSamples) / 4);
    for (var i = from; i < to; i++) {
      var d = Math.abs(orig[i] - out[i]);
      if (d > maxDiff) maxDiff = d;
    }
    assert(maxDiff < 1e-6, 'S6 fade does not affect samples outside the fade window');
  }

  // --- Scenario 7: Edge case — very short chunk (smaller than
  //     2*fadeLen). The fade should clamp to floor(len/2) and still
  //     apply, not crash.
  {
    var tiny = synthChunk(20, 440, fmt.TARGET_SOURCE_RATE, 0.01, 0.3);
    var threw = false;
    try { newPipeline(tiny, fmt.TARGET_SOURCE_RATE); } catch (e) { threw = true; }
    assert(!threw, 'S7 fade handles tiny chunks (< 2*fadeLen) without throwing');
  }

  // --- Scenario 8: Edge case — empty input. Must not throw and must
  //     return an empty Float32Array (so the worklet postMessage carries
  //     a no-op sample buffer).
  {
    var empty = new Int16Array(0);
    var out = newPipeline(empty, fmt.TARGET_SOURCE_RATE);
    assert(out && out.length === 0, 'S8 empty input returns an empty Float32Array');
  }

  // --- Scenario 9: Resampler normalization. A pure DC input at the
  //     source rate must resample to the same DC value at the
  //     destination rate (within numerical precision). This proves the
  //     windowed-sinc kernel sums to unity, which is the property the
  //     boundary click fix relies on (no amplitude drift across the
  //     resample step).
  {
    var dc = 0.25;
    var inArr = new Float32Array(2400); // 100 ms at 24 kHz
    inArr.fill(dc);
    var out = fmt.resampleWindowedSinc(inArr, 24000, 48000);
    var maxDev = 0;
    for (var i = 0; i < out.length; i++) {
      var d = Math.abs(out[i] - dc);
      if (d > maxDev) maxDev = d;
    }
    assert(maxDev < 1e-3, 'S9 windowed-sinc resampler preserves DC level');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});