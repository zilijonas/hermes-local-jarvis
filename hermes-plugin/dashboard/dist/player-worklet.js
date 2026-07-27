(() => {
  // src/worklets/player-worklet.js
  var PlayerWorkletProcessor = class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.ringSize = Math.max(1, Math.round(sampleRate * 4));
      this.ring = new Float32Array(this.ringSize);
      this.writeIdx = 0;
      this.readIdx = 0;
      this.available = 0;
      this.port.onmessage = (event) => {
        var msg = event.data;
        if (msg.type === "push") {
          this._push(msg.samples);
        } else if (msg.type === "clear") {
          this.readIdx = this.writeIdx;
          this.available = 0;
        }
      };
    }
    _push(samples) {
      for (var i = 0; i < samples.length; i++) {
        this.ring[this.writeIdx] = samples[i];
        this.writeIdx = (this.writeIdx + 1) % this.ringSize;
        if (this.available < this.ringSize) {
          this.available++;
        } else {
          this.readIdx = (this.readIdx + 1) % this.ringSize;
        }
      }
    }
    process(inputs, outputs) {
      var output = outputs[0];
      var channel = output[0];
      for (var i = 0; i < channel.length; i++) {
        if (this.available > 0) {
          channel[i] = this.ring[this.readIdx];
          this.readIdx = (this.readIdx + 1) % this.ringSize;
          this.available--;
        } else {
          channel[i] = 0;
        }
      }
      for (var c = 1; c < output.length; c++) {
        output[c].set(channel);
      }
      return true;
    }
  };
  registerProcessor("player-worklet", PlayerWorkletProcessor);
})();
