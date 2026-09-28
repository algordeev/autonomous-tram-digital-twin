import assert from "node:assert/strict";
import test from "node:test";
import {
  timeOfDayDemandFactor,
  stopDemandWeight,
  computeBoardingAlighting,
  computeDwellSeconds,
  StopDemandTracker,
} from "../src/simulation-core/passenger-model.ts";

test("demand is higher during the morning peak than at night", () => {
  const peak = timeOfDayDemandFactor(8 * 60);
  const night = timeOfDayDemandFactor(3 * 60);
  assert.ok(peak > night * 5, `expected peak (${peak}) >> night (${night})`);
});

test("stop weighting stays within the documented band", () => {
  for (const id of ["R01", "R02", "R03", "East Terminal", "West Terminal"]) {
    const weight = stopDemandWeight(id);
    assert.ok(weight >= 0.7 && weight < 1.6, `weight for ${id} out of band: ${weight}`);
  }
});

test("queue grows over elapsed time and boarding drains it", () => {
  const tracker = new StopDemandTracker("R01");
  tracker.advance(0, 8 * 60, 1.4);
  tracker.advance(300, 8 * 60, 1.4); // 5 minutes later, still peak
  const waiting = tracker.boardable();
  assert.ok(waiting > 0, "queue should have grown from zero");

  const result = computeBoardingAlighting({
    onboard: 10,
    capacity: 40,
    waiting,
    alightFraction: 0.2,
  });
  assert.equal(result.overflow, 0, "plenty of capacity, nobody should be left behind");
  tracker.board(result.boarding, result.overflow);
  assert.ok(tracker.boardable() < waiting, "boarding should reduce the queue");
});

test("capacity limits boarding and reports overflow", () => {
  const tracker = new StopDemandTracker("R01");
  tracker.advance(0, 8 * 60, 1.4);
  tracker.advance(1200, 8 * 60, 1.4); // 20 minutes of unattended peak demand
  const waiting = tracker.boardable();
  assert.ok(waiting > 20, "expected a sizeable queue after 20 unattended minutes");

  const result = computeBoardingAlighting({
    onboard: 90,
    capacity: 100,
    waiting,
    alightFraction: 0.1,
  });
  assert.ok(result.overflow > 0, "an almost-full tram should leave some passengers behind");
  tracker.board(result.boarding, result.overflow);
  assert.ok(tracker.isOvercrowded(), "tracker should flag the stop as overcrowded");
});

test("dwell time grows with passenger flow and respects the door-cycle floor", () => {
  const empty = computeDwellSeconds({
    boarding: 0,
    alighting: 0,
    doorCount: 3,
    secondsPerBoarding: 1.3,
    secondsPerAlighting: 0.9,
    minDwellSeconds: 8,
    doorCycleOverheadSeconds: 3,
  });
  assert.equal(empty, 8, "an empty stop should still take the minimum dwell, not zero");

  const busy = computeDwellSeconds({
    boarding: 30,
    alighting: 10,
    doorCount: 3,
    secondsPerBoarding: 1.3,
    secondsPerAlighting: 0.9,
    minDwellSeconds: 8,
    doorCycleOverheadSeconds: 3,
  });
  assert.ok(busy > empty, "boarding 30 passengers must take longer than an empty stop");
});

test("Little's Law wait estimate rises as the queue grows relative to arrival rate", () => {
  const tracker = new StopDemandTracker("R02");
  tracker.advance(0, 8 * 60, 1.0);
  tracker.advance(600, 8 * 60, 1.0);
  const waitAfterTenMinutes = tracker.estimateAverageWaitSeconds();
  tracker.advance(1200, 8 * 60, 1.0);
  const waitAfterTwentyMinutes = tracker.estimateAverageWaitSeconds();
  assert.ok(
    waitAfterTwentyMinutes > waitAfterTenMinutes,
    "unattended queue should mean rising estimated wait",
  );
});
