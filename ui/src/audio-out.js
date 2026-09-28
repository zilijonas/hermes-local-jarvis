// audio-out.js — low-latency TTS playback: queueChunk(int16 PCM @24kHz) ->
// AudioWorklet FIFO -> speakers, with a hardStop() for barge-in (<150ms local
// silence per docs/SPEC.md, before the server even sees {"t":"barge_in"}).
//
// Tries to open the AudioContext at 24000Hz (matching the wire format
// exactly, so the worklet just plays samples 1:1 with no resampling cost).
// Not all browsers honor a requested sampleRate (notably Safari can ignore
// it) — when the context lands on a different rate we naive-linear-resample
// each incoming chunk on the main thread before handing it to the worklet.
//
// Echo cancellation (protocol v2): Chrome's built-in AEC (getUserMedia
// echoCancellation:true on the mic, see audio-in.js) only reliably tracks a
// playing <audio>/<video> ELEMENT as its echo reference — audio routed
// straight from an AudioWorklet to AudioContext.destination is invisible to
// it, so in hands-free mode Jarvis can hear its own voice. The fix: tee
// playback through a MediaStreamAudioDestinationNode into a hidden <audio
// autoplay playsinline> element, preferably via a same-page loopback
// RTCPeerConnection pair (local offer/answer, no STUN/TURN needed — both
// ends are this page) so the element gets a "real" received track, which is
// the most reliably AEC-visible shape. Each rung falls back automatically if
// unavailable: loopback -> plain <audio>.srcObject = destination.stream ->
// plain audioCtx.destination (today's pre-v2 behavior, no AEC benefit but
// works everywhere). getDiagnostics() reports which rung is active.
import { assetUrl } from "./sdk.js";

// iOS / iPadOS WebKit (incl. home-screen PWAs). iPadOS reports "MacIntel" + touch.
var IS_IOS = typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent || "") ||
   (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export function createAudioOutput() {
  var TARGET_SOURCE_RATE = 24000;
  var DRAIN_CONFIRM_MS = 250; // matches the server's playback.end echo-guard debounce
  var LOOPBACK_TIMEOUT_MS = 2000;

  var audioCtx = null;
  var workletNode = null;
  var gainNode = null;
  var readyPromise = null;
  var pendingGain = 1;

  // AnalyserNode tap for the visualizer: worklet -> gain -> analyser -> (echo
  // -cancelled output sink), so getLevels() measures the audio the user
  // actually hears (volume changes included) — not server-side amp events.
  // This stays correct regardless of which output rung below is active: the
  // analyser sits upstream of all of them.
  var analyser = null;
  var freqData = null;
  var timeFloat = null;
  var timeByte = null;
  var bandBins = null; // [lowEnd, midEnd, highEnd] as bin indices
  var levelsOut = { level: 0, low: 0, mid: 0, high: 0 };

  // ---- playback-drained bookkeeping (barge-in / echo-guard playback.end) ----
  var playingFlag = false;
  var confirmDrainTimer = null;
  var drainedListeners = [];

  function armConfirmDrain() {
    clearTimeout(confirmDrainTimer);
    confirmDrainTimer = setTimeout(function () {
      playingFlag = false;
      drainedListeners.slice().forEach(function (fn) {
        try {
          fn();
        } catch (e) {
          /* a listener's own bug must not break the audio pipeline */
        }
      });
    }, DRAIN_CONFIRM_MS);
  }

  // ---- echo-cancellation output routing ----
  var outputPath = "pending"; // "loopback" | "stream-element" | "direct" | "pending"
  var outputError = null;
  var audioEl = null;
  var loopbackPc1 = null;
  var loopbackPc2 = null;

  function ensureAudioElement() {
    if (audioEl) return audioEl;
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.playsInline = true; // iOS Safari: never let this open a fullscreen player
    audioEl.setAttribute("aria-hidden", "true");
    // Off-screen but NOT display:none — some browsers pause a display:none
    // media element's playback, which would silently defeat the whole route.
    audioEl.style.position = "fixed";
    audioEl.style.width = "1px";
    audioEl.style.height = "1px";
    audioEl.style.opacity = "0";
    audioEl.style.pointerEvents = "none";
    (document.body || document.documentElement).appendChild(audioEl);
    return audioEl;
  }

  // Call from a REAL user-gesture handler (mic button / Space keydown) so the
  // element's later, async srcObject assignment isn't blocked by autoplay
  // policy (notably iOS Safari). Safe to call repeatedly and before the audio
  // graph exists at all.
  function primeAutoplay() {
    var el = ensureAudioElement();
    try {
      var p = el.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* retried once real audio is routed */ });
    } catch (e) {
      /* some browsers throw synchronously on a silent/empty <audio>.play() */
    }
  }

  function connectDirect(sourceNode) {
    outputPath = "direct";
    sourceNode.connect(audioCtx.destination);
  }

  // Loopback pair: pc1 gets the local MediaStreamAudioDestinationNode's
  // track, offers/answers itself (no signaling server — both ends are this
  // page, ICE candidates are wired straight across), pc2's remote track
  // feeds the hidden <audio> element Chrome's AEC engine can see.
  function connectLoopback(msDest) {
    return new Promise(function (resolve, reject) {
      if (!window.RTCPeerConnection) {
        reject(new Error("RTCPeerConnection unsupported"));
        return;
      }
      try {
        loopbackPc1 = new RTCPeerConnection();
        loopbackPc2 = new RTCPeerConnection();
      } catch (e) {
        reject(e);
        return;
      }
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) {
          settled = true;
          reject(new Error("loopback negotiation timed out"));
        }
      }, LOOPBACK_TIMEOUT_MS);

      loopbackPc1.onicecandidate = function (e) {
        if (e.candidate) loopbackPc2.addIceCandidate(e.candidate).catch(function () {});
      };
      loopbackPc2.onicecandidate = function (e) {
        if (e.candidate) loopbackPc1.addIceCandidate(e.candidate).catch(function () {});
      };
      loopbackPc2.ontrack = function (e) {
        var el = ensureAudioElement();
        el.srcObject = e.streams[0];
        try {
          var p = el.play();
          if (p && typeof p.catch === "function") p.catch(function () { /* primeAutoplay() covers the retry */ });
        } catch (err) {
          /* noop */
        }
        // Chromium-only: shrink the jitter buffer so the silence hardStop()
        // creates at the worklet reaches the speaker with minimal extra
        // delay (the barge-in budget is 150ms; an unbounded jitter buffer
        // would eat into that).
        try {
          var receiver = e.receiver;
          if (receiver && "playoutDelayHint" in receiver) receiver.playoutDelayHint = 0;
        } catch (hintErr) {
          /* non-Chromium — ignore, still functionally correct */
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };

      msDest.stream.getTracks().forEach(function (track) {
        loopbackPc1.addTrack(track, msDest.stream);
      });

      loopbackPc1
        .createOffer()
        .then(function (offer) {
          return loopbackPc1.setLocalDescription(offer).then(function () {
            return offer;
          });
        })
        .then(function (offer) {
          return loopbackPc2.setRemoteDescription(offer);
        })
        .then(function () {
          return loopbackPc2.createAnswer();
        })
        .then(function (answer) {
          return loopbackPc2.setLocalDescription(answer).then(function () {
            return answer;
          });
        })
        .then(function (answer) {
          return loopbackPc1.setRemoteDescription(answer);
        })
        .catch(function (e) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(e);
          }
        });
    });
  }

  // Rung 2: the destination stream straight onto the <audio> element (no
  // RTCPeerConnection) — still a real playing element, AEC-visible on most
  // browsers, just without the jitter-buffer tuning above.
  function connectStreamElement(msDest) {
    var el = ensureAudioElement();
    el.srcObject = msDest.stream;
    var p;
    try {
      p = el.play();
    } catch (e) {
      return Promise.reject(e);
    }
    if (p && typeof p.then === "function") return p;
    return Promise.resolve();
  }

  function connectEchoCancelledOutput(sourceNode) {
    if (IS_IOS) {
      // iOS runs the mic through system voice processing, which cancels the
      // app's own output: the plain destination is AEC-covered, and the
      // loopback/<audio> routes are the ones that go silent in PWAs.
      connectDirect(sourceNode);
      outputError = null;
      return Promise.resolve();
    }
    if (typeof audioCtx.createMediaStreamDestination !== "function") {
      outputError = "createMediaStreamDestination unsupported on this browser";
      connectDirect(sourceNode);
      return Promise.resolve();
    }
    var msDest;
    try {
      msDest = audioCtx.createMediaStreamDestination();
    } catch (e) {
      outputError = "createMediaStreamDestination failed: " + (e && e.message ? e.message : e);
      connectDirect(sourceNode);
      return Promise.resolve();
    }
    sourceNode.connect(msDest);
    return connectLoopback(msDest)
      .then(function () {
        outputPath = "loopback";
        outputError = null;
      })
      .catch(function (loopbackErr) {
        return connectStreamElement(msDest)
          .then(function () {
            outputPath = "stream-element";
            outputError = "loopback unavailable (" + (loopbackErr && loopbackErr.message ? loopbackErr.message : loopbackErr) + ")";
          })
          .catch(function (elErr) {
            try {
              msDest.disconnect();
            } catch (e) {
              /* noop */
            }
            connectDirect(sourceNode);
            outputError =
              "no AEC-visible output route available (loopback: " +
              (loopbackErr && loopbackErr.message ? loopbackErr.message : loopbackErr) +
              "; element: " +
              (elErr && elErr.message ? elErr.message : elErr) +
              ")";
          });
      });
  }

  // The context must be CREATED and resumed inside a user gesture: iOS keeps a
  // context born outside one suspended for good (that was "no sound on the
  // phone"). iOS also gets the hardware rate, not 24 kHz: a second context at a
  // different rate than the mic's plays silence there; queueChunk resamples.
  function ensureContext() {
    if (audioCtx) return audioCtx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (IS_IOS) {
      audioCtx = new Ctor();
    } else {
      try {
        audioCtx = new Ctor({ sampleRate: TARGET_SOURCE_RATE });
      } catch (e) {
        audioCtx = new Ctor();
      }
    }
    return audioCtx;
  }

  // Call synchronously from any real user gesture (tap, click, key). Resumes the
  // context and plays one silent frame, the classic iOS unlock, then builds the
  // graph. Cheap and idempotent; returns true once audio is actually running.
  function unlock() {
    var ctx = ensureContext();
    try {
      if (ctx.state !== "running" && ctx.resume) ctx.resume().catch(function () {});
      var buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      /* a failed unlock is retried on the next gesture */
    }
    if (!IS_IOS) primeAutoplay();
    ensureReady().catch(function () {});
    return ctx.state === "running";
  }

  function isUnlocked() {
    return !!audioCtx && audioCtx.state === "running";
  }

  function ensureReady() {
    if (readyPromise) return readyPromise;
    ensureContext();
    readyPromise = audioCtx.audioWorklet
      .addModule(assetUrl("player-worklet.js"))
      .then(function () {
        workletNode = new AudioWorkletNode(audioCtx, "player-worklet", { outputChannelCount: [1] });
        workletNode.port.onmessage = function (ev) {
          if (ev.data && ev.data.type === "drained") armConfirmDrain();
        };
        gainNode = audioCtx.createGain();
        gainNode.gain.value = pendingGain;
        workletNode.connect(gainNode);

        var tapNode = gainNode;
        try {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.5;
          freqData = new Uint8Array(analyser.frequencyBinCount);
          if (typeof analyser.getFloatTimeDomainData === "function") {
            timeFloat = new Float32Array(analyser.fftSize);
          } else {
            timeByte = new Uint8Array(analyser.fftSize);
          }
          // band edges in Hz -> bin indices for the actual context rate
          var binHz = audioCtx.sampleRate / analyser.fftSize;
          bandBins = [Math.round(250 / binHz), Math.round(2000 / binHz), Math.min(analyser.frequencyBinCount, Math.round(6000 / binHz))];
          gainNode.connect(analyser);
          tapNode = analyser;
        } catch (e) {
          // Analyser unavailable — playback still works, visualizer falls
          // back to server tts.amp events (getLevels() stays null).
          analyser = null;
        }
        return connectEchoCancelledOutput(tapNode);
      })
      .catch(function (err) {
        readyPromise = null; // allow retry on the next queueChunk()
        throw err;
      });
    return readyPromise;
  }

  // Called by the visualizer ONCE PER FRAME. Returns null when the analyser
  // tap isn't available/running (caller then falls back to tts.amp events).
  // The returned object is reused across calls — read, don't retain.
  function getLevels() {
    if (!analyser || !audioCtx || audioCtx.state !== "running") return null;
    var i;
    var rms = 0;
    if (timeFloat) {
      analyser.getFloatTimeDomainData(timeFloat);
      for (i = 0; i < timeFloat.length; i++) rms += timeFloat[i] * timeFloat[i];
      rms = Math.sqrt(rms / timeFloat.length);
    } else {
      analyser.getByteTimeDomainData(timeByte);
      for (i = 0; i < timeByte.length; i++) {
        var v = (timeByte[i] - 128) / 128;
        rms += v * v;
      }
      rms = Math.sqrt(rms / timeByte.length);
    }
    analyser.getByteFrequencyData(freqData);
    var sums = [0, 0, 0];
    var counts = [0, 0, 0];
    var band = 0;
    for (i = 0; i < bandBins[2]; i++) {
      while (band < 2 && i >= bandBins[band]) band++;
      sums[band] += freqData[i];
      counts[band]++;
    }
    levelsOut.level = Math.min(1, rms * 4.5);
    levelsOut.low = counts[0] ? sums[0] / (counts[0] * 255) : 0;
    levelsOut.mid = counts[1] ? sums[1] / (counts[1] * 255) : 0;
    levelsOut.high = counts[2] ? sums[2] / (counts[2] * 255) : 0;
    return levelsOut;
  }

  // `data` is an ArrayBuffer/Int16Array of 24kHz mono s16le PCM (one TTS
  // chunk). Converts to Float32 and, if the context didn't land on 24kHz,
  // naive-linear-resamples to the context's actual rate before queueing.
  function queueChunk(data) {
    playingFlag = true;
    clearTimeout(confirmDrainTimer);
    ensureReady()
      .then(function () {
        if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
        var int16 = data instanceof Int16Array ? data : new Int16Array(data);
        var float32 = int16ToFloat32(int16);
        var dstRate = audioCtx.sampleRate;
        var samples = dstRate === TARGET_SOURCE_RATE ? float32 : resampleLinear(float32, TARGET_SOURCE_RATE, dstRate);
        workletNode.port.postMessage({ type: "push", samples: samples }, [samples.buffer]);
      })
      .catch(function () {
        // addModule/AudioContext failure — already reflected via connection
        // status elsewhere; drop this chunk rather than throwing unhandled.
      });
  }

  // Barge-in: clear the worklet's FIFO immediately. The message hits the
  // worklet's port within a single ~2.7-5.8ms render quantum, well under the
  // 150ms budget. playingFlag drops synchronously too (no 250ms debounce) —
  // a barge-in must never wait around before the echo guard releases.
  function hardStop() {
    if (workletNode) workletNode.port.postMessage({ type: "clear" });
    clearTimeout(confirmDrainTimer);
    playingFlag = false;
  }

  function setGain(v) {
    pendingGain = v;
    if (gainNode) gainNode.gain.value = v;
  }

  // True from the moment a chunk is queued until ~250ms after the worklet's
  // FIFO has run dry with nothing new arriving (see armConfirmDrain()).
  function isPlaying() {
    return playingFlag;
  }
  // Fires once per confirmed drain (debounced — see DRAIN_CONFIRM_MS). Used
  // by app.js to send {"t":"playback.end"} once Jarvis has genuinely
  // stopped making sound (echo guard / barge-in on the server side).
  function onDrained(cb) {
    drainedListeners.push(cb);
    return function unsubscribe() {
      drainedListeners = drainedListeners.filter(function (f) {
        return f !== cb;
      });
    };
  }
  // { path: "pending"|"loopback"|"stream-element"|"direct", error } — surfaced
  // in the System tab's diagnostics (components/work.js).
  function getDiagnostics() {
    return { path: outputPath, error: outputError };
  }

  function destroy() {
    clearTimeout(confirmDrainTimer);
    drainedListeners = [];
    try {
      if (loopbackPc1) loopbackPc1.close();
    } catch (e) {
      /* noop */
    }
    try {
      if (loopbackPc2) loopbackPc2.close();
    } catch (e) {
      /* noop */
    }
    if (audioEl && audioEl.parentNode) audioEl.parentNode.removeChild(audioEl);
    try {
      if (audioCtx) audioCtx.close();
    } catch (e) {
      /* noop */
    }
  }

  return {
    unlock: unlock,
    isUnlocked: isUnlocked,
    queueChunk: queueChunk,
    hardStop: hardStop,
    setGain: setGain,
    getLevels: getLevels,
    isPlaying: isPlaying,
    onDrained: onDrained,
    primeAutoplay: primeAutoplay,
    getDiagnostics: getDiagnostics,
    destroy: destroy,
  };
}

function int16ToFloat32(int16) {
  var out = new Float32Array(int16.length);
  for (var i = 0; i < int16.length; i++) {
    var s = int16[i];
    out[i] = s < 0 ? s / 32768 : s / 32767;
  }
  return out;
}

function resampleLinear(src, srcRate, dstRate) {
  var ratio = srcRate / dstRate;
  var outLen = Math.max(1, Math.round(src.length / ratio));
  var out = new Float32Array(outLen);
  for (var i = 0; i < outLen; i++) {
    var pos = i * ratio;
    var i0 = Math.floor(pos);
    var i1 = Math.min(i0 + 1, src.length - 1);
    var frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}
