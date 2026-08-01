// ws.js — WebSocket client for /api/plugins/jarvis-voice/ws, per docs/SPEC.md
// §WebSocket (single source of truth for the binding protocol).
//
// Binary framing (assumption verified against SPEC.md, both directions bridged
// byte/frame-for-frame by hermes-plugin/dashboard/plugin_api.py):
//   INBOUND  binary frames are TTS PCM (24kHz mono s16le) and are only
//            meaningful immediately after a {"t":"tts.chunk_hdr", samples}
//            text frame — any other binary frame is ignored defensively
//            (protects against protocol drift/ordering bugs upstream).
//   OUTBOUND binary frames are raw mic PCM (16kHz mono s16le), sent by the
//            caller via sendBinary() only while push-to-talk is held.
//
// Reconnect: capped exponential backoff 1s -> 2s -> 4s -> 8s -> 10s (capped),
// reset to 1s on every successful open.
import { buildSocketUrl } from "./sdk.js";

var INITIAL_BACKOFF_MS = 1000;
var MAX_BACKOFF_MS = 10000;

export function createJarvisSocket(handlers) {
  var onEvent = (handlers && handlers.onEvent) || function () {};
  var onBinary = (handlers && handlers.onBinary) || function () {};
  var onStatus = (handlers && handlers.onStatus) || function () {};
  var onOpen = (handlers && handlers.onOpen) || function () {};

  var ws = null;
  var backoffMs = INITIAL_BACKOFF_MS;
  var reconnectTimer = null;
  var closedByUser = false;
  var expectingBinary = false;

  function scheduleReconnect() {
    if (closedByUser) return;
    onStatus("reconnecting");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    closedByUser = false;
    onStatus(backoffMs > INITIAL_BACKOFF_MS ? "reconnecting" : "connecting");

    var socket;
    try {
      socket = new WebSocket(buildSocketUrl());
    } catch (e) {
      scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.onopen = function () {
      // A reconnect timer armed before this socket opened must not fire
      // later and replace this healthy connection with a fresh one.
      clearTimeout(reconnectTimer);
      backoffMs = INITIAL_BACKOFF_MS;
      expectingBinary = false;
      onStatus("open");
      onOpen();
    };
    socket.onmessage = function (ev) {
      if (typeof ev.data === "string") {
        var msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (msg && msg.t === "tts.chunk_hdr") {
          expectingBinary = true;
        }
        onEvent(msg);
      } else if (expectingBinary) {
        expectingBinary = false;
        onBinary(ev.data);
      }
      // else: stray binary frame with no preceding chunk_hdr — ignored.
    };
    socket.onclose = function () {
      // Only the ACTIVE socket's close drives a reconnect. A discarded
      // socket (forceReconnect closed it and already opened a new one)
      // closing late must not flip status back to "reconnecting" or arm
      // a timer that would tear down the replacement connection.
      if (ws !== socket) return;
      ws = null;
      scheduleReconnect();
    };
    socket.onerror = function () {
      try {
        socket.close();
      } catch (e) {
        /* noop, onclose will fire and drive reconnect */
      }
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }
  function sendBinary(buf) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
  }
  function forceReconnect() {
    backoffMs = INITIAL_BACKOFF_MS;
    closedByUser = false;
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        /* noop */
      }
      ws = null;
    }
    connect();
  }
  function close() {
    closedByUser = true;
    clearTimeout(reconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        /* noop */
      }
      ws = null;
    }
  }

  connect();
  return { send: send, sendBinary: sendBinary, close: close, forceReconnect: forceReconnect };
}
