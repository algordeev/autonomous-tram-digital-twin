// Credibility checks for the İzmir baseline of the sensitivity study:
//  1. energy-balance closure per strategy,
//  2. timestep convergence (50 ms against 25 ms),
//  3. warm-up sensitivity (10 min against 20 min),
//  4. Wh/vkm next to an empty column for published reference values.
//
//   npm run benchmark:sanity
//
// Writes outputs/sweeps/sanity.json and outputs/sweeps/sanity.md.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BASELINE, gitCommit } from "./lib/energy-case.mjs";

const OUTPUT_DIR = fileURLToPath(new URL("../outputs/sweeps/", import.meta.url));
const CASE_SCRIPT = fileURLToPath(new URL("./run-energy-case.mjs", import.meta.url));
const SCENARIO = "izmir-konak";
const TARGET_PERCENT = 1;
const STRATEGIES = ["none", "reactive", "predictive"];
const LABELS = { "no-storage": "none", baseline: "reactive", "network-optimal": "predictive" };

function runCase(overrides) {
  const params = { ...BASELINE, ...overrides };
  const args = [
    CASE_SCRIPT,
    "--scenario", SCENARIO,
    "--start-minute", String(params.startMinute),
    "--warmup-minutes", String(params.warmupMinutes),
    "--window-minutes", String(params.windowMinutes),
    "--storage-scale", String(params.storageScale),
    "--eta-scale", String(params.etaScale),
    "--timestep-ms", String(params.timestepMs),
    "--strategy", STRATEGIES.join(","),
    "--emit-json",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(stdout.trim().split("\n").at(-1))) : reject(new Error(`case failed (exit ${code})`)),
    );
  });
}

console.log("Running the İzmir baseline, the 25 ms case and the two 20 min warm-up cases in parallel …");
const [base, fineStep, longWarmUp, sameWindow] = await Promise.all([
  runCase({}),
  runCase({ timestepMs: 25 }),
  runCase({ warmupMinutes: 20 }),
  // Starts 10 min earlier, so the measured window is the same 08:10–09:10:
  // isolates the warm-up from the time of day.
  runCase({ warmupMinutes: 20, startMinute: BASELINE.startMinute - 10 }),
]);
for (const result of [base, fineStep, longWarmUp, sameWindow]) {
  if (result.report.coreRuntime !== "cpp-wasm") throw new Error("A sanity case did not run on the cpp-wasm core.");
}

const relative = (value, reference) => (reference !== 0 ? (Math.abs(value - reference) / Math.abs(reference)) * 100 : 0);
const pass = (percent) => percent < TARGET_PERCENT;

// 1. Energy balance: grid supply + regeneration accepted by the network
//    (reused by other trams or charged into a flywheel)
//    = vehicle electrical demand + flywheel losses + ΔE stored.
const balance = base.report.rows.map((row) => {
  const supplyKWh = row.gridSupplyKWh + row.acceptedRegenerationKWh;
  const useKWh = row.vehicleDemandKWh + row.flywheelLossesKWh + row.flywheelStoredChangeKWh;
  const residualKWh = supplyKWh - useKWh;
  return {
    strategy: LABELS[row.strategy],
    gridSupplyKWh: row.gridSupplyKWh,
    acceptedRegenerationKWh: row.acceptedRegenerationKWh,
    localReuseKWh: row.localReuseKWh,
    vehicleDemandKWh: row.vehicleDemandKWh,
    tractionKWh: row.tractionKWh,
    auxiliaryKWh: row.auxiliaryKWh,
    flywheelLossesKWh: row.flywheelLossesKWh,
    flywheelStoredChangeKWh: row.flywheelStoredChangeKWh,
    residualKWh,
    residualPercent: (Math.abs(residualKWh) / useKWh) * 100,
    pass: pass((Math.abs(residualKWh) / useKWh) * 100),
  };
});

// 2 and 3. Same metrics, one variable changed.
const compare = (variant) => base.report.rows.map((row, index) => {
  const other = variant.report.rows[index];
  const whChange = relative(other.gridWhPerVehicleKm, row.gridWhPerVehicleKm);
  const peakChange = relative(other.peakGridPowerKw, row.peakGridPowerKw);
  return {
    strategy: LABELS[row.strategy],
    baseWhPerVkm: row.gridWhPerVehicleKm,
    variantWhPerVkm: other.gridWhPerVehicleKm,
    whPerVkmChangePercent: whChange,
    basePeakKw: row.peakGridPowerKw,
    variantPeakKw: other.peakGridPowerKw,
    peakChangePercent: peakChange,
    baseSavingPercent: row.energySavingPercent,
    variantSavingPercent: other.energySavingPercent,
    basePeakReductionPercent: row.peakReductionPercent,
    variantPeakReductionPercent: other.peakReductionPercent,
    pass: pass(whChange) && pass(peakChange),
  };
});
const timestep = compare(fineStep);
const warmUp = compare(longWarmUp);
const warmUpSameWindow = compare(sameWindow);

const sanity = {
  generatedFrom: { gitCommit: gitCommit(), node: process.version, scenario: SCENARIO, baseline: BASELINE, coreRuntime: base.report.coreRuntime },
  targetPercent: TARGET_PERCENT,
  energyBalance: { definition: "grid supply + accepted regeneration = vehicle demand + flywheel losses + ΔE stored", rows: balance, pass: balance.every((row) => row.pass) },
  timestepConvergence: { compared: "50 ms vs 25 ms fixed step", rows: timestep, pass: timestep.every((row) => row.pass) },
  warmUpSensitivity: { compared: "10 min vs 20 min warm-up (window start moves 10 min later)", rows: warmUp, pass: warmUp.every((row) => row.pass) },
  warmUpSensitivitySameWindow: { compared: "10 min vs 20 min warm-up, same 08:10–09:10 window (service starts 07:50)", rows: warmUpSameWindow, pass: warmUpSameWindow.every((row) => row.pass) },
  referenceComparison: base.report.rows.map((row) => ({
    strategy: LABELS[row.strategy],
    gridWhPerVehicleKm: row.gridWhPerVehicleKm,
    publishedReference: null,
  })),
};

const f = (value, digits = 2) => value.toFixed(digits);
const verdict = (ok) => (ok ? "pass" : "**fail**");
const md = [
  `## Sanity checks (İzmir baseline, git ${sanity.generatedFrom.gitCommit})`,
  "",
  `Target: < ${TARGET_PERCENT}% for every item.`,
  "",
  "### 1. Energy-balance closure",
  "",
  "grid supply + accepted regeneration = vehicle demand + flywheel losses + ΔE stored",
  "",
  "| Strategy | Grid kWh | Accepted regen kWh | Vehicle demand kWh | Flywheel losses kWh | ΔE kWh | Residual kWh | Residual | Result |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...balance.map((row) => `| ${row.strategy} | ${f(row.gridSupplyKWh, 3)} | ${f(row.acceptedRegenerationKWh, 3)} | ${f(row.vehicleDemandKWh, 3)} | ${f(row.flywheelLossesKWh, 3)} | ${f(row.flywheelStoredChangeKWh, 3)} | ${row.residualKWh.toExponential(2)} | ${row.residualPercent.toExponential(2)}% | ${verdict(row.pass)} |`),
  "",
  ...[["2. Timestep convergence (50 ms → 25 ms)", timestep], ["3a. Warm-up sensitivity (10 min → 20 min; the window moves to 08:20–09:20)", warmUp], ["3b. Warm-up sensitivity, same 08:10–09:10 window (service from 07:50)", warmUpSameWindow]].flatMap(([title, rows]) => [
    `### ${title}`,
    "",
    "| Strategy | Wh/vkm | Change | Peak kW | Change | Saving | Peak reduction | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.strategy} | ${f(row.baseWhPerVkm, 1)} → ${f(row.variantWhPerVkm, 1)} | ${f(row.whPerVkmChangePercent)}% | ${f(row.basePeakKw, 1)} → ${f(row.variantPeakKw, 1)} | ${f(row.peakChangePercent)}% | ${f(row.baseSavingPercent, 1)}% → ${f(row.variantSavingPercent, 1)}% | ${f(row.basePeakReductionPercent, 1)}% → ${f(row.variantPeakReductionPercent, 1)}% | ${verdict(row.pass)} |`),
    "",
  ]),
  "### 4. Grid energy per vehicle-km against published values",
  "",
  "| Strategy | Simulated Wh/vkm | Published reference (to fill in) |",
  "| --- | ---: | --- |",
  ...sanity.referenceComparison.map((row) => `| ${row.strategy} | ${f(row.gridWhPerVehicleKm, 1)} | |`),
  "",
].join("\n");

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(`${OUTPUT_DIR}sanity.json`, `${JSON.stringify(sanity, null, 2)}\n`, "utf8");
await writeFile(`${OUTPUT_DIR}sanity.md`, `${md}\n`, "utf8");
console.log(md);
console.log(`Wrote ${OUTPUT_DIR}sanity.json and sanity.md`);
