// Shared tooling for the automation results: core loading, a seeded random
// generator, engine set-up, an independent per-step safety oracle, CSV output
// and a small child-process pool. Shared by run-safety-stress.mjs and
// run-disturbance.mjs. Nothing here changes control, safety or physics logic;
// the oracle only reads engine state.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SimulationEngine } from "../../src/simulation-core/index.ts";
import { gitCommit, initializeCore } from "./energy-case.mjs";

export { gitCommit, initializeCore };

export const FIXED_STEP_SECONDS = 0.05;
export const TRAM_LENGTH_METERS = 15;
/** Front-to-front spacing the engine enforces as the physical minimum (15 m body + 7 m gap). */
export const MIN_FRONT_SEPARATION_METERS = 22;

/** Deterministic generator (mulberry32); the seed is reported with every result. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Engine on the network's configured fleet, reactive flywheels, service clock set. */
export function createEngine({ scenarioId, startMinute, terminalHolding = true, intervalRestoration = true }) {
  const engine = new SimulationEngine(scenarioId);
  engine.setEnergyStrategy("baseline");
  engine.setServiceClockMinutes(startMinute);
  if (!terminalHolding) engine.setTerminalHolding(false);
  if (!intervalRestoration) engine.setIntervalRestoration(false);
  engine.setRunning(true);
  return engine;
}

/** One fixed control step, exactly as the engine's own clock calls it. */
export const stepEngine = (engine) => engine.stepFixed(FIXED_STEP_SECONDS);

const ON_LINE = new Set(["in-service", "to-depot"]);
// Physical service-brake limit (control_parameters.hpp, kServiceDecelerationMps2).
const SERVICE_DECELERATION_MPS2 = 1.25;

/**
 * Independent invariant checks on every step, from engine geometry rather than
 * from the controllers' own bookkeeping:
 *  - collision: a tram's front inside the body of the tram ahead on the same track;
 *  - separation: front-to-front spacing below the 22 m physical minimum;
 *  - overtaking: two trams on one directed segment swap order;
 *  - conflict zone: more than one tram body inside a junction conflict zone;
 *  - crossing: a tram body inside a crossing while road traffic has green or amber;
 *  - exposed reservation: an entered, uncleared tram grant under a non-tram phase;
 *  - points moved while locked: a turnout changed position while its lock owner
 *    had not released it (passed the points with its rear, left the line, or,
 *    before reaching them, could still stop short with the service brake), or
 *    while a tram body straddled the turnout node.
 * All-red latches are counted with their duration (time to recover).
 */
export class SafetyOracle {
  constructor(engine) {
    this.engine = engine;
    this.segments = engine.segments;
    this.outgoing = new Map();
    for (const segment of this.segments.values()) {
      if (!this.outgoing.has(segment.from)) this.outgoing.set(segment.from, []);
      this.outgoing.get(segment.from).push(segment);
    }
    this.signals = engine.scenario.signals.map((signal) => ({
      ...signal,
      controller: engine.trafficControllers.get(signal.controllerId ?? signal.id) ?? null,
    })).filter((signal) => signal.controller);
    this.zones = engine.scenario.junctionConflictZones ?? [];
    this.switches = engine.scenario.switches.map((definition) => ({
      definition,
      runtime: engine.switchStates.get(definition.id),
    })).filter((item) => item.runtime);
    this.counts = {
      collision: 0, separation: 0, overtaking: 0, conflictZone: 0,
      crossing: 0, exposedReservation: 0, pointsMovedWhileLocked: 0,
    };
    this.firstViolations = [];
    this.minGapMeters = Infinity;
    this.allRedLatches = 0;
    this.recoverySeconds = [];
    this.faultSince = new Map();
    this.previousOrder = new Map();
    this.previousSwitch = new Map(this.switches.map(({ definition, runtime }) => [definition.id, this.switchSnapshot(runtime)]));
    this.standstillSince = null;
    this.maxStandstillSeconds = 0;
    // Liveness: a junction is blocked while trams queue at it and its phase does
    // not change. A block starts at the later of the last phase change and the
    // moment the queue became non-empty, so an idle junction that a tram then
    // reaches does not count its idle time as blocked.
    this.lastPhase = new Map([...engine.trafficControllers.values()].map((controller) => [controller.id, { phase: controller.phase, since: 0 }]));
    this.maxBlockedSeconds = 0;
    this.blockedJunctions = new Map();
    this.queuedSince = new Map();
    // Liveness: points are blocked while trams queue for them and the lock owner
    // does not change; likewise counted from the later of the two.
    this.lockSince = new Map(this.switches.map(({ definition, runtime }) => [definition.id, { lockedBy: runtime.lockedBy, since: 0 }]));
    this.maxSwitchBlockedSeconds = 0;
    this.blockedSwitches = new Set();
  }

  /** Whether the tram can still stop before the switch node on its route. */
  canStopBeforePoints(tram, definition) {
    if (tram.branchOrigin?.switchId === definition.id) return false;
    let distance = null;
    for (const segment of this.segments.values()) {
      if (segment.to !== definition.nodeId) continue;
      const ahead = this.engine.forwardDistanceToPosition(tram, segment.id, 1);
      if (ahead !== null && ahead >= 0 && (distance === null || ahead < distance)) distance = ahead;
    }
    if (distance === null) return true; // The points are not ahead on its route.
    return distance >= tram.speedMps ** 2 / (2 * SERVICE_DECELERATION_MPS2) + 1;
  }

  /** When the queue `key` became non-empty (recorded on first sight). */
  queueStart(key, now) {
    if (!this.queuedSince.has(key)) this.queuedSince.set(key, now);
    return this.queuedSince.get(key);
  }

  /** Marks the queue `key` empty; a blocked time of 0. */
  queueEnd(key) {
    this.queuedSince.delete(key);
    return 0;
  }

  switchSnapshot(runtime) {
    const owner = runtime.lockedBy ? this.engine.trams.find((tram) => tram.id === runtime.lockedBy) : null;
    return { state: runtime.state, lockedBy: runtime.lockedBy, releaseAt: runtime.releaseAtDistance, owner };
  }

  violation(kind, detail) {
    this.counts[kind] += 1;
    if (this.firstViolations.length < 20) {
      this.firstViolations.push({ kind, time: this.engine.simulationTime, detail });
    }
  }

  onLineTrams() {
    return this.engine.trams.filter((tram) => ON_LINE.has(tram.serviceState));
  }

  /** Distance from `tram`'s front to the nearest tram front ahead along the track (≤ 60 m search). */
  gapAhead(tram, bySegment) {
    const segment = this.segments.get(tram.segmentId);
    if (!segment) return null;
    let best = null;
    for (const other of bySegment.get(tram.segmentId) ?? []) {
      if (other === tram || other.progress <= tram.progress) continue;
      if (this.sideBySideBerths(tram, other)) continue;
      const gap = (other.progress - tram.progress) * segment.lengthMeters;
      if (best === null || gap < best.gap) best = { gap, other };
    }
    if (best) return best;
    // Walk forward over following segments; a segment leading straight back to
    // where this one started is the opposite track at a terminus, not the way ahead.
    const frontier = [{ node: segment.to, from: segment.from, travelled: (1 - tram.progress) * segment.lengthMeters, depth: 0 }];
    while (frontier.length > 0) {
      const { node, from, travelled, depth } = frontier.shift();
      if (travelled > 60 || depth > 4) continue;
      for (const next of this.outgoing.get(node) ?? []) {
        if (next.to === from) continue;
        for (const other of bySegment.get(next.id) ?? []) {
          if (other === tram) continue;
          const gap = travelled + other.progress * next.lengthMeters;
          if (best === null || gap < best.gap) best = { gap, other };
        }
        frontier.push({ node: next.to, from: next.from, travelled: travelled + next.lengthMeters, depth: depth + 1 });
      }
    }
    return best;
  }

  /** İzmir terminals have two berths on one track model; side-by-side trams there are not in line. */
  sideBySideBerths(a, b) {
    const berth = (tram) => tram.terminalBerth || tram.terminalDeparture?.berth || 0;
    return berth(a) > 0 && berth(b) > 0 && berth(a) !== berth(b);
  }

  /** Extent of the tram body on `segmentId` as [rear, front] progress, or null. */
  bodyOn(tram, segmentId) {
    const segment = this.segments.get(segmentId);
    if (!segment) return null;
    if (tram.segmentId === segmentId) {
      return [tram.progress - TRAM_LENGTH_METERS / segment.lengthMeters, tram.progress];
    }
    if (!this.engine.bodySegmentIds(tram).includes(segmentId)) return null;
    const current = this.segments.get(tram.segmentId);
    const intoCurrent = tram.progress * (current?.lengthMeters ?? 0);
    return [1 - Math.max(0, TRAM_LENGTH_METERS - intoCurrent) / segment.lengthMeters, 1];
  }

  check() {
    const engine = this.engine;
    const now = engine.simulationTime;
    const trams = this.onLineTrams();
    const bySegment = new Map();
    for (const tram of trams) {
      if (!bySegment.has(tram.segmentId)) bySegment.set(tram.segmentId, []);
      bySegment.get(tram.segmentId).push(tram);
    }

    // Collision, separation, overtaking.
    for (const tram of trams) {
      const ahead = this.gapAhead(tram, bySegment);
      if (!ahead) continue;
      this.minGapMeters = Math.min(this.minGapMeters, ahead.gap);
      if (ahead.gap < TRAM_LENGTH_METERS) {
        this.violation("collision", `${tram.id} front ${ahead.gap.toFixed(2)} m behind ${ahead.other.id} front`);
      } else if (ahead.gap < MIN_FRONT_SEPARATION_METERS - 0.5) {
        this.violation("separation", `${tram.id} ${ahead.gap.toFixed(2)} m behind ${ahead.other.id}`);
      }
    }
    const order = new Map();
    for (const [segmentId, group] of bySegment) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const [a, b] = group[i].id < group[j].id ? [group[i], group[j]] : [group[j], group[i]];
          if (this.sideBySideBerths(a, b)) continue;
          const key = `${segmentId}|${a.id}|${b.id}`;
          const sign = Math.sign(a.progress - b.progress);
          const previous = this.previousOrder.get(key);
          if (previous !== undefined && sign !== 0 && previous !== 0 && sign !== previous) {
            this.violation("overtaking", `${a.id} and ${b.id} swapped order on ${segmentId}`);
          }
          order.set(key, sign);
        }
      }
    }
    this.previousOrder = order;

    // Junction conflict zones.
    for (const zone of this.zones) {
      const occupants = trams.filter((tram) =>
        engine.bodySegmentIds(tram).some((segmentId) => zone.segmentIds.includes(segmentId)));
      if (occupants.length > 1) this.violation("conflictZone", `${zone.id}: ${occupants.map((tram) => tram.id).join(", ")}`);
    }

    // Crossings and reservations.
    for (const signal of this.signals) {
      const controller = signal.controller;
      if (controller.phase === "road-green" || controller.phase === "amber-to-tram") {
        const clearAt = signal.clearAt ?? Math.min(0.98, signal.at + 0.18);
        for (const tram of trams) {
          const body = this.bodyOn(tram, signal.segmentId);
          if (body && body[1] > signal.at && body[0] < clearAt) {
            this.violation("crossing", `${tram.id} inside ${signal.id} during ${controller.phase}`);
          }
        }
      }
    }
    for (const controller of engine.trafficControllers.values()) {
      if (controller.activeTramEntered && !controller.activeTramCleared &&
          controller.phase !== "tram-green" && controller.phase !== "fault") {
        this.violation("exposedReservation", `${controller.id}: entered grant under ${controller.phase}`);
      }
      const last = this.lastPhase.get(controller.id);
      if (last.phase !== controller.phase) this.lastPhase.set(controller.id, { phase: controller.phase, since: now });
      const blockedFor = controller.queue.length > 0
        ? now - Math.max(this.lastPhase.get(controller.id).since, this.queueStart(`junction:${controller.id}`, now))
        : this.queueEnd(`junction:${controller.id}`);
      if (blockedFor > this.maxBlockedSeconds) this.maxBlockedSeconds = blockedFor;
      if (blockedFor >= 600) this.blockedJunctions.set(controller.id, blockedFor);
      else this.blockedJunctions.delete(controller.id);
      const inFault = controller.phase === "fault";
      if (inFault && !this.faultSince.has(controller.id)) {
        this.faultSince.set(controller.id, now);
        this.allRedLatches += 1;
      } else if (!inFault && this.faultSince.has(controller.id)) {
        this.recoverySeconds.push(now - this.faultSince.get(controller.id));
        this.faultSince.delete(controller.id);
      }
    }

    // Turnouts.
    for (const { definition, runtime } of this.switches) {
      const previous = this.previousSwitch.get(definition.id);
      if (runtime.state !== previous.state) {
        if (previous.lockedBy) {
          const owner = previous.owner;
          // An approach lock may also lapse while its owner, which has not
          // reached the points, can still stop before them with the service
          // brake: it then needs the lock again to pass.
          const released = !owner || !ON_LINE.has(owner.serviceState) ||
            (previous.releaseAt !== undefined && owner.distanceMeters >= previous.releaseAt) ||
            (previous.releaseAt === undefined && this.canStopBeforePoints(owner, definition));
          if (!released) this.violation("pointsMovedWhileLocked", `${definition.id} moved while locked by ${previous.lockedBy}`);
        }
        for (const tram of trams) {
          const segment = this.segments.get(tram.segmentId);
          if (segment?.from === definition.nodeId && tram.progress * segment.lengthMeters < TRAM_LENGTH_METERS) {
            this.violation("pointsMovedWhileLocked", `${definition.id} moved under ${tram.id}`);
          }
        }
      }
      this.previousSwitch.set(definition.id, this.switchSnapshot(runtime));
      const lock = this.lockSince.get(definition.id);
      if (lock.lockedBy !== runtime.lockedBy) this.lockSince.set(definition.id, { lockedBy: runtime.lockedBy, since: now });
      const switchKey = `switch:${definition.id}`;
      const switchQueuedSince = runtime.queue.length > 0 ? this.queueStart(switchKey, now) : this.queueEnd(switchKey);
      const switchBlockedFor = runtime.queue.length > 0 && runtime.lockedBy
        ? now - Math.max(this.lockSince.get(definition.id).since, switchQueuedSince)
        : 0;
      this.maxSwitchBlockedSeconds = Math.max(this.maxSwitchBlockedSeconds, switchBlockedFor);
      if (switchBlockedFor >= 600) this.blockedSwitches.add(definition.id);
      else this.blockedSwitches.delete(definition.id);
    }

    // Network standstill (liveness, not safety).
    const moving = trams.some((tram) => tram.speedMps > 0.1);
    if (trams.length > 0 && !moving) {
      this.standstillSince ??= now;
      this.maxStandstillSeconds = Math.max(this.maxStandstillSeconds, now - this.standstillSince);
    } else {
      this.standstillSince = null;
    }
  }

  totalViolations() {
    return Object.values(this.counts).reduce((sum, value) => sum + value, 0);
  }

  summary() {
    const recovered = [...this.recoverySeconds].sort((a, b) => a - b);
    const quantile = (q) => (recovered.length ? recovered[Math.min(recovered.length - 1, Math.floor(q * recovered.length))] : null);
    return {
      violations: { ...this.counts },
      totalViolations: this.totalViolations(),
      firstViolations: this.firstViolations,
      minGapMeters: Number.isFinite(this.minGapMeters) ? this.minGapMeters : null,
      allRedLatches: this.allRedLatches,
      recoveredLatches: recovered.length,
      unrecoveredLatches: this.faultSince.size,
      recoveryMedianSeconds: quantile(0.5),
      recoveryMaxSeconds: recovered.length ? recovered.at(-1) : null,
      maxStandstillSeconds: this.maxStandstillSeconds,
      maxJunctionBlockedSeconds: this.maxBlockedSeconds,
      junctionsBlockedAtEnd: [...this.blockedJunctions.keys()],
      maxSwitchBlockedSeconds: this.maxSwitchBlockedSeconds,
      switchesBlockedAtEnd: [...this.blockedSwitches],
    };
  }
}

export async function writeCsv(path, columns, rows) {
  await mkdir(dirname(path), { recursive: true });
  const cell = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const text = [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\n");
  await writeFile(path, `${text}\n`, "utf8");
}

/** Runs `node script ...args` per job on a pool; each child prints one JSON line last. */
export async function runPool(script, jobs, concurrency, label) {
  const results = new Array(jobs.length);
  let next = 0;
  let finished = 0;
  const started = Date.now();
  const runOne = (index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...jobs[index].args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label(jobs[index])} failed (exit ${code}):\n${stderr}`));
        return;
      }
      results[index] = JSON.parse(stdout.trim().split("\n").at(-1));
      finished += 1;
      const elapsed = (Date.now() - started) / 1000;
      const eta = (elapsed / finished) * (jobs.length - finished);
      console.log(`[${finished}/${jobs.length}] ${label(jobs[index])} · elapsed ${Math.round(elapsed)}s · ETA ${Math.round(eta)}s`);
      resolve();
    });
  });
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) await runOne(next++);
  });
  await Promise.all(workers);
  return results;
}
