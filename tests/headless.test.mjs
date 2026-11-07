import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  initializeCppRuntimeFromBytes,
  runEnergyComparison,
  runHeadlessSimulation,
  scaleScenarioStorage,
  SCENARIOS,
  SimulationEngine,
} from "../src/simulation-core/index.ts";

test("the complete simulation core loads and advances without browser globals", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(typeof globalThis.document, "undefined");

  const engine = new SimulationEngine("nizhny-routes-2-21", 4);
  engine.setRunning(true);
  engine.step(0.1);

  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.time > 0);
  assert.equal(snapshot.trams.length, 4);
});

test("energy comparison runs no-storage, reactive and predictive cases", async () => {
  const wasm = await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url));
  await initializeCppRuntimeFromBytes(wasm);
  const report = runEnergyComparison({
    scenarioId: "izmir-konak",
    tramCount: 6,
    durationSeconds: 120,
    startServiceMinute: 8 * 60,
  });
  assert.deepEqual(report.rows.map((row) => row.strategy), ["no-storage", "baseline", "network-optimal"]);
  assert.equal(report.rows[0].flywheelLossesKWh, 0);
  assert.ok(report.rows[1].gridSupplyKWh > 0);
  assert.ok(Number.isFinite(report.rows[2].energySavingPercent));
  assert.ok(report.rows.every((row) => row.distanceKm > 0));
  assert.ok(report.rows.every((row) => Number.isFinite(row.gridWhPerVehicleKm)));
  assert.ok(
    report.rows[2].averageSpeedKmh >= report.rows[1].averageSpeedKmh * 0.9,
    "predictive control must not obtain savings by collapsing service speed",
  );
});

test("headless runner returns serializable operational and energy statistics", () => {
  const report = runHeadlessSimulation({
    scenarioId: "nizhny-routes-2-21",
    tramCount: 4,
    durationSeconds: 120,
    sampleEverySeconds: 30,
  });

  assert.equal(report.schemaVersion, 1);
  assert.ok(["cpp-wasm", "typescript-fallback"].includes(report.coreRuntime));
  assert.equal(report.scenarioId, "nizhny-routes-2-21");
  assert.ok(report.simulatedDurationSeconds >= 119.9);
  assert.equal(report.samples.length, 4);
  assert.ok(report.routeOperations.length >= 2);
  assert.ok(report.energyStatistics.routes.length >= 2);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("the headless CLI runs on the C++ core and simulates the traction-power network", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/run-headless.mjs", import.meta.url)),
      "--scenario", "nizhny-routes-2-21",
      "--duration-hours", "0.03",
      "--start-minute", "480",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.coreRuntime, "cpp-wasm");
  const power = report.energyStatistics.powerSystem;
  assert.ok(report.energyStatistics.total.gridDrawKWh > 0);
  assert.ok(power.gridSupplyKWh > 0, "substations must supply the trams' demand");
  assert.ok(power.peakGridPowerKw > 0);
});

test("a plain fleet size is spread over the fleet groups instead of one start point", () => {
  const engine = new SimulationEngine("izmir-konak");
  engine.setFleetSize(14);
  const positions = new Set(engine.getSnapshot().trams.map((tram) => `${tram.segmentId}@${tram.progress}`));
  assert.equal(positions.size, 14);
  assert.deepEqual(engine.getFleetGroupCounts(), { "konak-to-faltay": 7, "konak-to-halkapinar": 7 });

  const report = runHeadlessSimulation({ scenarioId: "izmir-konak", tramCount: 6, durationSeconds: 1 });
  assert.equal(report.routeOperations.reduce((sum, route) => sum + route.totalFleet, 0), 6);
});

test("the energy comparison measures a window after warm-up and credits stored flywheel energy", async () => {
  await initializeCppRuntimeFromBytes(await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url)));
  const report = runEnergyComparison({
    scenarioId: "izmir-konak",
    tramCount: 6,
    startServiceMinute: 480,
    warmUpSeconds: 60,
    durationSeconds: 120,
  });
  assert.equal(report.tramCount, 6);
  assert.deepEqual(report.fleetGroups, { "konak-to-faltay": 3, "konak-to-halkapinar": 3 });
  const [reference, reactive] = report.rows;
  assert.equal(reference.flywheelStartKWh, 0);
  assert.equal(reference.socCorrectedGridKWh, reference.gridSupplyKWh);
  // Charge gained in the window is credited at the discharge efficiency.
  const gained = reactive.flywheelEndKWh - reactive.flywheelStartKWh;
  const expected = reactive.gridSupplyKWh - (gained >= 0 ? gained * 0.95 : gained / 0.95);
  assert.ok(Math.abs(reactive.socCorrectedGridKWh - expected) < 1e-9);
  for (const row of report.rows) {
    // Six trams for two minutes at under 70 km/h: the warm-up is not counted.
    assert.ok(row.distanceKm > 0 && row.distanceKm < 6 * (120 / 3600) * 70);
    assert.ok(row.peakGridPowerKw > 0);
  }
});

test("storage scaling rescales flywheel ratings without touching the shared scenario", () => {
  const izmir = SCENARIOS.find((item) => item.id === "izmir-konak");
  const original = izmir.tractionPowerSystem.sections.find((section) => section.flywheel).flywheel;
  const half = scaleScenarioStorage(izmir, 0.5, 0.9);
  const scaled = half.tractionPowerSystem.sections.find((section) => section.flywheel).flywheel;
  assert.equal(scaled.modules, original.modules);
  assert.ok(Math.abs(scaled.moduleEnergyKWh - original.moduleEnergyKWh * 0.5) < 1e-12);
  assert.ok(Math.abs(scaled.chargeEfficiency - original.chargeEfficiency * 0.9) < 1e-12);
  assert.equal(izmir.tractionPowerSystem.sections.find((section) => section.flywheel).flywheel, original);
  assert.ok(scaleScenarioStorage(izmir, 0).tractionPowerSystem.sections.every((section) => !section.flywheel));
  assert.equal(scaleScenarioStorage(izmir, 1, 1), izmir);
  assert.throws(() => scaleScenarioStorage(izmir, 1, 1.1), /above 1/);
  assert.equal(new SimulationEngine("izmir-konak", undefined, { fixedStepSeconds: 0.025 }).fixedStepSeconds, 0.025);
});

test("sampling the measured window does not change the energy comparison", async () => {
  await initializeCppRuntimeFromBytes(await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url)));
  const options = { scenarioId: "izmir-konak", tramCount: 6, startServiceMinute: 480, warmUpSeconds: 60, durationSeconds: 240 };
  const plain = runEnergyComparison({ ...options, serviceSampleSeconds: 3600 });
  const sampled = runEnergyComparison({ ...options, serviceSampleSeconds: 5, gridPowerSampleSeconds: 1 });
  assert.equal(sampled.schemaVersion, 2);
  assert.equal(sampled.coreRuntime, "cpp-wasm");
  plain.rows.forEach((row, index) => {
    assert.equal(sampled.rows[index].socCorrectedGridKWh, row.socCorrectedGridKWh);
    assert.equal(sampled.rows[index].peakGridPowerKw, row.peakGridPowerKw);
    assert.equal(sampled.rows[index].distanceKm, row.distanceKm);
  });
  assert.equal(sampled.rows[0].gridPowerSeriesKw.length, 240);
});
