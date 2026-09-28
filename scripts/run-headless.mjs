import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runHeadlessSimulation } from "../src/simulation-core/index.ts";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "nizhny-routes-2-21" },
    "duration-hours": { type: "string", default: "1" },
    "sample-seconds": { type: "string", default: "60" },
    "tram-count": { type: "string" },
    "start-minute": { type: "string" },
    output: { type: "string" },
  },
});

const durationHours = Number(values["duration-hours"]);
const sampleEverySeconds = Number(values["sample-seconds"]);
const tramCount = values["tram-count"] ? Number(values["tram-count"]) : undefined;
const startServiceMinute = values["start-minute"]
  ? Number(values["start-minute"])
  : undefined;

if (!(durationHours > 0) || !(sampleEverySeconds > 0)) {
  throw new Error("--duration-hours and --sample-seconds must be positive numbers");
}

const report = runHeadlessSimulation({
  scenarioId: values.scenario,
  tramCount,
  durationSeconds: durationHours * 3600,
  sampleEverySeconds,
  startServiceMinute,
});
const json = `${JSON.stringify(report, null, 2)}\n`;

if (values.output) {
  const outputPath = resolve(values.output);
  await writeFile(outputPath, json, "utf8");
  process.stdout.write(`Headless report written to ${outputPath}\n`);
} else {
  process.stdout.write(json);
}
