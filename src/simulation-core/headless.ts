import {
  SimulationEngine,
  type EnergyStatisticsSnapshot,
  type RouteOperationsSnapshot,
  type SimulationMetrics,
  type SimulationSnapshot,
} from "./engine.ts";
import { isCppRuntimeReady } from "./cpp-runtime.ts";

export interface HeadlessSimulationOptions {
  scenarioId?: string;
  /** Spread over the network's fleet groups, as setFleetSize does. */
  tramCount?: number;
  /** Trams per fleet group; takes precedence over tramCount. */
  fleetGroups?: Record<string, number>;
  durationSeconds: number;
  startServiceMinute?: number;
  sampleEverySeconds?: number;
  energyStrategy?: "no-storage" | "baseline" | "network-optimal";
}

export interface HeadlessSample {
  elapsedSeconds: number;
  clock: string;
  metrics: SimulationMetrics;
  routeOperations: RouteOperationsSnapshot[];
}

export interface HeadlessSimulationReport {
  schemaVersion: 1;
  /** Core that ran the simulation; the TypeScript fallback has no traction-power network. */
  coreRuntime: "cpp-wasm" | "typescript-fallback";
  scenarioId: string;
  scenarioName: string;
  requestedDurationSeconds: number;
  simulatedDurationSeconds: number;
  startClock: string;
  endClock: string;
  finalMetrics: SimulationMetrics;
  routeOperations: RouteOperationsSnapshot[];
  energyStatistics: EnergyStatisticsSnapshot;
  eventCounts: Record<"info" | "ok" | "warning" | "danger", number>;
  samples: HeadlessSample[];
}

const cloneMetrics = (metrics: SimulationMetrics): SimulationMetrics => ({ ...metrics });

/** Engine with the requested fleet, strategy and service clock, ready to run. */
function createHeadlessEngine(options: {
  scenarioId?: string;
  tramCount?: number;
  fleetGroups?: Record<string, number>;
  startServiceMinute?: number;
  energyStrategy?: "no-storage" | "baseline" | "network-optimal";
}) {
  const engine = new SimulationEngine(options.scenarioId);
  const groupsApplied = options.fleetGroups
    ? engine.setFleetGroupCounts(options.fleetGroups)
    : false;
  if (!groupsApplied && options.tramCount !== undefined) {
    engine.setFleetSize(options.tramCount);
  }
  if (options.energyStrategy) engine.setEnergyStrategy(options.energyStrategy);
  if (options.startServiceMinute !== undefined) {
    engine.setServiceClockMinutes(options.startServiceMinute);
  }
  engine.setSimulationRate(5);
  engine.setRunning(true);
  return engine;
}

/** Advances by exactly `seconds` of simulated time in deterministic batches. */
function advanceHeadless(engine: SimulationEngine, seconds: number, onBatch?: (elapsed: number) => void) {
  const fixedBatchSeconds = 0.5;
  let elapsedSeconds = 0;
  while (elapsedSeconds + 1e-9 < seconds) {
    const simulatedBatch = Math.min(fixedBatchSeconds, seconds - elapsedSeconds);
    engine.step(simulatedBatch / 5);
    elapsedSeconds += simulatedBatch;
    onBatch?.(elapsedSeconds);
  }
}

const cloneRouteOperations = (
  operations: RouteOperationsSnapshot[],
): RouteOperationsSnapshot[] => operations.map((item) => ({ ...item }));

/**
 * Runs the complete network simulation without React, DOM, Canvas or animation
 * frames. The returned plain object can be serialized directly to JSON.
 */
export function runHeadlessSimulation(
  options: HeadlessSimulationOptions,
): HeadlessSimulationReport {
  if (!(options.durationSeconds > 0)) {
    throw new Error("durationSeconds must be positive");
  }

  const engine = createHeadlessEngine(options);

  const start = engine.getSnapshot();
  const sampleEvery = Math.max(1, options.sampleEverySeconds ?? 60);
  const samples: HeadlessSample[] = [];
  let nextSampleAt = sampleEvery;

  advanceHeadless(engine, options.durationSeconds, (elapsedSeconds) => {
    if (elapsedSeconds + 1e-9 >= nextSampleAt) {
      const snapshot = engine.getSnapshot();
      samples.push({
        elapsedSeconds: snapshot.time,
        clock: snapshot.clock,
        metrics: cloneMetrics(snapshot.metrics),
        routeOperations: cloneRouteOperations(snapshot.routeOperations),
      });
      nextSampleAt += sampleEvery;
    }
  });

  const finalSnapshot: SimulationSnapshot = engine.getSnapshot();
  const eventCounts = { info: 0, ok: 0, warning: 0, danger: 0 };
  for (const event of finalSnapshot.events) eventCounts[event.tone] += 1;

  return {
    schemaVersion: 1,
    coreRuntime: isCppRuntimeReady() ? "cpp-wasm" : "typescript-fallback",
    scenarioId: finalSnapshot.scenarioId,
    scenarioName: finalSnapshot.scenarioName,
    requestedDurationSeconds: options.durationSeconds,
    simulatedDurationSeconds: finalSnapshot.time,
    startClock: start.clock,
    endClock: finalSnapshot.clock,
    finalMetrics: cloneMetrics(finalSnapshot.metrics),
    routeOperations: cloneRouteOperations(finalSnapshot.routeOperations),
    energyStatistics: finalSnapshot.energyStatistics,
    eventCounts,
    samples,
  };
}

export interface EnergyComparisonRow {
  strategy: "no-storage" | "baseline" | "network-optimal";
  label: string;
  /** Grid supply during the measured window, as metered. */
  gridSupplyKWh: number;
  /** Grid supply corrected for the change in flywheel charge over the window. */
  socCorrectedGridKWh: number;
  flywheelStartKWh: number;
  flywheelEndKWh: number;
  /** Network grid-power peak within the measured window (start-up excluded). */
  peakGridPowerKw: number;
  rejectedRegenerationKWh: number;
  localReuseKWh: number;
  flywheelLossesKWh: number;
  interventions: number;
  distanceKm: number;
  averageSpeedKmh: number;
  scheduledDepartures: number;
  departureAdherencePercent: number | null;
  meanDepartureDeviationSeconds: number | null;
  gridWhPerVehicleKm: number;
  energySavingPercent: number;
  peakReductionPercent: number;
}

export interface EnergyComparisonReport {
  scenarioId: string;
  warmUpSeconds: number;
  durationSeconds: number;
  tramCount: number;
  fleetGroups: Record<string, number> | null;
  rows: EnergyComparisonRow[];
}

/**
 * Runs identical deterministic service for all three energy-control cases and
 * compares them over a measured window after a warm-up, so the start-up wave
 * of every tram leaving its start position is not what is measured.
 *
 * Flywheel charge at the end of the window is not a saving yet and a drained
 * bank is not free: the grid figure is corrected by the change in stored
 * energy, valued at the discharge efficiency when the bank gained energy and
 * at the charge efficiency when it lost energy.
 */
export function runEnergyComparison(options: {
  scenarioId: string;
  /** Spread over the network's fleet groups; the default fleet when omitted. */
  tramCount?: number;
  fleetGroups?: Record<string, number>;
  durationSeconds?: number;
  warmUpSeconds?: number;
  startServiceMinute?: number;
}): EnergyComparisonReport {
  const durationSeconds = options.durationSeconds ?? 600;
  const warmUpSeconds = options.warmUpSeconds ?? 300;
  const variants = [
    ["no-storage", "No wayside storage"],
    ["baseline", "Flywheel · reactive"],
    ["network-optimal", "Predictive SOC + peak dispatch"],
  ] as const;
  let tramCount = 0;
  let fleetGroups: Record<string, number> | null = null;
  const raw = variants.map(([strategy, label]) => {
    const engine = createHeadlessEngine({ ...options, energyStrategy: strategy });
    tramCount = engine.getSnapshot().trams.length;
    fleetGroups = engine.getFleetGroupCounts();
    advanceHeadless(engine, warmUpSeconds);
    const before = engine.getSnapshot();
    engine.resetGridPeakWindow();
    advanceHeadless(engine, durationSeconds);
    const after = engine.getSnapshot();

    const powerBefore = before.energyStatistics.powerSystem;
    const power = after.energyStatistics.powerSystem;
    const delta = (key: "gridSupplyKWh" | "rejectedGeneratorKWh" | "localReuseKWh" | "flywheelLossesKWh" | "interventions") =>
      power[key] - powerBefore[key];
    const flywheel = engine.scenario.tractionPowerSystem?.sections.find((section) => section.flywheel)?.flywheel;
    const storedChangeKWh = power.flywheelStoredKWh - powerBefore.flywheelStoredKWh;
    const storageCorrectionKWh = storedChangeKWh >= 0
      ? storedChangeKWh * (flywheel?.dischargeEfficiency ?? 1)
      : storedChangeKWh / (flywheel?.chargeEfficiency ?? 1);
    const gridSupplyKWh = delta("gridSupplyKWh");
    const distanceKm = after.energyStatistics.total.distanceKm - before.energyStatistics.total.distanceKm;
    const departuresBefore = before.metrics.scheduledDepartures;
    const departures = after.metrics.scheduledDepartures - departuresBefore;
    const onTime = (snapshot: SimulationSnapshot) =>
      ((snapshot.metrics.departureAdherencePercent ?? 0) / 100) * snapshot.metrics.scheduledDepartures;
    const deviation = (snapshot: SimulationSnapshot) =>
      (snapshot.metrics.meanDepartureDeviationSeconds ?? 0) * snapshot.metrics.scheduledDepartures;
    return {
      strategy,
      label,
      gridSupplyKWh,
      socCorrectedGridKWh: gridSupplyKWh - storageCorrectionKWh,
      flywheelStartKWh: powerBefore.flywheelStoredKWh,
      flywheelEndKWh: power.flywheelStoredKWh,
      peakGridPowerKw: engine.getWindowPeakGridPowerKw(),
      rejectedRegenerationKWh: delta("rejectedGeneratorKWh"),
      localReuseKWh: delta("localReuseKWh"),
      flywheelLossesKWh: delta("flywheelLossesKWh"),
      interventions: delta("interventions"),
      distanceKm,
      averageSpeedKmh: tramCount > 0 ? distanceKm / tramCount / (durationSeconds / 3600) : 0,
      scheduledDepartures: departures,
      departureAdherencePercent: departures > 0 ? ((onTime(after) - onTime(before)) / departures) * 100 : null,
      meanDepartureDeviationSeconds: departures > 0 ? (deviation(after) - deviation(before)) / departures : null,
    };
  });
  const reference = raw[0];
  const normalizedGridWh = (gridKWh: number, distanceKm: number) =>
    distanceKm > 0 ? (gridKWh * 1000) / distanceKm : 0;
  const referenceGridWhPerKm = normalizedGridWh(reference.socCorrectedGridKWh, reference.distanceKm);
  const percentReduction = (value: number, baseline: number) =>
    baseline > 0 ? ((baseline - value) / baseline) * 100 : 0;
  return {
    scenarioId: options.scenarioId,
    warmUpSeconds,
    durationSeconds,
    tramCount,
    fleetGroups,
    rows: raw.map((row) => ({
      ...row,
      gridWhPerVehicleKm: normalizedGridWh(row.socCorrectedGridKWh, row.distanceKm),
      energySavingPercent: percentReduction(
        normalizedGridWh(row.socCorrectedGridKWh, row.distanceKm),
        referenceGridWhPerKm,
      ),
      peakReductionPercent: percentReduction(row.peakGridPowerKw, reference.peakGridPowerKw),
    })),
  };
}
