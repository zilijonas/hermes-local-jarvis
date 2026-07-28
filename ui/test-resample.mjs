#!/usr/bin/env node
// ui/test-resample.mjs — isolated unit check for the linear-interpolation
// resampler in src/worklets/mic-worklet.js. Run with: node ui/test-resample.mjs
//
// The worklet runs inside AudioWorkletGlobalScope and can't be `import`ed
// into plain Node, so the core interpolation loop is copied here verbatim
// (same math as MicWorkletProcessor.process()'s inner while-loop, applied to
// one flat buffer instead of the block-by-block + carry-buffer streaming
// version — mathematically identical per output sample; the carry buffer
// only exists to span 128-frame process() call boundaries).
//
// Verifies the failure mode the old accumulate-and-average decimator had on
// non-integer ratios (44100 -> 16000 = 2.75625): correct-ish output length,
// no NaN/Infinity, no clipping beyond [-1, 1].

function resampleLinear(input, srcRate, targetRate) {
  var step = srcRate / targetRate;
  var out = [];
  var pos = 0;
  while (true) {
    var i0 = Math.floor(pos);
    var i1 = i0 + 1;
    if (i1 >= input.length) break;
    var frac = pos - i0;
    out.push(input[i0] + (input[i1] - input[i0]) * frac);
    pos += step;
  }
  return out;
}

function makeSine(rate, seconds, freq) {
  var n = Math.round(rate * seconds);
  var buf = new Array(n);
  for (var i = 0; i < n; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return buf;
}

var SRC_RATE = 44100;
var TARGET_RATE = 16000;
var DURATION_S = 1.0;
var FREQ_HZ = 440;

var input = makeSine(SRC_RATE, DURATION_S, FREQ_HZ);
var output = resampleLinear(input, SRC_RATE, TARGET_RATE);

var ratio = SRC_RATE / TARGET_RATE; // 2.75625 — non-integer on purpose
var expectedLen = Math.floor((input.length - 2) / ratio) + 1;

var failures = [];

if (Math.abs(output.length - expectedLen) > 2) {
  failures.push("length mismatch: got " + output.length + ", expected ~" + expectedLen + " (ratio " + ratio + ")");
}
if (output.length === 0) {
  failures.push("output is empty");
}
if (output.length >= input.length) {
  failures.push("output not shorter than input — resample didn't downsample as expected");
}

var nanCount = 0;
var maxAbs = 0;
for (var i = 0; i < output.length; i++) {
  var v = output[i];
  if (!Number.isFinite(v)) nanCount++;
  var a = Math.abs(v);
  if (a > maxAbs) maxAbs = a;
}
if (nanCount > 0) failures.push(nanCount + " non-finite sample(s) in output");
if (maxAbs > 1.0001) failures.push("output amplitude out of expected [-1,1] range: " + maxAbs);

console.log("input samples:  " + input.length + " @ " + SRC_RATE + "Hz");
console.log("output samples: " + output.length + " @ " + TARGET_RATE + "Hz (ratio " + ratio.toFixed(5) + ")");
console.log("max |output|:   " + maxAbs.toFixed(4));

// Also exercise a second non-integer ratio (48000 -> 16000 = 3.0 is
// integer; 48000 -> 22050 = 2.1768707... is not) so the check isn't
// accidentally only validated against one fractional ratio.
var input2 = makeSine(48000, 0.5, 440);
var output2 = resampleLinear(input2, 48000, 22050);
var anyBad2 = output2.some(function (v) {
  return !Number.isFinite(v) || Math.abs(v) > 1.0001;
});
if (anyBad2) failures.push("secondary ratio (48000->22050) produced NaN/out-of-range samples");
console.log("secondary ratio 48000->22050: " + input2.length + " -> " + output2.length + " samples, ok=" + !anyBad2);

if (failures.length) {
  console.error("FAIL:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("OK: resampler produces correct length ratio, no NaN, no clipping.");
