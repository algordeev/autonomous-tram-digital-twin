// Disturbance recovery on İzmir (configured fleet of 14 trams): one tram held 2, 5 or 10 min at
// a mid-line stop (Konak İskele, towards Fahrettin Altay), or a passenger
// surge there, with headway regulation on or off.
//
//   npm run automation:disturbance
//
// Regulation modes (engine experiment switches, both on by default):
//   on               terminal holding (timetable slots and interval holds) and
//                    en-route interval restoration
//   off              both switched off
//   terminal-off     terminal holding off only        (5-min hold only)
//   restoration-off  interval restoration off only    (5-min hold only)
// Switching regulation off never relaxes separation: the 30 m safety headway,
// no-passing lock and signal protection stay active, and every run is checked
// by the per-step safety oracle (any violation fails the script).
//
// Each disturbed run is compared with the undisturbed run of the same mode.
// Recovery time is measured from the start of the disturbance to the first
// moment after which, until the horizon, the 10-min rolling headway CV is
// within 0.10 of the undisturbed run's (headway spread within 10% of the mean
// headway; CV is already a ratio, and a regulated line runs at CV ≈ 0.001, so a
// band of 10% *of* the CV would be narrower than rounding) and the 10-min
// rolling on-time share is within 10% of the undisturbed run's. Re-sync time
// uses the stricter |ΔCV| ≤ 0.01: back on the undisturbed headway pattern.
// Writes outputs/automation/disturbance.csv and disturbance-series.json.
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  FIXED_STEP_SECONDS,
  SafetyOracle,
  createEngine,
  gitCommit,
  initializeCore,
  runPool,
  stepEngine,
  writeCsv,
} from "./lib/automation.mjs";

const OUTPUT_DIR = fileURLToPath(new URL("../outputs/automation/", import.meta.url));
const SCRIPT = fileURLToPath(import.meta.url);
const SCENARIO = "izmir-konak";
const STOP = "IZK-RO09"; // Konak İskele, towards Fahrettin Altay
// Evening peak (16:30–19:30, 4.6 min planned headway): the whole run stays in
// one timetable window, and the configured 14 trams are fewer than the window's
// target, so no surplus trams queue at the terminals (they do off-peak).
const START_MINUTE = 990;
const ONSET_SECONDS = 70 * 60;
const HORIZON_SECONDS = 105 * 60;
const SURGE_PASSENGERS = 250;
const ROLLING_SECONDS = 600;
const SAMPLE_SECONDS = 30;
const TOLERANCE = 0.1;
const MODES = {
  on: { terminalHolding: true, intervalRestoration: true },
  off: { terminalHolding: false, intervalRestoration: false },
  "terminal-off": { terminalHolding: false, intervalRestoration: true },
  "restoration-off": { terminalHolding: true, intervalRestoration: false },
};

const { values } = parseArgs({
  options: {
    run: { type: "boolean", default: false },
    case: { type: "string" },
    "hold-minutes": { type: "string", default: "0" },
    mode: { type: "string" },
    jobs: { type: "string" },
  },
});

async function runOne(kind, holdMinutes, mode) {
  await initializeCore();
  const started = Date.now();
  const engine = createEngine({ scenarioId: SCENARIO, startMinute: START_MINUTE, ...MODES[mode] });
  const oracle = new SafetyOracle(engine);
  const totalSteps = Math.round((ONSET_SECONDS + HORIZON_SECONDS) / FIXED_STEP_SECONDS);
  const pollEvery = Math.round(1 / FIXED_STEP_SECONDS);
  const sampleEvery = Math.round(SAMPLE_SECONDS / FIXED_STEP_SECONDS);
  let lastDepartures = engine.getLastStopDepartures();
  const departures = [];
  const samples = [];
  let disturbanceAt = null;
  let heldTramId = null;
  let plannedHeadwaySeconds = null;
  for (let step = 1; step <= totalSteps; step += 1) {
    stepEngine(engine);
    oracle.check();
    const now = engine.simulationTime;
    if (disturbanceAt === null && now >= ONSET_SECONDS) {
      plannedHeadwaySeconds ??= (engine.activeServiceWindow()?.routes?.[SCENARIO]?.plannedHeadwayMinutes ?? 0) * 60 || null;
      if (kind === "undisturbed") {
        disturbanceAt = ONSET_SECONDS;
      } else if (kind === "surge") {
        if (engine.injectPassengers(STOP, SURGE_PASSENGERS)) disturbanceAt = now;
      } else if (kind === "hold") {
        const tram = engine.trams.find((item) => item.stationPhase === "dwell" && item.pendingStationReaderId === STOP);
        if (tram && engine.holdTramAtStop(tram.id, holdMinutes * 60)) {
          disturbanceAt = now;
          heldTramId = tram.id;
        }
      }
    }
    if (step % pollEvery === 0) {
      const current = engine.getLastStopDepartures();
      for (const [key, time] of Object.entries(current)) {
        const previous = lastDepartures[key];
        if (previous !== undefined && time !== previous) departures.push({ key, time, headway: time - previous });
      }
      lastDepartures = current;
    }
    if (step % sampleEvery === 0) {
      const service = engine.getServiceSample();
      samples.push({
        time: now,
        onTime: service.onTimePercent,
        wait: service.averageWaitSeconds,
        leftBehind: engine.getPassengersLeftBehind(),
      });
    }
  }
  if (disturbanceAt === null) throw new Error(`${kind} ${holdMinutes} ${mode}: disturbance was never applied`);
  const safety = oracle.summary();
  return {
    kind, holdMinutes, mode, ...MODES[mode],
    disturbanceAt, heldTramId, plannedHeadwaySeconds,
    departures, samples,
    safety: { totalViolations: safety.totalViolations, violations: safety.violations, firstViolations: safety.firstViolations, minGapMeters: safety.minGapMeters },
    runtimeSeconds: (Date.now() - started) / 1000,
  };
}

if (values.run) {
  // Exit only after the (large) line has been flushed to the pipe.
  const line = JSON.stringify(await runOne(values.case, Number(values["hold-minutes"]), values.mode));
  await new Promise((resolve) => process.stdout.write(`${line}\n`, resolve));
  process.exit(0);
}

// --- Analysis -------------------------------------------------------------

/** 10-min rolling headway CV, mean absolute headway deviation and on-time share at each sample time. */
function rolling(run) {
  const planned = run.plannedHeadwaySeconds;
  return run.samples.map((sample) => {
    const window = run.departures.filter((item) => item.time > sample.time - ROLLING_SECONDS && item.time <= sample.time);
    const headways = window.map((item) => item.headway);
    const mean = headways.reduce((sum, value) => sum + value, 0) / Math.max(1, headways.length);
    const variance = headways.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, headways.length);
    const onTime = run.samples.filter((item) => item.time > sample.time - ROLLING_SECONDS && item.time <= sample.time);
    return {
      time: sample.time,
      cv: headways.length >= 2 && mean > 0 ? Math.sqrt(variance) / mean : null,
      deviation: planned && headways.length ? headways.reduce((sum, value) => sum + Math.abs(value - planned), 0) / headways.length : null,
      onTime: onTime.reduce((sum, item) => sum + item.onTime, 0) / Math.max(1, onTime.length),
      wait: sample.wait,
      leftBehind: sample.leftBehind,
    };
  });
}

/** Mean of a rolling metric over the post-onset period. */
function level(series, key, from) {
  const values = series.filter((item) => item.time >= from && item[key] !== null).map((item) => item[key]);
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/** Seconds from the disturbance until the run stays near the undisturbed one; null if it never does. */
function recoverySeconds(run, reference, cvBand) {
  const base = new Map(rolling(reference).map((item) => [item.time, item]));
  let recoveredFrom = null;
  for (const item of rolling(run)) {
    if (item.time < run.disturbanceAt) continue;
    const ref = base.get(item.time);
    const ok = ref && item.cv !== null && ref.cv !== null &&
      Math.abs(item.cv - ref.cv) <= cvBand &&
      Math.abs(item.onTime - ref.onTime) <= TOLERANCE * ref.onTime;
    if (ok && recoveredFrom === null) recoveredFrom = item.time;
    if (!ok) recoveredFrom = null;
  }
  return recoveredFrom === null ? null : Math.max(0, recoveredFrom - run.disturbanceAt);
}

function summarize(run, reference) {
  const after = run.departures.filter((item) => item.time >= run.disturbanceAt);
  const afterSamples = run.samples.filter((item) => item.time >= run.disturbanceAt);
  const refSamples = reference.samples.filter((item) => item.time >= run.disturbanceAt);
  const mean = (items, key) => items.reduce((sum, item) => sum + item[key], 0) / Math.max(1, items.length);
  const leftBehind = (items) => (items.length ? items.at(-1).leftBehind - items[0].leftBehind : 0);
  const recovery = run === reference ? 0 : recoverySeconds(run, reference, 0.1);
  const resync = run === reference ? 0 : recoverySeconds(run, reference, 0.01);
  return {
    case: run.kind,
    hold_min: run.holdMinutes || "",
    surge_passengers: run.kind === "surge" ? SURGE_PASSENGERS : "",
    mode: run.mode,
    terminal_holding: run.terminalHolding,
    interval_restoration: run.intervalRestoration,
    disturbance_at_s: run.disturbanceAt.toFixed(0),
    held_tram: run.heldTramId ?? "",
    planned_headway_s: run.plannedHeadwaySeconds ?? "",
    recovery_s: recovery === null ? "" : recovery.toFixed(0),
    headway_cv_mean: level(rolling(run), "cv", run.disturbanceAt).toFixed(3),
    headway_deviation_mean_s: level(rolling(run), "deviation", run.disturbanceAt).toFixed(0),
    recovered: recovery !== null,
    resync_s: resync === null ? "" : resync.toFixed(0),
    max_gap_s: after.length ? Math.max(...after.map((item) => item.headway)).toFixed(0) : "",
    min_headway_s: after.length ? Math.min(...after.map((item) => item.headway)).toFixed(0) : "",
    mean_wait_s: mean(afterSamples, "wait").toFixed(1),
    mean_wait_change_s: (mean(afterSamples, "wait") - mean(refSamples, "wait")).toFixed(1),
    max_wait_s: afterSamples.length ? Math.max(...afterSamples.map((item) => item.wait)).toFixed(1) : "",
    on_time_pct: mean(afterSamples, "onTime").toFixed(1),
    left_behind: leftBehind(afterSamples),
    left_behind_change: leftBehind(afterSamples) - leftBehind(refSamples),
    safety_violations: run.safety.totalViolations,
    min_gap_m: run.safety.minGapMeters?.toFixed(2) ?? "",
    core_runtime: "cpp-wasm",
    git_commit: COMMIT,
  };
}

// Record the commit before any child runs, so later edits to tracked files
// (docs, plots) during a long run cannot mark the results dirty.
const COMMIT = gitCommit();
const plan = [
  ...Object.keys(MODES).map((mode) => ({ kind: "undisturbed", holdMinutes: 0, mode })),
  ...[2, 5, 10].flatMap((holdMinutes) => ["on", "off"].map((mode) => ({ kind: "hold", holdMinutes, mode }))),
  ...["terminal-off", "restoration-off"].map((mode) => ({ kind: "hold", holdMinutes: 5, mode })),
  ...["on", "off"].map((mode) => ({ kind: "surge", holdMinutes: 0, mode })),
];
const jobs = plan.map((item) => ({ ...item, args: ["--run", "--case", item.kind, "--hold-minutes", String(item.holdMinutes), "--mode", item.mode] }));
const concurrency = Number(values.jobs ?? Math.max(1, availableParallelism() - 1));
const label = (item) => `${item.kind}${item.holdMinutes ? ` ${item.holdMinutes} min` : ""} · ${item.mode}`;
console.log(`${jobs.length} İzmir runs (${(ONSET_SECONDS + HORIZON_SECONDS) / 60} min each) on ${concurrency} worker(s).`);
const runs = await runPool(SCRIPT, jobs, concurrency, label);

const reference = (mode) => runs.find((run) => run.kind === "undisturbed" && run.mode === mode);
const rows = runs.map((run) => summarize(run, reference(run.mode)));
await writeCsv(`${OUTPUT_DIR}disturbance.csv`, Object.keys(rows[0]), rows);
const series = runs.map((run) => ({
  kind: run.kind, holdMinutes: run.holdMinutes, mode: run.mode,
  disturbanceAt: run.disturbanceAt, plannedHeadwaySeconds: run.plannedHeadwaySeconds,
  // Rounded for the committed file only; the analysis above uses full precision.
  rolling: rolling(run).map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) =>
    [key, typeof value === "number" ? Number(value.toFixed(key === "cv" ? 4 : 1)) : value]))),
}));
await writeFile(`${OUTPUT_DIR}disturbance-series.json`, `${JSON.stringify({ gitCommit: COMMIT, node: process.version, scenario: SCENARIO, stop: STOP, startMinute: START_MINUTE, onsetSeconds: ONSET_SECONDS, horizonSeconds: HORIZON_SECONDS, rollingSeconds: ROLLING_SECONDS, tolerance: TOLERANCE, series })}\n`, "utf8");

console.log(`\nWrote ${OUTPUT_DIR}disturbance.csv and disturbance-series.json`);
for (const row of rows) {
  console.log(`${row.case} ${row.hold_min || row.surge_passengers || ""} ${row.mode}: recovery ${row.recovered ? `${row.recovery_s} s` : "not within horizon"}, max gap ${row.max_gap_s} s, min headway ${row.min_headway_s} s, wait ${row.mean_wait_s} s (${row.mean_wait_change_s}), on-time ${row.on_time_pct}%, violations ${row.safety_violations}`);
}
const violations = rows.reduce((sum, row) => sum + row.safety_violations, 0);
if (violations > 0) {
  console.error(`\n${violations} safety violations`);
  process.exit(1);
}
