import { TRAM_CORE_ABI_VERSION } from "./cpp-abi.ts";
import {
  integrateVehicleDynamics,
  REFERENCE_TRAM_PARAMETERS,
  type DynamicsMode,
  type VehicleDynamicsResult,
} from "./vehicle-dynamics.ts";

type CppHeadwayExports = {
  tram_core_abi_version: () => number;
  tram_core_uniform_headway: (
    cycleMeters: number,
    activeCount: number,
    fallbackMeters: number,
  ) => number;
  tram_core_headway_speed_factor: (
    distanceMeters: number,
    safetyMeters: number,
    restoreAtMeters: number,
  ) => number;
  tram_core_terminal_interval_hold: (
    distanceMeters: number,
    targetMeters: number,
  ) => number;
  tram_core_terminal_berth: (occupiedMask: number) => number;
  tram_core_parallel_terminal_bypass: (
    sameTerminal: number,
    occupiedMask: number,
  ) => number;
  tram_core_departure_slot: (
    clockSeconds: number,
    windowStartSeconds: number,
    headwaySeconds: number,
    nextReservedSeconds: number,
  ) => number;
  tram_core_departure_on_time: (
    deviationSeconds: number,
    toleranceSeconds: number,
  ) => number;
  tram_core_authority_begin: (count: number) => number;
  tram_core_authority_sync: (
    index: number,
    speed: number,
    acceleration: number,
    consumed: number,
    tractionEnergy: number,
    auxiliaryEnergy: number,
    mechanicalBrake: number,
    grossRegenerated: number,
    regenerated: number,
    rejected: number,
    downhill: number,
    climb: number,
  ) => number;
  tram_core_authority_step: (
    index: number,
    targetSpeed: number,
    emergency: number,
    grade: number,
    passengerCount: number,
    delta: number,
  ) => number;
  tram_core_speed_profile_target: (
    lineSpeed: number,
    curveRadius: number,
    lateralAcceleration: number,
    infrastructureSpeed: number,
    distanceToRestriction: number,
    approachDeceleration: number,
  ) => number;
  tram_core_predictive_eco_target: (
    index: number,
    enabled: number,
    speed: number,
    authorityTarget: number,
    distanceToConstraint: number,
    constraintSpeed: number,
    grade: number,
    passengerCount: number,
    scheduleMargin: number,
  ) => number;
  tram_core_authority_eco_mode: (index: number) => number;
  tram_core_authority_override_motion: (
    index: number,
    speed: number,
    acceleration: number,
  ) => number;
  tram_core_resolve_target_speed: (
    speedLimit: number,
    manualMode: number,
    manualCommand: number,
    stationPhase: number,
    blocked: number,
    intervalFactor: number,
    dispatchHold: number,
  ) => number;
  tram_core_station_approach_speed: (distanceMeters: number, speedLimit: number) => number;
  tram_core_safe_move: (
    requested: number,
    blockDistance: number,
    leaderDistance: number,
    physicalGap: number,
  ) => number;
  tram_core_authority_mode: (index: number) => number;
  tram_core_authority_speed: (index: number) => number;
  tram_core_authority_acceleration: (index: number) => number;
  tram_core_authority_distance: (index: number) => number;
  tram_core_authority_traction_force: (index: number) => number;
  tram_core_authority_brake_force: (index: number) => number;
  tram_core_authority_resistance_force: (index: number) => number;
  tram_core_authority_consumed: (index: number) => number;
  tram_core_authority_traction_energy: (index: number) => number;
  tram_core_authority_auxiliary_energy: (index: number) => number;
  tram_core_authority_mechanical_brake: (index: number) => number;
  tram_core_authority_gross_regenerated: (index: number) => number;
  tram_core_authority_regenerated: (index: number) => number;
  tram_core_authority_rejected: (index: number) => number;
  tram_core_authority_downhill: (index: number) => number;
  tram_core_authority_climb: (index: number) => number;
  tram_core_station_sync: (index: number, phase: number, until: number) => number;
  tram_core_station_step: (index: number, now: number, manual: number, aligned: number) => number;
  tram_core_station_phase: (index: number) => number;
  tram_core_station_until: (index: number) => number;
  tram_core_station_event: (index: number) => number;
  tram_core_depot_sync: (index: number, state: number) => number;
  tram_core_depot_command: (index: number, command: number) => number;
  tram_core_depot_observe: (
    index: number,
    reachedPortal: number,
    reachedDepot: number,
    reachedLine: number,
    exitClear: number,
  ) => number;
  tram_core_depot_state: (index: number) => number;
  tram_core_signal_begin: (count: number) => number;
  tram_core_signal_sync: (
    index: number, phase: number, until: number, activeTram: number,
    activeSignal: number, entered: number, cleared: number, grantedAt: number,
    manualMode: number, manualSignal: number, pending: number,
  ) => number;
  tram_core_signal_step: (
    index: number, now: number, candidateTram: number, candidateSignal: number,
    stillWaiting: number, activeInvalid: number, amber: number, green: number,
    clearance: number, timeout: number,
  ) => number;
  tram_core_signal_manual: (index: number, mode: number, signal: number) => number;
  tram_core_signal_observe: (index: number, tram: number, signal: number, cleared: number, now: number) => number;
  tram_core_signal_fault: (index: number) => number;
  tram_core_signal_phase: (index: number) => number;
  tram_core_signal_until: (index: number) => number;
  tram_core_signal_active_tram: (index: number) => number;
  tram_core_signal_active_signal: (index: number) => number;
  tram_core_signal_entered: (index: number) => number;
  tram_core_signal_cleared: (index: number) => number;
  tram_core_signal_granted_at: (index: number) => number;
  tram_core_signal_pending: (index: number) => number;
  tram_core_signal_event: (index: number) => number;
  tram_core_switch_begin: (count: number) => number;
  tram_core_switch_sync: (index: number, state: number, lockedBy: number) => number;
  tram_core_switch_toggle: (index: number, cooperative: number) => number;
  tram_core_switch_request: (
    index: number,
    desired: number,
    tram: number,
    cooperative: number,
  ) => number;
  tram_core_switch_release: (index: number, tram: number) => number;
  tram_core_switch_state: (index: number) => number;
  tram_core_switch_locked_by: (index: number) => number;
  tram_core_power_begin: (sections: number, vehicles: number, strategy: number) => number;
  tram_core_power_configure_section: (index: number, maxPowerKw: number) => number;
  tram_core_power_configure_flywheel: (index: number, modules: number, modulePowerKw: number, moduleEnergyWh: number, chargeEfficiency: number, dischargeEfficiency: number, initialSoc: number) => number;
  tram_core_power_set_strategy: (strategy: number) => number;
  tram_core_power_target: (index: number, section: number, manual: number, inService: number, now: number, speed: number, target: number) => number;
  tram_core_power_guidance: (index: number) => number;
  tram_core_power_sync_vehicle: (index: number, section: number, consumed: number, mechanical: number, gross: number, accepted: number, rejected: number) => number;
  tram_core_power_step: (delta: number) => number;
  tram_core_power_section_traction: (index: number) => number;
  tram_core_power_section_regeneration: (index: number) => number;
  tram_core_power_section_reused: (index: number) => number;
  tram_core_power_section_grid: (index: number) => number;
  tram_core_power_section_reused_wh: (index: number) => number;
  tram_core_power_section_grid_wh: (index: number) => number;
  tram_core_power_section_rejected_wh: (index: number) => number;
  tram_core_power_section_peak: (index: number) => number;
  tram_core_power_section_flywheel_energy: (index: number) => number;
  tram_core_power_section_flywheel_capacity: (index: number) => number;
  tram_core_power_section_flywheel_charge_power: (index: number) => number;
  tram_core_power_section_flywheel_discharge_power: (index: number) => number;
  tram_core_power_section_flywheel_charged_wh: (index: number) => number;
  tram_core_power_section_flywheel_discharged_wh: (index: number) => number;
  tram_core_power_section_flywheel_losses_wh: (index: number) => number;
  tram_core_power_section_forecast_traction: (index: number) => number;
  tram_core_power_section_forecast_regeneration: (index: number) => number;
  tram_core_power_section_flywheel_target_grid: (index: number) => number;
  tram_core_power_section_flywheel_mode: (index: number) => number;
  tram_core_power_vehicle_accepted: (index: number) => number;
  tram_core_power_vehicle_rejected: (index: number) => number;
  tram_core_power_network_peak: () => number;
  tram_core_power_interventions: () => number;
};

let cppExports: CppHeadwayExports | null = null;
let loading: Promise<boolean> | null = null;
let authorityCount = 1;
const initializedVehicles = new Set<number>();
const initializedStations = new Set<number>();
const initializedDepotStates = new Set<number>();
let trafficAuthorityCount = 0;
const initializedTrafficControllers = new Set<number>();
let switchAuthorityCount = 0;
const initializedSwitches = new Set<number>();
let powerSectionMaxKw: number[] = [];
let powerFlywheels: CppFlywheelConfig[] = [];
let powerVehicleCount = 1;
let powerStrategy = 1;

export interface CppVehicleAuthorityState {
  speedMps: number;
  accelerationMps2: number;
  consumedEnergyWh: number;
  tractionEnergyWh: number;
  auxiliaryEnergyWh: number;
  mechanicalBrakeEnergyWh: number;
  grossRegeneratedEnergyWh: number;
  regeneratedEnergyWh: number;
  rejectedRegenerationEnergyWh: number;
  downhillPotentialEnergyWh: number;
  climbPotentialEnergyWh: number;
}

export interface CppVehicleAuthorityResult extends VehicleDynamicsResult {
  cumulative: CppVehicleAuthorityState;
  source: "cpp-wasm" | "typescript-fallback";
}

const DYNAMICS_MODES: DynamicsMode[] = [
  "coast",
  "traction",
  "service-brake",
  "emergency-brake",
];

function acceptCppRuntime(instance: WebAssembly.Instance) {
  const candidate = instance.exports as unknown as CppHeadwayExports;
  if (
    candidate.tram_core_abi_version() !== TRAM_CORE_ABI_VERSION ||
    typeof candidate.tram_core_authority_step !== "function" ||
    typeof candidate.tram_core_power_step !== "function"
  ) throw new Error("Unsupported C++ core ABI");
  cppExports = candidate;
  candidate.tram_core_authority_begin(authorityCount);
  candidate.tram_core_signal_begin(trafficAuthorityCount);
  candidate.tram_core_switch_begin(switchAuthorityCount);
  candidate.tram_core_power_begin(powerSectionMaxKw.length, powerVehicleCount, powerStrategy);
  powerSectionMaxKw.forEach((maxPower, index) => candidate.tram_core_power_configure_section(index, maxPower));
  powerFlywheels.forEach((storage, index) => candidate.tram_core_power_configure_flywheel(index, storage.modules, storage.modulePowerKw, storage.moduleEnergyWh, storage.chargeEfficiency, storage.dischargeEfficiency, storage.initialSoc));
  initializedVehicles.clear();
  initializedStations.clear();
  initializedDepotStates.clear();
  initializedTrafficControllers.clear();
  initializedSwitches.clear();
  return true;
}

export function initializeCppRuntimeFromBytes(bytes: BufferSource) {
  return WebAssembly.instantiate(bytes, {}).then(({ instance }) => acceptCppRuntime(instance));
}

export function initializeCppRuntime() {
  if (cppExports) return Promise.resolve(true);
  if (loading) return loading;
  const wasmUrl = typeof document === "undefined"
    ? "/wasm/tram-core.wasm"
    : new URL(`${import.meta.env.BASE_URL}wasm/tram-core.wasm`, document.baseURI).toString();
  loading = fetch(wasmUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`C++ core HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then(({ instance }) => acceptCppRuntime(instance))
    .catch(() => false);
  return loading;
}

export interface CppFlywheelConfig { modules: number; modulePowerKw: number; moduleEnergyWh: number; chargeEfficiency: number; dischargeEfficiency: number; initialSoc: number }
export type CppEnergyStrategy = "no-storage" | "baseline" | "network-optimal";
export function configureCppPowerAuthority(sections: Array<{ maxPowerKw: number; flywheel?: CppFlywheelConfig }>, vehicleCount: number, strategy: CppEnergyStrategy) {
  powerSectionMaxKw = sections.slice(0, 16).map((section) => section.maxPowerKw);
  powerFlywheels = sections.slice(0, 16).map((section) => strategy === "no-storage" ? { modules: 0, modulePowerKw: 0, moduleEnergyWh: 0, chargeEfficiency: 1, dischargeEfficiency: 1, initialSoc: 0 } : section.flywheel ?? { modules: 0, modulePowerKw: 0, moduleEnergyWh: 0, chargeEfficiency: 1, dischargeEfficiency: 1, initialSoc: 0 });
  powerVehicleCount = Math.max(1, Math.min(20, Math.round(vehicleCount)));
  powerStrategy = strategy === "network-optimal" ? 1 : 0;
  if (!cppExports) return;
  cppExports.tram_core_power_begin(powerSectionMaxKw.length, powerVehicleCount, powerStrategy);
  powerSectionMaxKw.forEach((maxPower, index) => cppExports!.tram_core_power_configure_section(index, maxPower));
  powerFlywheels.forEach((storage, index) => cppExports!.tram_core_power_configure_flywheel(index, storage.modules, storage.modulePowerKw, storage.moduleEnergyWh, storage.chargeEfficiency, storage.dischargeEfficiency, storage.initialSoc));
}

export function setCppPowerStrategy(strategy: CppEnergyStrategy) {
  powerStrategy = strategy === "network-optimal" ? 1 : 0;
  cppExports?.tram_core_power_set_strategy(powerStrategy);
}

export function cppEnergyOptimizedTarget(input: { index: number; sectionIndex: number; manual: boolean; inService: boolean; now: number; speedMps: number; targetSpeedMps: number }) {
  if (!cppExports) return { targetSpeedMps: input.targetSpeedMps, guidance: 0 };
  const targetSpeedMps = cppExports.tram_core_power_target(input.index, input.sectionIndex, input.manual ? 1 : 0, input.inService ? 1 : 0, input.now, input.speedMps, input.targetSpeedMps);
  return { targetSpeedMps, guidance: cppExports.tram_core_power_guidance(input.index) };
}

export interface CppPowerSectionState { tractionPowerKw: number; regenerationPowerKw: number; locallyReusedPowerKw: number; gridPowerKw: number; localReuseWh: number; gridSupplyWh: number; rejectedGeneratorWh: number; peakGridPowerKw: number; flywheelEnergyWh: number; flywheelCapacityWh: number; flywheelChargePowerKw: number; flywheelDischargePowerKw: number; flywheelChargedWh: number; flywheelDischargedWh: number; flywheelLossesWh: number; forecastTractionKw: number; forecastRegenerationKw: number; flywheelTargetGridKw: number; flywheelMode: number }
export function cppSettleTractionPower(delta: number, vehicles: Array<{ sectionIndex: number; consumedWh: number; mechanicalWh: number; grossWh: number; acceptedWh: number; rejectedWh: number }>) {
  if (!cppExports) return null;
  vehicles.forEach((vehicle, index) => cppExports!.tram_core_power_sync_vehicle(index, vehicle.sectionIndex, vehicle.consumedWh, vehicle.mechanicalWh, vehicle.grossWh, vehicle.acceptedWh, vehicle.rejectedWh));
  cppExports.tram_core_power_step(delta);
  const sections: CppPowerSectionState[] = powerSectionMaxKw.map((_, index) => ({
    tractionPowerKw: cppExports!.tram_core_power_section_traction(index), regenerationPowerKw: cppExports!.tram_core_power_section_regeneration(index), locallyReusedPowerKw: cppExports!.tram_core_power_section_reused(index), gridPowerKw: cppExports!.tram_core_power_section_grid(index), localReuseWh: cppExports!.tram_core_power_section_reused_wh(index), gridSupplyWh: cppExports!.tram_core_power_section_grid_wh(index), rejectedGeneratorWh: cppExports!.tram_core_power_section_rejected_wh(index), peakGridPowerKw: cppExports!.tram_core_power_section_peak(index),
    flywheelEnergyWh: cppExports!.tram_core_power_section_flywheel_energy(index), flywheelCapacityWh: cppExports!.tram_core_power_section_flywheel_capacity(index), flywheelChargePowerKw: cppExports!.tram_core_power_section_flywheel_charge_power(index), flywheelDischargePowerKw: cppExports!.tram_core_power_section_flywheel_discharge_power(index), flywheelChargedWh: cppExports!.tram_core_power_section_flywheel_charged_wh(index), flywheelDischargedWh: cppExports!.tram_core_power_section_flywheel_discharged_wh(index), flywheelLossesWh: cppExports!.tram_core_power_section_flywheel_losses_wh(index),
    forecastTractionKw: cppExports!.tram_core_power_section_forecast_traction(index), forecastRegenerationKw: cppExports!.tram_core_power_section_forecast_regeneration(index), flywheelTargetGridKw: cppExports!.tram_core_power_section_flywheel_target_grid(index), flywheelMode: cppExports!.tram_core_power_section_flywheel_mode(index),
  }));
  return { sections, vehicles: vehicles.map((_, index) => ({ acceptedWh: cppExports!.tram_core_power_vehicle_accepted(index), rejectedWh: cppExports!.tram_core_power_vehicle_rejected(index) })), peakNetworkGridPowerKw: cppExports.tram_core_power_network_peak(), interventions: cppExports.tram_core_power_interventions() };
}

export function isCppRuntimeReady() {
  return cppExports !== null;
}

export function resetCppRuntimeForTests() {
  cppExports = null;
  loading = null;
}

export function configureCppAuthority(count: number) {
  authorityCount = Math.max(1, Math.min(20, Math.round(count)));
  initializedVehicles.clear();
  initializedStations.clear();
  initializedDepotStates.clear();
  cppExports?.tram_core_authority_begin(authorityCount);
}

export function configureCppTrafficAuthority(count: number) {
  trafficAuthorityCount = Math.max(0, Math.min(12, Math.round(count)));
  initializedTrafficControllers.clear();
  cppExports?.tram_core_signal_begin(trafficAuthorityCount);
}

export function configureCppSwitchAuthority(count: number) {
  switchAuthorityCount = Math.max(0, Math.min(12, Math.round(count)));
  initializedSwitches.clear();
  cppExports?.tram_core_switch_begin(switchAuthorityCount);
}

function ensureCppSwitch(
  index: number,
  state: "main" | "branch",
  lockedByIndex: number,
) {
  if (!cppExports || index < 0 || index >= switchAuthorityCount) return false;
  if (!initializedSwitches.has(index)) {
    cppExports.tram_core_switch_sync(
      index,
      state === "branch" ? 1 : 0,
      lockedByIndex,
    );
    initializedSwitches.add(index);
  }
  return true;
}

function cppSwitchSnapshot(index: number) {
  return {
    state: cppExports!.tram_core_switch_state(index) ? "branch" as const : "main" as const,
    lockedByIndex: cppExports!.tram_core_switch_locked_by(index),
  };
}

export function cppToggleSwitchAuthority(
  index: number,
  state: "main" | "branch",
  lockedByIndex: number,
  cooperative: boolean,
) {
  if (!ensureCppSwitch(index, state, lockedByIndex)) {
    if (lockedByIndex >= 0) return null;
    return { state: state === "main" ? "branch" as const : "main" as const, lockedByIndex };
  }
  if (!cppExports!.tram_core_switch_toggle(index, cooperative ? 1 : 0)) return null;
  return cppSwitchSnapshot(index);
}

export function cppRequestSwitchAuthority(
  index: number,
  state: "main" | "branch",
  lockedByIndex: number,
  desired: "main" | "branch",
  tramIndex: number,
  cooperative: boolean,
) {
  if (!ensureCppSwitch(index, state, lockedByIndex)) {
    if (lockedByIndex >= 0 && (lockedByIndex !== tramIndex || state !== desired)) return null;
    return { state: desired, lockedByIndex: tramIndex };
  }
  if (!cppExports!.tram_core_switch_request(index, desired === "branch" ? 1 : 0, tramIndex, cooperative ? 1 : 0)) return null;
  return cppSwitchSnapshot(index);
}

export function cppReleaseSwitchAuthority(
  index: number,
  state: "main" | "branch",
  lockedByIndex: number,
  tramIndex: number,
) {
  if (!ensureCppSwitch(index, state, lockedByIndex)) {
    return { state, lockedByIndex: lockedByIndex === tramIndex ? -1 : lockedByIndex };
  }
  cppExports!.tram_core_switch_release(index, tramIndex);
  return cppSwitchSnapshot(index);
}

export function cppObserveTrafficAuthority(index: number, tram: number, signal: number, cleared: boolean, now: number) {
  if (!cppExports || !initializedTrafficControllers.has(index)) return;
  cppExports.tram_core_signal_observe(index, tram, signal, cleared ? 1 : 0, now);
  return cppExports.tram_core_signal_fault(index);
}

export interface CppTrafficAuthorityState {
  phase: number;
  phaseUntil: number;
  activeTramIndex: number;
  activeSignalIndex: number;
  activeTramEntered: boolean;
  activeTramCleared: boolean;
  activeGrantedAt: number;
  manualMode: number;
  manualSignalIndex: number;
  manualReleasePending: boolean;
}

export interface CppTrafficAuthorityResult extends CppTrafficAuthorityState {
  event: number;
  source: "cpp-wasm" | "typescript-fallback";
}

export function cppStepTrafficAuthority(
  index: number,
  state: CppTrafficAuthorityState,
  input: {
    now: number;
    candidateTramIndex: number;
    candidateSignalIndex: number;
    stillWaiting: boolean;
    activeInvalid: boolean;
    amberSeconds: number;
    tramGreenSeconds: number;
    clearanceSeconds: number;
    grantTimeoutSeconds: number;
  },
): CppTrafficAuthorityResult | null {
  if (!cppExports || index < 0 || index >= trafficAuthorityCount) return null;
  if (!initializedTrafficControllers.has(index)) {
    cppExports.tram_core_signal_sync(
      index,
      state.phase,
      state.phaseUntil,
      state.activeTramIndex,
      state.activeSignalIndex,
      state.activeTramEntered ? 1 : 0,
      state.activeTramCleared ? 1 : 0,
      state.activeGrantedAt,
      0,
      -1,
      0,
    );
    initializedTrafficControllers.add(index);
  }
  cppExports.tram_core_signal_manual(index, state.manualMode, state.manualSignalIndex);
  cppExports.tram_core_signal_step(
    index,
    input.now,
    input.candidateTramIndex,
    input.candidateSignalIndex,
    input.stillWaiting ? 1 : 0,
    input.activeInvalid ? 1 : 0,
    input.amberSeconds,
    input.tramGreenSeconds,
    input.clearanceSeconds,
    input.grantTimeoutSeconds,
  );
  return {
    phase: cppExports.tram_core_signal_phase(index),
    phaseUntil: cppExports.tram_core_signal_until(index),
    activeTramIndex: cppExports.tram_core_signal_active_tram(index),
    activeSignalIndex: cppExports.tram_core_signal_active_signal(index),
    activeTramEntered: Boolean(cppExports.tram_core_signal_entered(index)),
    activeTramCleared: Boolean(cppExports.tram_core_signal_cleared(index)),
    activeGrantedAt: cppExports.tram_core_signal_granted_at(index),
    manualMode: state.manualMode,
    manualSignalIndex: state.manualSignalIndex,
    manualReleasePending: Boolean(cppExports.tram_core_signal_pending(index)),
    event: cppExports.tram_core_signal_event(index),
    source: "cpp-wasm",
  };
}

export function cppResolveTargetSpeed(input: {
  speedLimitMps: number;
  manualMode: boolean;
  manualCommand: "forward" | "stop" | "reverse";
  stationPhase: "none" | "crawl" | "dwell";
  blocked: boolean;
  intervalFactor: number | null;
  dispatchHold: boolean;
}) {
  const manualCommand = input.manualCommand === "forward" ? 1 : input.manualCommand === "reverse" ? 2 : 0;
  const stationPhase = input.stationPhase === "crawl" ? 1 : input.stationPhase === "dwell" ? 2 : 0;
  if (cppExports) {
    return cppExports.tram_core_resolve_target_speed(
      input.speedLimitMps,
      input.manualMode ? 1 : 0,
      manualCommand,
      stationPhase,
      input.blocked ? 1 : 0,
      input.intervalFactor ?? -1,
      input.dispatchHold ? 1 : 0,
    );
  }
  if (
    input.dispatchHold ||
    input.blocked ||
    input.stationPhase === "dwell" ||
    (input.manualMode && input.manualCommand === "stop")
  ) return 0;
  if (input.stationPhase === "crawl") return input.speedLimitMps * (20 / 55);
  if (input.manualMode) {
    return input.manualCommand === "forward"
      ? Math.min(input.speedLimitMps, 20 / 3.6)
      : 0;
  }
  return input.intervalFactor === null
    ? input.speedLimitMps
    : input.speedLimitMps * input.intervalFactor;
}

export function cppStationApproachSpeed(distanceMeters: number, speedLimitMps: number) {
  if (cppExports) {
    return cppExports.tram_core_station_approach_speed(distanceMeters, speedLimitMps);
  }
  return Math.min(speedLimitMps, Math.sqrt(2 * 0.72 * Math.max(0, distanceMeters - 0.35)));
}

export function cppSpeedProfileTarget(input: {
  lineSpeedMps: number;
  curveRadiusMeters?: number | null;
  lateralAccelerationMps2?: number;
  infrastructureSpeedMps?: number | null;
  distanceToRestrictionMeters: number;
  approachDecelerationMps2?: number;
}) {
  const curveRadius = input.curveRadiusMeters ?? -1;
  const lateralAcceleration = input.lateralAccelerationMps2 ?? 0.65;
  const infrastructureSpeed = input.infrastructureSpeedMps ?? -1;
  const approachDeceleration = input.approachDecelerationMps2 ?? 0.72;
  if (cppExports) {
    return cppExports.tram_core_speed_profile_target(
      input.lineSpeedMps,
      curveRadius,
      lateralAcceleration,
      infrastructureSpeed,
      input.distanceToRestrictionMeters,
      approachDeceleration,
    );
  }
  const curveSpeed = curveRadius > 0
    ? Math.sqrt(curveRadius * lateralAcceleration)
    : input.lineSpeedMps;
  const restriction = Math.min(
    input.lineSpeedMps,
    curveSpeed,
    infrastructureSpeed > 0 ? infrastructureSpeed : input.lineSpeedMps,
  );
  if (input.distanceToRestrictionMeters <= 0) return restriction;
  return Math.min(
    input.lineSpeedMps,
    Math.sqrt(restriction ** 2 + 2 * approachDeceleration * input.distanceToRestrictionMeters),
  );
}

export function cppPredictiveEcoTarget(input: {
  index: number;
  enabled: boolean;
  speedMps: number;
  authorityTargetMps: number;
  distanceToConstraintMeters: number | null;
  constraintSpeedMps: number;
  grade: number;
  passengerCount: number;
  scheduleMargin: number;
}) {
  if (!cppExports || input.index < 0 || input.index >= authorityCount) {
    return { targetSpeedMps: input.authorityTargetMps, mode: "cruise" as const };
  }
  const targetSpeedMps = cppExports.tram_core_predictive_eco_target(
    input.index,
    input.enabled ? 1 : 0,
    input.speedMps,
    input.authorityTargetMps,
    input.distanceToConstraintMeters ?? -1,
    input.constraintSpeedMps,
    input.grade,
    input.passengerCount,
    input.scheduleMargin,
  );
  const rawMode = cppExports.tram_core_authority_eco_mode(input.index);
  return {
    targetSpeedMps,
    mode: rawMode === 1 ? "coast" as const : rawMode === 2 ? "predictive-brake" as const : "cruise" as const,
  };
}

export function cppSafeMoveMeters(
  requestedMeters: number,
  blockDistanceMeters: number | null,
  leaderDistanceMeters: number | null,
  physicalGapMeters: number,
) {
  if (cppExports) {
    return cppExports.tram_core_safe_move(
      requestedMeters,
      blockDistanceMeters ?? -1,
      leaderDistanceMeters ?? -1,
      physicalGapMeters,
    );
  }
  let allowed = requestedMeters;
  if (blockDistanceMeters !== null && blockDistanceMeters <= allowed + 1.6) {
    allowed = Math.min(allowed, Math.max(0, blockDistanceMeters - 1.6));
  }
  if (leaderDistanceMeters !== null) {
    allowed = Math.min(
      allowed,
      Math.max(0, leaderDistanceMeters - physicalGapMeters),
    );
  }
  return allowed;
}

export function cppStepVehicleAuthority(
  index: number,
  state: CppVehicleAuthorityState,
  command: {
    targetSpeedMps: number;
    emergencyBrake?: boolean;
    grade: number;
    passengerCount?: number;
  },
  deltaSeconds: number,
): CppVehicleAuthorityResult {
  if (!cppExports || index < 0 || index >= authorityCount) {
    const passengerCount = Math.max(0, Math.min(110, command.passengerCount ?? 0));
    const result = integrateVehicleDynamics(
      { speedMps: state.speedMps, accelerationMps2: state.accelerationMps2 },
      command,
      deltaSeconds,
      {
        ...REFERENCE_TRAM_PARAMETERS,
        massKg: REFERENCE_TRAM_PARAMETERS.massKg + passengerCount * 75,
        resistanceA_N:
          REFERENCE_TRAM_PARAMETERS.resistanceA_N *
          ((REFERENCE_TRAM_PARAMETERS.massKg + passengerCount * 75) /
            REFERENCE_TRAM_PARAMETERS.massKg),
      },
    );
    return {
      ...result,
      cumulative: {
        speedMps: result.speedMps,
        accelerationMps2: result.accelerationMps2,
        consumedEnergyWh: state.consumedEnergyWh + result.consumedEnergyWh,
        tractionEnergyWh: state.tractionEnergyWh + result.tractionEnergyWh,
        auxiliaryEnergyWh: state.auxiliaryEnergyWh + result.auxiliaryEnergyWh,
        mechanicalBrakeEnergyWh:
          state.mechanicalBrakeEnergyWh + result.mechanicalBrakeEnergyWh,
        grossRegeneratedEnergyWh:
          state.grossRegeneratedEnergyWh + result.grossRegeneratedEnergyWh,
        regeneratedEnergyWh:
          state.regeneratedEnergyWh + result.regeneratedEnergyWh,
        rejectedRegenerationEnergyWh:
          state.rejectedRegenerationEnergyWh + result.rejectedRegenerationEnergyWh,
        downhillPotentialEnergyWh:
          state.downhillPotentialEnergyWh + result.downhillPotentialEnergyWh,
        climbPotentialEnergyWh:
          state.climbPotentialEnergyWh + result.climbPotentialEnergyWh,
      },
      source: "typescript-fallback",
    };
  }

  if (!initializedVehicles.has(index)) {
    cppExports.tram_core_authority_sync(
      index,
      state.speedMps,
      state.accelerationMps2,
      state.consumedEnergyWh,
      state.tractionEnergyWh,
      state.auxiliaryEnergyWh,
      state.mechanicalBrakeEnergyWh,
      state.grossRegeneratedEnergyWh,
      state.regeneratedEnergyWh,
      state.rejectedRegenerationEnergyWh,
      state.downhillPotentialEnergyWh,
      state.climbPotentialEnergyWh,
    );
    initializedVehicles.add(index);
  }
  cppExports.tram_core_authority_step(
    index,
    command.targetSpeedMps,
    command.emergencyBrake ? 1 : 0,
    command.grade,
    command.passengerCount ?? 0,
    deltaSeconds,
  );
  const get = (name: keyof CppHeadwayExports) =>
    (cppExports![name] as (vehicleIndex: number) => number)(index);
  const cumulative: CppVehicleAuthorityState = {
    speedMps: get("tram_core_authority_speed"),
    accelerationMps2: get("tram_core_authority_acceleration"),
    consumedEnergyWh: get("tram_core_authority_consumed"),
    tractionEnergyWh: get("tram_core_authority_traction_energy"),
    auxiliaryEnergyWh: get("tram_core_authority_auxiliary_energy"),
    mechanicalBrakeEnergyWh: get("tram_core_authority_mechanical_brake"),
    grossRegeneratedEnergyWh: get("tram_core_authority_gross_regenerated"),
    regeneratedEnergyWh: get("tram_core_authority_regenerated"),
    rejectedRegenerationEnergyWh: get("tram_core_authority_rejected"),
    downhillPotentialEnergyWh: get("tram_core_authority_downhill"),
    climbPotentialEnergyWh: get("tram_core_authority_climb"),
  };
  return {
    speedMps: cumulative.speedMps,
    accelerationMps2: cumulative.accelerationMps2,
    distanceMeters: get("tram_core_authority_distance"),
    tractionForceN: get("tram_core_authority_traction_force"),
    brakeForceN: get("tram_core_authority_brake_force"),
    resistanceForceN: get("tram_core_authority_resistance_force"),
    consumedEnergyWh: 0,
    tractionEnergyWh: 0,
    auxiliaryEnergyWh: 0,
    mechanicalBrakeEnergyWh: 0,
    grossRegeneratedEnergyWh: 0,
    regeneratedEnergyWh: 0,
    rejectedRegenerationEnergyWh: 0,
    downhillPotentialEnergyWh: 0,
    climbPotentialEnergyWh: 0,
    mode: DYNAMICS_MODES[Math.max(0, Math.min(3, cppExports.tram_core_authority_mode(index)))]!,
    cumulative,
    source: "cpp-wasm",
  };
}

export function cppOverrideVehicleMotion(
  index: number,
  speedMps: number,
  accelerationMps2: number,
) {
  cppExports?.tram_core_authority_override_motion(
    index,
    speedMps,
    accelerationMps2,
  );
}

export function invalidateCppStation(index: number) {
  initializedStations.delete(index);
}

/**
 * Push a station's dwell deadline out to `until` without changing its phase.
 * Used by the passenger boarding model to keep doors open for as long as
 * real boarding/alighting flow requires, instead of the fixed default the
 * station authority would otherwise apply. Safe to call every time the
 * required dwell estimate changes — it just re-syncs the authority's own
 * state (WASM or TypeScript fallback), so no core rebuild is needed.
 */
export function cppExtendStationDwell(index: number, until: number) {
  if (!cppExports || index < 0 || index >= authorityCount) return;
  if (!initializedStations.has(index)) initializedStations.add(index);
  cppExports.tram_core_station_sync(index, 2 /* dwell */, until);
}

export function cppStepStationAuthority(
  index: number,
  state: { phase: "none" | "crawl" | "dwell"; until: number; speedMps: number },
  now: number,
  manual: boolean,
  aligned: boolean,
) {
  const phases = ["none", "crawl", "dwell"] as const;
  if (!cppExports || index < 0 || index >= authorityCount) {
    if (manual) return { ...state, event: 0, source: "typescript-fallback" as const };
    if (state.phase === "crawl" && aligned && state.speedMps <= 0.12) {
      return { phase: "dwell" as const, until: now + 12, event: 1, source: "typescript-fallback" as const };
    }
    if (state.phase === "dwell" && now >= state.until) {
      return { phase: "none" as const, until: 0, event: 2, source: "typescript-fallback" as const };
    }
    return { ...state, event: 0, source: "typescript-fallback" as const };
  }
  if (!initializedStations.has(index)) {
    cppExports.tram_core_station_sync(index, Math.max(0, phases.indexOf(state.phase)), state.until);
    initializedStations.add(index);
  }
  cppExports.tram_core_station_step(index, now, manual ? 1 : 0, aligned ? 1 : 0);
  return {
    phase: phases[cppExports.tram_core_station_phase(index)] ?? "none",
    until: cppExports.tram_core_station_until(index),
    event: cppExports.tram_core_station_event(index),
    source: "cpp-wasm" as const,
  };
}

export type CppServiceState =
  | "in-service"
  | "to-depot"
  | "depot-ingress"
  | "in-depot"
  | "depot-egress";

const SERVICE_STATES: CppServiceState[] = [
  "in-service",
  "to-depot",
  "depot-ingress",
  "in-depot",
  "depot-egress",
];

function ensureCppDepotState(index: number, state: CppServiceState) {
  if (!cppExports || index < 0 || index >= authorityCount) return false;
  if (!initializedDepotStates.has(index)) {
    cppExports.tram_core_depot_sync(index, SERVICE_STATES.indexOf(state));
    initializedDepotStates.add(index);
  }
  return true;
}

export function invalidateCppDepotState(index: number) {
  initializedDepotStates.delete(index);
}

export function cppDepotCommandAuthority(
  index: number,
  state: CppServiceState,
  command: "withdraw" | "dispatch" | "cancel",
) {
  const commandValue = command === "withdraw" ? 1 : command === "dispatch" ? 2 : 3;
  if (ensureCppDepotState(index, state)) {
    return SERVICE_STATES[cppExports!.tram_core_depot_command(index, commandValue)] ?? state;
  }
  if (command === "withdraw" && state === "in-service") return "to-depot";
  if (command === "dispatch" && state === "in-depot") return "depot-egress";
  if (command === "cancel" && state === "to-depot") return "in-service";
  return state;
}

export function cppDepotObserveAuthority(
  index: number,
  state: CppServiceState,
  observation: {
    reachedPortal?: boolean;
    reachedDepot?: boolean;
    reachedLine?: boolean;
    exitClear?: boolean;
  },
) {
  if (ensureCppDepotState(index, state)) {
    return SERVICE_STATES[
      cppExports!.tram_core_depot_observe(
        index,
        observation.reachedPortal ? 1 : 0,
        observation.reachedDepot ? 1 : 0,
        observation.reachedLine ? 1 : 0,
        observation.exitClear ? 1 : 0,
      )
    ] ?? state;
  }
  if (state === "to-depot" && observation.reachedPortal) return "depot-ingress";
  if (state === "depot-ingress" && observation.reachedDepot) return "in-depot";
  if (state === "depot-egress" && observation.reachedLine && observation.exitClear) {
    return "in-service";
  }
  return state;
}

export function cppUniformHeadwayMeters(
  cycleMeters: number,
  activeCount: number,
  fallbackMeters: number,
) {
  if (cppExports) {
    return cppExports.tram_core_uniform_headway(
      cycleMeters,
      activeCount,
      fallbackMeters,
    );
  }
  return activeCount > 0
    ? Math.max(fallbackMeters, cycleMeters / activeCount)
    : fallbackMeters;
}

export function cppDepartureSlot(
  clockSeconds: number,
  windowStartSeconds: number,
  headwaySeconds: number,
  nextReservedSeconds: number | null,
) {
  if (cppExports) {
    return cppExports.tram_core_departure_slot(
      clockSeconds,
      windowStartSeconds,
      headwaySeconds,
      nextReservedSeconds ?? -1,
    );
  }
  if (!(headwaySeconds > 0)) return -1;
  const nearest = Math.round((clockSeconds - windowStartSeconds) / headwaySeconds);
  return Math.max(
    windowStartSeconds + nearest * headwaySeconds,
    nextReservedSeconds ?? Number.NEGATIVE_INFINITY,
  );
}

export function cppDepartureOnTime(
  deviationSeconds: number,
  toleranceSeconds: number,
) {
  return cppExports
    ? Boolean(cppExports.tram_core_departure_on_time(deviationSeconds, toleranceSeconds))
    : Math.abs(deviationSeconds) <= toleranceSeconds;
}

export function cppHeadwaySpeedFactor(
  distanceMeters: number,
  safetyMeters: number,
  restoreAtMeters: number,
) {
  if (cppExports) {
    return cppExports.tram_core_headway_speed_factor(
      distanceMeters,
      safetyMeters,
      restoreAtMeters,
    );
  }
  return Math.max(
    0,
    Math.min(
      1,
      (distanceMeters - safetyMeters) /
        Math.max(1, restoreAtMeters - safetyMeters),
    ),
  );
}

export function cppTerminalIntervalHold(
  elapsedSeconds: number,
  targetSeconds: number,
) {
  return cppExports
    ? Boolean(cppExports.tram_core_terminal_interval_hold(elapsedSeconds, targetSeconds))
    : elapsedSeconds + 0.000001 < targetSeconds;
}

export function cppTerminalBerth(occupiedMask: number): 0 | 1 | 2 {
  const berth = cppExports
    ? cppExports.tram_core_terminal_berth(occupiedMask)
    : !(occupiedMask & 1)
      ? 1
      : !(occupiedMask & 2)
        ? 2
        : 0;
  return berth === 1 || berth === 2 ? berth : 0;
}

export function cppParallelTerminalBypass(
  sameTerminal: boolean,
  occupiedMask: number,
) {
  return cppExports
    ? Boolean(
        cppExports.tram_core_parallel_terminal_bypass(
          sameTerminal ? 1 : 0,
          occupiedMask,
        ),
      )
    : sameTerminal && occupiedMask !== 3;
}
