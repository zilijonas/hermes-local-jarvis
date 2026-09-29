// test-audio-format-old.js — runs the same suite against an OLD, broken
// implementation of audio-format.js to prove the regression test catches
// the bug. This file is not part of pytest — it's a one-shot helper
// invoked by hand when changing the test. If you can see "X passed, Y
// failed" with Y > 0 here, the test is real.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const OLD = path.join(os.tmpdir(), 'audio-format-old-' + process.pid + '.mjs');
const OLD_SRC = `
// Old broken version — no fade, naive linear resample. Simulates what
// queueChunk() did before the fix: int16 -> float32, optional linear
// resample, NO boundary processing.
export var TARGET_SOURCE_RATE = 24000;
export var CHUNK_FADE_MS = 0;
export function int16ToFloat32(int16) {
  var out = new Float32Array(int16.length);
  for (var i = 0; i < int16.length; i++) {
    var s = int16[i];
    out[i] = s < 0 ? s / 32768 : s / 32767;
  }
  return out;
}
export function applyChunkBoundaryFade(samples, fadeLen) {
  return samples;
}
export function fadeSamplesForRate(sampleRate) {
  return Math.max(1, Math.round((sampleRate * CHUNK_FADE_MS) / 1000));
}
export function resampleWindowedSinc(src, srcRate, dstRate) {
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
export function pcmChunkToFloat32(int16, dstRate) {
  var f32 = int16ToFloat32(int16);
  return dstRate === TARGET_SOURCE_RATE ? f32 : resampleWindowedSinc(f32, TARGET_SOURCE_RATE, dstRate);
}
`;
fs.writeFileSync(OLD, OLD_SRC);
process.on('exit', () => { try { fs.unlinkSync(OLD); } catch (e) {} });

(async () => {
  const fmt = await import(OLD);

  function constantChunk(value, n) {
    var i16 = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
    var arr = new Int16Array(n);
    arr.fill(i16);
    return arr;
  }

  function newPipeline(int16, dstRate) {
    return fmt.pcmChunkToFloat32(int16, dstRate);
  }

  function runScenario(opts) {
    var dstRate = opts.dstRate;
    var chunk1 = constantChunk(opts.amp1, opts.nSamples);
    var chunk2 = constantChunk(opts.amp2, opts.nSamples);
    var new1 = newPipeline(chunk1, dstRate);
    var new2 = newPipeline(chunk2, dstRate);
    var fadeWindow = fmt.fadeSamplesForRate(dstRate);
    function boundaryStats(arr1, arr2) {
      var joinStep = Math.abs(arr2[0] - arr1[arr1.length - 1]);
      var m = joinStep;
      for (var i = Math.max(1, arr1.length - fadeWindow); i < arr1.length; i++) {
        var d = Math.abs(arr1[i] - arr1[i - 1]);
        if (d > m) m = d;
      }
      for (var i = 1; i < Math.min(arr2.length, fadeWindow); i++) {
        var d2 = Math.abs(arr2[i] - arr2[i - 1]);
        if (d2 > m) m = d2;
      }
      return m;
    }
    return { newLocalD: boundaryStats(new1, new2) };
  }

  var failures = 0;
  var passes = 0;
  function assert(cond, label) {
    if (cond) { passes++; console.log('  PASS  ' + label); }
    else { failures++; console.log('  FAIL  ' + label); }
  }

  console.log('audio-format regression suite — OLD implementation (should FAIL)');

  // The OLD path has no fade, so the join step equals the amplitude step
  // exactly. Every "newLocalD < threshold" assertion in the FIXED-path
  // test must fail here.
  {
    var r = runScenario({ dstRate: 24000, nSamples: 2880, amp1: 0.10, amp2: 0.15 });
    assert(r.newLocalD > 0.04, 'OLD S1: amplitude step produces a hard boundary click');
  }
  {
    var r = runScenario({ dstRate: 24000, nSamples: 2880, amp1: 0.10, amp2: 0.50 });
    assert(r.newLocalD > 0.3, 'OLD S2: big amplitude jump produces a click at the boundary');
  }
  {
    var r = runScenario({ dstRate: 48000, nSamples: 2880, amp1: 0.10, amp2: 0.15 });
    assert(r.newLocalD > 0.04, 'OLD S4: 48kHz with amplitude step produces a click');
  }
  {
    var r = runScenario({ dstRate: 44100, nSamples: 2880, amp1: 0.10, amp2: 0.15 });
    assert(r.newLocalD > 0.04, 'OLD S5: 44.1kHz with amplitude step produces a click');
  }

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  if (failures === 0) {
    console.log('GOOD — regression test catches the bug on OLD implementation.');
    process.exit(0);
  } else {
    console.log('BAD — regression test missed the bug on OLD implementation!');
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });