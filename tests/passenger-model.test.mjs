import assert from "node:assert/strict";
import test from "node:test";
import {
  timeOfDayDemandFactor,
  stopDemandWeight,
  computeBoardingAlighting,
  computeDwellSeconds,
  StopDemandTracker,
} from "../src/simulation-core/passenger-model.ts";
import { SimulationEngine } from "../src/simulation-core/engine.ts";

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

test("the overcrowded flag clears once a tram takes everyone waiting", () => {
  const tracker = new StopDemandTracker("R01");
  tracker.advance(0, 8 * 60, 1.4);
  tracker.advance(1200, 8 * 60, 1.4);
  const full = computeBoardingAlighting({ onboard: 95, capacity: 100, waiting: tracker.boardable(), alightFraction: 0 });
  tracker.board(full.boarding, full.overflow);
  assert.ok(tracker.isOvercrowded());

  const empty = computeBoardingAlighting({ onboard: 0, capacity: 100, waiting: tracker.boardable(), alightFraction: 0 });
  assert.equal(empty.overflow, 0);
  tracker.board(empty.boarding, empty.overflow);
  tracker.advance(1260, 8 * 60, 1.4); // new arrivals after the tram left
  assert.ok(tracker.boardable() > 0, "people are waiting again");
  assert.equal(tracker.isOvercrowded(), false, "but nobody was left behind by the last tram");
});

test("everyone gets off at a terminus, and boarding continues for the return trip", () => {
  const engine = new SimulationEngine("izmir-konak");
  const terminus = engine.scenario.readers.find((reader) => reader.terminal);
  const midline = engine.scenario.readers.find((reader) => reader.kind === "station" && !reader.terminal);
  const tram = engine.trams[0];
  const index = engine.trams.indexOf(tram);

  tram.onboardPassengers = 80;
  tram.pendingStationReaderId = midline.id;
  const passing = engine.serviceStopPassengers(tram, index);
  assert.ok(passing.alighting > 0 && passing.alighting < 80, "a mid-line stop keeps most passengers on");

  tram.onboardPassengers = 80;
  tram.pendingStationReaderId = terminus.id;
  const end = engine.serviceStopPassengers(tram, index);
  assert.equal(end.alighting, 80);
  assert.equal(tram.onboardPassengers, end.boarding);
});

test("a tram heading out of service empties at its last stop and takes nobody on", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const tram = engine.trams[0];
  const index = engine.trams.indexOf(tram);
  assert.equal(engine.markForDepot(tram, false, true), true);
  const { portal } = engine.depotPortalById(tram.depotPortalId);
  const lastStop = engine.scenario.readers.find(
    (reader) => reader.kind === "station" && reader.label === portal.lastPassengerStop,
  );
  const tracker = engine.peekDemand(lastStop.id);
  tracker.advance(engine.simulationTime + 600, 8 * 60, 1.4);
  const waiting = tracker.boardable();
  assert.ok(waiting > 0);

  tram.onboardPassengers = 60;
  tram.pendingStationReaderId = lastStop.id;
  const result = engine.serviceStopPassengers(tram, index);
  assert.equal(result.alighting, 60);
  assert.equal(result.boarding, 0);
  assert.equal(tram.onboardPassengers, 0);
  assert.equal(tracker.boardable(), waiting, "the queue waits for a tram in service");
});
