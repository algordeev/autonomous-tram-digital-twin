import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SimulationEngine } from "../src/simulation-core/engine.ts";
import { NETWORK_CONFIGS, validateNetworkConfig } from "../src/simulation-core/network-config.ts";

test("all operational networks load from standalone JSON configs", async () => {
  assert.deepEqual(
    NETWORK_CONFIGS.map((network) => network.id),
    ["nizhny-route-2", "nizhny-routes-2-21", "izmir-konak"],
  );
  for (const network of NETWORK_CONFIGS) {
    const bytes = await readFile(
      new URL(`../src/config/networks/${network.id}.json`, import.meta.url),
      "utf8",
    );
    const parsed = validateNetworkConfig(JSON.parse(bytes));
    assert.equal(parsed.id, network.id);
    assert.ok(parsed.segments.length > 30);
    assert.ok(parsed.routes.length >= 1);
  }
});

test("an experiment round-trip restores network, fleet, controls and infrastructure", () => {
  const source = new SimulationEngine("nizhny-routes-2-21");
  source.setFleetGroupCount("route-21-to-chyorny-prud", 2);
  source.setSpeedLimit(35);
  source.setSimulationRate(2);
  source.setServiceClockMinutes(17 * 60 + 30);
  source.toggleSwitch("SW-21-KRS");
  source.setTrafficSignalMode("SG-OSH-A", "tram-green");

  const exported = source.exportExperimentConfig("Evening test");
  const target = new SimulationEngine("nizhny-route-2");
  const loaded = target.loadExperimentConfig(JSON.parse(JSON.stringify(exported)));
  const snapshot = target.getSnapshot();

  assert.equal(loaded.name, "Evening test");
  assert.equal(snapshot.scenarioId, "nizhny-routes-2-21");
  assert.equal(snapshot.options.speedLimit, 35);
  assert.equal(snapshot.options.simulationRate, 2);
  assert.equal(snapshot.serviceMinute, 17 * 60 + 30);
  assert.equal(snapshot.fleetGroups.find((group) => group.id === "route-21-to-chyorny-prud")?.count, 2);
  assert.equal(snapshot.switches.find((item) => item.id === "SW-21-KRS")?.state, "branch");
  assert.equal(
    snapshot.trafficControllers.find((item) => item.id === "J-OSH")?.manualMode,
    "tram-green",
  );
  assert.equal(snapshot.running, false);
});

test("invalid experiment networks and obstacle segments are rejected", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  const experiment = engine.exportExperimentConfig("Invalid test");
  assert.throws(
    () => engine.loadExperimentConfig({ ...experiment, networkId: "missing-network" }),
    /unknown network/i,
  );
  assert.throws(
    () => engine.loadExperimentConfig({ ...experiment, obstacles: [{ segmentId: "missing", at: 0.5 }] }),
    /outside the selected network/i,
  );
});
