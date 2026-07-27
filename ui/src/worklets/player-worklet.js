// player-worklet.js — AudioWorkletProcessor: a small ring buffer fed Float32
// samples from the main thread (audio-out.js), drained continuously by
// process() so playback never gaps between TTS chunks. A "clear" message
// (barge-in) resets the read pointer to the write pointer, i.e. instant
// silence, well within the <150ms barge-in budget.
//
// Self-contained on purpose — see mic-worklet.js's header comment.
class PlayerWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringSize = Math.max(1, Math.round(sampleRate * 4)); // 4s ring buffer
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
        // Buffer full (shouldn't normally happen at 4s of headroom) — drop
        // the oldest sample rather than growing unbounded.
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
}

registerProcessor("player-worklet", PlayerWorkletProcessor);
