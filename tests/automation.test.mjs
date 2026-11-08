// The safety oracle used by the automation results must detect each violation
// it reports as zero. Each test plants one violation by editing engine state
// directly (as the safety integration tests do) and checks it is counted.
import assert from "node:assert/strict";
import test from "node:test";
import { resetCppRuntimeForTests } from "../src/simulation-core/index.ts";
import { SafetyOracle, createEngine, initializeCore, stepEngine } from "../scripts/lib/automation.mjs";

test.beforeEach(async () => { resetCppRuntimeForTests(); await initializeCore(); });
test.afterEach(() => resetCppRuntimeForTests());

const nizhny = () => createEngine({ scenarioId: "nizhny-routes-2-21", startMinute: 480 });
const place = (tram, segmentId, progress) => {
  tram.segmentId = segmentId;
  tram.progress = progress;
  tram.serviceState = "in-service";
};

test("a normal run has no oracle violations", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  for (let step = 0; step < 2400; step += 1) {
    stepEngine(engine);
    oracle.check();
  }
  assert.equal(oracle.totalViolations(), 0, JSON.stringify(oracle.firstViolations));
});

test("overlapping trams are a collision, and swapping order is overtaking", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  const [a, b] = engine.trams;
  const length = engine.segments.get("N2A03").lengthMeters;
  place(a, "N2A03", 0.4);
  place(b, "N2A03", 0.4 + 5 / length);
  oracle.check();
  assert.ok(oracle.counts.collision > 0);
  place(a, "N2A03", 0.4 + 10 / length);
  oracle.check();
  assert.ok(oracle.counts.overtaking > 0);
});

test("spacing below the 22 m physical minimum is a separation violation", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  const [a, b] = engine.trams;
  const length = engine.segments.get("N2A03").lengthMeters;
  place(a, "N2A03", 0.3);
  place(b, "N2A03", 0.3 + 18 / length);
  oracle.check();
  assert.ok(oracle.counts.separation > 0);
  assert.equal(oracle.counts.collision, 0);
});

test("a tram inside a crossing while road traffic has green is a crossing violation", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  const signal = engine.scenario.signals.find((item) => item.id === "SG-OSH-A");
  const controller = engine.trafficControllers.get(signal.controllerId);
  controller.phase = "road-green";
  place(engine.trams[0], signal.segmentId, (signal.at + signal.clearAt) / 2);
  oracle.check();
  assert.ok(oracle.counts.crossing > 0);
});

test("two trams in a junction conflict zone are a conflict-zone violation", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  const zone = engine.scenario.junctionConflictZones[0];
  place(engine.trams[0], zone.segmentIds[0], 0.5);
  place(engine.trams[1], zone.segmentIds[3], 0.5);
  oracle.check();
  assert.ok(oracle.counts.conflictZone > 0);
});

test("points moving while their owner holds the lock are detected", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  const runtime = engine.switchStates.get(engine.scenario.switches[0].id);
  const owner = engine.trams[0];
  runtime.lockedBy = owner.id;
  runtime.releaseAtDistance = owner.distanceMeters + 1000;
  oracle.check();
  runtime.state = runtime.state === "main" ? "branch" : "main";
  oracle.check();
  assert.ok(oracle.counts.pointsMovedWhileLocked > 0);
});

test("an approach lock may lapse only while its owner can still stop short of the points", () => {
  for (const [metersBefore, speed, expectViolation] of [[10, 8, true], [400, 8, false]]) {
    const engine = nizhny();
    const oracle = new SafetyOracle(engine);
    const definition = engine.scenario.switches.find((item) => item.id === "SW-21-CHP");
    const runtime = engine.switchStates.get(definition.id);
    const incoming = [...engine.segments.values()].find((segment) => segment.to === definition.nodeId && segment.lengthMeters > 400);
    const owner = engine.trams[0];
    place(owner, incoming.id, 1 - metersBefore / incoming.lengthMeters);
    owner.speedMps = speed;
    assert.ok(Math.abs(engine.forwardDistanceToPosition(owner, incoming.id, 1) - metersBefore) < 1e-6);
    runtime.lockedBy = owner.id;
    delete runtime.releaseAtDistance;
    oracle.check();
    runtime.lockedBy = null;
    runtime.state = runtime.state === "main" ? "branch" : "main";
    oracle.check();
    assert.equal(oracle.counts.pointsMovedWhileLocked > 0, expectViolation, `${metersBefore} m before the points at ${speed} m/s`);
  }
});

test("an entered grant exposed to a road phase is detected", () => {
  const engine = nizhny();
  const oracle = new SafetyOracle(engine);
  const controller = [...engine.trafficControllers.values()][0];
  controller.activeTramEntered = true;
  controller.activeTramCleared = false;
  controller.phase = "road-green";
  oracle.check();
  assert.ok(oracle.counts.exposedReservation > 0);
});

test("holdTramAtStop extends only a dwell that is in progress", () => {
  const engine = createEngine({ scenarioId: "izmir-konak", startMinute: 990 });
  const moving = engine.trams.find((tram) => tram.stationPhase !== "dwell");
  assert.equal(engine.holdTramAtStop(moving.id, 120), false);
  let dwelling = null;
  for (let step = 0; step < 20000 && !dwelling; step += 1) {
    stepEngine(engine);
    dwelling = engine.trams.find((tram) => tram.stationPhase === "dwell" && tram.pendingStationReaderId?.startsWith("IZK-RO0"));
  }
  assert.ok(dwelling, "a tram dwells at a mid-line stop");
  const heldUntil = engine.simulationTime + 120;
  assert.equal(engine.holdTramAtStop(dwelling.id, 120), true);
  for (let step = 0; step < 2000; step += 1) stepEngine(engine);
  assert.equal(dwelling.stationPhase, "dwell", "still held 100 s later");
  for (let step = 0; step < 600; step += 1) stepEngine(engine);
  assert.ok(engine.simulationTime > heldUntil && dwelling.stationPhase !== "dwell", "released after the hold");
});

test("injectPassengers adds riders to a stop queue and rejects non-stops", () => {
  const engine = createEngine({ scenarioId: "izmir-konak", startMinute: 990 });
  const before = engine.getServiceSample().averageWaitSeconds;
  assert.equal(engine.injectPassengers("IZK-RO09", 250), true);
  assert.equal(engine.injectPassengers("SIG-GAZI-O", 10), false);
  assert.ok(engine.getServiceSample().averageWaitSeconds > before);
});

test("terminal holding can be switched off for experiments, and is on by default", () => {
  for (const terminalHolding of [true, false]) {
    const engine = createEngine({ scenarioId: "izmir-konak", startMinute: 990, terminalHolding });
    let reserved = 0;
    for (let step = 0; step < 12000 && (!terminalHolding || reserved === 0); step += 1) {
      stepEngine(engine);
      if (engine.trams.some((tram) => tram.scheduledDepartureKind === "terminal")) reserved += 1;
    }
    assert.equal(reserved > 0, terminalHolding);
  }
});
