// entry.js — Hermes plugin boot (from hermes-ui/templates/entry.js, PLUGIN
// set to "jarvis-voice"). Copied verbatim into dist/entry.js by build.sh (no
// esbuild step: this is a tiny non-module IIFE with no imports).
// Manifest: "entry": "dist/entry.js".
// 1. boot Hermes UI once per page (shared across plugins)  2. load the plugin view.
(function () {
  "use strict";
  var PLUGIN = "jarvis-voice";
  var base = (window.HERMES_BASE_PATH || "") + "/dashboard-plugins/" + PLUGIN + "/dist/";
  function load(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = false; s.onload = resolve;
      s.onerror = function () { reject(new Error(PLUGIN + ": could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  load(base + "hui/boot.js")
    .then(function () { return window.HermesUIBoot(base + "hui/"); })
    .then(function () { return load(base + "index.js"); })
    .catch(function (e) { console.error(e); });
})();
