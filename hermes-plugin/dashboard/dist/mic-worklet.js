(() => {
  // src/worklets/mic-worklet.js
  var MicWorkletProcessor = class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      var po = options && options.processorOptions || {};
      this.targetRate = po.targetSampleRate || 16e3;
      this.srcRate = po.sourceSampleRate || sampleRate;
      this.step = this.srcRate / this.targetRate;
      this.carry = new Float32Array(0);
      this.readPos = 0;
      this.chunkSamples = Math.max(1, Math.round(this.targetRate * 0.04));
      this.outBuf = new Int16Array(this.chunkSamples);
      this.outPos = 0;
      this.levelSum = 0;
      this.levelCount = 0;
      this.levelReportEvery = Math.max(1, Math.round(this.srcRate * 0.05));
    }
    process(inputs) {
      var input = inputs[0];
      if (!input || !input[0]) return true;
      var channel = input[0];
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
        if (i1 >= buf.length) break;
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
      var consumedWhole = Math.floor(pos);
      this.carry = buf.slice(consumedWhole);
      this.readPos = pos - consumedWhole;
      return true;
    }
  };
  registerProcessor("mic-worklet", MicWorkletProcessor);
})();
