(() => {
  // src/worklets/player-worklet.js
  var PlayerWorkletProcessor = class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.maxSamples = Math.max(1, Math.round(sampleRate * 120));
      this.chunks = [];
      this.readOffset = 0;
      this.queued = 0;
      this.hasPlayed = false;
      this.drainedSent = true;
      this.port.onmessage = (event) => {
        var msg = event.data;
        if (msg.type === "push") {
          this._push(msg.samples);
        } else if (msg.type === "clear") {
          this.chunks.length = 0;
          this.readOffset = 0;
          this.queued = 0;
        }
      };
    }
    _push(samples) {
      if (!samples || !samples.length) return;
      this.drainedSent = false;
      if (this.queued + samples.length > this.maxSamples) {
        var allowed = this.maxSamples - this.queued;
        if (allowed <= 0) return;
        samples = samples.subarray(0, allowed);
      }
      this.chunks.push(samples);
      this.queued += samples.length;
    }
    process(inputs, outputs) {
      var output = outputs[0];
      var channel = output[0];
      for (var i = 0; i < channel.length; i++) {
        if (this.queued > 0) {
          var head = this.chunks[0];
          channel[i] = head[this.readOffset];
          this.readOffset++;
          this.queued--;
          this.hasPlayed = true;
          if (this.readOffset >= head.length) {
            this.chunks.shift();
            this.readOffset = 0;
          }
        } else {
          channel[i] = 0;
        }
      }
      for (var c = 1; c < output.length; c++) {
        output[c].set(channel);
      }
      if (this.queued === 0 && this.hasPlayed && !this.drainedSent) {
        this.drainedSent = true;
        this.port.postMessage({ type: "drained" });
      }
      return true;
    }
  };
  registerProcessor("player-worklet", PlayerWorkletProcessor);
})();
