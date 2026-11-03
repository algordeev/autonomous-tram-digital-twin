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
        // A tram occupies the zone with any part of its 15 m body, not only its front.
        const occupants = engine.trams.filter((tram) => tram.serviceState === "in-service" &&
          engine.bodySegmentIds(tram).some((segmentId) => zone.segmentIds.includes(segmentId)));
        assert.ok(occupants.length <= 1, `${seed}/${tick}: ${zone.id} occupied by ${occupants.map((tram) => tram.id)}`);
      }
    }
  });
}

test("a withdrawn tram releases points it never reached and drops its queued requests", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const definition = engine.scenario.switches.find((item) => item.id === "SW-21-CHP");
  const runtime = engine.switchStates.get(definition.id);
  const controller = engine.trafficControllers.get("J-CHP-MERGE");
  const [tram, other] = engine.trams;
  runtime.queue.push({ tramId: tram.id, desired: "branch", requestedAt: 0 });
  engine.applyNextSwitchRequest(runtime, definition);
  assert.equal(runtime.lockedBy, tram.id);
  runtime.queue.push({ tramId: tram.id, desired: "main", requestedAt: 1 });
  controller.queue.push({ tramId: tram.id, signalId: "SG-CHP-R21", requestedAt: 0 });

  assert.equal(engine.placeInDepot(tram), true);
  assert.equal(runtime.lockedBy, null);
  assert.ok(!runtime.queue.some((request) => request.tramId === tram.id));
  assert.ok(!controller.queue.some((request) => request.tramId === tram.id));
  // The core agrees the points are free: another tram can now take them.
  runtime.queue.push({ tramId: other.id, desired: "main", requestedAt: 2 });
  engine.applyNextSwitchRequest(runtime, definition);
  assert.equal(runtime.lockedBy, other.id);
});

test("points a withdrawn tram has crossed stay locked until it is stored", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const definition = engine.scenario.switches.find((item) => item.id === "SW-21-CHP");
  const runtime = engine.switchStates.get(definition.id);
  const tram = engine.trams[0];
  runtime.queue.push({ tramId: tram.id, desired: "branch", requestedAt: 0 });
  engine.applyNextSwitchRequest(runtime, definition);
  runtime.releaseAtDistance = tram.distanceMeters + 15;

  tram.serviceState = "depot-ingress";
  engine.releaseOffLineClaims(tram, false);
  assert.equal(runtime.lockedBy, tram.id, "its rear may still be over the points");
  tram.serviceState = "to-depot";
  assert.equal(engine.placeInDepot(tram), true);
  assert.equal(runtime.lockedBy, null);
});

test("a crossing grant to a tram that left the line is released once, not requeued", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const controller = engine.trafficControllers.get("J-CHP-MERGE");
  const tram = engine.trams.find((item) => item.fleetGroupId === "route-21-to-chyorny-prud");
  tram.segmentId = "N21-CHP-LOOP";
  tram.progress = 0.3;
  controller.queue.push({ tramId: tram.id, signalId: "SG-CHP-R21", requestedAt: 0 });
  engine.updateTraffic();
  engine.simulationTime = controller.phaseUntil;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");

  // Withdrawn into a depot while standing on the approach, before entering.
  tram.serviceState = "depot-ingress";
  engine.simulationTime += 26;
  engine.updateTraffic();
  assert.equal(controller.phase, "amber-to-road");
  assert.ok(!controller.queue.some((request) => request.tramId === tram.id));
  engine.simulationTime += controller.clearanceSeconds;
  engine.updateTraffic();
  assert.equal(controller.phase, "road-green");
  assert.equal(controller.activeTramId, null);
});

test("a tram stored after entering a crossing reports its rear clear", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const controller = engine.trafficControllers.get("J-CHP-MERGE");
  const signal = engine.scenario.signals.find((item) => item.id === "SG-CHP-R21");
  const tram = engine.trams.find((item) => item.fleetGroupId === "route-21-to-chyorny-prud");
  controller.queue.push({ tramId: tram.id, signalId: signal.id, requestedAt: 0 });
  engine.updateTraffic();
  engine.simulationTime = controller.phaseUntil;
  engine.updateTraffic();
  tram.segmentId = signal.segmentId;
  tram.progress = signal.at + 0.01;
  engine.updateTraffic();
  assert.equal(controller.activeTramEntered, true);

  assert.equal(engine.placeInDepot(tram), true);
  assert.equal(controller.activeTramCleared, true);
  engine.simulationTime += 30;
  engine.updateTraffic();
  assert.equal(controller.phase, "amber-to-road", "cleared, not an all-red clearance fault");
  engine.simulationTime += controller.clearanceSeconds;
  engine.updateTraffic();
  assert.equal(controller.phase, "road-green");
});

test("a tram rejoining from the depot track locks the points while it crosses them", () => {
  const engine = new SimulationEngine("prototype-loop", 2);
  const definition = engine.scenario.switches[0], runtime = engine.switchStates.get(definition.id);
  const tram = engine.trams[0];
  const returnTrack = engine.segments.get(definition.returnSegmentIds[0]);
  assert.equal(runtime.state, "main");
  tram.segmentId = returnTrack.id;
  tram.progress = 1;

  assert.equal(engine.chooseNextSegment(tram, returnTrack)?.id, definition.mainSegmentId);
  assert.equal(runtime.lockedBy, tram.id);
  assert.equal(runtime.state, "branch", "trailing through from the branch leg");
  for (const mode of ["firmware", "cooperative"]) {
    engine.options.controlMode = mode;
    assert.equal(engine.toggleSwitch(definition.id), false);
  }
  tram.distanceMeters = runtime.releaseAtDistance;
  engine.releaseClearedSwitches();
  assert.equal(runtime.lockedBy, null);
  assert.equal(runtime.state, "main", "points restored after the rear clears");
});

test("a tram rejoining from the depot track waits while another tram holds the points", () => {
  const engine = new SimulationEngine("prototype-loop", 2);
  const definition = engine.scenario.switches[0], runtime = engine.switchStates.get(definition.id);
  const [tram, other] = engine.trams;
  const returnTrack = engine.segments.get(definition.returnSegmentIds[0]);
  runtime.queue.push({ tramId: other.id, desired: "main", requestedAt: 0 });
  engine.applyNextSwitchRequest(runtime, definition);
  assert.equal(runtime.lockedBy, other.id);
  tram.segmentId = returnTrack.id;
  tram.progress = 1;

  assert.equal(engine.chooseNextSegment(tram, returnTrack), null);
  assert.equal(runtime.lockedBy, other.id);
  assert.equal(runtime.state, "main");
});

test("a curve limit holds past the apex until the rear has left the curve", () => {
  let checkedLookBack = false;
  for (const networkId of ["izmir-konak", "nizhny-route-2", "nizhny-routes-2-21"]) {
    const engine = new SimulationEngine(networkId);
    const tram = engine.trams[0];
    const lineSpeedMps = 70 / 3.6;
    const curves = engine.speedRestrictions
      .filter((item) => item.reason === "curve")
      .sort((a, b) => a.radiusMeters - b.radiusMeters);
    const placeOn = (segmentId, progress) => {
      tram.segmentId = segmentId;
      tram.progress = progress;
      engine.resetSegmentTrail(tram);
    };

    const sharp = curves.find((item) => (1 - item.at) * engine.segments.get(item.segmentId).lengthMeters > 12);
    const segment = engine.segments.get(sharp.segmentId);
    placeOn(segment.id, sharp.at);
    const apexLimit = engine.speedProfileGuidance(tram, lineSpeedMps).targetSpeedMps;
    assert.ok(apexLimit < lineSpeedMps - 1, `${networkId}: ${sharp.id} restricts speed`);
    placeOn(segment.id, sharp.at + 10 / segment.lengthMeters);
    const inside = engine.speedProfileGuidance(tram, lineSpeedMps);
    assert.equal(inside.reason, "curve");
    assert.ok(inside.targetSpeedMps <= apexLimit + 1e-9, `${networkId}: 10 m past ${sharp.id} apex`);

    // An apex just before a segment end still applies once the front has crossed into the next segment.
    for (const curve of curves) {
      const previous = engine.segments.get(curve.segmentId);
      const apexMeters = curve.at * previous.lengthMeters;
      if (curve.at === 0 || previous.lengthMeters - apexMeters > 20) continue;
      const next = engine.peekNextSegment(tram, previous);
      if (!next || next.lengthMeters < 20) continue;
      const frontPastApex = previous.lengthMeters - apexMeters + 3;
      const previousStart = 1_000 - frontPastApex - apexMeters;
      tram.distanceMeters = 1_000;
      tram.segmentId = next.id;
      tram.progress = (1_000 - (previousStart + previous.lengthMeters)) / next.lengthMeters;
      tram.segmentTrail = [
        { segmentId: "earlier", enteredAtMeters: 0 },
        { segmentId: previous.id, enteredAtMeters: previousStart },
        { segmentId: next.id, enteredAtMeters: previousStart + previous.lengthMeters },
      ];
      const crossed = engine.speedProfileGuidance(tram, lineSpeedMps);
      const direct = Math.sqrt(0.65 * curve.radiusMeters);
      assert.ok(crossed.targetSpeedMps <= direct + 0.05, `${networkId}: ${curve.id} ignored after the segment end`);
      checkedLookBack = true;
      break;
    }
  }
  assert.ok(checkedLookBack, "a curve near a segment end exists in some network");
});
