// One-factor-at-a-time sensitivity sweeps around the benchmark baseline
// (each network's default fleet, 08:00 start, 10 min warm-up, 60 min window,
// storage and efficiency scale 1), every case for none/reactive/predictive.
//
//   npm run benchmark:sweeps            # resumable; skips rows already in the CSV
//   npm run benchmark:sweeps -- --jobs 4 --dry-run
//
// Writes outputs/sweeps/results.csv (one row per case and strategy), one JSON
// report per case under outputs/sweeps/reports/, and the İzmir baseline
// grid-power time series used for the figures.
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  BASELINE,
  appendCsv,
  caseKey,
  readCsv,
  rowKey,
} from "./lib/energy-case.mjs";

const OUTPUT_DIR = fileURLToPath(new URL("../outputs/sweeps/", import.meta.url));
const CSV_PATH = `${OUTPUT_DIR}results.csv`;
const REPORT_DIR = `${OUTPUT_DIR}reports/`;
const SERIES_PATH = `${OUTPUT_DIR}izmir-baseline-grid-power.csv`;
const CASE_SCRIPT = fileURLToPath(new URL("./run-energy-case.mjs", import.meta.url));
const STRATEGY_NAMES = ["none", "reactive", "predictive"];

// The documented benchmark (docs/EXPERIMENTS.md) the sweep must reproduce first.
const EXPECTED_BASELINE = { energySavingPct: 22.0, peakReductionPct: 12.4, tolerance: 0.05 };

const { values } = parseArgs({
  options: {
    jobs: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "skip-baseline-check": { type: "boolean", default: false },
  },
});
const jobs = Math.max(1, Number(values.jobs ?? Math.max(1, availableParallelism() - 1)));

const baseline = (scenario, overrides = {}) => ({
  scenario,
  tramCount: null,
  startMinute: BASELINE.startMinute,
  warmupMinutes: BASELINE.warmupMinutes,
  windowMinutes: BASELINE.windowMinutes,
  storageScale: BASELINE.storageScale,
  etaScale: BASELINE.etaScale,
  timestepMs: BASELINE.timestepMs,
  ...overrides,
});

const SWEEPS = [
  ...["izmir-konak", "nizhny-route-2", "nizhny-routes-2-21"].flatMap((scenario) =>
    [360, 480, 720, 1020, 1260].map((startMinute) => ({ sweep: "time-of-day", ...baseline(scenario, { startMinute }) })),
  ),
  ...[8, 10, 12, 14, 16].map((tramCount) => ({ sweep: "fleet", ...baseline("izmir-konak", { tramCount }) })),
  ...[0, 0.5, 1, 1.5].map((storageScale) => ({ sweep: "storage", ...baseline("izmir-konak", { storageScale }) })),
  // Nominal η is 0.95; scales above 1/0.95 would exceed η = 1 and are rejected.
  ...[0.9, 0.95, 1].map((etaScale) => ({ sweep: "efficiency", ...baseline("izmir-konak", { etaScale }) })),
];

// One run per distinct parameter set: the baseline appears in several sweeps.
const cases = [];
const seen = new Set();
for (const item of SWEEPS) {
  const key = caseKey(item, "*");
  if (seen.has(key)) continue;
  seen.add(key);
  cases.push(item);
}

const done = new Set((await readCsv(CSV_PATH)).map(rowKey));
const isDone = (item) => STRATEGY_NAMES.every((name) => done.has(caseKey(item, name)));
const pending = cases.filter((item) => !isDone(item));
console.log(`${cases.length} cases (${cases.length * STRATEGY_NAMES.length} rows); ${cases.length - pending.length} already in ${CSV_PATH}; ${pending.length} to run on ${jobs} worker(s).`);
if (values["dry-run"]) {
  for (const item of pending) console.log(`  ${item.sweep}: ${caseKey(item, "*")}`);
  process.exit(0);
}
await mkdir(REPORT_DIR, { recursive: true });

const caseArgs = (item, extra = []) => [
  CASE_SCRIPT,
  "--scenario", item.scenario,
  ...(item.tramCount === null ? [] : ["--tram-count", String(item.tramCount)]),
  "--start-minute", String(item.startMinute),
  "--warmup-minutes", String(item.warmupMinutes),
  "--window-minutes", String(item.windowMinutes),
  "--storage-scale", String(item.storageScale),
  "--eta-scale", String(item.etaScale),
  "--timestep-ms", String(item.timestepMs),
  "--strategy", STRATEGY_NAMES.join(","),
  "--emit-json",
  ...extra,
];

function runChild(item, extra) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, caseArgs(item, extra), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`case ${caseKey(item, "*")} failed (exit ${code}):\n${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout.trim().split("\n").at(-1)));
    });
  });
}

const reportName = (item) => `${caseKey(item, "all").replace(/\|/g, "_")}.json`;

async function record(item, result) {
  const { rows, report } = result;
  const series = report.rows.map((row) => row.gridPowerSeriesKw);
  for (const row of report.rows) delete row.gridPowerSeriesKw;
  await writeFile(`${REPORT_DIR}${reportName(item)}`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await appendCsv(CSV_PATH, rows);
  for (const row of rows) done.add(rowKey(row));
  return series;
}

// 1. Baseline first: it must reproduce the documented benchmark before anything else runs.
const izmirBaseline = cases.find((item) => item.scenario === "izmir-konak" && caseKey(item, "*") === caseKey(baseline("izmir-konak"), "*"));
const started = performance.now();
if (!values["skip-baseline-check"]) {
  console.log("Checking the İzmir baseline against docs/EXPERIMENTS.md …");
  const result = await runChild(izmirBaseline, ["--grid-power-sample-seconds", "1"]);
  const reactive = result.rows.find((row) => row.strategy === "reactive");
  const offEnergy = Math.abs(reactive.energy_saving_pct - EXPECTED_BASELINE.energySavingPct);
  const offPeak = Math.abs(reactive.peak_reduction_pct - EXPECTED_BASELINE.peakReductionPct);
  console.log(`  reactive: ${reactive.energy_saving_pct.toFixed(2)}% saving, ${reactive.peak_reduction_pct.toFixed(2)}% peak reduction (expected ${EXPECTED_BASELINE.energySavingPct}% / ${EXPECTED_BASELINE.peakReductionPct}%)`);
  if (offEnergy > EXPECTED_BASELINE.tolerance || offPeak > EXPECTED_BASELINE.tolerance) {
    console.error("The baseline does not reproduce the documented benchmark. Stopping before the sweep.");
    process.exit(1);
  }
  const series = await record(izmirBaseline, isDone(izmirBaseline) ? { rows: [], report: result.report } : result);
  const lines = ["t_s,none_kw,reactive_kw,predictive_kw"];
  for (let index = 0; index < series[0].length; index += 1) {
    lines.push([index + 1, ...series.map((values) => values[index].toFixed(2))].join(","));
  }
  await writeFile(SERIES_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`  baseline reproduced; grid-power series written to ${SERIES_PATH}`);
}

// 2. The remaining cases in parallel.
const queue = cases.filter((item) => !isDone(item));
const total = queue.length;
let finished = 0;
let failed = 0;
const sweepStarted = performance.now();
const formatDuration = (seconds) => {
  const s = Math.round(seconds);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

async function worker() {
  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await record(item, await runChild(item, []));
    } catch (error) {
      failed += 1;
      console.error(String(error.message ?? error));
    }
    finished += 1;
    const elapsed = (performance.now() - sweepStarted) / 1000;
    const eta = (elapsed / finished) * (total - finished);
    console.log(`[${finished}/${total}] ${item.sweep}: ${caseKey(item, "*")} · elapsed ${formatDuration(elapsed)} · ETA ${formatDuration(eta)}`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, Math.max(1, total)) }, worker));

const wall = (performance.now() - started) / 1000;
console.log(`\nDone: ${cases.length} cases, ${total} run now (${failed} failed), wall time ${formatDuration(wall)}. Results: ${CSV_PATH}`);
if (failed > 0) process.exit(1);
