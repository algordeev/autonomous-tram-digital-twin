// Runs one energy-comparison case and prints (or appends) one CSV row per
// strategy. Energy saving and peak reduction are always computed against a
// no-storage reference with exactly the same other parameters.
//
//   node scripts/run-energy-case.mjs --scenario izmir-konak --strategy reactive \
//     --tram-count 12 --start-minute 1020 --csv outputs/sweeps/results.csv
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CSV_COLUMNS, appendCsv, initializeCore, runCase } from "./lib/energy-case.mjs";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "izmir-konak" },
    "tram-count": { type: "string" },
    "start-minute": { type: "string" },
    "warmup-minutes": { type: "string" },
    "window-minutes": { type: "string" },
    "storage-scale": { type: "string" },
    "eta-scale": { type: "string" },
    "timestep-ms": { type: "string" },
    strategy: { type: "string", multiple: true },
    "grid-power-sample-seconds": { type: "string" },
    csv: { type: "string" },
    json: { type: "string" },
    "emit-json": { type: "boolean", default: false },
  },
});

await initializeCore();
const { report, rows } = runCase({
  scenario: values.scenario,
  tramCount: values["tram-count"],
  startMinute: values["start-minute"],
  warmupMinutes: values["warmup-minutes"],
  windowMinutes: values["window-minutes"],
  storageScale: values["storage-scale"],
  etaScale: values["eta-scale"],
  timestepMs: values["timestep-ms"],
  strategies: values.strategy?.flatMap((item) => item.split(",")),
  gridPowerSampleSeconds: values["grid-power-sample-seconds"],
});

if (values.json) await writeFile(resolve(values.json), `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (values["emit-json"]) {
  // Machine-readable output for the sweep runner.
  process.stdout.write(`${JSON.stringify({ rows, report })}\n`);
} else if (values.csv) {
  await appendCsv(resolve(values.csv), rows);
  process.stdout.write(`Appended ${rows.length} row(s) to ${resolve(values.csv)}\n`);
} else {
  process.stdout.write(`${CSV_COLUMNS.join(",")}\n`);
  for (const row of rows) process.stdout.write(`${CSV_COLUMNS.map((column) => row[column]).join(",")}\n`);
}
