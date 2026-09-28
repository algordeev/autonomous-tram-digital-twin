#!/usr/bin/env bash
set -euo pipefail

if ! command -v em++ >/dev/null 2>&1; then
  echo "Emscripten em++ is required. Activate emsdk first." >&2
  exit 1
fi

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="${1:-$root_dir/../public/wasm}"
mkdir -p "$output_dir"

em++ -std=c++17 -O3 \
  -I"$root_dir/include" \
  "$root_dir/src/core_c_api.cpp" \
  "$root_dir/src/simulation_core.cpp" \
  "$root_dir/src/priority_controller.cpp" \
  "$root_dir/src/vehicle_dynamics.cpp" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web \
  -s FILESYSTEM=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_tram_core_abi_version","_tram_core_create","_tram_core_destroy","_tram_core_reset","_tram_core_step","_tram_core_set_target_speed","_tram_core_set_paused","_tram_core_time","_tram_core_snapshot_json","_tram_core_snapshot_size","_tram_core_vehicle_x","_tram_core_vehicle_y","_tram_core_vehicle_speed","_tram_core_vehicle_acceleration","_tram_core_consumed_wh","_tram_core_regenerated_wh"]' \
  -s EXPORTED_RUNTIME_METHODS='["UTF8ToString"]' \
  -o "$output_dir/tram-core.mjs"

echo "WASM core written to $output_dir/tram-core.mjs and tram-core.wasm"
