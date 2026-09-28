import {
  SimulationEngine,
  type EnergyStatisticsSnapshot,
  type RouteOperationsSnapshot,
  type SimulationMetrics,
  type SimulationSnapshot,
} from "./engine.ts";

export interface HeadlessSimulationOptions {
  scenarioId?: string;
  tramCount?: number;
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

  const engine = new SimulationEngine(options.scenarioId, options.tramCount);
  if (options.energyStrategy) engine.setEnergyStrategy(options.energyStrategy);
  if (options.startServiceMinute !== undefined) {
    engine.setServiceClockMinutes(options.startServiceMinute);
  }
  engine.setSimulationRate(5);
  engine.setRunning(true);

  const start = engine.getSnapshot();
  const sampleEvery = Math.max(1, options.sampleEverySeconds ?? 60);
  const samples: HeadlessSample[] = [];
  const fixedBatchSeconds = 0.5;
  let elapsedSeconds = 0;
  let nextSampleAt = sampleEvery;

  while (elapsedSeconds + 1e-9 < options.durationSeconds) {
    const remaining = options.durationSeconds - elapsedSeconds;
    const simulatedBatch = Math.min(fixedBatchSeconds, remaining);
    engine.step(simulatedBatch / 5);
    elapsedSeconds += simulatedBatch;

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
  }

  const finalSnapshot: SimulationSnapshot = engine.getSnapshot();
  const eventCounts = { info: 0, ok: 0, warning: 0, danger: 0 };
  for (const event of finalSnapshot.events) eventCounts[event.tone] += 1;

  return {
    schemaVersion: 1,
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
  gridSupplyKWh: number;
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
  durationSeconds: number;
  tramCount: number;
  rows: EnergyComparisonRow[];
}

/** Runs identical deterministic service for all three energy-control cases. */
export function runEnergyComparison(options: {
  scenarioId: string;
  tramCount: number;
  durationSeconds?: number;
  startServiceMinute?: number;
}): EnergyComparisonReport {
  const durationSeconds = options.durationSeconds ?? 600;
  const variants = [
    ["no-storage", "No wayside storage"],
    ["baseline", "Flywheel · reactive"],
    ["network-optimal", "Predictive SOC + peak dispatch"],
  ] as const;
  const raw = variants.map(([strategy, label]) => {
    const report = runHeadlessSimulation({
      scenarioId: options.scenarioId,
      tramCount: options.tramCount,
      durationSeconds,
      startServiceMinute: options.startServiceMinute,
      sampleEverySeconds: durationSeconds,
      energyStrategy: strategy,
    });
    return {
      strategy,
      label,
      power: report.energyStatistics.powerSystem,
      distanceKm: report.energyStatistics.total.distanceKm,
      averageSpeedKmh: report.finalMetrics.averageSpeedKmh,
      scheduledDepartures: report.finalMetrics.scheduledDepartures,
      departureAdherencePercent: report.finalMetrics.departureAdherencePercent,
      meanDepartureDeviationSeconds: report.finalMetrics.meanDepartureDeviationSeconds,
    };
  });
  const reference = raw[0];
  const normalizedGridWh = (gridKWh: number, distanceKm: number) =>
    distanceKm > 0 ? (gridKWh * 1000) / distanceKm : 0;
  const referenceGridWhPerKm = normalizedGridWh(
    reference.power.gridSupplyKWh,
    reference.distanceKm,
  );
  const percentReduction = (value: number, baseline: number) =>
    baseline > 0 ? ((baseline - value) / baseline) * 100 : 0;
  return {
    scenarioId: options.scenarioId,
    durationSeconds,
    tramCount: options.tramCount,
    rows: raw.map(({
      strategy,
      label,
      power,
      distanceKm,
      averageSpeedKmh,
      scheduledDepartures,
      departureAdherencePercent,
      meanDepartureDeviationSeconds,
    }) => ({
      strategy,
      label,
      gridSupplyKWh: power.gridSupplyKWh,
      peakGridPowerKw: power.peakGridPowerKw,
      rejectedRegenerationKWh: power.rejectedGeneratorKWh,
      localReuseKWh: power.localReuseKWh,
      flywheelLossesKWh: power.flywheelLossesKWh,
      interventions: power.interventions,
      distanceKm,
      averageSpeedKmh,
      scheduledDepartures,
      departureAdherencePercent,
      meanDepartureDeviationSeconds,
      gridWhPerVehicleKm: normalizedGridWh(power.gridSupplyKWh, distanceKm),
      energySavingPercent: percentReduction(
        normalizedGridWh(power.gridSupplyKWh, distanceKm),
        referenceGridWhPerKm,
      ),
      peakReductionPercent: percentReduction(power.peakGridPowerKw, reference.power.peakGridPowerKw),
    })),
  };
}
