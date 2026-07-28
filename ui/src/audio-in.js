// audio-in.js — mic capture: getUserMedia -> AudioWorklet (resamples the
// device's real rate down to 16kHz mono s16le via linear interpolation) ->
// onChunk(ArrayBuffer)/onLevel(rms). See ui/README.md §Mic behavior for the
// full rationale behind the choices below.
//
// The audio graph (getUserMedia + AudioContext + worklet) is built once and
// kept alive across toggle/push-to-talk sessions — only a boolean `active`
// flag (checked inside the worklet-message handler) gates whether chunks are
// forwarded to the caller. This keeps repeat-start latency low: the first
// start() pays for mic permission + graph setup, every start() after that is
// just flipping a flag.
import { assetUrl } from "./sdk.js";

export function createMicInput(opts) {
  var onChunk = (opts && opts.onChunk) || function () {};
  var onLevel = (opts && opts.onLevel) || function () {};
  var onError = (opts && opts.onError) || function () {};

  var audioCtx = null;
  var workletNode = null;
  var sourceNode = null;
  var stream = null;
  var active = false;
  var readyPromise = null;
  var chunkCount = 0;

  function supported() {
    return !!(
      (window.AudioContext || window.webkitAudioContext) &&
      window.AudioWorkletNode &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );
  }

  // Human-readable mapping for the getUserMedia/AudioWorklet failure modes
  // real users actually hit: permission denial, no device, device busy,
  // insecure-origin (getUserMedia doesn't exist at all outside a secure
  // context, which would otherwise surface as a confusing TypeError).
  function describeError(err) {
    if (!window.isSecureContext) {
      return "Mic unavailable: this page is not a secure context (needs https:// or localhost).";
    }
    var name = (err && err.name) || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "Microphone permission denied. Allow mic access for this site, then try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No microphone found. Check your input device.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "Microphone is in use by another app, or a hardware error occurred.";
    }
    if (name === "OverconstrainedError") {
      return "No microphone matches the required audio constraints.";
    }
    if (name === "AbortError") {
      return "Microphone access was aborted.";
    }
    return (err && err.message) || String(err);
  }

  function ensureAudioCtx() {
    if (!audioCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  function ensureReady() {
    if (readyPromise) return readyPromise;
    if (!window.isSecureContext) {
      readyPromise = Promise.reject(new Error("insecure-context"));
      return readyPromise;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      readyPromise = Promise.reject(new Error("getUserMedia is not available in this browser."));
      return readyPromise;
    }

    var ctx = ensureAudioCtx();
    // The real, honored-or-not-by-every-browser context sample rate — never
    // assume 16000 (Safari in particular ignores a `sampleRate` hint on the
    // AudioContext constructor). Passed to the worklet explicitly so it can
    // resample using the true ratio even if it somehow disagreed with the
    // AudioWorkletGlobalScope `sampleRate` global.
    var nativeRate = ctx.sampleRate;

    readyPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })
      .then(function (s) {
        stream = s;
        return ctx.audioWorklet.addModule(assetUrl("mic-worklet.js")).catch(function (err) {
          throw new Error("mic init failed: " + (err && err.message ? err.message : err));
        });
      })
      .then(function () {
        sourceNode = ctx.createMediaStreamSource(stream);
        workletNode = new AudioWorkletNode(ctx, "mic-worklet", {
          processorOptions: { targetSampleRate: 16000, sourceSampleRate: nativeRate },
        });
        workletNode.port.onmessage = function (ev) {
          var data = ev.data;
          if (data.type === "chunk") {
            if (active) {
              chunkCount++;
              onChunk(data.buffer);
            }
          } else if (data.type === "level") {
            onLevel(data.rms);
          }
        };
        // Intentionally not connected to audioCtx.destination — capture only,
        // no local monitoring/echo.
        sourceNode.connect(workletNode);
      })
      .catch(function (err) {
        readyPromise = null; // allow retry on the next start()
        throw err;
      });
    return readyPromise;
  }

  // start(): the AudioContext is created and resume()d FIRST, synchronously
  // from the same call chain the click/keydown handler kicked off — some
  // browsers (Safari especially) can drop "user activation" if resume()
  // waits behind getUserMedia's permission prompt, which may sit open for
  // an arbitrarily long time. `active` also flips synchronously so a caller
  // that already sent {t:"mic.start"} won't race the (possibly slow,
  // permission-gated) graph setup.
  function start() {
    active = true;
    chunkCount = 0;
    var ctx = ensureAudioCtx();
    Promise.resolve()
      .then(function () {
        return ctx.resume ? ctx.resume() : undefined;
      })
      .catch(function () {
        /* some browsers reject a redundant resume() call; the state check
           right below is the authoritative signal, not this rejection */
      })
      .then(function () {
        if (ctx.state !== "running") {
          throw new Error("AudioContext did not enter 'running' state (state: " + ctx.state + ").");
        }
        return ensureReady();
      })
      .catch(function (err) {
        active = false;
        onError(describeError(err));
      });
  }

  function stop() {
    active = false;
  }

  function teardown() {
    active = false;
    if (workletNode) {
      try {
        workletNode.disconnect();
      } catch (e) {
        /* noop */
      }
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch (e) {
        /* noop */
      }
    }
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch (e) {
        /* noop */
      }
      audioCtx = null;
    }
    readyPromise = null;
  }

  // Local proof-of-flow counter for the "mic level is silent" hint in
  // app.js — see its armSilenceCheck().
  function getChunkCount() {
    return chunkCount;
  }

  return {
    start: start,
    stop: stop,
    teardown: teardown,
    isSupported: supported(),
    getChunkCount: getChunkCount,
  };
}
