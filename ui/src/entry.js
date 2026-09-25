// entry.js — Hermes plugin boot (hermes-ui templates/entry.js, entry v2).
// Manifest: "entry": "dist/entry.js". Set PLUGIN and SCRIPTS below.
//
// The host checks for register() one microtask after this file loads, but
// the real view needs the shared library first (async). So we register a
// tiny placeholder SYNCHRONOUSLY: it shows a loading frame, and shows the
// failure (with Retry) if a script fails. When index.js calls register()
// with the real App, the host swaps it in. Without this the host flags
// "did not call register()" and that error screen can stick.
(function () {
  "use strict";
  var PLUGIN = "jarvis-voice";
  var SCRIPTS = ["index.js"]; // in order, after the library
  var base = (window.HERMES_BASE_PATH || "") + "/dashboard-plugins/" + PLUGIN + "/dist/";
  var sdk = window.__HERMES_PLUGIN_SDK__, reg = window.__HERMES_PLUGINS__;
  var state = { error: null }, listeners = [];
  function setError(e) { state.error = e; listeners.forEach(function (f) { f(); }); }

  if (sdk && reg && sdk.React) {
    var R = sdk.React;
    var Placeholder = function () {
      var s = R.useState(0);
      R.useEffect(function () {
        var f = function () { s[1](function (n) { return n + 1; }); };
        listeners.push(f);
        return function () { listeners = listeners.filter(function (x) { return x !== f; }); };
      }, []);
      var box = { minHeight: "60vh", display: "grid", placeItems: "center", color: "#8FA3A8", font: "12px/1.5 -apple-system, system-ui, sans-serif", letterSpacing: "0.16em", textTransform: "uppercase", background: "#070A0C" };
      if (state.error) {
        return R.createElement("div", { style: box, role: "alert" },
          R.createElement("div", { style: { textAlign: "center", display: "grid", gap: "10px", letterSpacing: 0, textTransform: "none" } },
            R.createElement("div", { style: { color: "#E8F4F6", fontSize: "14px" } }, "This plugin couldn't load"),
            R.createElement("div", null, String(state.error.message || state.error)),
            R.createElement("button", { type: "button", onClick: function () { location.reload(); }, style: { justifySelf: "center", padding: "6px 14px", borderRadius: "8px", border: "1px solid rgba(120,190,200,.22)", background: "#101A1E", color: "#E8F4F6", cursor: "pointer" } }, "Reload")));
      }
      return R.createElement("div", { style: box, "aria-busy": "true" }, "Loading");
    };
    reg.register(PLUGIN, Placeholder);
  }

  function load(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = false; s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load " + src.replace(base, ""))); };
      document.head.appendChild(s);
    });
  }
  load(base + "hui/boot.js")
    .then(function () { return window.HermesUIBoot(base + "hui/"); })
    .then(function () { return SCRIPTS.reduce(function (p, f) { return p.then(function () { return load(base + f); }); }, Promise.resolve()); })
    .catch(function (e) { console.error("[" + PLUGIN + "]", e); setError(e); });
})();
