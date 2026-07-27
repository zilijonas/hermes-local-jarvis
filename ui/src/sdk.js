// sdk.js — thin glue to the host-provided Hermes plugin SDK globals.
//
// IMPORTANT: nothing here reads window.__HERMES_PLUGIN_SDK__ / __HERMES_PLUGINS__
// at module-evaluation time. ESM top-level bodies of every imported module run
// (in dependency order) before index.js's own top-level presence guard runs, so
// any eager `var SDK = window.__HERMES_PLUGIN_SDK__` at *module* scope here would
// risk capturing `undefined` depending on bundler output order. Every accessor
// below is a plain function, called lazily from inside component render bodies,
// event handlers, or index.js's mount() — all of which run after the host has
// already set these globals (index.js's guard confirms that before mounting).
//
// See docs/hermes-plugin-api.md §Frontend SDK for the documented contract.

export var PLUGIN_NAME = "jarvis-voice";
export var API_BASE = "/api/plugins/jarvis-voice";

export function getSDK() {
  return window.__HERMES_PLUGIN_SDK__;
}

export function getPlugins() {
  return window.__HERMES_PLUGINS__;
}

export function getReact() {
  var sdk = getSDK();
  return sdk && sdk.React;
}

export function getHooks() {
  var sdk = getSDK();
  return (sdk && sdk.hooks) || {};
}

export function sessionToken() {
  return window.__HERMES_SESSION_TOKEN__;
}

// Dashboard-plugin static assets are served at
// /dashboard-plugins/<plugin>/<file-relative-to-dashboard-dir>, e.g.
// /dashboard-plugins/jarvis-voice/dist/mic-worklet.js. window.HERMES_BASE_PATH
// is a defensive hook for a possible future path prefix; it does not exist in
// the current Hermes build (verified: not present anywhere in the SDK source
// or any sibling plugin bundle), so this normally resolves to the plain path.
export function assetUrl(file) {
  var base = window.HERMES_BASE_PATH || "";
  return new URL(base + "/dashboard-plugins/jarvis-voice/dist/" + file, window.location.origin).toString();
}

export function authedFetch(path, options) {
  var sdk = getSDK();
  var url = API_BASE + path;
  if (sdk && typeof sdk.authedFetch === "function") {
    return sdk.authedFetch(url, options);
  }
  var opts = Object.assign({}, options);
  opts.headers = Object.assign({}, opts.headers);
  var token = sessionToken();
  if (token) opts.headers["X-Hermes-Session-Token"] = token;
  if (!opts.credentials) opts.credentials = "include";
  return fetch(url, opts);
}

export function fetchJSON(path) {
  var sdk = getSDK();
  if (sdk && typeof sdk.fetchJSON === "function") {
    return sdk.fetchJSON(API_BASE + path);
  }
  return authedFetch(path).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
    return res.json();
  });
}

// Builds the /ws URL per docs/SPEC.md §WebSocket. Prefers the SDK's own
// buildWsUrl/buildWsAuthParam helpers (documented in docs/hermes-plugin-api.md
// §Frontend SDK) so auth stays consistent with however the host dashboard
// authenticates WS connections; falls back to manual construction from
// window.__HERMES_SESSION_TOKEN__ if the SDK doesn't ship them at runtime.
export function buildSocketUrl() {
  var sdk = getSDK();
  var path = API_BASE + "/ws";
  if (sdk && typeof sdk.buildWsUrl === "function") {
    try {
      var url = sdk.buildWsUrl(path);
      if (typeof sdk.buildWsAuthParam === "function") {
        var auth = sdk.buildWsAuthParam();
        if (auth) url += (url.indexOf("?") === -1 ? "?" : "&") + auth;
      }
      return url;
    } catch (e) {
      // fall through to manual construction
    }
  }
  var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  var token = sessionToken();
  var manual = proto + "//" + window.location.host + path;
  if (token) manual += "?token=" + encodeURIComponent(token);
  return manual;
}
