import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SimulationEngine, initializeCppRuntimeFromBytes, resetCppRuntimeForTests } from "../src/simulation-core/index.ts";

const bytes = await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url));
test.beforeEach(async () => { resetCppRuntimeForTests(); await initializeCppRuntimeFromBytes(bytes); });
test.afterEach(() => resetCppRuntimeForTests());

test("browser adapter cannot re-import a grant or force manual green over its occupant", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const controller = engine.trafficControllers.get("J-OSH"), tram = engine.trams[0];
  const signal = engine.scenario.signals.find((item) => item.id === "SG-OSH-A");
  controller.queue.push({ tramId: tram.id, signalId: signal.id, requestedAt: 0 });
  engine.updateTraffic();
  engine.simulationTime = controller.phaseUntil;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  tram.segmentId = signal.segmentId; tram.progress = signal.at + .01;
  engine.updateTraffic();
  assert.equal(controller.activeTramEntered, true);
  engine.setTrafficSignalMode("SG-OSH-B", "tram-green");
  assert.equal(controller.activeSignalId, "SG-OSH-A");
  assert.equal(controller.activeTramId, tram.id);
  // Corrupt the rendering mirror. It must not replace the live core grant.
  controller.phase = "road-green";
  controller.activeTramId = null;
  controller.activeTramEntered = false;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  assert.equal(controller.activeSignalId, "SG-OSH-A");
  assert.equal(controller.activeTramEntered, true);
  engine.simulationTime += 26;
  engine.updateTraffic();
  assert.equal(controller.phase, "fault");
  assert.equal(controller.activeTramId, tram.id);
  engine.setTrafficSignalMode("SG-OSH-B", "road-green");
  assert.equal(controller.phase, "fault");
  engine.observeTraffic(controller, engine.trams[1], signal.id, true);
  engine.updateTraffic();
  assert.equal(controller.phase, "fault");
  const segment = engine.segments.get(signal.segmentId);
  tram.progress = signal.clearAt + 15 / segment.lengthMeters + .001;
  engine.updateTraffic();
  assert.equal(controller.phase, "amber-to-road");
  engine.simulationTime += controller.clearanceSeconds;
  engine.updateTraffic();
  assert.equal(controller.phase, "road-green");
});

test("browser switch queue respects core refusal and keeps the lock through rear clearance", () => {
  const engine = new SimulationEngine("prototype-loop", 2);
  const definition = engine.scenario.switches[0], runtime = engine.switchStates.get(definition.id);
  const tram = engine.trams[0];
  const incoming = [...engine.segments.values()].find((segment) => segment.to === definition.nodeId);
  tram.segmentId = incoming.id;
  assert.ok(engine.chooseNextSegment(tram, incoming));
  assert.equal(runtime.lockedBy, tram.id);
  for (const mode of ["firmware", "cooperative"]) {
    engine.options.controlMode = mode;
    assert.equal(engine.toggleSwitch(definition.id), false);
  }
  const state = runtime.state;
  runtime.queue.push({ tramId: engine.trams[1].id, desired: state === "main" ? "branch" : "main", requestedAt: 0 });
  engine.applyNextSwitchRequest(runtime, definition);
  assert.equal(runtime.state, state);
  assert.equal(runtime.lockedBy, tram.id);
  assert.equal(runtime.queue.length, 1);
  tram.distanceMeters = runtime.releaseAtDistance - .01;
  engine.releaseClearedSwitches();
  assert.equal(runtime.lockedBy, tram.id);
  tram.distanceMeters += .02;
  engine.releaseClearedSwitches();
  assert.equal(runtime.lockedBy, engine.trams[1].id);
  assert.notEqual(runtime.state, state);
});

for (const seed of [17, 71, 203]) {
  test(`browser network conflict-zone invariant on every fixed step, seed ${seed}`, () => {
    const engine = new SimulationEngine("nizhny-routes-2-21", 10);
    engine.setAutoDispatch(false);
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const zones = engine.scenario.junctionConflictZones ?? [];
    assert.ok(zones.length > 0);
    for (let tick = 0; tick < 2400; tick++) {
      if (tick % 100 === 0) {
        const signal = engine.scenario.signals[Math.floor(random() * engine.scenario.signals.length)];
        engine.setTrafficSignalMode(signal.id, ["auto", "tram-green", "road-green"][Math.floor(random() * 3)]);
      }
      engine.stepFixed(.05);
      for (const zone of zones) {
        const occupants = engine.trams.filter((tram) => tram.serviceState === "in-service" && zone.segmentIds.includes(tram.segmentId));
        assert.ok(occupants.length <= 1, `${seed}/${tick}: ${zone.id} occupied by ${occupants.map((tram) => tram.id)}`);
      }
    }
  });
}
