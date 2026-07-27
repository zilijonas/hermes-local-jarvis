// mic-worklet.js — AudioWorkletProcessor: decimates the device's native
// sample rate down to 16kHz mono via simple accumulate-and-average low-pass
// filtering (a cheap anti-alias before dropping samples), emits ~40ms Int16
// PCM chunks, and reports a running RMS level for the visualizer.
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
    this.srcRate = sampleRate; // AudioWorkletGlobalScope global: context's native rate
    this.ratio = this.srcRate / this.targetRate;

    this.acc = 0;
    this.accCount = 0;
    this.phase = 0;

    this.chunkSamples = Math.max(1, Math.round(this.targetRate * 0.04)); // ~40ms
    this.outBuf = new Int16Array(this.chunkSamples);
    this.outPos = 0;

    this.levelSum = 0;
    this.levelCount = 0;
    this.levelReportEvery = Math.max(1, Math.round(this.srcRate * 0.05)); // ~50ms
  }

  process(inputs) {
    var input = inputs[0];
    if (input && input[0]) {
      var channel = input[0];
      for (var i = 0; i < channel.length; i++) {
        var sample = channel[i];

        this.levelSum += sample * sample;
        this.levelCount++;

        this.acc += sample;
        this.accCount++;
        this.phase += 1;
        if (this.phase >= this.ratio) {
          this.phase -= this.ratio;
          var avg = this.accCount > 0 ? this.acc / this.accCount : 0;
          this.acc = 0;
          this.accCount = 0;

          var clamped = Math.max(-1, Math.min(1, avg));
          this.outBuf[this.outPos++] = clamped < 0 ? clamped * 32768 : clamped * 32767;

          if (this.outPos >= this.outBuf.length) {
            this.port.postMessage({ type: "chunk", buffer: this.outBuf.buffer }, [this.outBuf.buffer]);
            this.outBuf = new Int16Array(this.chunkSamples);
            this.outPos = 0;
          }
        }
      }

      if (this.levelCount >= this.levelReportEvery) {
        var rms = Math.sqrt(this.levelSum / this.levelCount);
        this.port.postMessage({ type: "level", rms: Math.min(1, rms * 4) });
        this.levelSum = 0;
        this.levelCount = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-worklet", MicWorkletProcessor);
