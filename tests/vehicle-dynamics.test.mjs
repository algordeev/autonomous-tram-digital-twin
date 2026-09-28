import assert from "node:assert/strict";
import test from "node:test";
import {
  FixedStepClock,
  integrateVehicleDynamics,
} from "../src/simulation-core/index.ts";

function simulate(initialSpeed, targetSpeed, seconds, emergencyBrake = false) {
  let state = { speedMps: initialSpeed, accelerationMps2: 0 };
  let distanceMeters = 0;
  let consumedEnergyWh = 0;
  let regeneratedEnergyWh = 0;
  const steps = Math.round(seconds / 0.05);
  for (let index = 0; index < steps; index += 1) {
    const result = integrateVehicleDynamics(
      state,
      { targetSpeedMps: targetSpeed, emergencyBrake },
      0.05,
    );
    state = result;
    distanceMeters += result.distanceMeters;
    consumedEnergyWh += result.consumedEnergyWh;
    regeneratedEnergyWh += result.regeneratedEnergyWh;
  }
  return { ...state, distanceMeters, consumedEnergyWh, regeneratedEnergyWh };
}

test("reference tram accelerates smoothly to the commanded speed", () => {
  const result = simulate(0, 40 / 3.6, 30);
  assert.ok(result.speedMps > 10.9 && result.speedMps <= 40 / 3.6);
  assert.ok(result.consumedEnergyWh > 0);
  assert.ok(result.accelerationMps2 <= 1.15);
});

test("emergency braking stops shorter than service braking and regenerates energy", () => {
  const service = simulate(40 / 3.6, 0, 15, false);
  const emergency = simulate(40 / 3.6, 0, 15, true);
  assert.ok(service.speedMps < 0.05);
  assert.ok(emergency.speedMps < 0.05);
  assert.ok(emergency.distanceMeters < service.distanceMeters);
  assert.ok(service.regeneratedEnergyWh > 0);
  assert.ok(emergency.regeneratedEnergyWh > 0);
});

test("downhill grade produces potential energy and regenerative braking", () => {
  let state = { speedMps: 10, accelerationMps2: 0 };
  let potentialWh = 0;
  let acceptedWh = 0;
  for (let index = 0; index < 200; index += 1) {
    const result = integrateVehicleDynamics(
      state,
      { targetSpeedMps: 10, grade: -0.01 },
      0.05,
    );
    state = result;
    potentialWh += result.downhillPotentialEnergyWh;
    acceptedWh += result.regeneratedEnergyWh;
  }
  // 27.5 t descending 1 m: mgh ≈ 74.9 Wh.
  assert.ok(potentialWh > 74 && potentialWh < 76);
  assert.ok(acceptedWh > 0 && acceptedWh < potentialWh);
});

test("fixed simulation ticks are independent from render-frame grouping", () => {
  const run = (frames) => {
    const clock = new FixedStepClock(0.05, 100);
    let state = { speedMps: 0, accelerationMps2: 0 };
    let distanceMeters = 0;
    for (const frame of frames) {
      clock.advance(frame, (delta) => {
        const result = integrateVehicleDynamics(
          state,
          { targetSpeedMps: 30 / 3.6 },
          delta,
        );
        state = result;
        distanceMeters += result.distanceMeters;
      });
    }
    return { ...state, distanceMeters };
  };

  const regular = run(Array.from({ length: 20 }, () => 0.05));
  const irregular = run([0.11, 0.03, 0.17, 0.08, 0.21, 0.04, 0.19, 0.17]);
  assert.ok(Math.abs(regular.speedMps - irregular.speedMps) < 1e-9);
  assert.ok(Math.abs(regular.distanceMeters - irregular.distanceMeters) < 1e-9);
});
