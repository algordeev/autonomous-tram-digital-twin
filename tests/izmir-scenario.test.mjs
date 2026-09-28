import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SimulationEngine } from "../src/simulation-core/engine.ts";
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
