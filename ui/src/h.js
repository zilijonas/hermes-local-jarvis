// h.js — tiny createElement helper bound to the host's React instance.
//
// No JSX: keeps the source framework-agnostic and avoids wiring esbuild's
// jsxFactory to a global that only exists at runtime (window.__HERMES_PLUGIN_SDK__.React
// is injected by the host page, not importable at bundle time — we must not
// `import React from "react"`, per the plugin contract: React is not bundled).
import { getReact } from "./sdk.js";

export function h() {
  var React = getReact();
  if (!React) throw new Error("jarvis-voice: SDK React not available");
  return React.createElement.apply(React, arguments);
}

export function frag(children) {
  var React = getReact();
  return React.createElement.apply(React, [React.Fragment, null].concat(children));
}
