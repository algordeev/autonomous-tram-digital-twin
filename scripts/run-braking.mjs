// Stopping distance of the vehicle model: service and emergency braking from
// 20, 40, 50 and 70 km/h, empty and full (110 passengers), on level track.
// Runs the C++ vehicle authority step (tram_core_authority_step) directly at
// the 50 ms control step, from steady cruise (acceleration 0) to standstill.
//
//   npm run automation:braking
//
// Checks: emergency deceleration never exceeds 2.4 m/s², service deceleration
// never exceeds 1.25 m/s², and the deceleration build-up respects the jerk
// limits (0.9 m/s³ service, 5 m/s³ emergency, when the track brakes apply).
// A full service brake to a zero target tracks speed with a 1.4 s time constant
// below 1.75 m/s, so the last metres approach standstill exponentially; the
// stop is counted at 0.1 m/s (at most 0.14 m before rest). Emergency braking
// reaches standstill exactly. No driver or system reaction time is included.
// Writes outputs/automation/braking.csv; exits 1 if a check fails.
import { fileURLToPath } from "node:url";
import {
  configureCppAuthority,
  cppStepVehicleAuthority,
} from "../src/simulation-core/index.ts";
import { FIXED_STEP_SECONDS, gitCommit, initializeCore, writeCsv } from "./lib/automation.mjs";

const OUTPUT = fileURLToPath(new URL("../outputs/automation/braking.csv", import.meta.url));
const SPEEDS_KMH = [20, 40, 50, 70];
const LOADS = [{ name: "empty", passengers: 0 }, { name: "full", passengers: 110 }];
const MODES = [
  { name: "service", emergency: false, decelerationLimit: 1.25, jerkLimit: 0.9 },
  { name: "emergency", emergency: true, decelerationLimit: 2.4, jerkLimit: 5 },
];
const STOP_SPEED_MPS = 0.1;
const LINE_SPEED_LIMIT_KMH = 40; // network default; 50 and 70 km/h are vehicle-model cases only

await initializeCore();

const zeroState = (speedMps) => ({
  speedMps, accelerationMps2: 0, consumedEnergyWh: 0, tractionEnergyWh: 0, auxiliaryEnergyWh: 0,
  mechanicalBrakeEnergyWh: 0, grossRegeneratedEnergyWh: 0, regeneratedEnergyWh: 0,
  rejectedRegenerationEnergyWh: 0, downhillPotentialEnergyWh: 0, climbPotentialEnergyWh: 0,
});

/** Jerk-limited ramp to a constant deceleration: d = v·t_r − j·t_r³/6 + (v − j·t_r²/2)² / (2a). */
function analyticDistance(speed, deceleration, jerk) {
  const ramp = deceleration / jerk;
  const rampDrop = (jerk * ramp * ramp) / 2;
  if (rampDrop >= speed) {
    const t = Math.sqrt((2 * speed) / jerk);
    return speed * t - (jerk * t ** 3) / 6;
  }
  return speed * ramp - (jerk * ramp ** 3) / 6 + (speed - rampDrop) ** 2 / (2 * deceleration);
}

const rows = [];
const failures = [];
for (const mode of MODES) {
  for (const load of LOADS) {
    for (const speedKmh of SPEEDS_KMH) {
      configureCppAuthority(1);
      let state = zeroState(speedKmh / 3.6);
      let distance = 0;
      let time = 0;
      let maxDeceleration = 0;
      let maxBuildUpJerk = 0;
      let previousAcceleration = 0;
      let peakBrakeForce = 0;
      while (state.speedMps > STOP_SPEED_MPS && time < 120) {
        const result = cppStepVehicleAuthority(0, state, {
          targetSpeedMps: 0, emergencyBrake: mode.emergency, grade: 0, passengerCount: load.passengers,
        }, FIXED_STEP_SECONDS);
        if (result.source !== "cpp-wasm") throw new Error("vehicle step did not run on the C++ core");
        distance += result.distanceMeters;
        time += FIXED_STEP_SECONDS;
        const acceleration = result.accelerationMps2;
        maxDeceleration = Math.max(maxDeceleration, -acceleration);
        // Build-up jerk: steps where the deceleration is still growing (the final
        // step to standstill is excluded, see the header).
        if (result.speedMps > 0 && -acceleration > -previousAcceleration) {
          maxBuildUpJerk = Math.max(maxBuildUpJerk, (previousAcceleration - acceleration) / FIXED_STEP_SECONDS);
        }
        peakBrakeForce = Math.max(peakBrakeForce, result.brakeForceN);
        previousAcceleration = acceleration;
        state = result.cumulative;
      }
      const speed = speedKmh / 3.6;
      const decelerationOk = maxDeceleration <= mode.decelerationLimit + 1e-9;
      const jerkOk = maxBuildUpJerk <= mode.jerkLimit + 1e-9;
      if (!decelerationOk) failures.push(`${mode.name} ${load.name} ${speedKmh} km/h: deceleration ${maxDeceleration.toFixed(3)} m/s²`);
      if (!jerkOk) failures.push(`${mode.name} ${load.name} ${speedKmh} km/h: jerk ${maxBuildUpJerk.toFixed(3)} m/s³`);
      rows.push({
        mode: mode.name,
        load: load.name,
        passengers: load.passengers,
        mass_kg: 27500 + load.passengers * 75,
        initial_speed_kmh: speedKmh,
        within_line_speed_limit: speedKmh <= LINE_SPEED_LIMIT_KMH,
        stopping_distance_m: distance.toFixed(2),
        analytic_distance_m: analyticDistance(speed, mode.decelerationLimit, mode.jerkLimit).toFixed(2),
        stopping_time_s: time.toFixed(2),
        mean_deceleration_mps2: ((speed * speed) / (2 * distance)).toFixed(3),
        max_deceleration_mps2: maxDeceleration.toFixed(3),
        deceleration_limit_mps2: mode.decelerationLimit,
        max_build_up_jerk_mps3: maxBuildUpJerk.toFixed(3),
        jerk_limit_mps3: mode.jerkLimit,
        peak_brake_force_kn: (peakBrakeForce / 1000).toFixed(1),
        checks_pass: decelerationOk && jerkOk,
        core_runtime: "cpp-wasm",
        git_commit: gitCommit(),
      });
    }
  }
}
await writeCsv(OUTPUT, Object.keys(rows[0]), rows);
console.log("| Braking | Load | Speed | Distance (m) | Analytic (m) | Time (s) | Max decel. (m/s²) | Max build-up jerk (m/s³) | Checks |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
for (const row of rows) {
  console.log(`| ${row.mode} | ${row.load} | ${row.initial_speed_kmh} km/h | ${row.stopping_distance_m} | ${row.analytic_distance_m} | ${row.stopping_time_s} | ${row.max_deceleration_mps2} | ${row.max_build_up_jerk_mps3} | ${row.checks_pass ? "pass" : "**fail**"} |`);
}
console.log(`\nWrote ${OUTPUT}`);
if (failures.length > 0) {
  console.error(`\nBraking checks failed:\n${failures.join("\n")}`);
  process.exit(1);
}
