import assert from "node:assert/strict";
import test from "node:test";
import {
  SCENARIOS,
  SimulationEngine,
  initializeCppRuntimeFromBytes,
  resetCppRuntimeForTests,
  sampleTrackSegment,
} from "../src/simulation-core/index.ts";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url));

function advance(engine, simulatedSeconds) {
  engine.setSimulationRate(5);
  engine.setRunning(true);
  const iterations = Math.ceil(simulatedSeconds / 0.25);
  for (let index = 0; index < iterations; index += 1) {
    engine.step(0.05);
  }
}

test("the ported controller detects the default obstacle and stops safely", () => {
  const engine = new SimulationEngine("prototype-loop", 2);
  engine.setAutoDispatch(false);
  advance(engine, 35);

  const tram = engine.getSnapshot().trams.find((item) => item.id === "T02");
  assert.ok(tram);
  assert.equal(tram.statusTone, "danger");
  assert.match(tram.status, /Obstacle/);
  assert.ok(tram.speedKmh < 0.2);
});

test("RFID infrastructure requests the original four-phase signal cycle", () => {
  const engine = new SimulationEngine("prototype-loop", 1);
  engine.clearObstacles();
  engine.setAutoDispatch(false);
  advance(engine, 85);

  const messages = engine
    .getSnapshot()
    .events.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /requested priority at SG-01/);
  assert.match(messages, /SG-01 GREEN · minimum 10s/);
  assert.match(messages, /cleared SG-01/);
  assert.match(messages, /SG-01 released · tram signal RED/);
});

test("a red tram signal returns to green on the next approach", () => {
  const engine = new SimulationEngine("prototype-loop", 1);
  engine.clearObstacles();
  engine.setAutoDispatch(false);
  advance(engine, 230);

  const events = engine.getSnapshot().events.map((entry) => entry.message);
  const greenEvents = events.filter((message) =>
    message.includes("SG-01 GREEN · minimum 10s"),
  );
  assert.ok(greenEvents.length >= 2);
  assert.ok(events.some((message) => message.includes("SG-01 released")));
  assert.doesNotMatch(engine.getSnapshot().trams[0].status, /Signal SG-01 · STOP/);
});

test("a green signal releases the leading tram even when another tram requested it", () => {
  const engine = new SimulationEngine("city-interchange", 2);
  engine.clearObstacles();
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let greenSnapshot;
  for (let index = 0; index < 400; index += 1) {
    engine.step(0.05);
    const snapshot = engine.getSnapshot();
    if (
      snapshot.trafficPhase === "tram-green" &&
      snapshot.activeTrafficSignal === "SG-X" &&
      snapshot.activeTrafficTram === "T01"
    ) {
      greenSnapshot = snapshot;
      break;
    }
  }

  assert.ok(greenSnapshot);
  const leadingTram = greenSnapshot.trams.find((tram) => tram.id === "T02");
  assert.ok(leadingTram);
  assert.ok(
    leadingTram.segmentId !== "G4" || leadingTram.progress > 0.2,
    "the leading tram must advance through or beyond the protected segment",
  );
  assert.doesNotMatch(leadingTram.status, /Signal SG-X · STOP/);

  advance(engine, 8);
  const releasedTram = engine.getSnapshot().trams.find((tram) => tram.id === "T02");
  assert.ok(releasedTram);
  assert.ok(releasedTram.segmentId !== "G4" || releasedTram.progress > 0.9);
});

test("cooperative mode applies UID-based turnout intent for multiple trams", () => {
  const engine = new SimulationEngine("shared-corridor", 4);
  engine.setAutoDispatch(false);
  advance(engine, 90);

  const messages = engine
    .getSnapshot()
    .events.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /SW-X (?:locked|relocked) MAIN for/);
  assert.match(messages, /(?:SW-X (?:locked|relocked) BRANCH for|queued for SW-X)/);
});

test("a placed obstacle can be removed and the network resumes", () => {
  const engine = new SimulationEngine("city-interchange", 1);
  assert.equal(engine.getSnapshot().obstacles.length, 1);
  engine.clearObstacles();
  assert.equal(engine.getSnapshot().obstacles.length, 0);
  advance(engine, 12);
  assert.ok(engine.getSnapshot().trams[0].speedKmh > 0);
});

test("the physical rail-order lock remains active when predictive headway is off", () => {
  const engine = new SimulationEngine("prototype-loop", 4);
  engine.setCollisionAvoidance(false);
  engine.setAutoDispatch(false);
  advance(engine, 80);

  const snapshot = engine.getSnapshot();
  const queuedTrams = snapshot.trams.filter((tram) =>
    tram.status.startsWith("Rail order hold"),
  );
  assert.ok(queuedTrams.length >= 2);
  assert.ok(queuedTrams.every((tram) => tram.speedKmh < 0.2));
  assert.ok(
    snapshot.events.some((entry) =>
      entry.message.includes("physical no-passing lock behind"),
    ),
  );
});

test("the Nizhny Novgorod study scenario preserves 8.6 km and ten trams", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-route-2");
  assert.ok(scenario);
  const routeALength = scenario.segments
    .filter((segment) => segment.id.startsWith("N2A"))
    .reduce((total, segment) => total + (segment.lengthMeters ?? 0), 0);
  const routeBLength = scenario.segments
    .filter((segment) => segment.id.startsWith("N2B"))
    .reduce((total, segment) => total + (segment.lengthMeters ?? 0), 0);
  assert.ok(Math.abs(routeALength - 8_600) < 0.01);
  assert.ok(Math.abs(routeBLength - 8_600) < 0.01);
  assert.equal(scenario.studyBaseline?.directionalStops, 36);
  assert.equal(scenario.studyBaseline?.mappedStopLocations, 17);
  assert.equal(scenario.switches.length, 5);
  assert.deepEqual(
    scenario.switches.map((turnout) => turnout.id),
    ["SW-LYD", "SW-KRS", "SW-OSH", "SW-MAS", "SW-CHP"],
  );
  assert.ok(
    scenario.switches.every(
      (turnout) =>
        turnout.segmentId?.startsWith("N2A") &&
        typeof turnout.at === "number" &&
        turnout.at > 0 &&
        turnout.at < 1 &&
        turnout.alternateApproaches?.length === 1 &&
        turnout.alternateApproaches[0].segmentId.startsWith("N2B") &&
        turnout.alternateApproaches[0].at > 0 &&
        turnout.alternateApproaches[0].at < 1,
    ),
  );

  const engine = new SimulationEngine("nizhny-route-2");
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.trams.length, 10);
  assert.ok(snapshot.trams.some((tram) => tram.segmentId.startsWith("N2A")));
  assert.ok(snapshot.trams.some((tram) => tram.segmentId.startsWith("N2B")));
});

test("Route 2 energy profile reproduces the eight measured 2021 descents", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-routes-2-21");
  assert.ok(scenario);
  const clockwiseDrops = scenario.segments
    .filter((segment) => segment.id.startsWith("N2B") && (segment.elevationChangeMeters ?? 0) < 0)
    .map((segment) => -(segment.elevationChangeMeters ?? 0));
  assert.equal(clockwiseDrops.length, 8);
  assert.equal(clockwiseDrops.reduce((sum, value) => sum + value, 0), 102);
});

test("energy statistics separate generator output, accepted energy and losses", async () => {
  await initializeCppRuntimeFromBytes(wasmBytes);
  const engine = new SimulationEngine("nizhny-routes-2-21", 10);
  engine.setAutoDispatch(false);
  advance(engine, 180);
  const energy = engine.getSnapshot().energyStatistics;
  assert.equal(energy.studyPotentialKWhPerRun, 7.84);
  assert.equal(energy.routes.length, 2);
  assert.ok(energy.total.grossRegeneratedKWh > 0);
  assert.ok(energy.total.acceptedRegeneratedKWh > 0);
  assert.ok(energy.total.acceptedRegeneratedKWh <= energy.total.grossRegeneratedKWh + 1e-9);
  assert.ok(energy.total.rejectedKWh > 0);
  assert.equal(energy.powerSystem.enabled, true);
  assert.equal(energy.powerSystem.sections.length, 5);
  assert.ok(energy.powerSystem.localReuseKWh > 0);
  assert.ok(energy.powerSystem.gridSupplyKWh > 0);
  assert.ok(energy.powerSystem.peakGridPowerKw > 0);
  assert.ok(
    energy.powerSystem.sections.every(
      (section) => section.locallyReusedPowerKw <= section.regenerationPowerKw + 1e-9,
    ),
  );
});

test("real traction-power evidence is exposed without overstating Izmir locations", () => {
  const nizhny = SCENARIOS.find((item) => item.id === "nizhny-routes-2-21");
  const izmir = SCENARIOS.find((item) => item.id === "izmir-konak");
  assert.equal(nizhny?.tractionPowerSystem?.substations.length, 5);
  assert.ok(
    nizhny?.tractionPowerSystem?.substations.every(
      (substation) => substation.confidence === "verified-address",
    ),
  );
  assert.equal(izmir?.tractionPowerSystem?.substations.length, 8);
  assert.equal(izmir?.tractionPowerSystem?.sections.length, 6);
  assert.equal(
    izmir?.tractionPowerSystem?.substations.find((item) => item.id === "IZM-SS-BASMANE")?.confidence,
    "verified-address",
  );
  assert.ok(
    izmir?.tractionPowerSystem?.substations.some(
      (item) => item.confidence === "verified-count-estimated-location",
    ),
  );
});

test("energy-optimal dispatch reduces the measured network peak", async () => {
  await initializeCppRuntimeFromBytes(wasmBytes);
  const run = (strategy) => {
    const engine = new SimulationEngine("nizhny-routes-2-21", 10);
    engine.setAutoDispatch(false);
    engine.setEnergyStrategy(strategy);
    advance(engine, 60);
    return engine.getSnapshot().energyStatistics.powerSystem;
  };
  const baseline = run("baseline");
  const optimized = run("network-optimal");
  assert.equal(baseline.interventions, 0);
  assert.ok(optimized.interventions > 0);
  assert.ok(optimized.peakGridPowerKw < baseline.peakGridPowerKw);
  resetCppRuntimeForTests();
});

test("Route 2 direction labels match the geographic travel direction", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-route-2");
  assert.ok(scenario);
  const routeA = scenario.routes.find((route) => route.id === "2A");
  const routeB = scenario.routes.find((route) => route.id === "2B");
  assert.equal(routeA?.name, "counter-clockwise");
  assert.equal(routeA?.shortName, "2 ↺");
  assert.equal(routeB?.name, "clockwise");
  assert.equal(routeB?.shortName, "2 ↻");
});

test("Route 2 stays on cooperative control because legacy firmware has no multi-junction model", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  engine.setControlMode("firmware");
  assert.equal(engine.getSnapshot().options.controlMode, "cooperative");
  assert.ok(
    engine
      .getSnapshot()
      .events.some((entry) => entry.message.includes("unavailable on this multi-junction network")),
  );

  const prototype = new SimulationEngine("prototype-loop");
  prototype.setControlMode("firmware");
  assert.equal(prototype.getSnapshot().options.controlMode, "firmware");
});

test("junction queue policies choose FIFO, delay and fixed fleet rank", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  const controller = engine.trafficControllers.get("J-LYD");
  assert.ok(controller);
  const queue = () => [
    { tramId: "T03", signalId: "SG-LYD-A", requestedAt: 1 },
    { tramId: "T01", signalId: "SG-LYD-A", requestedAt: 3 },
    { tramId: "T02", signalId: "SG-LYD-B", requestedAt: 2 },
  ];

  controller.queue = queue();
  engine.setPriorityPolicy("fifo");
  engine.sortTrafficQueue(controller);
  assert.deepEqual(controller.queue.map((request) => request.tramId), ["T03", "T02", "T01"]);

  engine.trams.find((tram) => tram.id === "T02").delaySeconds = 50;
  controller.queue = queue();
  engine.setPriorityPolicy("schedule");
  engine.sortTrafficQueue(controller);
  assert.equal(controller.queue[0].tramId, "T02");

  controller.queue = queue();
  engine.setPriorityPolicy("fleet");
  engine.sortTrafficQueue(controller);
  assert.deepEqual(controller.queue.map((request) => request.tramId), ["T01", "T02", "T03"]);
});

test("Route 2 keeps both tracks visibly separate and turnout paths monotonic", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-route-2");
  assert.ok(scenario);

  const routeA = scenario.segments.filter((segment) =>
    segment.id.startsWith("N2A"),
  );
  const routeB = scenario.segments.filter((segment) =>
    segment.id.startsWith("N2B"),
  );
  assert.equal(routeA.length, routeB.length);
  assert.ok(routeB.every((segment) => segment.render !== false));

  for (let index = 0; index < routeA.length; index += 1) {
    const separation = Math.hypot(
      routeA[index].points[0].x - routeB[index].points[0].x,
      routeA[index].points[0].y - routeB[index].points[0].y,
    );
    assert.ok(separation >= 22, `${routeA[index].id} track gap is visible`);
  }

  assert.deepEqual(
    scenario.routes.find((route) => route.id === "2A")?.segmentIds,
    routeA.map((segment) => segment.id),
  );
  assert.deepEqual(
    scenario.routes.find((route) => route.id === "2B")?.segmentIds,
    routeB.map((segment) => segment.id),
  );

  for (const segment of [...routeA, ...routeB]) {
    const start = segment.points[0];
    const end = segment.points[segment.points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = dx * dx + dy * dy;
    let previousProgress = -Number.EPSILON;
    for (const point of segment.points) {
      const progress =
        ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        squaredLength;
      assert.ok(
        progress >= previousProgress - 0.000001,
        `${segment.id} must not double back`,
      );
      previousProgress = progress;
    }
  }

  for (const turnoutId of ["SW-KRS", "SW-MAS", "SW-CHP"]) {
    const turnout = scenario.switches.find((item) => item.id === turnoutId);
    assert.ok(turnout);
    assert.ok(turnout.at <= 0.72, `${turnoutId} is clear of its stop`);
  }
});

test("Route 2 actively restores its planned interval after an obstacle hold", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  const obstaclePoint = engine.getPointOnSegment("N2A01", 0.32)?.point;
  assert.ok(obstaclePoint);
  assert.equal(engine.addObstacleAt(obstaclePoint), true);
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let recovering;
  for (let index = 0; index < 2_400; index += 1) {
    engine.step(0.05);
    if (index % 10 !== 0) continue;
    recovering = engine
      .getSnapshot()
      .trams.find(
        (tram) =>
          tram.leaderTramId === "T01" &&
          tram.headwayAheadMeters !== null &&
          tram.headwayAheadMeters < tram.targetHeadwayMeters * 0.55,
      );
    if (recovering) break;
  }

  assert.ok(recovering);
  assert.ok(recovering.headwayAheadMeters !== null);
  assert.ok(
    recovering.headwayAheadMeters <
      recovering.targetHeadwayMeters * 0.92,
  );
  const followerId = recovering.id;
  const compressedGap = recovering.headwayAheadMeters;
  assert.ok(
    engine
      .getSnapshot()
      .events.some((entry) =>
        entry.message.includes("restoring planned interval"),
      ),
  );

  engine.clearObstacles();
  let restoredGap = compressedGap;
  for (let index = 0; index < 1_200; index += 1) {
    engine.step(0.05);
    if (index % 10 !== 0) continue;
    const follower = engine
      .getSnapshot()
      .trams.find((tram) => tram.id === followerId);
    restoredGap = follower?.headwayAheadMeters ?? restoredGap;
    if (restoredGap > compressedGap + 200) break;
  }
  assert.ok(
    restoredGap > compressedGap + 200,
    "the follower must let the delayed tram rebuild a real gap",
  );
});

test("every Route 2 stop exposes live arrivals for both directions", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  let snapshot = engine.getSnapshot();
  assert.equal(snapshot.stopBoards.length, 17);
  assert.equal(snapshot.selectedStopId, "STOP-01");
  assert.ok(
    snapshot.stopBoards.every(
      (board) =>
        board.directions.length === 2 &&
        board.directions.every(
          (direction) =>
            direction.arrivals.length === 3 &&
            direction.arrivals.every(
              (arrival) =>
                typeof arrival.etaSeconds === "number" &&
                arrival.distanceMeters >= 0,
            ),
        ),
    ),
  );

  engine.selectStop("STOP-11");
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.selectedStopId, "STOP-11");
  assert.equal(
    snapshot.stopBoards.find((board) => board.id === "STOP-11")?.label,
    "Чёрный Пруд",
  );

  const obstaclePoint = engine.getPointOnSegment("N2A01", 0.32)?.point;
  assert.ok(obstaclePoint);
  assert.equal(engine.addObstacleAt(obstaclePoint), true);
  snapshot = engine.getSnapshot();
  assert.ok(
    snapshot.stopBoards.some((board) =>
      board.directions.some((direction) =>
        direction.arrivals.some(
          (arrival) => arrival.status === "held" && arrival.etaSeconds === null,
        ),
      ),
    ),
  );
});

test("stop ETA counts down continuously and damps sudden speed changes", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  const firstSnapshot = engine.getSnapshot();
  const firstArrival = firstSnapshot.stopBoards[8].directions[0].arrivals[0];
  assert.equal(typeof firstArrival.etaSeconds, "number");

  engine.setSimulationRate(5);
  engine.setRunning(true);
  for (let index = 0; index < 4; index += 1) engine.step(0.1);

  const movingSnapshot = engine.getSnapshot();
  const movingArrival = movingSnapshot.stopBoards[8].directions[0].arrivals.find(
    (arrival) => arrival.tramId === firstArrival.tramId,
  );
  assert.ok(movingArrival);
  assert.ok(
    Math.abs(firstArrival.etaSeconds - movingArrival.etaSeconds - 2) < 0.05,
    "the cached prediction should still count down every simulation second",
  );

  engine.setSpeedLimit(10);
  const slowedSnapshot = engine.getSnapshot();
  const slowedArrival = slowedSnapshot.stopBoards[8].directions[0].arrivals.find(
    (arrival) => arrival.tramId === firstArrival.tramId,
  );
  assert.ok(slowedArrival);
  assert.ok(
    slowedArrival.etaSeconds - movingArrival.etaSeconds <= 18.01,
    "a sudden speed change should be absorbed gradually by the board prediction",
  );
});

test("Izmir stop boards group both directions and preserve physical arrival order", () => {
  const engine = new SimulationEngine("izmir-konak");
  const snapshot = engine.getSnapshot();
  const sadikbey = snapshot.stopBoards.find((board) => board.label === "Sadıkbey");
  assert.ok(sadikbey);
  assert.equal(sadikbey.directions.length, 2);

  const splitPair = snapshot.stopBoards.find(
    (board) => board.label === "Havagazı / Üniversite",
  );
  assert.ok(splitPair);
  assert.deepEqual(
    new Set(splitPair.directions.map((direction) => direction.platformLabel)),
    new Set(["Havagazı", "Üniversite"]),
  );

  const karatas = snapshot.stopBoards.find((board) => board.label === "Karataş");
  assert.ok(karatas);
  const fahrettinAltay = karatas.directions.find((direction) =>
    direction.shortName.includes("F.Altay"),
  );
  const halkapinar = karatas.directions.find((direction) =>
    direction.shortName.includes("Halkapınar"),
  );
  assert.ok(fahrettinAltay);
  assert.ok(halkapinar);
  assert.ok(fahrettinAltay.arrivals.length > 0);
  assert.ok(halkapinar.arrivals.length > 0);
  assert.ok(
    fahrettinAltay.arrivals.some((arrival) =>
      snapshot.trams.find((tram) => tram.id === arrival.tramId)?.segmentId.startsWith("IZK-O"),
    ),
  );
  assert.ok(
    halkapinar.arrivals.some((arrival) =>
      snapshot.trams.find((tram) => tram.id === arrival.tramId)?.segmentId.startsWith("IZK-I"),
    ),
  );
  for (const board of snapshot.stopBoards) {
    for (const direction of board.directions) {
      const targetPrefix = direction.shortName.includes("F.Altay") ? "IZK-O" : "IZK-I";
      for (const arrival of direction.arrivals) {
        const tram = snapshot.trams.find((item) => item.id === arrival.tramId);
        assert.ok(tram);
        assert.ok(
          arrival.distanceMeters <= (tram.segmentId.startsWith(targetPrefix) ? 12_800 : 23_550),
          `${board.label} ${direction.label} must use either a direct approach or one terminal turn`,
        );
      }
    }
  }

  for (const board of snapshot.stopBoards) {
    for (const direction of board.directions) {
      const timed = direction.arrivals.filter((arrival) => arrival.etaSeconds !== null);
      for (let index = 1; index < timed.length; index += 1) {
        assert.ok(
          timed[index].etaSeconds > timed[index - 1].etaSeconds,
          `${board.label} ${direction.label} must not predict a following tram first`,
        );
      }
    }
  }

  engine.setSimulationRate(20);
  engine.setRunning(true);
  for (let step = 0; step < 600; step += 1) {
    engine.step(0.1);
    if (step % 30 !== 0) continue;
    const liveSnapshot = engine.getSnapshot();
    for (const board of liveSnapshot.stopBoards) {
      for (const direction of board.directions) {
        const targetPrefix = direction.shortName.includes("F.Altay") ? "IZK-O" : "IZK-I";
        for (const arrival of direction.arrivals) {
          const tram = liveSnapshot.trams.find((item) => item.id === arrival.tramId);
          assert.ok(tram);
          assert.ok(
            arrival.distanceMeters <= (tram.segmentId.startsWith(targetPrefix) ? 12_800 : 23_550),
          );
        }
      }
    }
  }
});

test("Route 2 uses five independent real-junction signal controllers", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-route-2");
  assert.ok(scenario);
  const controllerIds = [
    ...new Set(scenario.signals.map((signal) => signal.controllerId)),
  ];
  assert.deepEqual(controllerIds, [
    "J-LYD",
    "J-OSH",
    "J-SEN",
    "J-BPE",
    "J-MAS",
  ]);
  assert.equal(scenario.signals.length, 10);
  for (const controllerId of controllerIds) {
    const approaches = scenario.signals.filter(
      (signal) => signal.controllerId === controllerId,
    );
    assert.equal(approaches.length, 2);
    assert.equal(
      approaches.filter((signal) => signal.render !== false).length,
      1,
    );
    assert.ok(approaches.every((signal) => signal.at >= 0.06 && signal.at <= 0.94));
  }
  assert.ok(
    scenario.readers
      .filter((reader) => reader.kind === "traffic")
      .every((reader) => reader.render === false),
  );
  assert.equal(
    scenario.readers.filter((reader) => reader.kind === "telemetry").length,
    0,
  );

  const engine = new SimulationEngine("nizhny-route-2", 1);
  assert.equal(engine.getSnapshot().trafficControllers.length, 5);
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let oneJunctionActivated = false;
  for (let index = 0; index < 4_000; index += 1) {
    engine.step(0.05);
    const active = engine
      .getSnapshot()
      .trafficControllers.filter((controller) => controller.phase !== "road-green");
    if (active.length > 0) {
      assert.equal(active.length, 1);
      oneJunctionActivated = true;
      break;
    }
  }
  assert.ok(oneJunctionActivated);
});

test("a real Route 2 turnout can divert a tram onto its mapped branch", () => {
  const engine = new SimulationEngine("nizhny-route-2", 1);
  engine.toggleSwitch("SW-OSH");
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let diverted = false;
  for (let index = 0; index < 2_400; index += 1) {
    engine.step(0.05);
    const snapshot = engine.getSnapshot();
    if (
      snapshot.events.some((entry) =>
        entry.message.includes("diverted at SW-OSH"),
      )
    ) {
      diverted = true;
      assert.ok(snapshot.trams[0].segmentId.startsWith("N2X-"));
      const turnout = snapshot.switches.find((item) => item.id === "SW-OSH");
      assert.equal(turnout?.state, "branch", "points must stay fixed while the rear is over the turnout");
      assert.equal(turnout?.lockedBy, snapshot.trams[0].id);
      assert.equal(engine.toggleSwitch("SW-OSH"), false);
      advance(engine, 30);
      const cleared = engine.getSnapshot().switches.find((item) => item.id === "SW-OSH");
      assert.equal(cleared?.lockedBy, null);
      assert.equal(cleared?.state, "main", "automatic reset is allowed after rear clearance");
      break;
    }
  }

  assert.ok(diverted);
});

test("manual recovery returns a tram from an external branch to Route 2", () => {
  const engine = new SimulationEngine("nizhny-route-2", 1);
  engine.toggleSwitch("SW-OSH");
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let reachedBranchEnd = false;
  for (let index = 0; index < 3_200; index += 1) {
    engine.step(0.05);
    const tram = engine.getSnapshot().trams[0];
    if (
      tram.segmentId === "N2X-OSH" &&
      tram.progress >= 0.999999 &&
      tram.canReverseToRoute
    ) {
      reachedBranchEnd = true;
      break;
    }
  }

  assert.ok(reachedBranchEnd);
  assert.equal(engine.setSelectedTramManual(true), true);
  assert.equal(engine.setSelectedTramCommand("reverse"), true);

  let returned = false;
  for (let index = 0; index < 1_600; index += 1) {
    engine.step(0.05);
    const tram = engine.getSnapshot().trams[0];
    if (!tram.canReverseToRoute && tram.segmentId === "N2A03") {
      assert.equal(tram.manualMode, true);
      assert.equal(tram.manualCommand, "stop");
      assert.match(tram.status, /Manual hold|Back on route/);
      returned = true;
      break;
    }
  }

  assert.ok(returned);
  const beforeForward = engine.getSnapshot().trams[0].progress;
  assert.equal(engine.setSelectedTramCommand("forward"), true);
  for (let index = 0; index < 80; index += 1) engine.step(0.05);
  const moving = engine.getSnapshot().trams[0];
  assert.equal(moving.manualMode, true);
  assert.ok(
    moving.segmentId !== "N2A03" || moving.progress > beforeForward,
    "manual forward should move the recovered tram along Route 2",
  );
});

test("the same Route 2 turnout complex also controls the opposite track", () => {
  const engine = new SimulationEngine("nizhny-route-2", 2);
  engine.toggleSwitch("SW-LYD");
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let diverted = false;
  for (let index = 0; index < 2_400; index += 1) {
    engine.step(0.05);
    const snapshot = engine.getSnapshot();
    const event = snapshot.events.find((entry) =>
      entry.message.includes("diverted at SW-LYD"),
    );
    if (event) {
      const divertedTram = snapshot.trams.find((tram) =>
        tram.segmentId.startsWith("N2X-"),
      );
      assert.equal(divertedTram?.id, "T02");
      diverted = true;
      break;
    }
  }

  assert.ok(diverted);
});

test("manual branch recovery restores the original opposite-direction track", () => {
  const engine = new SimulationEngine("nizhny-route-2", 2);
  engine.toggleSwitch("SW-LYD");
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let divertedTramId;
  for (let index = 0; index < 3_200; index += 1) {
    engine.step(0.05);
    const divertedTram = engine
      .getSnapshot()
      .trams.find(
        (tram) =>
          tram.segmentId === "N2X-LYD" &&
          tram.progress >= 0.999999 &&
          tram.canReverseToRoute,
      );
    if (divertedTram) {
      divertedTramId = divertedTram.id;
      break;
    }
  }

  assert.equal(divertedTramId, "T02");
  engine.selectTram(divertedTramId);
  assert.equal(engine.setSelectedTramCommand("reverse"), true);

  let returned = false;
  for (let index = 0; index < 1_600; index += 1) {
    engine.step(0.05);
    const tram = engine
      .getSnapshot()
      .trams.find((item) => item.id === divertedTramId);
    if (tram && !tram.canReverseToRoute) {
      assert.equal(tram.segmentId, "N2B01");
      assert.equal(tram.manualCommand, "stop");
      returned = true;
      break;
    }
  }

  assert.ok(returned);
});

test("Route 2 trams pass green signals and the controller returns them to red", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  engine.setSimulationRate(5);
  engine.setRunning(true);

  let sawGreen = false;
  let sawRelease = false;
  let activeTramPassedGreen = false;
  for (let index = 0; index < 3_200; index += 1) {
    engine.step(0.05);
    const snapshot = engine.getSnapshot();
    if (snapshot.trafficPhase === "tram-green") {
      sawGreen = true;
      const activeTram = snapshot.trams.find(
        (tram) => tram.id === snapshot.activeTrafficTram,
      );
      if (activeTram && !/Signal .* STOP/.test(activeTram.status)) {
        activeTramPassedGreen = true;
      }
    }
    if (
      sawGreen &&
      snapshot.events.some((entry) =>
        entry.message.includes("released · tram signal RED"),
      )
    ) {
      sawRelease = true;
      break;
    }
  }

  assert.ok(sawGreen);
  assert.ok(activeTramPassedGreen);
  assert.ok(sawRelease);
});

test("Route 2 trams preserve their rail order even without predictive headway", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  engine.setCollisionAvoidance(false);
  engine.setSimulationRate(5);
  engine.setRunning(true);

  const expectedCounterClockwiseOrder = ["T01", "T03", "T05", "T07", "T09"];
  const expectedClockwiseOrder = ["T10", "T08", "T06", "T04", "T02"];

  const isCyclicRotation = (actual, expected) => {
    if (actual.length !== expected.length) return false;
    return expected.some((_, offset) =>
      actual.every(
        (tramId, index) => tramId === expected[(index + offset) % expected.length],
      ),
    );
  };

  const directedPosition = (tram) => {
    const segmentNumber = Number(tram.segmentId.slice(-2));
    const base =
      tram.segmentId.startsWith("N2A")
        ? segmentNumber - 1
        : (18 - segmentNumber) % 17;
    return base + tram.progress;
  };

  for (let index = 0; index < 8_000; index += 1) {
    engine.step(0.05);
    if (index % 10 !== 0) continue;

    const trams = engine.getSnapshot().trams;
    const counterClockwiseOrder = trams
      .filter((tram) => tram.segmentId.startsWith("N2A"))
      .sort((first, second) => directedPosition(first) - directedPosition(second))
      .map((tram) => tram.id);
    const clockwiseOrder = trams
      .filter((tram) => tram.segmentId.startsWith("N2B"))
      .sort((first, second) => directedPosition(first) - directedPosition(second))
      .map((tram) => tram.id);

    assert.ok(
      isCyclicRotation(counterClockwiseOrder, expectedCounterClockwiseOrder),
      `counter-clockwise rail order changed at iteration ${index}: ${counterClockwiseOrder.join(", ")}`,
    );
    assert.ok(
      isCyclicRotation(clockwiseOrder, expectedClockwiseOrder),
      `clockwise rail order changed at iteration ${index}: ${clockwiseOrder.join(", ")}`,
    );
  }
});

test("the real Routes 2 + 21 scenario shares rails and closes both Route 21 terminals", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-routes-2-21");
  assert.ok(scenario);
  assert.deepEqual(
    scenario.routes.map((route) => route.id),
    ["2", "21"],
  );

  const route2 = scenario.routes[0];
  const route21 = scenario.routes[1];
  for (const sharedSegment of ["N2B17", "N2B12", "N2A11", "N2A16"]) {
    assert.ok(route2.segmentIds.includes(sharedSegment));
    assert.ok(route21.segmentIds.includes(sharedSegment));
  }

  const chyornyPrudLoop = scenario.segments.find(
    (segment) => segment.id === "N21-CHP-LOOP",
  );
  assert.equal(chyornyPrudLoop?.from, "B11");
  assert.equal(chyornyPrudLoop?.to, "A11");
  assert.ok(chyornyPrudLoop.points.length >= 5);
  assert.ok(chyornyPrudLoop.lengthMeters > 50);

  const parkLoop = scenario.segments.find(
    (segment) => segment.id === "N21-PARK-LOOP",
  );
  assert.equal(parkLoop?.from, "PARK-I");
  assert.equal(parkLoop?.to, "PARK-O");
  assert.ok(parkLoop.lengthMeters > 90);
  assert.match(scenario.mapContext.sourceLabel, /227555 \+ 240660/);

  const segmentById = new Map(
    scenario.segments.map((segment) => [segment.id, segment]),
  );
  for (const [beforeId, afterId] of [
    ["N2A15", "N2A16"],
    ["N2B17", "N2B16"],
  ]) {
    const before = segmentById.get(beforeId);
    const after = segmentById.get(afterId);
    const end = before.points.at(-1);
    const start = after.points[0];
    assert.ok(
      Math.hypot(end.x - start.x, end.y - start.y) < 0.01,
      `${beforeId} → ${afterId} must be visually continuous on Gorkogo`,
    );
  }

  const krasnoselskayaTriangle = [
    "KRS-N-E",
    "KRS-N-W",
    "KRS-E-N",
    "KRS-E-W",
    "KRS-W-N",
    "KRS-W-E",
  ];
  assert.ok(
    krasnoselskayaTriangle.every((segmentId) =>
      scenario.segments.some((segment) => segment.id === segmentId),
    ),
  );
  assert.equal(
    scenario.segments.find((segment) => segment.id === "N21I01")?.from,
    "KRS-W-OUT",
  );
  assert.equal(route21.segmentIds.indexOf("KRS-N-W") + 1, route21.segmentIds.indexOf("N21I01"));
  assert.equal(
    scenario.segments.find((segment) => segment.id === "N21O12")?.to,
    "KRS-W-IN",
  );
  assert.equal(route21.segmentIds.indexOf("N21O12") + 1, route21.segmentIds.indexOf("KRS-W-N"));
  assert.deepEqual(
    scenario.switches
      .filter((turnout) => turnout.label.startsWith("Красносельская"))
      .map((turnout) => turnout.nodeId)
      .sort(),
    ["A17", "KRS-E-IN", "KRS-W-IN"],
  );

  const chyornyPrudWidth =
    Math.max(...chyornyPrudLoop.points.map((point) => point.x)) -
    Math.min(...chyornyPrudLoop.points.map((point) => point.x));
  const chyornyPrudHeight =
    Math.max(...chyornyPrudLoop.points.map((point) => point.y)) -
    Math.min(...chyornyPrudLoop.points.map((point) => point.y));
  assert.ok(chyornyPrudWidth < 20 && chyornyPrudHeight < 20);

  const maximumTurn = (segment) => {
    let maximum = 0;
    for (let index = 1; index < segment.points.length - 1; index += 1) {
      const first = segment.points[index - 1];
      const middle = segment.points[index];
      const last = segment.points[index + 1];
      const incoming = { x: middle.x - first.x, y: middle.y - first.y };
      const outgoing = { x: last.x - middle.x, y: last.y - middle.y };
      const denominator = Math.max(
        0.001,
        Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y),
      );
      const cosine = Math.max(
        -1,
        Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator),
      );
      maximum = Math.max(maximum, (Math.acos(cosine) * 180) / Math.PI);
    }
    return maximum;
  };

  for (const segment of scenario.segments) {
    assert.ok(
      maximumTurn(segment) < 100,
      `${segment.id} contains a backtracking rail bend`,
    );
  }

  for (const turnout of scenario.switches) {
    const main = scenario.segments.find(
      (segment) => segment.id === turnout.mainSegmentId,
    );
    const branch = scenario.segments.find(
      (segment) => segment.id === turnout.branchSegmentId,
    );
    assert.ok(main);
    assert.ok(branch);
    assert.deepEqual(main.points[0], branch.points[0]);
    const mainAngle = Math.atan2(
      main.points.at(-1).y - main.points[0].y,
      main.points.at(-1).x - main.points[0].x,
    );
    const branchAngle = Math.atan2(
      branch.points.at(-1).y - branch.points[0].y,
      branch.points.at(-1).x - branch.points[0].x,
    );
    const rawDifference = Math.abs(mainAngle - branchAngle);
    const difference = Math.min(rawDifference, Math.PI * 2 - rawDifference);
    assert.ok(difference > (30 * Math.PI) / 180, `${turnout.id} branches overlap`);
  }
});

test("Route 21 makes a rapid turn at Chyorny Prud but retains dispatch control at Park Dubki", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const tram = engine.trams.find(
    (item) => engine.routeIdForTram(item) === "21",
  );
  const terminalReader = engine.scenario.readers.find(
    (reader) => reader.id === "R21O-chyorny-prud",
  );
  const parkDubkiReader = engine.scenario.readers.find(
    (reader) => reader.routeId === "21" && reader.stationId === "park-dubki" && reader.terminal,
  );
  assert.ok(tram);
  assert.ok(terminalReader?.terminal);
  assert.equal(terminalReader.rapidTurnback, true);
  assert.ok(parkDubkiReader);
  assert.equal(parkDubkiReader.rapidTurnback, undefined);
  assert.equal(engine.isDispatchControlledTerminal(terminalReader), false);
  assert.equal(engine.isDispatchControlledTerminal(parkDubkiReader), true);
  tram.segmentId = terminalReader.segmentId;
  tram.progress = Math.max(0, terminalReader.at - 0.01);
  tram.stationPhase = "none";
  tram.pendingStationReaderId = null;
  tram.triggeredOnSegment.clear();
  engine.triggerReaders(tram, tram.progress, terminalReader.at + 0.01);
  assert.equal(tram.pendingStationReaderId, terminalReader.id);
  assert.equal(tram.stationPhase, "crawl");
  assert.equal(tram.terminalIntervalHold, false);

  tram.stationPhase = "none";
  tram.pendingStationReaderId = null;
  engine.handleReader(tram, parkDubkiReader);
  assert.equal(tram.terminalIntervalHold, true);
});

test("terminal departures retain their timetable slots instead of dropping schedule control", () => {
  const engine = new SimulationEngine("izmir-konak");
  const tram = engine.trams[0];
  assert.ok(tram);

  engine.setServiceClockMinutes(22 * 60 + 10);
  assert.equal(
    engine.reserveScheduledDeparture(tram, "IZK-RO18", "Fahrettin Altay", "terminal"),
    true,
  );
  assert.equal(tram.scheduledDepartureClockSeconds, 22 * 3600 + 16 * 60 + 30);

  const followingTram = engine.trams[1];
  assert.ok(followingTram);
  assert.equal(
    engine.reserveScheduledDeparture(
      followingTram,
      "IZK-RO18",
      "Fahrettin Altay",
      "terminal",
    ),
    true,
    "the following tram must receive the next unique advertised trip",
  );
  assert.ok(
    followingTram.scheduledDepartureClockSeconds > tram.scheduledDepartureClockSeconds,
  );
});

test("a bunched terminal arrival waits for the actual time headway, not route distance", () => {
  const engine = new SimulationEngine("izmir-konak");
  const tram = engine.trams[0];
  const terminalReader = engine.scenario.readers.find(
    (reader) => reader.id === "IZK-RO18",
  );
  assert.ok(tram);
  assert.ok(terminalReader?.terminal);

  engine.setServiceClockMinutes(8 * 60);
  tram.stationPhase = "none";
  engine.handleReader(tram, terminalReader);
  assert.equal(tram.terminalIntervalHold, true);
  tram.stationPhase = "dwell";
  tram.stationUntil = 0;
  engine.simulationTime = 1_000;
  engine.lastTerminalDepartureAtByPoint.set(
    "morning-peak:izmir-konak:terminal:IZK-RO18",
    800,
  );

  const shortGap = engine.maintainTerminalIntervalHold(tram, 0);
  assert.ok(shortGap);
  assert.equal(tram.terminalIntervalHold, true);
  assert.equal(shortGap.elapsedSeconds, 200);
  assert.ok(tram.stationUntil > engine.simulationTime);

  engine.simulationTime = 1_300;
  const restoredGap = engine.maintainTerminalIntervalHold(tram, 0);
  assert.ok(restoredGap);
  assert.equal(tram.terminalIntervalHold, false);

  tram.pendingStationReaderId = terminalReader.id;
  engine.lastTerminalDepartureAtByPoint.clear();
  engine.terminalHeadwayStatsByRouteWindow.clear();
  engine.recordTerminalDeparture(tram);
  engine.simulationTime += 276;
  engine.recordTerminalDeparture(tram);
  const route = engine.getRouteOperationsSnapshot().find(
    (item) => item.routeId === "izmir-konak",
  );
  assert.equal(route.actualHeadwayMeasured, true);
  assert.ok(Math.abs(route.actualHeadwayMinutes - 4.6) < 0.01);
});

test("Izmir terminals admit a second tram to a parallel platform without approach crawling", () => {
  const engine = new SimulationEngine("izmir-konak");
  const [first, second, third] = engine.trams;
  const terminals = engine.scenario.readers.filter(
    (reader) => reader.terminal,
  );
  assert.equal(terminals.length, 2);

  for (const terminal of terminals) {
    for (const tram of [first, second, third]) {
      tram.stationPhase = "none";
      tram.pendingStationReaderId = null;
      tram.terminalBerth = 0;
      tram.terminalEntryQueueReaderId = null;
    }

    engine.handleReader(first, terminal);
    first.stationPhase = "dwell";
    assert.equal(first.terminalBerth, 1);

    second.segmentId = terminal.segmentId;
    second.progress = Math.max(0, terminal.at - 0.05);
    second.pendingStationReaderId = null;
    second.stationPhase = "none";
    assert.equal(
      engine.canUseParallelIzmirTerminalBerth(second, first),
      true,
      `${terminal.label} must expose its second platform to the approaching tram`,
    );
    assert.equal(
      engine.leaderOccupiesApproachingIzmirTerminal(second, first),
      true,
      "the terminal leader must be excluded from distance-based interval crawling",
    );

    engine.handleReader(second, terminal);
    second.stationPhase = "dwell";
    assert.equal(second.terminalBerth, 2);

    engine.handleReader(third, terminal);
    assert.equal(third.terminalBerth, 0, "a third tram must wait outside the full terminus");
    assert.equal(third.stationPhase, "none", "the queueing tram must not enter station approach");
    assert.equal(third.pendingStationReaderId, null, "the queueing tram must not occupy a platform");
    assert.equal(third.terminalEntryQueueReaderId, terminal.id);
    const thirdIndex = engine.trams.indexOf(third);
    assert.equal(
      engine.resolveIzmirTerminalEntryQueue(third, thirdIndex),
      true,
      "both occupied berths must keep the terminal gate closed",
    );

    first.stationPhase = "none";
    first.pendingStationReaderId = null;
    first.terminalBerth = 0;
    assert.equal(
      engine.resolveIzmirTerminalEntryQueue(third, thirdIndex),
      false,
      "freeing a berth must release the first waiting tram",
    );
    assert.equal(third.terminalEntryQueueReaderId, null);
    assert.equal(third.stationPhase, "crawl");
    assert.equal(third.pendingStationReaderId, terminal.id);
    assert.equal(third.terminalBerth, 1);
  }
});

test("Route 21 RFID readers command the correct real turnout independently", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21", 2);
  const scenario = engine.scenario;
  const route21Tram = engine.trams.find((tram) => tram.routeIntent === "branch");
  assert.ok(route21Tram);

  const krasnoselskayaReader = scenario.readers.find(
    (reader) => reader.id === "RF-SW-21-KRS",
  );
  const chyornyPrudReader = scenario.readers.find(
    (reader) => reader.id === "RF-SW-21-CHP",
  );
  const krasnoselskayaWestReader = scenario.readers.find(
    (reader) => reader.id === "RF-SW-KRS-WEST",
  );
  assert.equal(krasnoselskayaReader.switchId, "SW-21-KRS");
  assert.equal(krasnoselskayaWestReader.switchId, "SW-KRS-WEST");
  assert.equal(chyornyPrudReader.switchId, "SW-21-CHP");

  engine.handleReader(route21Tram, krasnoselskayaReader);
  assert.equal(engine.switchStates.get("SW-21-KRS").state, "branch");
  engine.handleReader(route21Tram, krasnoselskayaWestReader);
  assert.equal(engine.switchStates.get("SW-KRS-WEST").state, "branch");
  assert.equal(engine.switchStates.get("SW-21-CHP").state, "main");

  engine.handleReader(route21Tram, chyornyPrudReader);
  assert.equal(engine.switchStates.get("SW-21-CHP").state, "branch");
});

test("shared stops separate Route 2 and Route 21 live arrivals", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.stopBoards.length, 29);

  const board = snapshot.stopBoards.find(
    (item) => item.id === "STOP-krasnoselskaya",
  );
  assert.ok(board);
  assert.deepEqual(
    new Set(board.directions.map((direction) => direction.shortName)),
    new Set(["2 ↺", "2 ↻", "21 →", "21 ←"]),
  );

  for (const direction of board.directions) {
    const expectedIntent = direction.shortName.startsWith("21") ? "branch" : "main";
    for (const arrival of direction.arrivals) {
      const tram = snapshot.trams.find((item) => item.id === arrival.tramId);
      assert.equal(tram?.routeIntent, expectedIntent);
    }
  }
});

test("Chyorny Prud is signalled while Krasnoselskaya uses its rail conflict zone", () => {
  const scenario = SCENARIOS.find((item) => item.id === "nizhny-routes-2-21");
  assert.ok(scenario);
  const signals = scenario.signals.filter(
    (signal) => signal.controllerId === "J-CHP-MERGE",
  );
  assert.equal(signals.length, 2);
  assert.equal(new Set(signals.map((signal) => signal.segmentId)).size, 2);
  const signalPoints = signals.map((signal) => {
    const segment = scenario.segments.find(
      (item) => item.id === signal.segmentId,
    );
    assert.ok(segment);
    return sampleTrackSegment(segment, signal.at).point;
  });
  assert.ok(
    Math.hypot(
      signalPoints[0].x - signalPoints[1].x,
      signalPoints[0].y - signalPoints[1].y,
    ) < 1.5,
    "both Chyorny Prud signal heads must mark the same crossing",
  );
  const chyornyPrudTurnout = scenario.switches.find(
    (turnout) => turnout.id === "SW-21-CHP",
  );
  assert.equal(chyornyPrudTurnout?.showArmLabels, false);
  assert.ok((chyornyPrudTurnout?.displayArmLengthPx ?? 100) <= 46);
  assert.equal(
    scenario.readers.find((reader) => reader.id === "R2A-chyorny-prud")
      ?.labelDistancePx,
    72,
  );
  assert.equal(
    scenario.signals.some(
      (signal) => signal.controllerId === "J-KRS-MERGE",
    ),
    false,
    "the complex Krasnoselskaya road layout must not be represented as one invented crossing",
  );
  assert.ok(
    scenario.junctionConflictZones.some(
      (zone) =>
        zone.id === "KRS-TRIANGLE" && zone.segmentIds.includes("KRS-E-N"),
    ),
  );

  const engine = new SimulationEngine("nizhny-routes-2-21");
  assert.equal(engine.getSnapshot().trafficControllers.length, 4);
  engine.setSimulationRate(5);
  engine.setRunning(true);
  for (let index = 0; index < 1_500; index += 1) engine.step(0.05);

  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.trams.every((tram) => tram.status !== "Route unavailable"));
  assert.ok(
    snapshot.trams.every(
      (tram) =>
        tram.headwayAheadMeters === null ||
        tram.headwayAheadMeters >= 7 - 0.01,
    ),
  );
});

test("the short Chyorny Prud connector requests green before entering the stop envelope", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21", 10);
  const scenario = engine.scenario;
  const connector = scenario.segments.find(
    (segment) => segment.id === "N21-CHP-LOOP",
  );
  const detector = scenario.readers.find(
    (reader) => reader.id === "DET-CHP-R21",
  );
  const signal = scenario.signals.find(
    (item) => item.id === "SG-CHP-R21",
  );
  assert.ok(connector);
  assert.ok(detector);
  assert.ok(signal);
  assert.ok(
    detector.at < signal.at - 32 / connector.lengthMeters,
    "the request detector must be reached before red-signal braking begins",
  );

  const route21Tram = engine.trams.find(
    (tram) => tram.routeIntent === "branch",
  );
  assert.ok(route21Tram);
  engine.trams = [route21Tram];
  route21Tram.segmentId = connector.id;
  route21Tram.progress = 0;
  route21Tram.speedMps = 0;
  route21Tram.triggeredOnSegment.clear();
  advance(engine, 35);

  const messages = engine.getSnapshot().events.map((entry) => entry.message);
  assert.ok(messages.some((message) => message.includes("requested priority at SG-CHP-R21")));
  assert.ok(messages.some((message) => message.includes("SG-CHP-R21 GREEN")));
  assert.ok(messages.some((message) => message.includes("cleared SG-CHP-R21")));
  assert.doesNotMatch(engine.getSnapshot().trams[0].status, /SG-CHP-R21 · STOP/);
});

test("planned headway is route-specific while physical safety still spans shared rails", () => {
  const configurePair = (gapMeters, sameRoute) => {
    const engine = new SimulationEngine("nizhny-routes-2-21", 2);
    const segment = engine.segments.get("N2B13");
    assert.ok(segment);
    const follower = engine.trams[0];
    const leader = engine.trams[1];
    follower.segmentId = segment.id;
    follower.progress = 0.2;
    follower.routeIntent = "main";
    follower.fleetGroupId = "route-2-counterclockwise";
    follower.desiredHeadwayMeters = 500;
    follower.stationPhase = "none";
    follower.releaseTime = 0;
    leader.segmentId = segment.id;
    leader.progress = follower.progress + gapMeters / segment.lengthMeters;
    leader.routeIntent = sameRoute ? "main" : "branch";
    leader.fleetGroupId = sameRoute
      ? "route-2-clockwise"
      : "route-21-to-chyorny-prud";
    leader.stationPhase = "none";
    leader.releaseTime = 0;
    engine.setRunning(true);
    engine.step(0.05);
    return engine.getSnapshot().trams.find((tram) => tram.id === follower.id);
  };

  const independentRouteFollower = configurePair(80, false);
  assert.ok(independentRouteFollower);
  assert.doesNotMatch(independentRouteFollower.status, /Interval recovery/);
  assert.equal(independentRouteFollower.leaderTramId, null);

  const sameRouteFollower = configurePair(80, true);
  assert.ok(sameRouteFollower);
  assert.match(sameRouteFollower.status, /Interval recovery/);

  const sharedRailSafetyFollower = configurePair(15, false);
  assert.ok(sharedRailSafetyFollower);
  assert.match(sharedRailSafetyFollower.status, /Headway hold/);
});

test("Route 21 restores spacing across both terminal direction labels", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const route21Trams = engine.trams.filter(
    (tram) => engine.routeIdForTram(tram) === "21",
  );
  assert.equal(route21Trams.length, 5);
  const cycleDistance = engine.routeCycleDistanceMeters(route21Trams[0]);
  assert.ok(cycleDistance);
  const uniformTarget = cycleDistance / route21Trams.length;
  for (const tram of route21Trams) {
    assert.ok(
      Math.abs(tram.desiredHeadwayMeters - uniformTarget) < 1,
      `${tram.label} must use the full Route 21 round-trip spacing target`,
    );
  }

  const follower = route21Trams.find(
    (tram) => tram.fleetGroupId === "route-21-to-park-dubki",
  );
  const leader = route21Trams.find(
    (tram) => tram.fleetGroupId === "route-21-to-chyorny-prud",
  );
  const segment = engine.segments.get("N21O04");
  assert.ok(follower);
  assert.ok(leader);
  assert.ok(segment);
  follower.segmentId = segment.id;
  follower.progress = 0.2;
  follower.stationPhase = "none";
  follower.releaseTime = 0;
  leader.segmentId = segment.id;
  leader.progress = 0.2 + 120 / segment.lengthMeters;
  leader.stationPhase = "none";
  leader.releaseTime = 0;
  engine.trams = [follower, leader];
  engine.setRunning(true);
  engine.step(0.05);
  const snapshot = engine.getSnapshot().trams.find(
    (tram) => tram.id === follower.id,
  );
  assert.ok(snapshot);
  assert.match(snapshot.status, /Interval recovery/);
  assert.equal(snapshot.leaderTramId, leader.id);
});

test("the Nizhny mixed network exposes four independent route-direction fleets", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  let snapshot = engine.getSnapshot();

  assert.deepEqual(
    snapshot.fleetGroups.map((group) => [group.id, group.count]),
    [
      ["route-2-counterclockwise", 3],
      ["route-2-clockwise", 2],
      ["route-21-to-chyorny-prud", 3],
      ["route-21-to-park-dubki", 2],
    ],
  );
  assert.equal(snapshot.trams.length, 10);
  assert.equal(snapshot.fleetCapacity, 20);

  assert.equal(engine.setFleetGroupCount("route-2-clockwise", 4), true);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.trams.length, 12);
  assert.equal(
    snapshot.trams.filter((tram) => tram.fleetGroupId === "route-2-clockwise").length,
    4,
  );
  assert.ok(
    snapshot.trams
      .filter((tram) => tram.fleetGroupId === "route-2-clockwise")
      .every((tram) => tram.segmentId.startsWith("N2B")),
  );
});

test("direction fleet controls allow zero in one direction but never an empty network", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  for (const group of engine.getSnapshot().fleetGroups) {
    if (group.id === "route-21-to-park-dubki") continue;
    assert.equal(engine.setFleetGroupCount(group.id, 0), true);
  }
  assert.equal(engine.getSnapshot().trams.length, 2);
  assert.equal(engine.setFleetGroupCount("route-21-to-park-dubki", 1), true);
  assert.equal(engine.setFleetGroupCount("route-21-to-park-dubki", 0), false);
  assert.equal(engine.getSnapshot().trams.length, 1);
});

test("road cars queue during tram priority and resume on the road phase", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const controller = engine.trafficControllers.values().next().value;
  assert.ok(controller);
  const car = engine.roadVehicles.find(
    (vehicle) =>
      vehicle.controllerId === controller.id &&
      vehicle.direction === 1 &&
      vehicle.progress < 0.2,
  );
  assert.ok(car);

  controller.phase = "tram-green";
  controller.phaseUntil = 999_999;
  engine.setSimulationRate(5);
  engine.setRunning(true);
  for (let index = 0; index < 60; index += 1) engine.step(0.05);
  assert.ok(Math.abs(car.progress - 0.39) < 0.003);
  assert.equal(car.stopped, true);

  controller.phase = "road-green";
  for (let index = 0; index < 8; index += 1) engine.step(0.05);
  assert.ok(car.progress > 0.39);
  assert.equal(car.stopped, false);
  assert.ok(car.speed <= 0.0281, "road traffic should remain visually slower");
});

test("every road crossing is signal-controlled in both car directions", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const scenario = engine.scenario;
  engine.simulationTime = 10;
  assert.equal(
    scenario.signals.find((signal) => signal.id === "SG-OSH-A")?.segmentId,
    "N2A03",
  );
  assert.equal(
    scenario.signals.find((signal) => signal.id === "SG-OSH-B")?.segmentId,
    "N2B04",
  );
  assert.equal(
    scenario.signals.find((signal) => signal.id === "SG-SEN-B")?.segmentId,
    "N2B08",
  );
  assert.equal(
    scenario.signals.find((signal) => signal.id === "SG-MAS-B")?.segmentId,
    "N2B16",
  );
  const oshPoints = ["SG-OSH-A", "SG-OSH-B"].map((id) => {
    const signal = scenario.signals.find((item) => item.id === id);
    assert.ok(signal);
    const segment = scenario.segments.find(
      (item) => item.id === signal.segmentId,
    );
    assert.ok(segment);
    return sampleTrackSegment(segment, signal.at).point;
  });
  assert.ok(
    Math.hypot(
      oshPoints[0].x - oshPoints[1].x,
      oshPoints[0].y - oshPoints[1].y,
    ) < 1,
    "both Osharskaya signal heads must sit at the same road crossing",
  );

  for (const controller of engine.trafficControllers.values()) {
    const approaches = scenario.signals.filter(
      (signal) => (signal.controllerId ?? signal.id) === controller.id,
    );
    assert.equal(
      approaches.length,
      2,
      `${controller.id} needs both tram approaches`,
    );
    assert.ok(
      approaches.every((signal) => signal.render !== false),
      `${controller.id} must show both tram signal heads on the map`,
    );
    for (const signal of approaches) {
      const segment = scenario.segments.find(
        (item) => item.id === signal.segmentId,
      );
      assert.ok(segment);
      assert.ok(
        typeof signal.clearAt === "number" &&
          (signal.clearAt - signal.at) * segment.lengthMeters >= 20,
        `${signal.id} must hold tram green until at least 20 m beyond the crossing`,
      );
    }

    for (const approach of approaches) {
      const reader = scenario.readers.find(
        (item) => item.kind === "traffic" && item.signalId === approach.id,
      );
      assert.ok(reader, `${approach.id} needs an approach detector`);
      controller.queue = [];
      controller.activeTramId = null;
      controller.activeSignalId = null;
      controller.phase = "road-green";
      engine.handleReader(engine.trams[0], reader);
      assert.ok(
        controller.queue.some((request) => request.signalId === approach.id),
        `${approach.id} must close the road from its own direction`,
      );

      const cars = engine.roadVehicles.filter(
        (vehicle) => vehicle.controllerId === controller.id,
      );
      cars.forEach((vehicle) => {
        vehicle.progress = vehicle.direction > 0 ? 0.38 : 0.62;
      });
      controller.phase = "tram-green";
      controller.activeTramId = engine.trams[0].id;
      controller.activeSignalId = approach.id;
      controller.activeTramEntered = false;
      controller.activeTramCleared = false;
      controller.phaseUntil = engine.simulationTime - 1;
      engine.trams[0].segmentId = approach.segmentId;
      engine.markSignalPassage(
        engine.trams[0],
        approach.at - 0.01,
        approach.at + 0.01,
      );
      assert.equal(controller.activeTramEntered, true);
      assert.equal(
        controller.activeTramCleared,
        false,
        `${approach.id} must stay green while the tram is on the crossing`,
      );
      engine.updateTraffic();
      assert.equal(
        controller.phase,
        "tram-green",
        `${approach.id} must not turn red at its stop line`,
      );
      engine.updateRoadVehicles(1);
      assert.ok(
        cars.some(
          (vehicle) =>
            vehicle.direction === 1 &&
            Math.abs(vehicle.progress - 0.39) < 0.002,
        ),
      );
      assert.ok(
        cars.some(
          (vehicle) =>
            vehicle.direction === -1 &&
            Math.abs(vehicle.progress - 0.61) < 0.002,
          ),
      );

      const approachSegment = scenario.segments.find(
        (item) => item.id === approach.segmentId,
      );
      assert.ok(approachSegment);
      const clearAt =
        approach.clearAt + 15 / approachSegment.lengthMeters;
      assert.ok(clearAt > approach.at);
      if (clearAt <= 1) {
        engine.markSignalPassage(
          engine.trams[0],
          clearAt - 0.01,
          clearAt + 0.01,
        );
      } else {
        // For a crossing at the end of a segment, clearance is completed only
        // after the whole tram has entered the following segment.
        engine.trams[0].segmentId = scenario.segments.find(
          (item) => item.id !== approach.segmentId,
        ).id;
        engine.updateTraffic();
        assert.equal(controller.activeTramCleared, false, "the front leaving a segment does not clear its rear");
        engine.trams[0].distanceMeters = controller.rearClearDistance + .01;
        engine.updateTraffic();
      }
      assert.equal(controller.activeTramCleared, true);
      controller.phaseUntil = engine.simulationTime - 1;
      engine.updateTraffic();
      assert.equal(controller.phase, "amber-to-road");
    }
  }
});

test("Maslyakova platforms are before both signal stop lines", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const scenario = engine.scenario;
  for (const signalId of ["SG-MAS-A", "SG-MAS-B"]) {
    const signal = scenario.signals.find((item) => item.id === signalId);
    assert.ok(signal, `${signalId} must exist`);
    const platformReader = scenario.readers.find(
      (reader) =>
        reader.kind === "station" &&
        reader.stationId === "maslyakova" &&
        reader.segmentId === signal.segmentId,
    );
    assert.ok(platformReader, `${signalId} needs its direction's platform`);
    assert.ok(
      platformReader.at < signal.at,
      `${signalId}: platform must come before the stop line in travel order`,
    );
    assert.ok(
      signal.at - platformReader.at >= 0.2,
      `${signalId}: platform must not overlap the crossing clearance zone`,
    );
  }
});

test("Krasnoselskaya admits only one tram into the turnout triangle", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const inside = engine.trams[0];
  const approaching = engine.trams.find(
    (tram) => tram.fleetGroupId === "route-21-to-chyorny-prud",
  );
  assert.ok(approaching);

  inside.segmentId = "KRS-E-N";
  inside.progress = 0.25;
  inside.speedMps = 0;
  approaching.segmentId = "N21O12";
  approaching.progress = 0.95;
  approaching.speedMps = 0;

  const block = engine.findBlockingCondition(approaching, null);
  assert.equal(block?.kind, "junction");
  assert.match(block?.status ?? "", /Красносельская/);
});

test("manual forward bypasses interval recovery but preserves the physical rail gap", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const follower = engine.trams[0];
  const leader = engine.trams[1];
  engine.trams = [follower, leader];
  follower.segmentId = "N2B01";
  follower.progress = 0.81;
  follower.speedMps = 0;
  follower.stationPhase = "none";
  leader.segmentId = "N2B01";
  leader.progress = 0.85;
  leader.speedMps = 0;
  leader.manualMode = true;
  leader.manualCommand = "stop";
  leader.stationPhase = "none";

  engine.selectTram(follower.id);
  assert.equal(engine.setSelectedTramManual(true), true);
  assert.equal(engine.setSelectedTramCommand("forward"), true);
  const before = follower.progress;
  engine.setRunning(true);
  for (let index = 0; index < 80; index += 1) engine.step(0.05);
  assert.ok(follower.progress > before, "manual forward should leave a 30m regulation hold");
  const gapMeters =
    (leader.progress - follower.progress) * engine.segments.get("N2B01").lengthMeters;
  assert.ok(gapMeters >= 6.9, "manual forward must retain the physical no-passing gap");
});

test("a stale signal grant is released and requeued instead of freezing a junction", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const controller = engine.trafficControllers.get("J-CHP-MERGE");
  const tram = engine.trams.find(
    (item) => item.fleetGroupId === "route-21-to-chyorny-prud",
  );
  assert.ok(controller);
  assert.ok(tram);
  tram.speedMps = 0;
  tram.manualMode = true;
  tram.manualCommand = "stop";
  controller.phase = "tram-green";
  controller.phaseUntil = 1;
  controller.activeTramId = tram.id;
  controller.activeSignalId = "SG-CHP-R21";
  controller.activeTramCleared = false;
  controller.activeTramEntered = false;
  controller.activeGrantedAt = 0;
  engine.simulationTime = 30;

  engine.updateTraffic();
  assert.equal(controller.phase, "amber-to-road");
  assert.ok(controller.queue.some((request) => request.tramId === tram.id));
});

test("manual signal control exposes tram, road and safe automatic modes", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  assert.equal(engine.setTrafficSignalMode("SG-OSH-A", "tram-green"), true);
  let controller = engine
    .getSnapshot()
    .trafficControllers.find((item) => item.id === "J-OSH");
  assert.equal(controller?.phase, "tram-green");
  assert.equal(controller?.manualMode, "tram-green");
  assert.equal(controller?.manualSignalId, "SG-OSH-A");

  const runtime = engine.trafficControllers.get("J-OSH");
  runtime.activeTramId = engine.trams[0].id;
  runtime.activeTramEntered = true;
  runtime.activeTramCleared = false;
  assert.equal(engine.setTrafficSignalMode("SG-OSH-A", "road-green"), true);
  engine.updateTraffic();
  assert.equal(runtime.phase, "tram-green", "road release must wait for the rear");
  assert.equal(runtime.manualReleasePending, true);

  runtime.activeTramCleared = true;
  engine.updateTraffic();
  assert.equal(runtime.phase, "amber-to-road");
  engine.simulationTime += runtime.clearanceSeconds;
  engine.updateTraffic();
  assert.equal(runtime.phase, "road-green");
  assert.equal(runtime.manualMode, "road-green");
  assert.equal(engine.setTrafficSignalMode("SG-OSH-A", "auto"), true);
  controller = engine
    .getSnapshot()
    .trafficControllers.find((item) => item.id === "J-OSH");
  assert.equal(controller?.manualMode, "auto");
});

test("a tram delayed by a leader keeps its green grant before entering", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const controller = engine.trafficControllers.get("J-OSH");
  const signal = engine.scenario.signals.find((item) => item.id === "SG-OSH-A");
  const tram = engine.trams[0];
  assert.ok(controller);
  assert.ok(signal);

  tram.segmentId = signal.segmentId;
  tram.progress = signal.at - 0.02;
  tram.speedMps = 0;
  tram.manualMode = false;
  controller.phase = "tram-green";
  controller.phaseUntil = 1;
  controller.activeTramId = tram.id;
  controller.activeSignalId = signal.id;
  controller.activeTramEntered = false;
  controller.activeTramCleared = false;
  controller.activeGrantedAt = 0;
  engine.simulationTime = 60;

  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  assert.equal(controller.activeTramId, tram.id);
  assert.equal(controller.activeTramCleared, false);
});

test("tram green remains held until the rear of a slowed tram clears the crossing", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const controller = engine.trafficControllers.get("J-OSH");
  const signal = engine.scenario.signals.find((item) => item.id === "SG-OSH-A");
  const tram = engine.trams[0];
  assert.ok(controller);
  assert.ok(signal);
  const segment = engine.segments.get(signal.segmentId);
  assert.ok(segment);
  const frontClearAt = signal.clearAt;
  const rearClearAt = frontClearAt + 15 / segment.lengthMeters;

  tram.segmentId = signal.segmentId;
  tram.progress = frontClearAt + (rearClearAt - frontClearAt) * 0.5;
  tram.speedMps = 0;
  controller.phase = "tram-green";
  controller.phaseUntil = 1;
  controller.activeTramId = tram.id;
  controller.activeSignalId = signal.id;
  controller.activeTramEntered = true;
  controller.activeTramCleared = false;
  controller.activeGrantedAt = 0;
  controller.activeEnteredAt = 55;
  engine.simulationTime = 60;

  engine.updateTraffic();
  assert.equal(controller.phase, "tram-green");
  assert.equal(controller.activeTramCleared, false);

  tram.progress = Math.min(0.999999, rearClearAt + 0.001);
  engine.updateTraffic();
  assert.equal(controller.activeTramCleared, true);
  controller.phaseUntil = engine.simulationTime - 1;
  engine.updateTraffic();
  assert.equal(controller.phase, "amber-to-road");
});

test("Actual avg remains available with one passenger tram in a direction", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const route21 = engine.trams.filter(
    (tram) => engine.routeIdForTram(tram) === "21",
  );
  route21.slice(1).forEach((tram) => {
    tram.serviceState = "in-depot";
  });
  const operation = engine
    .getSnapshot()
    .routeOperations.find((route) => route.routeId === "21");
  assert.equal(operation?.onRoute, 1);
  assert.ok(operation?.actualHeadwayMinutes !== null);
  assert.ok(operation.actualHeadwayMinutes > 0);
});

test("Routes 2 and 21 complete stop approach, align at platforms and board passengers", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21", 6);
  engine.setAutoDispatch(false);
  engine.setSimulationRate(5);
  engine.setRunning(true);
  let sawDoorsOpen = false;
  let sawCurveProfile = false;
  let sawTurnoutProfile = false;
  for (let index = 0; index < 5000; index += 1) {
    engine.step(0.05);
    if (engine.trams.some((tram) => tram.stationPhase === "dwell")) {
      sawDoorsOpen = true;
    }
    sawCurveProfile ||= engine.trams.some((tram) => tram.profileReason === "curve");
    sawTurnoutProfile ||= engine.trams.some((tram) => tram.profileReason === "turnout");
  }
  const snapshot = engine.getSnapshot();
  assert.ok(sawDoorsOpen, "no tram ever completed its stop approach");
  assert.ok(sawCurveProfile, "no tram used a geometry-derived curve profile");
  assert.ok(sawTurnoutProfile, "no tram used a turnout speed profile");
  assert.ok(snapshot.trams.every((tram) => tram.onboardPassengers > 0));
  assert.ok(snapshot.trams.every((tram) => tram.vehicleMassTonnes > 27.5));
  assert.ok(snapshot.trams.every((tram) =>
    Math.abs(tram.vehicleMassTonnes - (27.5 + tram.onboardPassengers * 0.075)) < 1e-9,
  ));
  assert.ok(snapshot.trams.some((tram) => !tram.status.startsWith("Stop approach")));
});

test("the mixed network has real depot assignments and a daily fleet plan", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  let snapshot = engine.getSnapshot();
  assert.deepEqual(
    snapshot.depots.map((depot) => depot.id),
    ["DEPOT-1", "DEPOT-2", "TURNBACK-1", "TURNBACK-2"],
  );
  assert.equal(snapshot.serviceScheduleLabel, "Morning peak");
  assert.deepEqual(
    snapshot.routeOperations.map((route) => [route.routeId, route.onRoute]),
    [["2", 5], ["21", 5]],
  );

  engine.setServiceClockMinutes(720);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.serviceScheduleLabel, "Daytime off-peak");
  assert.deepEqual(
    snapshot.routeOperations.map((route) => [route.routeId, route.onRoute, route.toDepot]),
    [["2", 4, 1], ["21", 4, 1]],
  );

  engine.setSimulationRate(5);
  engine.setRunning(true);
  for (let index = 0; index < 85; index += 1) engine.step(0.05);
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.routeOperations.find((route) => route.routeId === "21")?.onRoute, 3);
});

test("a selected tram can complete a non-passenger depot run and return to service", () => {
  const engine = new SimulationEngine("nizhny-routes-2-21");
  const tram = engine.trams.find(
    (item) => item.fleetGroupId === "route-2-counterclockwise",
  );
  assert.ok(tram);
  engine.selectTram(tram.id);
  assert.equal(engine.toggleSelectedTramDepot(), true);
  assert.equal(tram.serviceState, "to-depot");
  assert.equal(tram.lastPassengerStop, "Полтавская");
  assert.ok(
    engine
      .getSnapshot()
      .stopBoards.flatMap((board) => board.directions)
      .flatMap((direction) => direction.arrivals)
      .some(
        (arrival) =>
          arrival.tramId === tram.id && arrival.statusLabel.includes("DEPOT"),
      ),
  );

  tram.segmentId = "N2A05";
  tram.progress = 0.449;
  tram.speedMps = 8;
  engine.setRunning(true);
  engine.advanceTram(tram, 5);
  assert.equal(tram.serviceState, "depot-ingress");
  for (let index = 0; index < 500; index += 1) engine.step(0.05);
  assert.equal(tram.serviceState, "in-depot");

  assert.equal(engine.toggleSelectedTramDepot(), true);
  assert.equal(tram.serviceState, "depot-egress");
  for (let index = 0; index < 500; index += 1) engine.step(0.05);
  assert.equal(tram.serviceState, "in-service");
  assert.equal(tram.depotId, null);
});


test("diagram timetable lateness excludes planned terminal waits and follows each departure", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setAutoDispatch(false);
  engine.setServiceClockMinutes(8 * 60);
  const tram = engine.trams[0];
  const snapshotTram = () => engine.getSnapshot().trams.find((item) => item.id === tram.id);
  tram.delaySeconds = 900; // Existing distance heuristic must not leak into the diagram.
  assert.equal(snapshotTram().timetableDelaySeconds, null);

  assert.equal(engine.reserveScheduledDeparture(tram, "IZK-RO18", "Fahrettin Altay", "terminal"), true);
  const slot = tram.scheduledDepartureAt;
  engine.simulationTime = slot - 120;
  assert.equal(snapshotTram().timetableDelaySeconds, 0);
  engine.simulationTime = slot;
  engine.recordScheduledDeparture(tram);
  assert.equal(snapshotTram().lastDepartureDeviationSeconds, 0);
  engine.simulationTime += 300;
  assert.equal(snapshotTram().timetableDelaySeconds, 0);

  assert.equal(engine.reserveScheduledDeparture(tram, "IZK-RI19", "Halkapinar", "terminal"), true);
  engine.simulationTime = tram.scheduledDepartureAt + 90;
  assert.equal(snapshotTram().timetableDelaySeconds, 90);
  engine.recordScheduledDeparture(tram);
  engine.simulationTime += 300;
  assert.equal(snapshotTram().timetableDelaySeconds, 90);

  // Reach the next timetable grid point for a genuinely on-time new trip.
  const window = engine.activeServiceWindow();
  const headway = window.routes["izmir-konak"].plannedHeadwayMinutes * 60;
  const relativeClock = engine.serviceClockOffsetSeconds + engine.simulationTime - window.startMinute * 60;
  engine.simulationTime += Math.ceil(relativeClock / headway) * headway - relativeClock;
  assert.equal(engine.reserveScheduledDeparture(tram, "IZK-RO18", "Fahrettin Altay", "terminal"), true);
  assert.equal(snapshotTram().timetableDelaySeconds, 0);
  engine.simulationTime = tram.scheduledDepartureAt;
  engine.recordScheduledDeparture(tram);
  assert.equal(snapshotTram().timetableDelaySeconds, 0);

  tram.lastDepartureDeviationSeconds = -10;
  assert.equal(snapshotTram().timetableDelaySeconds, 0);
  assert.equal(engine.placeInDepot(tram), true);
  assert.equal(snapshotTram().timetableDelaySeconds, null);
});
