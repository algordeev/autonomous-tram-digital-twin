import assert from "node:assert/strict";
import test from "node:test";
import {
  FixedStepClock,
  REFERENCE_TRAM_PARAMETERS,
  electricBrakeForce,
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

test("the electric brake is limited by the motors and fades out at low speed", () => {
  const p = REFERENCE_TRAM_PARAMETERS;
  // 52 kN at 40 km/h would be about 570 kW; the motors take 240 kW of it.
  assert.ok(Math.abs(electricBrakeForce(52_000, 11.1, p) - 240_000 / 11.1) < 1e-6);
  // A moderate brake at 18 km/h is entirely electric.
  assert.equal(electricBrakeForce(30_000, 5, p), 30_000);
  // Halfway through the fade only half the 32 kN motor force is available.
  assert.equal(electricBrakeForce(40_000, 1.25, p), 16_000);
  assert.equal(electricBrakeForce(40_000, 0.5, p), 0);
});

test("only the electric share of a stop is generator output", () => {
  let state = { speedMps: 40 / 3.6, accelerationMps2: 0 };
  let wheelWh = 0;
  let grossWh = 0;
  for (let index = 0; index < 600 && state.speedMps > 0; index += 1) {
    const result = integrateVehicleDynamics(state, { targetSpeedMps: 0 }, 0.05);
    assert.ok(result.grossRegeneratedEnergyWh <= result.mechanicalBrakeEnergyWh * 0.86 + 1e-12);
    wheelWh += result.mechanicalBrakeEnergyWh;
    grossWh += result.grossRegeneratedEnergyWh;
    state = result;
  }
  assert.ok(state.speedMps < 0.05);
  const electricShare = grossWh / 0.86 / wheelWh;
  assert.ok(electricShare < 1, "the friction brake finishes the stop");
  assert.ok(electricShare > 0.8, `a service stop is still mostly electric (${electricShare.toFixed(3)})`);
});

test("emergency braking reaches 2.4 m/s2 within half a second, empty or full", () => {
  for (const passengers of [0, 110]) {
    const massKg = REFERENCE_TRAM_PARAMETERS.massKg + passengers * 75;
    const parameters = {
      ...REFERENCE_TRAM_PARAMETERS,
      massKg,
      resistanceA_N: REFERENCE_TRAM_PARAMETERS.resistanceA_N * (massKg / REFERENCE_TRAM_PARAMETERS.massKg),
    };
    let state = { speedMps: 40 / 3.6, accelerationMps2: 0 };
    let distanceMeters = 0;
    let reachedAt = null;
    for (let step = 1; step <= 600 && state.speedMps > 0; step += 1) {
      state = integrateVehicleDynamics(state, { targetSpeedMps: 0, emergencyBrake: true }, 0.05, parameters);
      distanceMeters += state.distanceMeters;
      assert.ok(-state.accelerationMps2 <= 2.4 + 1e-9);
      if (reachedAt === null && -state.accelerationMps2 >= 0.99 * 2.4) reachedAt = step * 0.05;
    }
    assert.ok(reachedAt !== null && reachedAt <= 0.6, `${passengers} passengers: full braking after ${reachedAt} s`);
    assert.ok(distanceMeters < 30, `${passengers} passengers: ${distanceMeters.toFixed(1)} m from 40 km/h`);
  }
});
