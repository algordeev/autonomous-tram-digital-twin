#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point: use the same pinned compiler and export manifest.
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -gt 0 ]]; then
  node "$root_dir/scripts/compile-portable-wasm.mjs" --output "$1/tram-core.wasm"
else
  node "$root_dir/scripts/compile-portable-wasm.mjs"
fi
