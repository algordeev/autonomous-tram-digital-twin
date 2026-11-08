// Safety stress test: long headless sessions on İzmir and Nizhny Novgorod
// Routes 2 + 21 with randomized, seeded detector and switch faults, checked by
// an independent oracle on every 50 ms step (scripts/lib/automation.mjs).
//
//   npm run automation:safety                   # 8 seeds × 4 h per network
//   npm run automation:safety -- --seeds 3 --hours 1
//   npm run automation:safety -- --ablation     # each fault type alone, 3 seeds
//
// Faults (exponential inter-arrival, mean --mean-interval seconds):
//   dropped-detector      every entry and clear observation of one signal is
//                         lost for 5–60 s
//   duplicate-entry       the next entry observation of one signal is sent
//                         twice, and the owner's entry is re-sent 1–20 s later
//   wrong-tram-clear      a clear observation for an occupied crossing arrives
//                         with another tram's identity
//   missing-rear-clear    clear observations of one signal are lost for
//                         30–120 s (longer than the 25 s clearance timeout)
//   foreign-switch-request  a switch reader reports a tram that is not there,
//                         or an operator requests the points (Nizhny only)
// Seed 0 is the fault-free reference run. Detector faults are injected where
// the browser layer hands observations to the C++ core (observeTraffic), so
// the core and the TypeScript mirror see exactly what a faulty detector sends.
// Writes outputs/automation/safety-stress.csv and .json; exits 1 on any violation.
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
  seededRandom,
  stepEngine,
  writeCsv,
} from "./lib/automation.mjs";

const OUTPUT_DIR = fileURLToPath(new URL("../outputs/automation/", import.meta.url));
const SCRIPT = fileURLToPath(import.meta.url);
const { values } = parseArgs({
  options: {
    run: { type: "boolean", default: false },
    scenario: { type: "string" },
    seed: { type: "string" },
    seeds: { type: "string", default: "8" },
    hours: { type: "string", default: "4" },
    "mean-interval": { type: "string", default: "60" },
    "start-minute": { type: "string", default: "420" },
    "warmup-minutes": { type: "string", default: "10" },
    networks: { type: "string", default: "izmir-konak,nizhny-routes-2-21" },
    jobs: { type: "string" },
    trace: { type: "boolean", default: false },
    types: { type: "string" },
    ablation: { type: "boolean", default: false },
  },
});
const hours = Number(values.hours);
const meanInterval = Number(values["mean-interval"]);
const startMinute = Number(values["start-minute"]);
const warmupSeconds = Number(values["warmup-minutes"]) * 60;

const FAULT_TYPES = ["dropped-detector", "duplicate-entry", "wrong-tram-clear", "missing-rear-clear", "foreign-switch-request"];

class FaultInjector {
  constructor(engine, random, startAt, types = FAULT_TYPES) {
    this.engine = engine;
    this.random = random;
    this.types = types.filter((type) => type !== "foreign-switch-request" || engine.scenario.switches.length > 0);
    this.signals = engine.scenario.signals.filter((signal) => engine.trafficControllers.has(signal.controllerId ?? signal.id));
    this.switchReaders = engine.scenario.readers.filter((reader) => reader.kind === "switch");
    this.counts = Object.fromEntries(FAULT_TYPES.map((type) => [type, 0]));
    this.outages = new Map();
    this.duplicateArmed = new Set();
    this.resends = [];
    this.nextAt = startAt + this.exponential();
    const original = engine.observeTraffic.bind(engine);
    this.observe = original;
    engine.observeTraffic = (controller, tram, signalId, cleared, detectedAt) => {
      const outage = this.outages.get(signalId);
      if (outage && engine.simulationTime < outage.until && (cleared || !outage.clearsOnly)) return;
      original(controller, tram, signalId, cleared, detectedAt);
      if (!cleared && this.duplicateArmed.has(signalId)) {
        this.duplicateArmed.delete(signalId);
        original(controller, tram, signalId, false, detectedAt);
      }
    };
  }

  exponential() {
    return -Math.log(1 - this.random()) * meanInterval;
  }

  pick(items) {
    return items[Math.floor(this.random() * items.length)];
  }

  uniform(min, max) {
    return min + this.random() * (max - min);
  }

  controllerOf(signal) {
    return this.engine.trafficControllers.get(signal.controllerId ?? signal.id);
  }

  /** A signal whose crossing currently has an entered owner, when one exists. */
  occupiedSignal() {
    const occupied = this.signals.filter((signal) => {
      const controller = this.controllerOf(signal);
      return controller.activeTramEntered && controller.activeSignalId === signal.id;
    });
    return occupied.length > 0 ? this.pick(occupied) : null;
  }

  tick() {
    const engine = this.engine;
    const now = engine.simulationTime;
    for (let index = this.resends.length - 1; index >= 0; index -= 1) {
      const resend = this.resends[index];
      if (now < resend.at) continue;
      this.resends.splice(index, 1);
      const controller = this.controllerOf(resend.signal);
      const owner = engine.trams.find((tram) => tram.id === controller.activeTramId);
      if (owner && controller.activeSignalId === resend.signal.id && controller.activeTramEntered) {
        this.observe(controller, owner, resend.signal.id, false);
      }
    }
    if (now < this.nextAt) return;
    this.nextAt = now + this.exponential();
    const type = this.pick(this.types);
    this.counts[type] += 1;
    this.lastType = type;
    if (type === "dropped-detector") {
      this.outages.set(this.pick(this.signals).id, { until: now + this.uniform(5, 60), clearsOnly: false });
    } else if (type === "missing-rear-clear") {
      const signal = this.occupiedSignal() ?? this.pick(this.signals);
      this.outages.set(signal.id, { until: now + this.uniform(30, 120), clearsOnly: true });
    } else if (type === "duplicate-entry") {
      const signal = this.occupiedSignal() ?? this.pick(this.signals);
      this.duplicateArmed.add(signal.id);
      this.resends.push({ signal, at: now });
      this.resends.push({ signal, at: now + this.uniform(1, 20) });
    } else if (type === "wrong-tram-clear") {
      const signal = this.occupiedSignal() ?? this.pick(this.signals);
      const controller = this.controllerOf(signal);
      const others = engine.trams.filter((tram) => tram.id !== controller.activeTramId);
      if (others.length > 0) this.observe(controller, this.pick(others), signal.id, true);
    } else if (type === "foreign-switch-request") {
      const reader = this.pick(this.switchReaders);
      if (this.random() < 0.5) {
        engine.handleReader(this.pick(engine.trams), reader);
      } else {
        engine.toggleSwitch(reader.switchId);
      }
    }
    if (values.trace) console.error(`${now.toFixed(0)} s fault ${type}`);
  }
}

async function runOne(scenarioId, seed, types) {
  await initializeCore();
  const started = Date.now();
  const engine = createEngine({ scenarioId, startMinute });
  const oracle = new SafetyOracle(engine);
  const injector = seed > 0 ? new FaultInjector(engine, seededRandom(seed), warmupSeconds, types) : null;
  const events = { clearanceTimeout: 0, unexpectedEntry: 0, staleGrant: 0, switchQueued: 0 };
  const addEvent = engine.addEvent.bind(engine);
  engine.addEvent = (tone, message) => {
    if (/clearance detector timeout/.test(message)) events.clearanceTimeout += 1;
    else if (/unexpected entry/.test(message)) events.unexpectedEntry += 1;
    else if (/stale tram grant/.test(message)) events.staleGrant += 1;
    else if (/queued for/.test(message)) events.switchQueued += 1;
    return addEvent(tone, message);
  };
  const totalSteps = Math.round((hours * 3600) / FIXED_STEP_SECONDS);
  const warmupSteps = Math.round(warmupSeconds / FIXED_STEP_SECONDS);
  const sampleEvery = Math.round(60 / FIXED_STEP_SECONDS);
  let distanceAtStart = 0;
  const onTime = [];
  for (let step = 1; step <= totalSteps; step += 1) {
    stepEngine(engine);
    oracle.check();
    injector?.tick();
    if (step === warmupSteps) distanceAtStart = engine.trams.reduce((sum, tram) => sum + tram.distanceMeters, 0);
    if (step > warmupSteps && step % sampleEvery === 0) onTime.push(engine.getServiceSample().onTimePercent);
    if (values.trace && step % (sampleEvery * 5) === 0) {
      for (const tram of engine.trams) {
        tram.traceStillSince = tram.speedMps > 0.1 ? null : tram.traceStillSince ?? engine.simulationTime;
      }
      const stuck = engine.trams.filter((tram) => tram.serviceState === "in-service" && tram.traceStillSince !== null &&
        engine.simulationTime - tram.traceStillSince >= 120);
      if (stuck.length > 0) {
        console.error(`${engine.simulationTime.toFixed(0)} s stuck: ${stuck.map((tram) => `${tram.id}@${tram.segmentId} "${tram.status}"`).join("; ")}`);
        for (const controller of engine.trafficControllers.values()) {
          if (controller.phase === "road-green" && controller.queue.length === 0 && !controller.activeTramId) continue;
          console.error(`   ${controller.id}: phase ${controller.phase} until ${controller.phaseUntil.toFixed(0)} active ${controller.activeTramId}/${controller.activeSignalId} entered ${controller.activeTramEntered} cleared ${controller.activeTramCleared} queue ${controller.queue.map((request) => `${request.tramId}@${request.signalId}`).join(",")} manual ${controller.manualMode}`);
        }
      }
    }
  }
  const distanceKm = (engine.trams.reduce((sum, tram) => sum + tram.distanceMeters, 0) - distanceAtStart) / 1000;
  return {
    scenario: scenarioId,
    seed,
    hours,
    trams: engine.trams.length,
    faults: injector ? injector.counts : Object.fromEntries(FAULT_TYPES.map((type) => [type, 0])),
    events,
    oracle: oracle.summary(),
    vehicleKm: distanceKm,
    onTimePercentMean: onTime.reduce((sum, value) => sum + value, 0) / Math.max(1, onTime.length),
    runtimeSeconds: (Date.now() - started) / 1000,
  };
}

if (values.run) {
  const types = values.types ? values.types.split(",") : FAULT_TYPES;
  const unknown = types.filter((type) => !FAULT_TYPES.includes(type));
  if (unknown.length > 0) throw new Error(`unknown fault types: ${unknown.join(", ")}`);
  const result = await runOne(values.scenario, Number(values.seed), types);
  result.faultTypes = types;
  await new Promise((resolve) => process.stdout.write(`${JSON.stringify(result)}\n`, resolve));
  process.exit(0);
}

// Record the commit before any child runs, so later edits to tracked files
// (docs, plots) during a long run cannot mark the results dirty.
const COMMIT = gitCommit();
const networks = values.networks.split(",");
const ablation = values.ablation;
const seedCount = ablation ? Math.min(3, Number(values.seeds)) : Number(values.seeds);
const seeds = ablation
  ? Array.from({ length: seedCount }, (_, index) => index + 1)
  : [0, ...Array.from({ length: seedCount }, (_, index) => index + 1)];
const typeSets = ablation ? FAULT_TYPES.map((type) => [type]) : [values.types ? values.types.split(",") : FAULT_TYPES];
const jobs = networks.flatMap((scenario) => typeSets
  .filter((types) => !(types.length === 1 && types[0] === "foreign-switch-request" && scenario === "izmir-konak"))
  .flatMap((types) => seeds.map((seed) => ({
    scenario, seed, types,
    args: ["--run", "--scenario", scenario, "--seed", String(seed), "--hours", String(hours),
      "--mean-interval", String(meanInterval), "--start-minute", String(startMinute),
      "--warmup-minutes", String(values["warmup-minutes"]), "--types", types.join(",")],
  }))));
// Longest runs first so the pool finishes evenly.
jobs.sort((a, b) => (a.scenario === "izmir-konak" ? 0 : 1) - (b.scenario === "izmir-konak" ? 0 : 1));
const concurrency = Number(values.jobs ?? Math.max(1, availableParallelism() - 1));
console.log(`${jobs.length} sessions × ${hours} h (${networks.join(", ")}; seeds 0–${seedCount}, 0 = fault-free) on ${concurrency} worker(s).`);
const results = await runPool(SCRIPT, jobs, concurrency, (job) => `${job.scenario} seed ${job.seed}${ablation ? ` ${job.types[0]}` : ""}`);
results.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.faultTypes.join().localeCompare(b.faultTypes.join()) || a.seed - b.seed);

const rows = results.map((result) => ({
  scenario: result.scenario,
  fault_types: result.seed === 0 ? "none" : result.faultTypes.length === FAULT_TYPES.length ? "all" : result.faultTypes.join(" "),
  seed: result.seed,
  hours: result.hours,
  trams: result.trams,
  ...Object.fromEntries(FAULT_TYPES.map((type) => [`faults_${type.replace(/-/g, "_")}`, result.faults[type]])),
  faults_total: Object.values(result.faults).reduce((sum, value) => sum + value, 0),
  ...Object.fromEntries(Object.entries(result.oracle.violations).map(([kind, count]) => [`violations_${kind}`, count])),
  violations_total: result.oracle.totalViolations,
  min_gap_m: result.oracle.minGapMeters === null ? "" : result.oracle.minGapMeters.toFixed(2),
  all_red_latches: result.oracle.allRedLatches,
  clearance_timeouts: result.events.clearanceTimeout,
  unexpected_entries: result.events.unexpectedEntry,
  stale_grants: result.events.staleGrant,
  unrecovered_latches: result.oracle.unrecoveredLatches,
  recovery_median_s: result.oracle.recoveryMedianSeconds?.toFixed(1) ?? "",
  recovery_max_s: result.oracle.recoveryMaxSeconds?.toFixed(1) ?? "",
  max_standstill_s: result.oracle.maxStandstillSeconds.toFixed(1),
  max_junction_blocked_s: result.oracle.maxJunctionBlockedSeconds.toFixed(0),
  junctions_blocked_at_end: result.oracle.junctionsBlockedAtEnd.join(" "),
  max_switch_blocked_s: result.oracle.maxSwitchBlockedSeconds.toFixed(0),
  switches_blocked_at_end: result.oracle.switchesBlockedAtEnd.join(" "),
  vehicle_km: result.vehicleKm.toFixed(1),
  on_time_pct: result.onTimePercentMean.toFixed(1),
  core_runtime: "cpp-wasm",
  git_commit: COMMIT,
}));
const columns = Object.keys(rows[0]);
const stem = ablation ? "safety-stress-ablation" : "safety-stress";
await writeCsv(`${OUTPUT_DIR}${stem}.csv`, columns, rows);
await writeFile(`${OUTPUT_DIR}${stem}.json`, `${JSON.stringify({ gitCommit: COMMIT, node: process.version, hours, meanInterval, startMinute, warmupSeconds, results }, null, 2)}\n`, "utf8");

const totalViolations = results.reduce((sum, result) => sum + result.oracle.totalViolations, 0);
console.log(`\nWrote ${OUTPUT_DIR}${stem}.csv and .json`);
for (const result of results) {
  console.log(`${result.scenario} seed ${result.seed}${ablation ? ` [${result.faultTypes[0]}]` : ""}: faults ${Object.values(result.faults).reduce((s, v) => s + v, 0)}, violations ${result.oracle.totalViolations}, latches ${result.oracle.allRedLatches} (unrecovered ${result.oracle.unrecoveredLatches}), longest junction block ${result.oracle.maxJunctionBlockedSeconds.toFixed(0)} s${result.oracle.junctionsBlockedAtEnd.length ? ` (still blocked: ${result.oracle.junctionsBlockedAtEnd.join(", ")})` : ""}, ${result.vehicleKm.toFixed(0)} vehicle-km`);
  for (const violation of result.oracle.firstViolations.slice(0, 3)) console.log(`   ${violation.kind} at ${violation.time.toFixed(1)} s: ${violation.detail}`);
}
if (totalViolations > 0) {
  console.error(`\n${totalViolations} safety violations`);
  process.exit(1);
}
console.log("\n0 safety violations.");
