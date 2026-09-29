// audio-format.js — pure-format helpers for TTS chunk playback.
//
// Extracted from audio-out.js so the boundary-discontinuity fix (crossfade at
// chunk heads/tails + windowed-sinc resampling) can be unit-tested under
// Node without a browser AudioContext. Browser-side audio-out.js still does
// the full pipeline (postMessage into the worklet FIFO), but it now imports
// the format functions from here so the same fade/resample logic runs in the
// test harness and in production.
//
// Wire format: 24 kHz mono s16le PCM, ~120 ms chunks (2880 samples). The
// server stitches these chunks together (with silence between them), so the
// client gets a stream of contiguous-or-gapped chunks of that rate.
//
// BUG we are fixing: when a chunk is queued into the worklet FIFO with a
// non-zero DC offset (or, when the AudioContext lands on a sample rate !=
// 24 kHz, when resampleLinear() rounds the boundary samples differently
// from the previous chunk's tail), the discontinuity at the chunk
// boundary produces an audible click. The fix: apply a short raised-cosine
// fade-in at the head and fade-out at the tail of every chunk so adjacent
// chunks meet through a tiny smooth taper instead of a step. For the
// resample case, also use a windowed-sinc kernel so the boundary
// interpolation matches on both sides.
//
// Latency budget: fade window is CHUNK_FADE_MS milliseconds (~5 ms = 120
// samples at 24 kHz), well under the 10 ms latency budget the task allows.
// The fade only touches samples that are already inside the chunk, so it
// adds no extra buffering.
export var TARGET_SOURCE_RATE = 24000;
export var CHUNK_FADE_MS = 5;

// int16 -> Float32 in [-1, 1). Symmetric divisor (-32768 vs 32767) keeps
// silence at exactly zero, which the crossfade expects.
export function int16ToFloat32(int16) {
  var out = new Float32Array(int16.length);
  for (var i = 0; i < int16.length; i++) {
    var s = int16[i];
    out[i] = s < 0 ? s / 32768 : s / 32767;
  }
  return out;
}

// Apply a raised-cosine fade-in to the first `fadeLen` samples and a
// matching fade-out to the last `fadeLen` samples. `fadeLen` samples must
// be <= floor(samples.length / 2) so the two fades don't overlap.
//
// Returns the same Float32Array (mutated in place — call sites already own
// it; no allocation). When fadeLen <= 0 or samples.length is too small,
// returns samples unchanged (a no-op for short final chunks).
export function applyChunkBoundaryFade(samples, fadeLen) {
  if (!samples || samples.length === 0) return samples;
  if (!fadeLen || fadeLen <= 0) return samples;
  var maxFade = Math.floor(samples.length / 2);
  if (fadeLen > maxFade) fadeLen = maxFade;
  for (var i = 0; i < fadeLen; i++) {
    // Raised cosine: 0 at the very edge, 1 in the middle. cos^2 window has
    // a smooth derivative at both endpoints so the slope into the next
    // chunk starts AND ends at zero — no audible click at the boundary,
    // and no audible bump where the fade stops. amplitude(0) = 0,
    // amplitude(fadeLen) = 1 (cos(pi/2) = 0, but squared -> 0 again,
    // so use cos(pi/2) which actually goes through 0 cleanly).
    var w = 0.5 - 0.5 * Math.cos((i / fadeLen) * Math.PI); // 0..1
    samples[i] *= w;
    samples[samples.length - 1 - i] *= w;
  }
  return samples;
}

// fadeLen at a given sample rate, rounded to whole samples. Useful so
// callers can compute it once from CHUNK_FADE_MS.
export function fadeSamplesForRate(sampleRate) {
  return Math.max(1, Math.round((sampleRate * CHUNK_FADE_MS) / 1000));
}

// Windowed-sinc resampler. Replaces the old naive per-chunk
// resampleLinear(), which interpolated linearly between adjacent samples
// and amplified boundary discontinuities whenever the chunk's tail sample
// differed from the next chunk's head.
//
// Strategy: for each output index i, we look at a small window of input
// samples centered on the ideal source position (i * srcRate / dstRate),
// compute the sinc value at the fractional offset, multiply by a Hann
// window (so the kernel tails go to zero smoothly), and sum. With a
// half-width of 4 samples and a Hann window the kernel has ~60 dB stopband
// rejection — vastly more than linear — and the kernel itself is zero at
// integer sample positions (where it would otherwise leak energy from
// neighbouring samples into a boundary step). For non-integer positions
// the kernel's tail reaches zero at +/- halfWidth, so the contribution
// from samples that might be on the OTHER side of a chunk boundary is
// already multiplied by zero — meaning even a hard boundary step at the
// chunk's last sample contributes no audible energy to the next chunk's
// first resampled output.
//
// `src` is mutated only as a side effect of the lookup (read-only access).
export function resampleWindowedSinc(src, srcRate, dstRate) {
  var ratio = srcRate / dstRate;
  var outLen = Math.max(1, Math.round(src.length / ratio));
  var out = new Float32Array(outLen);
  var halfWidth = 4; // samples on each side of the center

  // Hann window: w[k] = 0.5 * (1 - cos(2*pi*k / (2*halfWidth)))
  var hann = new Float32Array(2 * halfWidth);
  for (var k = 0; k < 2 * halfWidth; k++) {
    hann[k] = 0.5 * (1 - Math.cos((Math.PI * k) / halfWidth));
  }

  for (var i = 0; i < outLen; i++) {
    var center = i * ratio;
    var i0 = Math.floor(center);
    var frac = center - i0;
    var sum = 0;
    var wsum = 0;
    for (var m = -halfWidth; m < halfWidth; m++) {
      var idx = i0 + m;
      // sinc at fractional offset (1 - frac) for the right side of the
      // center, frac for the left side, normalized so the kernel peaks
      // at 1 at the center.
      var sinc;
      if (m === 0) {
        sinc = 1.0;
      } else if (idx < 0 || idx >= src.length) {
        // Out-of-bounds: contributes nothing (kernel tail is ~0 anyway
        // through the Hann window at this distance).
        continue;
      } else {
        var x = m - frac;
        if (x === 0) {
          sinc = 1.0;
        } else {
          var piX = Math.PI * x;
          sinc = Math.sin(piX) / piX;
        }
      }
      var wk = hann[m + halfWidth];
      sum += src[idx] * sinc * wk;
      wsum += sinc * wk;
    }
    // Normalize by the kernel mass so a DC input produces DC output.
    out[i] = wsum > 0 ? sum / wsum : 0;
  }
  return out;
}

// Convenience: convert raw int16 wire bytes/array to a Float32 chunk at
// the destination sample rate, with the boundary fade already applied.
// `dstRate` should be the AudioContext's actual sample rate. The fade is
// computed at `dstRate` so it stays a fixed number of milliseconds.
export function pcmChunkToFloat32(int16, dstRate) {
  var f32 = int16ToFloat32(int16);
  var out = dstRate === TARGET_SOURCE_RATE ? f32 : resampleWindowedSinc(f32, TARGET_SOURCE_RATE, dstRate);
  var fadeLen = fadeSamplesForRate(dstRate);
  return applyChunkBoundaryFade(out, fadeLen);
}