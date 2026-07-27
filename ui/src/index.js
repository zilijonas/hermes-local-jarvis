// index.js — bundle entry point.
//
// Mirrors the placeholder's registration contract (hermes-plugin/dashboard/dist/index.js
// pre-replacement): guard on both host globals before touching anything else,
// then register under the exact same plugin name, "jarvis-voice". The
// registration call below is written against the full global path (not an
// aliased local var) on purpose — it's a literal, bundler-proof anchor a
// build-verification step can grep for.
import { App } from "./app.js";

(function boot() {
  if (!window.__HERMES_PLUGIN_SDK__ || !window.__HERMES_PLUGINS__) return;
  window.__HERMES_PLUGINS__.register("jarvis-voice", App);
})();
