import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Clang,
  LLD,
  getCompilerInvocation,
  setUpSysroot,
} from "browsercc";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourcePath = resolve(root, "src/wasm_live_core.cpp");
const outputPath = resolve(root, "../public/wasm/tram-core.wasm");
const source = await readFile(sourcePath, "utf8");
const browserccEntry = import.meta.resolve("browsercc");
const sysroot = await readFile(new URL("sysroot.tar", browserccEntry));

const exports = [
  "tram_core_abi_version", "tram_core_create", "tram_core_destroy",
  "tram_core_reset", "tram_core_step", "tram_core_set_target_speed",
  "tram_core_set_paused", "tram_core_time", "tram_core_vehicle_x",
  "tram_core_vehicle_y", "tram_core_vehicle_speed",
  "tram_core_vehicle_acceleration", "tram_core_consumed_wh",
  "tram_core_regenerated_wh",
  "tram_core_uniform_headway", "tram_core_headway_speed_factor",
  "tram_core_terminal_interval_hold",
  "tram_core_terminal_berth", "tram_core_parallel_terminal_bypass",
  "tram_core_departure_slot", "tram_core_departure_on_time",
  "tram_core_authority_begin", "tram_core_authority_sync",
  "tram_core_authority_override_motion",
  "tram_core_station_sync", "tram_core_station_step",
  "tram_core_station_approach_speed",
  "tram_core_station_phase", "tram_core_station_until",
  "tram_core_station_event",
  "tram_core_depot_sync", "tram_core_depot_command",
  "tram_core_depot_observe", "tram_core_depot_state",
  "tram_core_authority_step", "tram_core_resolve_target_speed",
  "tram_core_speed_profile_target",
  "tram_core_predictive_eco_target", "tram_core_authority_eco_mode",
  "tram_core_safe_move", "tram_core_authority_speed",
  "tram_core_authority_acceleration", "tram_core_authority_distance",
  "tram_core_authority_traction_force", "tram_core_authority_brake_force",
  "tram_core_authority_resistance_force", "tram_core_authority_consumed",
  "tram_core_authority_traction_energy", "tram_core_authority_auxiliary_energy",
  "tram_core_authority_mechanical_brake", "tram_core_authority_gross_regenerated",
  "tram_core_authority_regenerated", "tram_core_authority_rejected",
  "tram_core_authority_downhill", "tram_core_authority_climb",
  "tram_core_authority_mode",
  "tram_core_power_begin", "tram_core_power_configure_section",
  "tram_core_power_configure_flywheel",
  "tram_core_power_set_strategy", "tram_core_power_target",
  "tram_core_power_guidance", "tram_core_power_sync_vehicle",
  "tram_core_power_step", "tram_core_power_section_traction",
  "tram_core_power_section_regeneration", "tram_core_power_section_reused",
  "tram_core_power_section_grid", "tram_core_power_section_reused_wh",
  "tram_core_power_section_grid_wh", "tram_core_power_section_rejected_wh",
  "tram_core_power_section_peak", "tram_core_power_vehicle_accepted",
  "tram_core_power_section_flywheel_energy", "tram_core_power_section_flywheel_capacity",
  "tram_core_power_section_flywheel_charge_power", "tram_core_power_section_flywheel_discharge_power",
  "tram_core_power_section_flywheel_charged_wh", "tram_core_power_section_flywheel_discharged_wh",
  "tram_core_power_section_flywheel_losses_wh",
  "tram_core_power_section_forecast_traction", "tram_core_power_section_forecast_regeneration",
  "tram_core_power_section_flywheel_target_grid", "tram_core_power_section_flywheel_mode",
  "tram_core_power_vehicle_rejected", "tram_core_power_network_peak",
  "tram_core_power_interventions",
  "tram_core_signal_begin", "tram_core_signal_sync", "tram_core_signal_step",
  "tram_core_signal_phase", "tram_core_signal_until",
  "tram_core_signal_active_tram", "tram_core_signal_active_signal",
  "tram_core_signal_entered", "tram_core_signal_cleared",
  "tram_core_signal_granted_at", "tram_core_signal_pending",
  "tram_core_signal_event",
  "tram_core_switch_begin", "tram_core_switch_sync",
  "tram_core_switch_toggle", "tram_core_switch_request",
  "tram_core_switch_release", "tram_core_switch_state",
  "tram_core_switch_locked_by",
  "tram_core_begin_network", "tram_core_route_meta",
  "tram_core_add_route_point", "tram_core_configure_zone",
  "tram_core_set_zone_route", "tram_core_configure_tram",
  "tram_core_set_tram_manual", "tram_core_set_tram_service",
  "tram_core_tram_count", "tram_core_vehicle_x_at",
  "tram_core_vehicle_y_at", "tram_core_vehicle_speed_at",
  "tram_core_vehicle_acceleration_at", "tram_core_consumed_wh_at",
  "tram_core_regenerated_wh_at", "tram_core_vehicle_route_at",
  "tram_core_vehicle_service_at", "tram_core_zone_owner",
];
const flags = [
  "-std=c++20", "-O3", "-fno-exceptions", "-fno-rtti", "-nostdlib",
  "-Wl,--no-entry", "-Wl,--strip-all",
  ...exports.map((name) => `-Wl,--export=${name}`),
];
let diagnostics = "";
const printErr = (line) => { diagnostics += `${line}\n`; };
const invocation = await getCompilerInvocation("wasm_live_core.cpp", source, flags);
const clang = await Clang({ thisProgram: "clang++", printErr });
clang.FS.writeFile("wasm_live_core.cpp", source);
setUpSysroot(clang, sysroot);
if (clang.callMain(invocation.compilerArgs) !== 0) {
  throw new Error(`Clang failed:\n${diagnostics}`);
}
const object = clang.FS.readFile(invocation.compilerArtifact, { encoding: "binary" });
const lld = await LLD({ thisProgram: "wasm-ld", printErr });
lld.FS.writeFile(invocation.compilerArtifact, object);
setUpSysroot(lld, sysroot);
if (lld.callMain(invocation.linkerArgs) !== 0) {
  throw new Error(`wasm-ld failed:\n${diagnostics}`);
}
const wasm = lld.FS.readFile(invocation.linerArtifact, { encoding: "binary" });
await writeFile(outputPath, wasm);
console.log(`Wrote ${outputPath} (${wasm.byteLength} bytes)`);
