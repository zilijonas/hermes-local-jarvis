// mic-worklet.js — AudioWorkletProcessor: resamples the device's native
// sample rate down to 16kHz mono via linear interpolation, emits ~40ms
// Int16 PCM chunks, and reports a running RMS level for the visualizer +
// the UI's mic-level meter.
//
// Linear interpolation (not integer-ratio decimation): the device's native
// rate is whatever the browser/OS actually gives us (e.g. 44100 or 48000
// Hz) — 44100/16000 = 2.75625, a non-integer ratio. A naive "keep every Nth
// sample" decimator only works cleanly for integer ratios; on a fractional
// ratio it drifts and the picked samples land at the wrong instants,
// producing audibly broken/aliased output. Linear interpolation instead
// walks a fractional read position (`readPos`) forward by `step` samples
// per output and blends the two nearest input samples — correct for any
// ratio, integer or not. `process()` is called every ~128-frame block, so a
// `carry` buffer holds whatever trailing input samples weren't yet consumed
// (readPos can land mid-block) across calls.
//
// Self-contained on purpose (no imports): AudioWorkletGlobalScope module
// loading via addModule() must not depend on the main bundle's module graph,
// and this keeps it portable across browsers with stricter worklet module
// support.
class MicWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    var po = (options && options.processorOptions) || {};
    this.targetRate = po.targetSampleRate || 16000;
    // Prefer the rate explicitly passed in from the main thread (the real
    // ctx.sampleRate, read before any hint could be ignored); fall back to
    // the AudioWorkletGlobalScope `sampleRate` global, which should already
    // agree with it.
    this.srcRate = po.sourceSampleRate || sampleRate;
    this.step = this.srcRate / this.targetRate; // may be non-integer, e.g. 2.75625

    this.carry = new Float32Array(0); // unconsumed tail samples from the previous block
    this.readPos = 0; // fractional read position into (carry ++ current block)

    this.chunkSamples = Math.max(1, Math.round(this.targetRate * 0.04)); // ~40ms
    this.outBuf = new Int16Array(this.chunkSamples);
    this.outPos = 0;

    this.levelSum = 0;
    this.levelCount = 0;
    this.levelReportEvery = Math.max(1, Math.round(this.srcRate * 0.05)); // ~50ms
  }

  process(inputs) {
    var input = inputs[0];
    if (!input || !input[0]) return true;
    var channel = input[0];

    // RMS level over the raw (native-rate) input — independent of, and
    // computed before, resampling.
    for (var i = 0; i < channel.length; i++) {
      var sample = channel[i];
      this.levelSum += sample * sample;
      this.levelCount++;
    }
    if (this.levelCount >= this.levelReportEvery) {
      var rms = Math.sqrt(this.levelSum / this.levelCount);
      this.port.postMessage({ type: "level", rms: Math.min(1, rms * 4) });
      this.levelSum = 0;
      this.levelCount = 0;
    }

    // buf = leftover carry from the previous block ++ this block.
    var buf;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + channel.length);
      buf.set(this.carry, 0);
      buf.set(channel, this.carry.length);
    } else {
      buf = channel;
    }

    var pos = this.readPos;
    while (true) {
      var i0 = Math.floor(pos);
      var i1 = i0 + 1;
      if (i1 >= buf.length) break; // not enough input yet for the next output sample
      var frac = pos - i0;
      var value = buf[i0] + (buf[i1] - buf[i0]) * frac;

      var clamped = Math.max(-1, Math.min(1, value));
      this.outBuf[this.outPos++] = clamped < 0 ? clamped * 32768 : clamped * 32767;

      if (this.outPos >= this.outBuf.length) {
        this.port.postMessage({ type: "chunk", buffer: this.outBuf.buffer }, [this.outBuf.buffer]);
        this.outBuf = new Int16Array(this.chunkSamples);
        this.outPos = 0;
      }

      pos += this.step;
    }

    // Carry the unconsumed tail into the next block, rebasing readPos
    // against the (now much shorter) carry buffer.
    var consumedWhole = Math.floor(pos);
    this.carry = buf.slice(consumedWhole);
    this.readPos = pos - consumedWhole;

    return true;
  }
}

registerProcessor("mic-worklet", MicWorkletProcessor);
