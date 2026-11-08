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
  // The 206 m zone gets more than the 25 s minimum clearance timeout.
  const clearanceTimeout = engine.crossingClearanceTimeout(controller);
  assert.ok(clearanceTimeout > 25);
  engine.simulationTime += clearanceTimeout - 1;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  engine.simulationTime += 2;
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
  // Requesting from the approach, first in line, as a detector request does.
  tram.segmentId = signal.segmentId;
  tram.progress = signal.at - 0.01;
  controller.queue.push({ tramId: tram.id, signalId: signal.id, requestedAt: 0 });
  engine.updateTraffic();
  engine.simulationTime = controller.phaseUntil;
  engine.updateTraffic();
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

test("a tram never speeds up once its stop approach has begun", () => {
  for (const networkId of ["izmir-konak", "nizhny-routes-2-21"]) {
    const engine = new SimulationEngine(networkId);
    engine.setRunning(true);
    // A tram starting the approach slowly may still creep in at the PWM 20 speed.
    const creepMps = (engine.getSnapshot().options.speedLimit / 3.6) * (20 / 55);
    const caps = new Map();
    const previousSpeed = new Map();
    let checked = 0;
    for (let tick = 0; tick < 24_000; tick += 1) {
      engine.stepFixed(0.05);
      for (const tram of engine.trams) {
        if (tram.stationPhase !== "crawl") {
          if (caps.has(tram.id)) checked += 1;
          caps.delete(tram.id);
        } else {
          // Taken from the step before the approach began: its first step may already contain a jump.
          if (!caps.has(tram.id)) caps.set(tram.id, Math.max(previousSpeed.get(tram.id) ?? 0, creepMps));
          // 0.5 m/s leaves room for gravity on a downhill coast, not for traction.
          assert.ok(
            tram.speedMps <= caps.get(tram.id) + 0.5,
            `${networkId}: ${tram.id} sped up to ${(tram.speedMps * 3.6).toFixed(1)} km/h from ${(caps.get(tram.id) * 3.6).toFixed(1)} approaching ${tram.pendingStationReaderId}`,
          );
        }
        previousSpeed.set(tram.id, tram.speedMps);
      }
    }
    assert.ok(checked > 50, `${networkId}: ${checked} approaches checked`);
  }
});

test("a tram reaching a switch without its lock takes the leg it looked ahead along", () => {
  const engine = new SimulationEngine("prototype-loop", 2);
  const definition = engine.scenario.switches[0], runtime = engine.switchStates.get(definition.id);
  const tram = engine.trams.find((item) => item.routeIntent === "main");
  const approach = [...engine.segments.values()].find(
    (segment) => segment.to === definition.nodeId && !definition.returnSegmentIds?.includes(segment.id),
  );
  // The points lie against the tram's route and nobody holds them.
  assert.equal(engine.toggleSwitch(definition.id), true);
  assert.equal(runtime.state, "branch");
  assert.equal(runtime.lockedBy, null);
  tram.segmentId = approach.id;
  tram.progress = 1;

  const planned = engine.peekNextSegment(tram, approach);
  assert.equal(planned.id, definition.mainSegmentId);
  assert.equal(engine.chooseNextSegment(tram, approach)?.id, planned.id);
  assert.equal(runtime.state, "main");
  assert.equal(runtime.lockedBy, tram.id);
});

test("look-ahead follows an inline turnout set to its branch", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  engine.setAutoDispatch(false);
  const definition = engine.scenario.switches.find((item) => item.id === "SW-LYD");
  const approach = engine.segments.get(definition.segmentId);
  const branch = engine.segments.get(definition.branchSegmentId);
  const [tram, onBranch, pastTurnout] = engine.trams;
  tram.segmentId = approach.id;
  tram.progress = definition.at - 60 / approach.lengthMeters;
  onBranch.segmentId = branch.id;
  onBranch.progress = 0.5;
  pastTurnout.segmentId = approach.id;
  pastTurnout.progress = Math.min(0.99, definition.at + 40 / approach.lengthMeters);

  assert.equal(engine.forwardDistanceToTram(tram, onBranch), null, "points set straight: the branch is off the route");
  assert.ok(engine.forwardDistanceToTram(tram, pastTurnout) > 0);

  assert.equal(engine.toggleSwitch(definition.id), true);
  const toBranchTram = engine.forwardDistanceToTram(tram, onBranch);
  assert.ok(Math.abs(toBranchTram - (60 + 0.5 * branch.lengthMeters)) < 0.01, `distance ${toBranchTram}`);
  assert.equal(engine.forwardDistanceToTram(tram, pastTurnout), null, "the main line beyond the turnout is off the route");
  assert.equal(engine.nearestTramAhead(tram)?.tram.id, onBranch.id);
  assert.ok(engine.forwardDistanceToPosition(tram, branch.id, 0.2) !== null, "an obstacle on the branch is seen");
  assert.ok(engine.pathAhead(tram, 200).some(({ segment }) => segment.id === branch.id));
});

test("a tram leaving the depot waits for a tram approaching the exit from the previous segment", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setAutoDispatch(false);
  const [tram, approaching] = engine.trams;
  const tramIndex = engine.trams.indexOf(tram);
  assert.equal(engine.placeInDepot(tram), true);
  assert.equal(engine.dispatchFromDepot(tram, false, true), true);
  const { portal } = engine.depotPortalById(tram.depotPortalId);
  const exit = engine.segments.get(portal.exitSegmentId);
  const cycle = engine.scenario.routes[0].segmentIds;
  const previous = engine.segments.get(cycle[(cycle.indexOf(exit.id) - 1 + cycle.length) % cycle.length]);
  // 30 m before the exit point, across the segment boundary, at line speed.
  approaching.segmentId = previous.id;
  approaching.progress = 1 - (30 - portal.exitProgress * exit.lengthMeters) / previous.lengthMeters;
  approaching.speedMps = 11;
  engine.resetSegmentTrail(approaching);

  for (let step = 0; step < 400; step += 1) engine.updateDepotTransition(tram, 0.05, tramIndex);
  assert.equal(tram.serviceState, "depot-egress", "it must not join in front of a tram that cannot stop");
  assert.match(tram.status, /Depot exit held/);

  approaching.speedMps = 0;
  for (let step = 0; step < 40; step += 1) engine.updateDepotTransition(tram, 0.05, tramIndex);
  assert.equal(tram.serviceState, "in-service", "a stopped tram 30 m back leaves room to join");
});

test("a turnout speed limit holds until the rear has left the turnout", () => {
  const mainLegMps = 20 / 3.6, branchLegMps = 15 / 3.6;
  for (const [networkId, restrictionId, divert, limitMps] of [
    ["nizhny-routes-2-21", "turnout:SW-21-KRS:branch", false, branchLegMps],
    // An inline turnout: straight through is its main leg, diverging its branch.
    ["nizhny-route-2", "turnout:SW-LYD:approach", false, mainLegMps],
    ["nizhny-route-2", "turnout:SW-LYD:approach", true, branchLegMps],
  ]) {
    const engine = new SimulationEngine(networkId);
    engine.setAutoDispatch(false);
    const restriction = engine.speedRestrictions.find((item) => item.id === restrictionId);
    const segment = engine.segments.get(restriction.segmentId);
    const tram = engine.trams[0];
    tram.segmentId = segment.id;
    if (divert) {
      // Just before the points, then a step past them onto the branch.
      assert.equal(engine.toggleSwitch(restriction.inlineSwitchId), true);
      const branch = engine.segments.get(engine.scenario.switches.find((item) => item.id === restriction.inlineSwitchId).branchSegmentId);
      tram.progress = restriction.at - 1 / segment.lengthMeters;
      engine.resetSegmentTrail(tram);
      tram.segmentTrail = [{ segmentId: "earlier", enteredAtMeters: tram.distanceMeters - 500 }, ...tram.segmentTrail];
      tram.segmentTrail[1].enteredAtMeters = tram.distanceMeters - tram.progress * segment.lengthMeters;
      tram.distanceMeters += 1 + 10;
      tram.segmentId = branch.id;
      tram.progress = 10 / branch.lengthMeters;
      tram.segmentTrail.push({ segmentId: branch.id, enteredAtMeters: tram.distanceMeters - 10 });
    } else {
      tram.progress = restriction.at + 10 / segment.lengthMeters;
      engine.resetSegmentTrail(tram);
    }
    const guidance = engine.speedProfileGuidance(tram, 70 / 3.6);
    assert.ok(
      guidance.targetSpeedMps <= limitMps + 1e-9,
      `${restrictionId}${divert ? " diverging" : ""}: ${(guidance.targetSpeedMps * 3.6).toFixed(1)} km/h 10 m past the turnout`,
    );
    if (!divert) assert.ok(guidance.targetSpeedMps > limitMps - 0.5, `${restrictionId}: no tighter limit than the turnout's own`);
  }
});

test("a crossing whose entry was lost releases once the owner's odometer proves it clear", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const controller = engine.trafficControllers.get("J-OSH");
  const signal = engine.scenario.signals.find((item) => item.id === "SG-OSH-A");
  const segment = engine.segments.get(signal.segmentId);
  const tram = engine.trams.find((item) => item.segmentId === signal.segmentId);
  controller.queue.push({ tramId: tram.id, signalId: signal.id, requestedAt: 0 });
  engine.updateTraffic();
  engine.simulationTime = controller.phaseUntil;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");

  // Every detector observation is lost while the tram passes the crossing.
  const deliver = engine.observeTraffic.bind(engine);
  let outage = true;
  engine.observeTraffic = (...args) => { if (!outage) deliver(...args); };
  tram.distanceMeters = 1000;
  tram.progress = signal.at + .001;
  engine.markSignalPassage(tram, signal.at - .001, tram.progress);
  engine.updateTraffic();
  assert.equal(controller.activeTramEntered, false, "the core never saw the entry");

  // The tram drives on to the next segment before the outage ends.
  const rearClearDistance = 1000 + (signal.clearAt - tram.progress) * segment.lengthMeters + 15;
  tram.segmentId = [...engine.segments.values()].find((item) => item.from === segment.to).id;
  tram.progress = .01;
  tram.distanceMeters = rearClearDistance - 1;
  engine.simulationTime += 10;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  outage = false;
  // Entry is re-reported, but the rear is not yet clear: the grant holds.
  engine.updateTraffic();
  assert.equal(controller.activeTramEntered, true);
  assert.equal(controller.activeTramCleared, false);
  assert.equal(controller.phase, "tram-green");
  tram.distanceMeters = rearClearDistance + .1;
  engine.updateTraffic();
  assert.equal(controller.activeTramCleared, true);
  engine.simulationTime = controller.phaseUntil + 1;
  engine.updateTraffic();
  assert.equal(controller.phase, "amber-to-road");
  engine.simulationTime += controller.clearanceSeconds;
  engine.updateTraffic();
  assert.equal(controller.phase, "road-green");
  assert.equal(controller.ownerPassage, undefined);
});

test("an approach lock for a tram that never comes lapses; a committed owner keeps it", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  engine.setAutoDispatch(false);
  const definition = engine.scenario.switches.find((item) => item.id === "SW-21-CHP");
  const runtime = engine.switchStates.get(definition.id);
  const [phantom, waiting] = engine.trams;
  // A phantom reader report locks the points for a tram far from them.
  runtime.queue.push({ tramId: phantom.id, desired: "branch", requestedAt: 0 });
  engine.applyNextSwitchRequest(runtime, definition);
  assert.equal(runtime.lockedBy, phantom.id);
  assert.equal(engine.switchOwnerCommitted(definition, runtime, phantom), false);
  runtime.queue.push({ tramId: waiting.id, desired: "main", requestedAt: 1 });
  engine.releaseClearedSwitches();
  engine.simulationTime += 59;
  engine.releaseClearedSwitches();
  assert.equal(runtime.lockedBy, phantom.id);
  assert.equal(engine.toggleSwitch(definition.id), false, "the lock still interlocks the points");
  engine.simulationTime += 2;
  engine.releaseClearedSwitches();
  assert.equal(runtime.lockedBy, waiting.id, "the queued tram is served");
  assert.equal(runtime.state, "main");

  // An owner standing just before the points never loses its lock.
  const incoming = [...engine.segments.values()].find((segment) => segment.to === definition.nodeId);
  waiting.segmentId = incoming.id;
  waiting.progress = 1 - 5 / incoming.lengthMeters;
  waiting.speedMps = 0;
  assert.equal(engine.switchOwnerCommitted(definition, runtime, waiting), true);
  for (let step = 0; step < 4; step += 1) {
    engine.simulationTime += 60;
    engine.releaseClearedSwitches();
  }
  assert.equal(runtime.lockedBy, waiting.id);
});

test("a tram keeps the crossing clear while the terminal beyond it is full", () => {
  const engine = new SimulationEngine("izmir-konak", 3);
  engine.setAutoDispatch(false);
  const signal = engine.scenario.signals.find((item) => item.id === "SIG-UCKUYULAR-O");
  const controller = engine.trafficForSignal(signal.id);
  const [first, second, tram] = engine.trams;
  for (const [index, berthed] of [first, second].entries()) {
    Object.assign(berthed, {
      segmentId: "IZK-O18", progress: .88, speedMps: 0, stationPhase: "dwell",
      pendingStationReaderId: "IZK-RO18", terminalBerth: index + 1,
    });
  }
  Object.assign(tram, { segmentId: "IZK-O18", progress: .5, speedMps: 0 });
  controller.queue.push({ tramId: tram.id, signalId: signal.id, requestedAt: 0 });

  let block = engine.findBlockingCondition(tram, engine.nearestTramAhead(tram));
  assert.equal(block.key, `keep-clear:${signal.id}`);
  assert.match(block.status, /Fahrettin Altay full/);
  assert.ok(!controller.queue.some((request) => request.tramId === tram.id), "no grant is requested");

  // A platform frees: the stop line becomes an ordinary red and it asks again.
  Object.assign(second, { stationPhase: "none", pendingStationReaderId: null, terminalBerth: 0, segmentId: "IZK-I01", progress: .5 });
  block = engine.findBlockingCondition(tram, engine.nearestTramAhead(tram));
  assert.equal(block.key, `signal:${signal.id}`);
  assert.ok(controller.queue.some((request) => request.tramId === tram.id));

  // Granted, then the terminal fills again before it enters: it yields the
  // grant after the grant timeout instead of holding the road red.
  engine.updateTraffic();
  engine.simulationTime = controller.phaseUntil;
  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  Object.assign(second, { segmentId: "IZK-O18", progress: .88, stationPhase: "dwell", pendingStationReaderId: "IZK-RO18", terminalBerth: 2 });
  const grantedAt = controller.activeGrantedAt;
  let releasedAt = null;
  for (let step = 0; step < 40 && releasedAt === null; step += 1) {
    engine.simulationTime += 1;
    assert.equal(engine.findBlockingCondition(tram, engine.nearestTramAhead(tram)).key, `keep-clear:${signal.id}`);
    engine.updateTraffic();
    if (controller.phase === "amber-to-road") releasedAt = engine.simulationTime;
  }
  assert.ok(releasedAt !== null && releasedAt - grantedAt >= 25, `released ${releasedAt - grantedAt} s after the grant`);
  assert.ok(!controller.queue.some((request) => request.tramId === tram.id), "a yielding tram is not requeued");
  engine.simulationTime += controller.clearanceSeconds;
  engine.updateTraffic();
  assert.equal(controller.phase, "road-green");
  assert.equal(controller.activeTramId, null);
});

test("only the first tram in line is granted, and a grant blocked by a tram ahead is withdrawn", () => {
  const engine = new SimulationEngine("izmir-konak", 3);
  engine.setAutoDispatch(false);
  const signal = engine.scenario.signals.find((item) => item.id === "SIG-UCKUYULAR-O");
  const controller = engine.trafficForSignal(signal.id);
  const [front, rear] = engine.trams;
  Object.assign(front, { segmentId: signal.segmentId, progress: signal.at - .02, speedMps: 0 });
  Object.assign(rear, { segmentId: signal.segmentId, progress: signal.at - .1, speedMps: 0 });

  // The tram ahead lost its request (it was keeping the crossing clear); the
  // tram behind it must not be granted a crossing it cannot reach.
  controller.queue.push({ tramId: rear.id, signalId: signal.id, requestedAt: 0 });
  engine.updateTraffic();
  assert.equal(controller.phase, "road-green");
  assert.equal(controller.activeTramId, null);
  controller.queue.push({ tramId: front.id, signalId: signal.id, requestedAt: 1 });
  engine.updateTraffic();
  assert.equal(controller.activeTramId, front.id);
  assert.ok(controller.queue.some((request) => request.tramId === rear.id), "the tram behind keeps its place");

  // A grant that is already held by a tram with another tram ahead is given back.
  const blocked = new SimulationEngine("izmir-konak", 3);
  blocked.setAutoDispatch(false);
  const blockedController = blocked.trafficForSignal(signal.id);
  const [ahead, behind] = blocked.trams;
  Object.assign(behind, { segmentId: signal.segmentId, progress: signal.at - .1, speedMps: 0 });
  blockedController.queue.push({ tramId: behind.id, signalId: signal.id, requestedAt: 0 });
  blocked.updateTraffic();
  blocked.simulationTime = blockedController.phaseUntil;
  blocked.updateTraffic();
  assert.equal(blockedController.activeTramId, behind.id);
  Object.assign(ahead, { segmentId: signal.segmentId, progress: signal.at - .02, speedMps: 0 });
  const grantedAt = blockedController.activeGrantedAt;
  while (blockedController.phase === "tram-green" && blocked.simulationTime < grantedAt + 40) {
    blocked.simulationTime += 1;
    blocked.updateTraffic();
  }
  assert.equal(blockedController.phase, "amber-to-road");
  assert.ok(blocked.simulationTime - grantedAt >= 25);
  assert.ok(blockedController.queue.some((request) => request.tramId === behind.id), "the tram behind keeps its request");
  // Once the crossing is free again, the tram behind is still not granted
  // while the tram ahead stands between it and the stop line.
  blocked.simulationTime += blockedController.clearanceSeconds;
  blocked.updateTraffic();
  blocked.updateTraffic();
  assert.notEqual(blockedController.activeTramId, behind.id);
});
