import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SimulationEngine } from "../src/simulation-core/engine.ts";
import {
  initializeCppRuntimeFromBytes,
  resetCppRuntimeForTests,
} from "../src/simulation-core/cpp-runtime.ts";
import { clampMapPan } from "../src/map-viewport.ts";

const loadNetwork = async () =>
  JSON.parse(
    await readFile(
      new URL("../src/config/networks/izmir-konak.json", import.meta.url),
      "utf8",
    ),
  );

function advance(engine, simulatedSeconds) {
  engine.setSimulationRate(5);
  engine.setRunning(true);
  const iterations = Math.ceil(simulatedSeconds / 0.25);
  for (let index = 0; index < iterations; index += 1) engine.step(0.05);
}

test("Izmir service cycle is continuous through both terminals", async () => {
  const network = await loadNetwork();
  const segments = new Map(network.segments.map((segment) => [segment.id, segment]));
  const cycle = network.routes[0].segmentIds;
  for (let index = 0; index < cycle.length; index += 1) {
    const current = segments.get(cycle[index]);
    const next = segments.get(cycle[(index + 1) % cycle.length]);
    assert.equal(
      current.to,
      next.from,
      `${current.id} must continue into ${next.id} without reversing`,
    );
  }
  assert.deepEqual(cycle.slice(17, 20), ["IZK-O18", "IZK-I01", "IZK-I02"]);
});

test("Izmir exposes one three-module VYCON bank in every line section", async () => {
  const network = await loadNetwork();
  assert.equal(network.tractionPowerSystem.nominalVoltageV, 750);
  assert.equal(network.tractionPowerSystem.sections.length, 6);
  assert.deepEqual(network.tractionPowerSystem.sections.map((section) => section.flywheel.modules), [3, 3, 3, 3, 3, 3]);
});

test("Fahrettin Altay departure continues past Uckuyular instead of returning", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setFleetGroupCount("konak-to-faltay", 0);
  engine.setFleetGroupCount("konak-to-halkapinar", 1);
  engine.setAutoDispatch(false);
  advance(engine, 130);

  const tram = engine.getSnapshot().trams[0];
  assert.ok(tram);
  assert.notEqual(tram.segmentId, "IZK-O18");
  assert.ok(
    tram.segmentId !== "IZK-I01" || tram.progress > 0.8,
    `tram remained at the Uckuyular approach: ${tram.segmentId} @ ${tram.progress}`,
  );
});

test("Uckuyular fail-safe requests priority when a tram starts on its detector", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setFleetGroupCount("konak-to-faltay", 0);
  engine.setFleetGroupCount("konak-to-halkapinar", 1);
  engine.setAutoDispatch(false);
  advance(engine, 90);

  const snapshot = engine.getSnapshot();
  const tram = snapshot.trams[0];
  assert.ok(tram.segmentId !== "IZK-I01" || tram.progress > 0.8);
  assert.doesNotMatch(tram.status, /Signal SIG-UCKUYULAR-I · STOP/);
});

test("Izmir geometry and pan limits expose all four map corners", async () => {
  const network = await loadNetwork();
  const points = network.segments.flatMap((segment) => segment.points);
  assert.ok(Math.min(...points.map((point) => point.x)) >= 0);
  assert.ok(Math.max(...points.map((point) => point.x)) <= 1000);
  assert.ok(Math.min(...points.map((point) => point.y)) >= 0);
  assert.ok(Math.max(...points.map((point) => point.y)) <= 620);

  const zoom = 18;
  assert.deepEqual(clampMapPan({ x: 9_000, y: 5_580 }, zoom, 1000, 620), {
    x: 9_000,
    y: 5_580,
  });
  assert.deepEqual(clampMapPan({ x: -9_000, y: -5_580 }, zoom, 1000, 620), {
    x: -9_000,
    y: -5_580,
  });
});

test("stored Izmir trams are laid out above the depot instead of on the service lead", () => {
  const engine = new SimulationEngine("izmir-konak");
  const depot = engine.scenario.depots[0];
  const portal = depot.portals[0];
  const stored = engine.trams.slice(0, 7);
  for (const tram of stored) {
    tram.serviceState = "in-depot";
    tram.depotId = depot.id;
    tram.depotPortalId = portal.id;
  }

  const snapshots = engine
    .getSnapshot()
    .trams.filter((tram) => tram.serviceState === "in-depot");
  assert.equal(snapshots.length, 7);
  assert.ok(snapshots.every((tram) => tram.position.y < depot.point.y));
  assert.ok(snapshots[3].position.y < snapshots[0].position.y);
  assert.ok(snapshots[6].position.y < snapshots[3].position.y);
});

test("smooth braking stops an Izmir tram at the platform marker", async () => {
  const network = await loadNetwork();
  const engine = new SimulationEngine("izmir-konak");
  engine.setFleetGroupCount("konak-to-faltay", 1);
  engine.setFleetGroupCount("konak-to-halkapinar", 0);
  engine.setAutoDispatch(false);
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let tram;
  for (let index = 0; index < 6000; index += 1) {
    engine.step(0.05);
    tram = engine.getSnapshot().trams[0];
    if (tram?.doorsOpen) break;
  }
  assert.ok(tram?.doorsOpen, "tram never reached a platform");
  const reader = network.readers.find(
    (item) => item.kind === "station" && item.segmentId === tram.segmentId,
  );
  const segment = network.segments.find((item) => item.id === tram.segmentId);
  assert.ok(reader && segment);
  const alignmentErrorMeters =
    Math.abs(tram.progress - (reader.displayAt ?? reader.at)) * segment.lengthMeters;
  assert.ok(alignmentErrorMeters <= 0.45, `platform error was ${alignmentErrorMeters} m`);
  assert.equal(tram.speedKmh, 0);
});

// Both orders matter: at the shared platform point the tie-break reports the
// standing tram as 0 m ahead only when it has the lower fleet rank.
for (const firstArrival of ["lower fleet rank", "higher fleet rank"]) test(`two trams use both Izmir terminal platforms side by side and leave independently (${firstArrival} arrives first)`, async () => {
  resetCppRuntimeForTests();
  await initializeCppRuntimeFromBytes(
    await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url)),
  );
  try {
    const engine = new SimulationEngine("izmir-konak");
    engine.setAutoDispatch(false);
    const terminal = engine.scenario.readers.find((reader) => reader.id === "IZK-RO18");
    const segment = engine.segments.get(terminal.segmentId);
    const [lowerRank, higherRank] = engine.trams;
    const [first, second] = firstArrival === "lower fleet rank"
      ? [lowerRank, higherRank]
      : [higherRank, lowerRank];
    engine.trams = [lowerRank, higherRank];
    for (const [tram, metersBeforeTrigger] of [[first, 40], [second, 140]]) {
      tram.serviceState = "in-service";
      tram.segmentId = segment.id;
      tram.progress = terminal.at - metersBeforeTrigger / segment.lengthMeters;
      tram.releaseTime = 0;
    }
    // A departure has just left this terminal, so the first arrival is held
    // for the planned interval as it would be in peak service.
    const window = engine.activeServiceWindow();
    engine.lastTerminalDepartureAtByPoint.set(
      `${window.id}:${engine.routeIdForTram(first)}:terminal:${terminal.id}`,
      0,
    );

    const dwelling = (tram) =>
      tram.pendingStationReaderId === terminal.id && tram.stationPhase === "dwell";
    let sideBySide = false;
    let departedAlongside = false;
    let secondStuckSteps = 0;
    let closestUnpairedMeters = Infinity;
    engine.setRunning(true);
    for (let tick = 0; tick < 20 * 60 / 0.05 && !departedAlongside; tick += 1) {
      engine.stepFixed(0.05);
      const snapshots = engine.getSnapshot().trams;
      for (const item of snapshots) {
        assert.ok(item.headwayAheadMeters === null || item.headwayAheadMeters >= 21.99,
          `${item.id} reports a ${item.headwayAheadMeters} m headway`);
      }
      if (dwelling(first) && dwelling(second)) {
        sideBySide = true;
        assert.notEqual(first.terminalBerth, second.terminalBerth);
      }
      // One tram clears the platform area while the other is still standing.
      const platformMeters = (terminal.displayAt ?? terminal.at) * segment.lengthMeters;
      if (sideBySide && [first, second].some(dwelling) && [first, second].some((tram) =>
        !dwelling(tram) &&
        (tram.segmentId !== segment.id || tram.progress * segment.lengthMeters > platformMeters + 22))) {
        departedAlongside = true;
      }
      if (second.stationPhase === "crawl" && second.speedMps < 0.01 && dwelling(first)) {
        secondStuckSteps += 1;
      }
      for (const [tram, other] of [[first, second], [second, first]]) {
        const parallel = snapshots.find((item) => item.id === tram.id).terminalBerth *
          snapshots.find((item) => item.id === other.id).terminalBerth === 2;
        const gap = engine.forwardDistanceToTram(tram, other);
        if (!parallel && gap !== null) closestUnpairedMeters = Math.min(closestUnpairedMeters, gap);
      }
    }
    assert.ok(sideBySide, "both platforms must be occupied at the same time");
    assert.ok(departedAlongside, "a tram must be able to leave while the other platform is occupied");
    assert.ok(secondStuckSteps < 20, `second tram waited behind the first for ${secondStuckSteps} steps`);
    assert.ok(closestUnpairedMeters >= 21.99, `trams came within ${closestUnpairedMeters} m outside the platforms`);
  } finally {
    resetCppRuntimeForTests();
  }
});

test("a tram held at an obstacle past the threshold is short-turned, and no unaffected tram is", async () => {
  resetCppRuntimeForTests();
  await initializeCppRuntimeFromBytes(
    await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url)),
  );
  try {
    const engine = new SimulationEngine("izmir-konak");
    engine.setServiceClockMinutes(8 * 60);
    engine.setRunning(true);
    const step = (seconds) => {
      for (let tick = 0; tick < seconds / 0.05; tick += 1) engine.stepFixed(0.05);
    };
    step(180);
    const victim = engine.trams.find((tram) =>
      tram.serviceState === "in-service" && tram.stationPhase === "none" && tram.speedMps > 5);
    assert.ok(victim, "a moving tram is needed");
    const segment = engine.segments.get(victim.segmentId);
    engine.obstacles.push({
      id: "BLOCK",
      segmentId: victim.segmentId,
      at: Math.min(0.999, victim.progress + 120 / segment.lengthMeters),
    });
    // Morning peak: 4.6 min headway, so the threshold is 2.5 x 276 s = 690 s.
    const thresholdSeconds = Math.max(600, 2.5 * 4.6 * 60);
    const maxHeld = new Map();
    const shortTurned = new Set();
    let seenEvent = engine.events[0]?.id ?? 0;
    for (let tick = 0; tick < 15 * 60 / 0.05; tick += 1) {
      engine.stepFixed(0.05);
      for (const tram of engine.trams) {
        maxHeld.set(tram.id, Math.max(maxHeld.get(tram.id) ?? 0, tram.heldSeconds));
      }
      for (const event of [...engine.events].reverse()) {
        if (event.id <= seenEvent) continue;
        const tram = engine.trams.find((item) => event.message.startsWith(`${item.label}: short turn`));
        if (tram) {
          assert.ok(maxHeld.get(tram.id) >= thresholdSeconds - 0.05,
            `${tram.id} was short-turned after only ${maxHeld.get(tram.id)?.toFixed(0)} s held`);
          shortTurned.add(tram.id);
        }
      }
      seenEvent = engine.events[0]?.id ?? seenEvent;
    }
    assert.ok(shortTurned.has(victim.id), "the stuck tram must be short-turned");
    assert.notEqual(victim.serviceState, "in-service");
  } finally {
    resetCppRuntimeForTests();
  }
});

test("Izmir detects an obstacle before entering its next track segment", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setFleetGroupCount("konak-to-faltay", 1);
  engine.setFleetGroupCount("konak-to-halkapinar", 0);
  engine.setAutoDispatch(false);
  const obstaclePoint = engine.getPointOnSegment("IZK-O02", 0.08)?.point;
  assert.ok(obstaclePoint && engine.addObstacleAt(obstaclePoint));
  advance(engine, 160);
  const tram = engine.getSnapshot().trams[0];
  assert.ok(tram.emergencyStops > 0, "tram never detected the obstacle");
  assert.equal(tram.speedKmh, 0);
  assert.match(tram.status, /Obstacle/);
});

test("every Izmir crossing stops road traffic for both tram approaches", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setAutoDispatch(false);
  engine.setSimulationRate(5);
  engine.setRunning(true);
  const protectedSignals = new Set();
  const stoppedRoadControllers = new Set();
  for (let index = 0; index < 8000; index += 1) {
    engine.step(0.05);
    for (const controller of engine.trafficControllers.values()) {
      if (controller.phase !== "road-green" && controller.activeSignalId) {
        protectedSignals.add(controller.activeSignalId);
      }
    }
    for (const vehicle of engine.roadVehicles) {
      if (vehicle.stopped) stoppedRoadControllers.add(vehicle.controllerId);
    }
  }
  assert.deepEqual(
    [...protectedSignals].sort(),
    engine.scenario.signals.map((signal) => signal.id).sort(),
  );
  assert.deepEqual(
    [...stoppedRoadControllers].sort(),
    [...new Set(engine.scenario.signals.map((signal) => signal.controllerId))].sort(),
  );
});

test("Izmir late service keeps running past midnight until 00:20", () => {
  const engine = new SimulationEngine("izmir-konak");
  const izmir = () => engine.getSnapshot().routeOperations.find((route) => route.routeId === "izmir-konak");

  engine.setServiceClockMinutes(23 * 60 + 50);
  assert.equal(engine.getSnapshot().serviceScheduleLabel, "Late service");
  engine.setServiceClockMinutes(10);
  assert.equal(engine.getSnapshot().serviceScheduleLabel, "Late service");
  assert.equal(izmir().plannedHeadwayMinutes, 15.3);
  engine.setServiceClockMinutes(20);
  assert.match(engine.getSnapshot().serviceScheduleLabel, /^Night storage/);
  assert.equal(izmir().plannedHeadwayMinutes, null);
});

test("an after-midnight departure stays on the late window's 21:00 timetable grid", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setServiceClockMinutes(10);
  const tram = engine.trams[0];
  assert.equal(engine.reserveScheduledDeparture(tram, "IZK-RI19", "Halkapinar", "terminal"), true);
  const headwaySeconds = 15.3 * 60;
  const sinceWindowStart = tram.scheduledDepartureClockSeconds + 86_400 - 21 * 3_600;
  const offGrid = sinceWindowStart / headwaySeconds - Math.round(sinceWindowStart / headwaySeconds);
  assert.ok(Math.abs(offGrid) < 1e-9, `slot is ${offGrid} headways off the grid`);
  assert.ok(tram.scheduledDepartureClockSeconds < 20 * 60 + headwaySeconds);
});
