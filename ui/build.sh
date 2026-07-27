#!/usr/bin/env bash
# ui/build.sh — bundle the jarvis-voice dashboard frontend with esbuild.
#
# Produces (consumed by the Hermes dashboard host, see docs/hermes-plugin-api.md):
#   hermes-plugin/dashboard/dist/index.js          IIFE bundle. Does NOT bundle
#                                                   React — uses
#                                                   window.__HERMES_PLUGIN_SDK__.React
#                                                   at runtime. Registers via
#                                                   window.__HERMES_PLUGINS__.register("jarvis-voice", ...).
#   hermes-plugin/dashboard/dist/style.css         copied verbatim from src/style.css.
#   hermes-plugin/dashboard/dist/mic-worklet.js    AudioWorkletProcessor, separate file
#                                                   (loaded via audioWorklet.addModule at runtime).
#   hermes-plugin/dashboard/dist/player-worklet.js AudioWorkletProcessor, separate file.
#
# Usage:
#   cd ui && npm install    # once, installs esbuild devDependency
#   ./build.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# esbuild ships a native Mach-O/ELF binary at node_modules/esbuild/bin/esbuild
# in current versions (not a Node.js JS shim) — invoke it directly rather than
# via `node`, which would fail with a "not valid JavaScript" syntax error on
# the binary. NODE_BIN is kept only as the interpreter for the (rare) pure-JS
# fallback install esbuild uses on unsupported platforms; that fallback file
# still carries its own `#!/usr/bin/env node` shebang, so direct invocation
# works either way as long as the file is executable.
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

echo "-> bundling app -> $DIST/index.js"
"$ESBUILD" src/index.js \
  --bundle \
  --format=iife \
  --target=es2020 \
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

echo "-> copying style.css -> $DIST/style.css"
cp src/style.css "$DIST/style.css"

echo "-> verifying registration contract"
if ! grep -q 'window.__HERMES_PLUGINS__.register("jarvis-voice"' "$DIST/index.js"; then
  echo "FAIL: dist/index.js does not call window.__HERMES_PLUGINS__.register(\"jarvis-voice\", ...)" >&2
  exit 1
fi

echo "OK: build complete."
ls -la "$DIST"
