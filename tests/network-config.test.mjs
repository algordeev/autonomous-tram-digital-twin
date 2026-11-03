import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SCENARIOS, SimulationEngine, serviceWindowContainsMinute } from "../src/simulation-core/engine.ts";
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

test("a service window crossing midnight covers both sides of it", () => {
  for (const window of [{ startMinute: 1260, endMinute: 1460 }, { startMinute: 1260, endMinute: 20 }]) {
    assert.equal(serviceWindowContainsMinute(window, 1259), false);
    assert.equal(serviceWindowContainsMinute(window, 1260), true);
    assert.equal(serviceWindowContainsMinute(window, 1439), true);
    assert.equal(serviceWindowContainsMinute(window, 0), true);
    assert.equal(serviceWindowContainsMinute(window, 19), true);
    assert.equal(serviceWindowContainsMinute(window, 20), false);
  }
  assert.equal(serviceWindowContainsMinute({ startMinute: 420, endMinute: 570 }, 419), false);
  assert.equal(serviceWindowContainsMinute({ startMinute: 420, endMinute: 570 }, 569), true);
});

test("a rejected experiment leaves the current scenario and fleet untouched", () => {
  const engine = new SimulationEngine("nizhny-route-2");
  engine.setSpeedLimit(35);
  const before = engine.getSnapshot();
  const experiment = new SimulationEngine("nizhny-routes-2-21").exportExperimentConfig("Empty fleet");
  experiment.fleetGroups = Object.fromEntries(Object.keys(experiment.fleetGroups).map((id) => [id, 0]));
  experiment.options.speedLimit = 60;

  assert.throws(() => engine.loadExperimentConfig(experiment), /Fleet size/);
  const after = engine.getSnapshot();
  assert.equal(after.scenarioId, "nizhny-route-2");
  assert.equal(after.options.speedLimit, 35);
  assert.deepEqual(after.trams.map((tram) => tram.id), before.trams.map((tram) => tram.id));
  assert.deepEqual(after.fleetGroups, before.fleetGroups);
});

test("experiments exported from every built-in scenario can be imported again", () => {
  for (const scenario of SCENARIOS) {
    const source = new SimulationEngine(scenario.id);
    const exported = JSON.parse(JSON.stringify(source.exportExperimentConfig(scenario.shortName)));
    const target = new SimulationEngine(scenario.id === "nizhny-route-2" ? "prototype-loop" : "nizhny-route-2");
    const loaded = target.loadExperimentConfig(exported);
    assert.equal(loaded.networkId, scenario.id);
    assert.equal(target.getSnapshot().scenarioId, scenario.id);
    assert.equal(target.getSnapshot().trams.length, source.getSnapshot().trams.length);
  }
});
