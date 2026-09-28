import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds standalone installable HTML without hosting metadata", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /Autonomous Tram Digital Twin/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /codex-preview|chatgpt|\.openai/i);
});

test("includes readable focus targets for intersections and terminals", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /Быстрый переход к перекрёстку или конечной/);
  assert.match(source, /Красносельская · треугольник стрелок/);
  assert.match(source, /Чёрный Пруд · стрелка и треугольник/);
  assert.match(source, /Парк Дубки · конечная/);
});

test("the two-route scenario exposes every turnout and signal in the side panel", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /showNizhnyInfrastructure = snapshot\.scenarioId !== "prototype-loop"/);
  assert.match(source, /snapshot\.scenarioName} turnout complexes/);
  assert.match(source, /Every controlled tram signal/);
  assert.match(source, /activeScenario\.signals\.map/);
});

test("the operations desk exposes portable experiment controls", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /Save on this computer/);
  assert.match(source, /Export JSON/);
  assert.match(source, /Import JSON/);
  assert.match(source, /tram-twin-experiments-v1/);
});

test("the live controls expose the VYCON flywheel bank", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /VYCON REGEN · \{flywheelModules\} modules/);
  assert.match(source, /flywheelSoc\.toFixed\(0\).*SOC/s);
  const network = JSON.parse(await readFile(new URL("../src/config/networks/nizhny-routes-2-21.json", import.meta.url), "utf8"));
  assert.equal(network.tractionPowerSystem.sections.reduce((sum, section) => sum + section.flywheel.modules, 0), 38);
});

test("road vehicles keep their lane offset aligned at every map zoom", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const lane = \(vehicle\.direction \* 5\) \/ zoom/);
});

test("controlled road surfaces stay below the rails and cars stay above them", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const crossingLayer = source.indexOf(
    "drawRoadCrossings(context, state.scenario, state, zoom)",
  );
  const trackLayer = source.indexOf(
    "drawTrack(context, state.scenario, activeSegments, zoom)",
  );
  const vehicleLayer = source.indexOf(
    "drawRoadVehicles(context, state.scenario, state, zoom)",
  );
  assert.ok(crossingLayer >= 0 && crossingLayer < trackLayer);
  assert.ok(vehicleLayer > trackLayer);
  assert.match(source, /ROAD_CROSSING_LENGTH_PX = 126/);
});
