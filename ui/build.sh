#!/usr/bin/env bash
# ui/build.sh — bundle the jarvis-voice dashboard frontend.
#
# Produces (consumed by the Hermes dashboard host, see docs/hermes-plugin-api.md):
#   hermes-plugin/dashboard/dist/entry.js          Copy of src/entry.js (no
#                                                   esbuild step: a tiny
#                                                   non-module IIFE with no
#                                                   imports). Boots
#                                                   window.HermesUI (vendored
#                                                   under dist/hui/ by
#                                                   hermes-ui/bin/hui-sync),
#                                                   then loads dist/index.js.
#   hermes-plugin/dashboard/dist/index.js          IIFE bundle of src/index.js
#                                                   (esbuild — still needed for
#                                                   the worklet/visualizer/
#                                                   store module graph). Uses
#                                                   window.HermesUI for every
#                                                   visual element; registers
#                                                   via window.__HERMES_PLUGINS__
#                                                   .register("jarvis-voice", ...).
#   hermes-plugin/dashboard/dist/mic-worklet.js    AudioWorkletProcessor, separate
#                                                   file (audioWorklet.addModule).
#   hermes-plugin/dashboard/dist/player-worklet.js AudioWorkletProcessor, separate file.
#
# No plugin CSS: chrome comes entirely from window.HermesUI's own stylesheet
# (dist/hui/hermes-ui.css, injected once per page by hui/boot.js). There is
# no dist/style.css and the manifest carries no "css" key.
#
# Usage:
#   cd ui && ./build.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# esbuild ships a native Mach-O/ELF binary at node_modules/esbuild/bin/esbuild
# in current versions (not a Node.js JS shim) — invoke it directly rather than
# via `node`, which would fail with a "not valid JavaScript" syntax error on
# the binary. NODE_BIN is used only for the syntax-check step below.
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
ESBUILD="./node_modules/esbuild/bin/esbuild"

if [ ! -x "$ESBUILD" ]; then
  echo "error: esbuild not found at $ESBUILD — run 'npm install' in ui/ first." >&2
  exit 1
fi

DIST="../hermes-plugin/dashboard/dist"
mkdir -p "$DIST"

echo "-> copying entry.js -> $DIST/entry.js"
cp src/entry.js "$DIST/entry.js"

echo "-> bundling app -> $DIST/index.js"
"$ESBUILD" src/index.js \
  --bundle \
  --format=iife \
  --target=es2020 \
  --minify \
  --outfile="$DIST/index.js"

echo "-> bundling mic-worklet -> $DIST/mic-worklet.js"
"$ESBUILD" src/worklets/mic-worklet.js \
  --bundle \
  --format=iife \
  --target=es2020 \
  --outfile="$DIST/mic-worklet.js"

echo "-> bundling player-worklet -> $DIST/player-worklet.js"
"$ESBUILD" src/worklets/player-worklet.js \
  --bundle \
  --format=iife \
  --target=es2020 \
  --outfile="$DIST/player-worklet.js"

echo "-> removing stale style.css (chrome now comes entirely from window.HermesUI)"
rm -f "$DIST/style.css"

echo "-> verifying registration contract"
if ! grep -q 'window.__HERMES_PLUGINS__.register("jarvis-voice"' "$DIST/index.js"; then
  echo "FAIL: dist/index.js does not call window.__HERMES_PLUGINS__.register(\"jarvis-voice\", ...)" >&2
  exit 1
fi
if ! grep -q 'HermesUIBoot' "$DIST/entry.js"; then
  echo "FAIL: dist/entry.js does not boot Hermes UI (HermesUIBoot missing)" >&2
  exit 1
fi

echo "-> syntax-checking dist bundles"
"$NODE_BIN" --check "$DIST/entry.js"
"$NODE_BIN" --check "$DIST/index.js"
"$NODE_BIN" --check "$DIST/mic-worklet.js"
"$NODE_BIN" --check "$DIST/player-worklet.js"

echo "OK: build complete."
ls -la "$DIST"
