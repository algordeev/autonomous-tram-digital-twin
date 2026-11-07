import {
  SimulationEngine,
  type EngineStudyOptions,
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
} & EngineStudyOptions) {
  const engine = new SimulationEngine(options.scenarioId, undefined, {
    fixedStepSeconds: options.fixedStepSeconds,
    storageScale: options.storageScale,
    etaScale: options.etaScale,
  });
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

export type EnergyComparisonStrategy = "no-storage" | "baseline" | "network-optimal";

export interface EnergyComparisonRow {
  strategy: EnergyComparisonStrategy;
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
  // --- Added in schemaVersion 2: reporting only, the computations above are unchanged.
  /** Electrical demand of all trams (traction after drivetrain losses + auxiliaries). */
  vehicleDemandKWh: number;
  tractionKWh: number;
  auxiliaryKWh: number;
  /** Generator output after conversion, before the network decides what it can accept. */
  grossRegenerationKWh: number;
  /** Regeneration the network accepted: reused by other trams or stored in a flywheel. */
  acceptedRegenerationKWh: number;
  /** Energy put into the flywheels' rotors (after charge losses). */
  flywheelChargedKWh: number;
  /** Energy delivered by the flywheels to the bus (after discharge losses). */
  flywheelDischargedKWh: number;
  /** Change of energy stored in the flywheels over the window, ΔE. */
  flywheelStoredChangeKWh: number;
  /** Pooled coefficient of variation of measured terminal departure intervals. */
  headwayCv: number | null;
  /** Mean measured terminal departure interval over the same groups. */
  headwayMeanSeconds: number | null;
  /** Terminal departure intervals the headway CV is based on. */
  headwayIntervals: number;
  /** Time mean of the instantaneous on-time share over the window samples. */
  onTimePercentMean: number;
  /** Time mean of the route-averaged busiest-stop wait estimate (Little's law). */
  averageWaitSecondsMean: number;
  /** Passengers left waiting by full trams during the window. */
  passengersLeftBehind: number;
  /** Network grid power during the window, when requested (one value per sample). */
  gridPowerSeriesKw?: number[];
}

export interface EnergyComparisonReport {
  /** 2 adds the run settings, the core runtime and the energy-balance and service fields. */
  schemaVersion: 2;
  coreRuntime: "cpp-wasm" | "typescript-fallback";
  scenarioId: string;
  startServiceMinute: number | null;
  warmUpSeconds: number;
  durationSeconds: number;
  fixedStepSeconds: number;
  storageScale: number;
  etaScale: number;
  /** Effective flywheel charge/discharge efficiency (null without flywheels). */
  flywheelChargeEfficiency: number | null;
  flywheelDischargeEfficiency: number | null;
  /** Sampling period of the service-metric means and the grid-power series. */
  serviceSampleSeconds: number;
  gridPowerSampleSeconds: number | null;
  tramCount: number;
  fleetGroups: Record<string, number> | null;
  rows: EnergyComparisonRow[];
}

const STRATEGY_LABELS: Record<EnergyComparisonStrategy, string> = {
  "no-storage": "No wayside storage",
  baseline: "Flywheel · reactive",
  "network-optimal": "Predictive SOC + peak dispatch",
};

/** Pooled CV over the timetable-window/route groups, from cumulative stat deltas. */
function headwayVariation(
  before: Record<string, { total: number; sumSeconds: number; sumSquaredSeconds: number }>,
  after: Record<string, { total: number; sumSeconds: number; sumSquaredSeconds: number }>,
) {
  let intervals = 0;
  let weightedCv = 0;
  let sumSeconds = 0;
  for (const [key, stats] of Object.entries(after)) {
    const previous = before[key] ?? { total: 0, sumSeconds: 0, sumSquaredSeconds: 0 };
    const n = stats.total - previous.total;
    if (n < 2) continue;
    const mean = (stats.sumSeconds - previous.sumSeconds) / n;
    if (!(mean > 0)) continue;
    const variance = Math.max(0, (stats.sumSquaredSeconds - previous.sumSquaredSeconds) / n - mean * mean);
    weightedCv += (Math.sqrt(variance) / mean) * n;
    sumSeconds += mean * n;
    intervals += n;
  }
  return {
    headwayCv: intervals > 0 ? weightedCv / intervals : null,
    headwayMeanSeconds: intervals > 0 ? sumSeconds / intervals : null,
    headwayIntervals: intervals,
  };
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
 *
 * The no-storage reference always runs first and uses no storage regardless
 * of `storageScale`; `strategies` selects which storage cases follow it.
 */
export function runEnergyComparison(options: {
  scenarioId: string;
  /** Spread over the network's fleet groups; the default fleet when omitted. */
  tramCount?: number;
  fleetGroups?: Record<string, number>;
  durationSeconds?: number;
  warmUpSeconds?: number;
  startServiceMinute?: number;
  /** Storage cases to compare with the reference; both when omitted. */
  strategies?: Array<"baseline" | "network-optimal">;
  /** Period of the on-time and wait samples inside the window (60 s by default). */
  serviceSampleSeconds?: number;
  /** Records network grid power at this period inside the window when set. */
  gridPowerSampleSeconds?: number;
} & EngineStudyOptions): EnergyComparisonReport {
  const durationSeconds = options.durationSeconds ?? 600;
  const warmUpSeconds = options.warmUpSeconds ?? 300;
  const serviceSampleSeconds = Math.max(1, options.serviceSampleSeconds ?? 60);
  const gridPowerSampleSeconds = options.gridPowerSampleSeconds && options.gridPowerSampleSeconds > 0
    ? options.gridPowerSampleSeconds
    : null;
  const strategies: EnergyComparisonStrategy[] = [
    "no-storage",
    ...(options.strategies ?? ["baseline", "network-optimal"]),
  ];
  let tramCount = 0;
  let fleetGroups: Record<string, number> | null = null;
  let fixedStepSeconds = 0;
  let flywheelEfficiency: { chargeEfficiency: number; dischargeEfficiency: number } | null = null;
  const raw = strategies.map((strategy) => {
    const engine = createHeadlessEngine({ ...options, energyStrategy: strategy });
    tramCount = engine.getSnapshot().trams.length;
    fleetGroups = engine.getFleetGroupCounts();
    fixedStepSeconds = engine.fixedStepSeconds;
    advanceHeadless(engine, warmUpSeconds);
    const before = engine.getSnapshot();
    const headwayBefore = engine.getTerminalHeadwayStats();
    const leftBehindBefore = engine.getPassengersLeftBehind();
    engine.resetGridPeakWindow();

    const onTimeSamples: number[] = [];
    const waitSamples: number[] = [];
    const gridPowerSeriesKw: number[] = [];
    let nextServiceSampleAt = serviceSampleSeconds;
    let nextPowerSampleAt = gridPowerSampleSeconds ?? Number.POSITIVE_INFINITY;
    advanceHeadless(engine, durationSeconds, (elapsed) => {
      if (elapsed + 1e-9 >= nextPowerSampleAt) {
        gridPowerSeriesKw.push(engine.getNetworkGridPowerKw());
        nextPowerSampleAt += gridPowerSampleSeconds!;
      }
      if (elapsed + 1e-9 >= nextServiceSampleAt) {
        // Not getSnapshot(): it updates the stop queues and would change the run.
        const sample = engine.getServiceSample();
        onTimeSamples.push(sample.onTimePercent);
        waitSamples.push(sample.averageWaitSeconds);
        nextServiceSampleAt += serviceSampleSeconds;
      }
    });
    const after = engine.getSnapshot();

    const powerBefore = before.energyStatistics.powerSystem;
    const power = after.energyStatistics.powerSystem;
    const delta = (key: "gridSupplyKWh" | "rejectedGeneratorKWh" | "localReuseKWh" | "flywheelLossesKWh" | "flywheelChargedKWh" | "flywheelDischargedKWh" | "interventions") =>
      power[key] - powerBefore[key];
    const totalDelta = (key: "gridDrawKWh" | "tractionKWh" | "auxiliaryKWh" | "grossRegeneratedKWh" | "acceptedRegeneratedKWh" | "distanceKm") =>
      after.energyStatistics.total[key] - before.energyStatistics.total[key];
    const flywheel = engine.scenario.tractionPowerSystem?.sections.find((section) => section.flywheel)?.flywheel;
    if (flywheel && strategy !== "no-storage") {
      flywheelEfficiency = {
        chargeEfficiency: flywheel.chargeEfficiency,
        dischargeEfficiency: flywheel.dischargeEfficiency,
      };
    }
    const storedChangeKWh = power.flywheelStoredKWh - powerBefore.flywheelStoredKWh;
    const storageCorrectionKWh = storedChangeKWh >= 0
      ? storedChangeKWh * (flywheel?.dischargeEfficiency ?? 1)
      : storedChangeKWh / (flywheel?.chargeEfficiency ?? 1);
    const gridSupplyKWh = delta("gridSupplyKWh");
    const distanceKm = totalDelta("distanceKm");
    const departuresBefore = before.metrics.scheduledDepartures;
    const departures = after.metrics.scheduledDepartures - departuresBefore;
    const onTime = (snapshot: SimulationSnapshot) =>
      ((snapshot.metrics.departureAdherencePercent ?? 0) / 100) * snapshot.metrics.scheduledDepartures;
    const deviation = (snapshot: SimulationSnapshot) =>
      (snapshot.metrics.meanDepartureDeviationSeconds ?? 0) * snapshot.metrics.scheduledDepartures;
    const mean = (values: number[]) =>
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      strategy,
      label: STRATEGY_LABELS[strategy],
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
      vehicleDemandKWh: totalDelta("gridDrawKWh"),
      tractionKWh: totalDelta("tractionKWh"),
      auxiliaryKWh: totalDelta("auxiliaryKWh"),
      grossRegenerationKWh: totalDelta("grossRegeneratedKWh"),
      acceptedRegenerationKWh: totalDelta("acceptedRegeneratedKWh"),
      flywheelChargedKWh: delta("flywheelChargedKWh"),
      flywheelDischargedKWh: delta("flywheelDischargedKWh"),
      flywheelStoredChangeKWh: storedChangeKWh,
      ...headwayVariation(headwayBefore, engine.getTerminalHeadwayStats()),
      onTimePercentMean: mean(onTimeSamples),
      averageWaitSecondsMean: mean(waitSamples),
      passengersLeftBehind: engine.getPassengersLeftBehind() - leftBehindBefore,
      ...(gridPowerSampleSeconds ? { gridPowerSeriesKw } : {}),
    };
  });
  const reference = raw[0];
  const normalizedGridWh = (gridKWh: number, distanceKm: number) =>
    distanceKm > 0 ? (gridKWh * 1000) / distanceKm : 0;
  const referenceGridWhPerKm = normalizedGridWh(reference.socCorrectedGridKWh, reference.distanceKm);
  const percentReduction = (value: number, baseline: number) =>
    baseline > 0 ? ((baseline - value) / baseline) * 100 : 0;
  const efficiency = flywheelEfficiency as { chargeEfficiency: number; dischargeEfficiency: number } | null;
  return {
    schemaVersion: 2,
    coreRuntime: isCppRuntimeReady() ? "cpp-wasm" : "typescript-fallback",
    scenarioId: options.scenarioId,
    startServiceMinute: options.startServiceMinute ?? null,
    warmUpSeconds,
    durationSeconds,
    fixedStepSeconds,
    storageScale: options.storageScale ?? 1,
    etaScale: options.etaScale ?? 1,
    flywheelChargeEfficiency: efficiency?.chargeEfficiency ?? null,
    flywheelDischargeEfficiency: efficiency?.dischargeEfficiency ?? null,
    serviceSampleSeconds,
    gridPowerSampleSeconds,
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
