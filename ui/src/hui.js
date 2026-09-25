// hui.js — single access point to the Hermes UI library (window.HermesUI).
//
// Safe at module scope: dist/entry.js (see templates/entry.js) loads
// hui/boot.js and awaits HermesUIBoot() BEFORE it ever requests dist/index.js
// (our esbuild bundle), so by the time any module in this bundle evaluates,
// window.HermesUI already exists (see hermes-ui/docs/integration.md
// "Because index.js loads after the library, module-scope var UI =
// window.HermesUI is safe").
export var UI = window.HermesUI;
export var html = UI && UI.html;
