// One energy-comparison case: a set of run parameters, the no-storage
// reference and the requested storage strategies, flattened to CSV rows.
// Shared by run-energy-case.mjs, run-sweeps.mjs and run-sanity-checks.mjs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SCENARIOS,
  initializeCppRuntimeFromBytes,
  isCppRuntimeReady,
  runEnergyComparison,
} from "../../src/simulation-core/index.ts";

export const STRATEGIES = {
  none: "no-storage",
  reactive: "baseline",
  predictive: "network-optimal",
};
const STRATEGY_NAMES = Object.fromEntries(Object.entries(STRATEGIES).map(([name, id]) => [id, name]));

export const CSV_COLUMNS = [
  "scenario", "strategy", "tram_count", "tram_count_requested", "start_minute", "warmup_min",
  "window_min", "storage_scale", "eta_scale", "eta_effective", "timestep_ms", "core_runtime",
  "vehicle_km", "grid_wh_metered", "grid_wh_corrected", "grid_wh_per_vkm", "energy_saving_pct",
  "peak_kw", "peak_reduction_pct", "regen_recovered_wh", "flywheel_start_kwh", "flywheel_end_kwh",
  "headway_cv", "mean_headway_s", "departure_adherence", "on_time_pct", "avg_wait_s",
  "left_behind", "interventions", "runtime_s", "git_commit",
];

/** Columns that identify a case; a row with the same values is the same run. */
export const KEY_COLUMNS = [
  "scenario", "strategy", "tram_count_requested", "start_minute", "warmup_min", "window_min",
  "storage_scale", "eta_scale", "timestep_ms",
];

export const BASELINE = {
  startMinute: 480,
  warmupMinutes: 10,
  windowMinutes: 60,
  storageScale: 1,
  etaScale: 1,
  timestepMs: 50,
};

let commit;
export function gitCommit() {
  if (commit) return commit;
  try {
    const cwd = new URL("../..", import.meta.url);
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim();
    // Only tracked source changes make a run irreproducible from the hash.
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd, encoding: "utf8" }).trim();
    commit = dirty ? `${hash}-dirty` : hash;
  } catch {
    commit = "unknown";
  }
  return commit;
}

export async function initializeCore() {
  await initializeCppRuntimeFromBytes(
    await readFile(new URL("../../public/wasm/tram-core.wasm", import.meta.url)),
  );
  if (!isCppRuntimeReady()) {
    throw new Error("The C++/WASM core did not load; refusing to run on the TypeScript fallback, which has no traction-power network.");
  }
}

/** Validates and normalizes case parameters (numbers, known scenario and strategy). */
export function normalizeCase(input) {
  const scenario = SCENARIOS.find((item) => item.id === input.scenario);
  if (!scenario) {
    throw new Error(`Unknown scenario "${input.scenario}". Known: ${SCENARIOS.map((item) => item.id).join(", ")}`);
  }
  const number = (value, name, fallback) => {
    const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
    return parsed;
  };
  const strategies = (input.strategies ?? ["none", "reactive", "predictive"]).map((name) => {
    if (!STRATEGIES[name]) throw new Error(`Unknown strategy "${name}" (none|reactive|predictive)`);
    return name;
  });
  const tramCount = input.tramCount === undefined || input.tramCount === null || input.tramCount === "" || input.tramCount === "default"
    ? null
    : number(input.tramCount, "tram count");
  const normalized = {
    scenario: scenario.id,
    tramCount,
    startMinute: number(input.startMinute, "start minute", BASELINE.startMinute),
    warmupMinutes: number(input.warmupMinutes, "warm-up minutes", BASELINE.warmupMinutes),
    windowMinutes: number(input.windowMinutes, "window minutes", BASELINE.windowMinutes),
    storageScale: number(input.storageScale, "storage scale", BASELINE.storageScale),
    etaScale: number(input.etaScale, "eta scale", BASELINE.etaScale),
    timestepMs: number(input.timestepMs, "timestep ms", BASELINE.timestepMs),
    strategies,
    gridPowerSampleSeconds: input.gridPowerSampleSeconds ? number(input.gridPowerSampleSeconds, "grid power sample seconds") : undefined,
  };
  if (!(normalized.windowMinutes > 0) || normalized.warmupMinutes < 0) throw new Error("window must be > 0 and warm-up ≥ 0");
  if (!(normalized.timestepMs > 0) || normalized.timestepMs > 1000) throw new Error("timestep must be in (0, 1000] ms");
  return normalized;
}

/** Key of one strategy row of a case, for resuming sweeps. */
export function caseKey(params, strategyName) {
  return [
    params.scenario, strategyName, params.tramCount ?? "default", params.startMinute,
    params.warmupMinutes, params.windowMinutes, params.storageScale, params.etaScale, params.timestepMs,
  ].join("|");
}
export const rowKey = (row) => KEY_COLUMNS.map((column) => row[column]).join("|");

/** Runs one case and returns { report, rows } with one CSV row per requested strategy. */
export function runCase(input) {
  const params = normalizeCase(input);
  const started = performance.now();
  const storageStrategies = params.strategies
    .filter((name) => name !== "none")
    .map((name) => STRATEGIES[name]);
  const report = runEnergyComparison({
    scenarioId: params.scenario,
    tramCount: params.tramCount ?? undefined,
    startServiceMinute: params.startMinute,
    warmUpSeconds: params.warmupMinutes * 60,
    durationSeconds: params.windowMinutes * 60,
    fixedStepSeconds: params.timestepMs / 1000,
    storageScale: params.storageScale,
    etaScale: params.etaScale,
    strategies: storageStrategies,
    gridPowerSampleSeconds: params.gridPowerSampleSeconds,
  });
  if (report.coreRuntime !== "cpp-wasm") {
    throw new Error(`Case ran on ${report.coreRuntime}; results must come from the cpp-wasm core.`);
  }
  const runtimeSeconds = (performance.now() - started) / 1000;
  const etaEffective = report.flywheelChargeEfficiency === null
    ? ""
    : report.flywheelChargeEfficiency === report.flywheelDischargeEfficiency
      ? round(report.flywheelChargeEfficiency, 4)
      : `${round(report.flywheelChargeEfficiency, 4)}/${round(report.flywheelDischargeEfficiency, 4)}`;
  const rows = report.rows
    .filter((row) => params.strategies.includes(STRATEGY_NAMES[row.strategy]))
    .map((row) => ({
      scenario: params.scenario,
      strategy: STRATEGY_NAMES[row.strategy],
      tram_count: report.tramCount,
      tram_count_requested: params.tramCount ?? "default",
      start_minute: params.startMinute,
      warmup_min: params.warmupMinutes,
      window_min: params.windowMinutes,
      storage_scale: params.storageScale,
      eta_scale: params.etaScale,
      eta_effective: etaEffective,
      timestep_ms: params.timestepMs,
      core_runtime: report.coreRuntime,
      vehicle_km: round(row.distanceKm, 3),
      grid_wh_metered: round(row.gridSupplyKWh * 1000, 1),
      grid_wh_corrected: round(row.socCorrectedGridKWh * 1000, 1),
      grid_wh_per_vkm: round(row.gridWhPerVehicleKm, 2),
      energy_saving_pct: round(row.energySavingPercent, 3),
      peak_kw: round(row.peakGridPowerKw, 1),
      peak_reduction_pct: round(row.peakReductionPercent, 3),
      regen_recovered_wh: round(row.acceptedRegenerationKWh * 1000, 1),
      flywheel_start_kwh: round(row.flywheelStartKWh, 3),
      flywheel_end_kwh: round(row.flywheelEndKWh, 3),
      headway_cv: row.headwayCv === null ? "" : round(row.headwayCv, 4),
      mean_headway_s: row.headwayMeanSeconds === null ? "" : round(row.headwayMeanSeconds, 1),
      departure_adherence: row.departureAdherencePercent === null ? "" : round(row.departureAdherencePercent, 2),
      on_time_pct: round(row.onTimePercentMean, 2),
      avg_wait_s: round(row.averageWaitSecondsMean, 1),
      left_behind: Math.round(row.passengersLeftBehind),
      interventions: row.interventions,
      runtime_s: round(runtimeSeconds, 1),
      git_commit: gitCommit(),
    }));
  return { params, report, rows };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Appends rows, writing the header first when the file is new or empty. */
export async function appendCsv(path, rows) {
  await mkdir(dirname(path), { recursive: true });
  let text = "";
  if (!existsSync(path) || (await readFile(path, "utf8")).trim() === "") {
    text += `${CSV_COLUMNS.join(",")}\n`;
  }
  for (const row of rows) text += `${CSV_COLUMNS.map((column) => csvCell(row[column])).join(",")}\n`;
  await appendFile(path, text, "utf8");
}

/** Minimal CSV reader for files written by appendCsv. */
export async function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const parseLine = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { cells.push(cell); cell = ""; }
      else cell += char;
    }
    cells.push(cell);
    return cells;
  };
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((value, index) => [header[index], value])));
}
