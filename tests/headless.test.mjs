import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  initializeCppRuntimeFromBytes,
  runEnergyComparison,
  runHeadlessSimulation,
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
  assert.equal(report.scenarioId, "nizhny-routes-2-21");
  assert.ok(report.simulatedDurationSeconds >= 119.9);
  assert.equal(report.samples.length, 4);
  assert.ok(report.routeOperations.length >= 2);
  assert.ok(report.energyStatistics.routes.length >= 2);
  assert.doesNotThrow(() => JSON.stringify(report));
});
