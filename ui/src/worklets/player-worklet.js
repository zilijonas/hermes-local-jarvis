// player-worklet.js — AudioWorkletProcessor: an unbounded (capped) FIFO of
// Float32 chunks fed from the main thread (audio-out.js), drained
// continuously by process() so playback never gaps between TTS chunks.
//
// v2: replaces the old fixed-4s ring buffer. The server streams TTS audio
// roughly 3x faster than realtime, so a long reply could queue well past 4s
// of buffered-but-unplayed audio within a few seconds of the reply starting
// — the old ring buffer then silently overwrote the OLDEST unplayed
// samples, which is audible as skipped/garbled words. A plain FIFO with a
// generous cap (120s — no real reply gets remotely close) fixes that: only
// if something has gone actually wrong (a runaway server) do we fall back to
// dropping the NEWEST incoming samples, never audio already queued to play.
//
// A "clear" message (barge-in) empties the FIFO immediately: instant
// silence, well within the <150ms barge-in budget (see docs/SPEC.md and
// audio-out.js's hardStop()). Once the FIFO runs fully dry AFTER having
// played real audio, a {type:"drained"} message tells the main thread
// playback has (momentarily) stopped — see audio-out.js's onDrained()/
// isPlaying(), used to send the client->server "playback.end" echo-guard
// signal once the main thread confirms it stays quiet for ~250ms.
//
// Self-contained on purpose — see mic-worklet.js's header comment.
class PlayerWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxSamples = Math.max(1, Math.round(sampleRate * 120)); // 120s hard cap
    this.chunks = []; // FIFO of Float32Array
    this.readOffset = 0; // read cursor into chunks[0]
    this.queued = 0; // total unread samples across all chunks
    this.hasPlayed = false; // true once we've ever emitted a real sample
    this.drainedSent = true; // don't fire "drained" before anything ever played

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
      // Last resort: the server has been streaming faster than we could EVER
      // play it back, for a full 120s straight — drop from the incoming
      // (newest) chunk, never from audio already queued.
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
}

registerProcessor("player-worklet", PlayerWorkletProcessor);
