import { NETWORK_CONFIGS, networkConfigById } from "./network-config.ts";
import { FixedStepClock } from "./fixed-step-clock.ts";
import { type DynamicsMode } from "./vehicle-dynamics.ts";
import {
  configureCppAuthority,
  configureCppPowerAuthority,
  configureCppTrafficAuthority,
  configureCppSwitchAuthority,
  cppDepotCommandAuthority,
  cppDepotObserveAuthority,
  cppDepartureOnTime,
  cppDepartureSlot,
  cppHeadwaySpeedFactor,
  cppParallelTerminalBypass,
  cppTerminalBerth,
  cppTerminalIntervalHold,
  cppOverrideVehicleMotion,
  cppResolveTargetSpeed,
  cppPredictiveEcoTarget,
  cppSpeedProfileTarget,
  cppStationApproachSpeed,
  cppSafeMoveMeters,
  cppReleaseSwitchAuthority,
  cppRequestSwitchAuthority,
  cppStepStationAuthority,
  cppStepTrafficAuthority,
  cppStepVehicleAuthority,
  cppToggleSwitchAuthority,
  cppUniformHeadwayMeters,
  cppExtendStationDwell,
  cppEnergyOptimizedTarget,
  cppSettleTractionPower,
  invalidateCppTrafficController,
  invalidateCppStation,
  invalidateCppDepotState,
  type CppVehicleAuthorityResult,
} from "./cpp-runtime.ts";
import {
  computeBoardingAlighting,
  computeDwellSeconds,
  StopDemandTracker,
} from "./passenger-model.ts";

export type Point = { x: number; y: number };

export type ReaderKind = "traffic" | "switch" | "station" | "telemetry";
export type SwitchPosition = "main" | "branch";
export type TrafficPhase =
  | "road-green"
  | "amber-to-tram"
  | "tram-green"
  | "amber-to-road";
export type TrafficManualMode = "auto" | "tram-green" | "road-green";
export type PriorityPolicy = "fifo" | "schedule" | "fleet";
export type ControlMode = "firmware" | "cooperative";
export type EnergyStrategy = "no-storage" | "baseline" | "network-optimal";
export type ManualCommand = "forward" | "stop" | "reverse";
export type ServiceState =
  | "in-service"
  | "to-depot"
  | "depot-ingress"
  | "in-depot"
  | "depot-egress";

// The local coast-to-stop rule is intentionally withheld from the operational
// strategy: deterministic A/B tests showed that it saved energy partly by
// degrading journey time. Predictive SOC and section peak dispatch remain on.
const PREDICTIVE_ECO_SPEED_CONTROL_ENABLED = false;

export interface TrackSegment {
  id: string;
  from: string;
  to: string;
  points: Point[];
  lengthMeters?: number;
  /** Signed elevation change from segment start to end. */
  elevationChangeMeters?: number;
  render?: boolean;
  label?: string;
}

export interface RFIDReader {
  id: string;
  segmentId: string;
  at: number;
  kind: ReaderKind;
  label: string;
  signalId?: string;
  switchId?: string;
  routeId?: string;
  stationId?: string;
  directionLabel?: string;
  directionShortName?: string;
  stationNumber?: number;
  showLabel?: boolean;
  render?: boolean;
  displayAt?: number;
  labelDistancePx?: number;
  /** Shared departure-board identity for differently named opposite platforms. */
  stopBoardId?: string;
  /** Combined public label for a shared departure board. */
  stopBoardLabel?: string;
  /** Operational timing point where a fixed departure slot is enforced. */
  terminal?: boolean;
  /** Passenger turnback that departs after normal dwell without timetable/headway holding. */
  rapidTurnback?: boolean;
}

export interface SignalDefinition {
  id: string;
  segmentId: string;
  at: number;
  clearAt?: number;
  label: string;
  controllerId?: string;
  render?: boolean;
  amberSeconds?: number;
  tramGreenSeconds?: number;
  clearanceSeconds?: number;
}

export interface JunctionConflictZoneDefinition {
  id: string;
  label: string;
  segmentIds: string[];
}

export interface SwitchDefinition {
  id: string;
  nodeId: string;
  mainSegmentId: string;
  branchSegmentId: string;
  returnSegmentIds?: string[];
  label: string;
  segmentId?: string;
  at?: number;
  alternateApproaches?: Array<{ segmentId: string; at: number }>;
  displayArmLengthPx?: number;
  showArmLabels?: boolean;
}

export interface RouteDefinition {
  id: string;
  name: string;
  shortName: string;
  color: string;
  segmentIds: string[];
  labelSegmentId: string;
  labelAt: number;
  labelOffset: number;
}

export interface MapContextLine {
  id: string;
  label: string;
  kind: "primary" | "secondary";
  points: Point[];
  labelAt?: number;
}

export interface MapContextLandmark {
  label: string;
  point: Point;
}

export interface MapContext {
  title: string;
  subtitle: string;
  sourceLabel: string;
  lines: MapContextLine[];
  landmarks: MapContextLandmark[];
  scaleBarMeters: number;
}

export type PowerLocationConfidence =
  | "verified-address"
  | "verified-count-estimated-location"
  | "schematic";

export interface TractionSubstationDefinition {
  id: string;
  label: string;
  sectionLabel?: string;
  point: Point;
  nominalVoltageV: number;
  maxPowerKw: number;
  confidence: PowerLocationConfidence;
  evidence: string;
  feedsMainLine?: boolean;
}

export interface ElectricalSectionDefinition {
  id: string;
  label: string;
  substationId: string;
  segmentIds: string[];
  color: string;
  flywheel?: {
    model: "VYCON REGEN";
    modules: number;
    modulePowerKw: number;
    moduleEnergyKWh: number;
    chargeEfficiency: number;
    dischargeEfficiency: number;
    initialSoc: number;
    converterNote: string;
  };
}

export interface TractionPowerSystemDefinition {
  nominalVoltageV: number;
  label: string;
  sourceLabel: string;
  modelNote: string;
  substations: TractionSubstationDefinition[];
  sections: ElectricalSectionDefinition[];
}

export interface StudyBaseline {
  label: string;
  lengthKm: number;
  directionalStops: number;
  mappedStopLocations: number;
  fleet: number;
  headwayMinutes: number;
  serviceHours: number;
  dailyTrips: number;
}

export interface FleetGroupDefinition {
  id: string;
  label: string;
  shortName: string;
  routeIntent: SwitchPosition;
  routeId: string;
  defaultCount: number;
  maxCount?: number;
  starts: Array<{ segmentId: string; progress: number }>;
}

export interface DepotPortalDefinition {
  id: string;
  routeId: string;
  fleetGroupIds: string[];
  portalSegmentId: string;
  portalAt: number;
  exitSegmentId: string;
  exitProgress: number;
  lastPassengerStop: string;
  trackPoints: Point[];
}

export interface DepotDefinition {
  id: string;
  label: string;
  shortName: string;
  note: string;
  point: Point;
  portals: DepotPortalDefinition[];
  /**
   * "depot" (default) is a full storage/maintenance yard — effectively
   * unlimited capacity, used for normal end-of-service storage. "turnback"
   * is a short reversing siding used for brief operational recovery (a
   * short-turned tram getting back on schedule) — real ones typically hold
   * only one or two trams and aren't meant for anything longer than that.
   */
  kind?: "depot" | "turnback";
  /** Max trams that may be committed/parked here at once. Omit for unlimited (real depots). */
  capacity?: number;
}

export interface RouteServicePlan {
  plannedHeadwayMinutes: number | null;
  targetActiveTrams: number;
}

export interface ServiceScheduleWindow {
  id: string;
  label: string;
  startMinute: number;
  endMinute: number;
  routes: Record<string, RouteServicePlan>;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  useCase: string;
  segments: TrackSegment[];
  readers: RFIDReader[];
  signals: SignalDefinition[];
  switches: SwitchDefinition[];
  junctionConflictZones?: JunctionConflictZoneDefinition[];
  routes: RouteDefinition[];
  /** Follow routes[].segmentIds as the authoritative directed service cycle. */
  strictRouteSequence?: boolean;
  starts: Array<{ segmentId: string; progress: number }>;
  defaultObstacles: Array<{ segmentId: string; at: number }>;
  defaultTramCount?: number;
  fleetOptions?: number[];
  fleetGroups?: FleetGroupDefinition[];
  depots?: DepotDefinition[];
  serviceSchedule?: ServiceScheduleWindow[];
  serviceStartMinute?: number;
  dispatchIntervalSeconds?: number;
  predeployedFleet?: boolean;
  metersPerReferenceUnit?: number;
  mapContext?: MapContext;
  studyBaseline?: StudyBaseline;
  tractionPowerSystem?: TractionPowerSystemDefinition;
}

export interface SimulationOptions {
  speedLimit: number;
  simulationRate: number;
  autoDispatch: boolean;
  collisionAvoidance: boolean;
  priorityPolicy: PriorityPolicy;
  controlMode: ControlMode;
  energyStrategy: EnergyStrategy;
  sensorRangeMeters: number;
}

export interface ExperimentDefinition {
  format: "autonomous-tram-experiment";
  version: 1;
  name: string;
  savedAt: string;
  networkId: string;
  serviceMinute: number;
  tramCount: number;
  fleetGroups: Record<string, number>;
  options: SimulationOptions;
  obstacles: Array<{ segmentId: string; at: number }>;
  switches: Record<string, SwitchPosition>;
  trafficManualModes: Record<string, TrafficManualMode>;
  selectedTramId: string | null;
  selectedStopId: string | null;
}

export interface TramSnapshot {
  id: string;
  label: string;
  uid: number;
  color: string;
  routeIntent: SwitchPosition;
  fleetGroupId: string | null;
  directionLabel: string | null;
  serviceState: ServiceState;
  serviceLabel: string;
  depotId: string | null;
  lastPassengerStop: string | null;
  linePriority: number;
  speedKmh: number;
  accelerationMps2: number;
  tractionForceKn: number;
  brakeForceKn: number;
  resistanceForceKn: number;
  dynamicsMode: DynamicsMode;
  status: string;
  statusTone: "normal" | "warning" | "danger" | "idle";
  doorsOpen: boolean;
  pwm: number;
  delaySeconds: number;
  /** Actual departure lateness, or current overdue slot; null without a timetable. */
  timetableDelaySeconds: number | null;
  scheduledDepartureClock: string | null;
  scheduledDepartureKind: "depot" | "terminal" | null;
  scheduledDeparturePointLabel: string | null;
  /** Assigned parallel platform at a dual-track Izmir terminus. */
  terminalBerth: 0 | 1 | 2;
  lastDepartureDeviationSeconds: number | null;
  distanceMeters: number;
  energyWh: number;
  recoveredWh: number;
  tractionEnergyWh: number;
  auxiliaryEnergyWh: number;
  mechanicalBrakeEnergyWh: number;
  grossRegeneratedWh: number;
  rejectedRegenerationWh: number;
  downhillPotentialWh: number;
  climbPotentialWh: number;
  emergencyStops: number;
  lap: number;
  segmentId: string;
  progress: number;
  position: Point;
  angle: number;
  manualMode: boolean;
  manualCommand: ManualCommand;
  canReverseToRoute: boolean;
  branchReturnSwitchId: string | null;
  leaderTramId: string | null;
  headwayAheadMeters: number | null;
  targetHeadwayMeters: number;
  onboardPassengers: number;
  passengerCapacity: number;
  vehicleMassTonnes: number;
  profileLimitKmh: number;
  profileReason: "line" | "curve" | "turnout";
  restrictionDistanceMeters: number | null;
  curveRadiusMeters: number | null;
  lateralAccelerationMps2: number;
  ecoDrivingMode: "cruise" | "coast" | "predictive-brake";
  ecoConstraintDistanceMeters: number | null;
  ecoConstraintLabel: string | null;
  /** Station whose coast approach is latched until its detector takes over. */
  ecoApproachStopId: string | null;
  ecoCoastSeconds: number;
}

export interface FleetGroupSnapshot {
  id: string;
  label: string;
  shortName: string;
  routeId: string;
  routeIntent: SwitchPosition;
  count: number;
  maxCount: number;
}

export interface DepotSnapshot {
  id: string;
  label: string;
  shortName: string;
  note: string;
  point: Point;
  storedTrams: number;
  inboundTrams: number;
  outboundTrams: number;
  kind: "depot" | "turnback";
  capacity: number | null;
}

export interface RoadVehicleSnapshot {
  id: string;
  controllerId: string;
  direction: 1 | -1;
  progress: number;
  speed: number;
  stopped: boolean;
  color: string;
}

export interface RouteOperationsSnapshot {
  routeId: string;
  routeName: string;
  shortName: string;
  color: string;
  plannedHeadwayMinutes: number | null;
  actualHeadwayMinutes: number | null;
  /** True once the value comes from actual terminal departure timestamps. */
  actualHeadwayMeasured: boolean;
  onRoute: number;
  toDepot: number;
  inDepot: number;
  totalFleet: number;
  /** Passengers currently waiting across all of this route's stops. */
  waitingPassengers: number;
  /** Worst-case (busiest stop) Little's-Law average wait estimate, seconds. */
  averageWaitSeconds: number;
  /** People currently aboard in-service trams on this route. */
  onboardPassengers: number;
  /** Combined seated+standing capacity of those same trams. */
  onboardCapacity: number;
  scheduledDepartures: number;
  departureAdherencePercent: number | null;
  meanDepartureDeviationSeconds: number | null;
}

export interface EventEntry {
  id: number;
  at: number;
  time: string;
  tone: "info" | "ok" | "warning" | "danger";
  message: string;
}

export interface ObstacleState {
  id: string;
  segmentId: string;
  at: number;
}

export interface SwitchSnapshot {
  id: string;
  label: string;
  state: SwitchPosition;
  lockedBy: string | null;
  queued: number;
}

export interface TrafficControllerSnapshot {
  id: string;
  label: string;
  phase: TrafficPhase;
  activeTramId: string | null;
  activeSignalId: string | null;
  queued: number;
  manualMode: TrafficManualMode;
  manualSignalId: string | null;
  manualReleasePending: boolean;
}

export type StopArrivalStatus =
  | "moving"
  | "recovering"
  | "due"
  | "scheduled"
  | "held";

export interface StopArrivalSnapshot {
  tramId: string;
  tramLabel: string;
  color: string;
  distanceMeters: number;
  etaSeconds: number | null;
  status: StopArrivalStatus;
  statusLabel: string;
}

export interface StopDirectionSnapshot {
  id: string;
  label: string;
  shortName: string;
  platformLabel: string;
  color: string;
  arrivals: StopArrivalSnapshot[];
  /** Passengers currently waiting at this platform/direction, per the demand model. */
  waitingPassengers: number;
  /** Little's-Law estimate of average passenger wait time at this platform. */
  averageWaitSeconds: number;
  /** True once passengers have recently been left behind by a full tram. */
  overcrowded: boolean;
}

export interface StopBoardSnapshot {
  id: string;
  stationNumber: number | null;
  label: string;
  point: Point;
  directions: StopDirectionSnapshot[];
}

export interface SimulationMetrics {
  averageSpeedKmh: number;
  headwayMeters: number;
  targetHeadwayMeters: number;
  onTimePercent: number;
  scheduledDepartures: number;
  departureAdherencePercent: number | null;
  meanDepartureDeviationSeconds: number | null;
  completedLaps: number;
  energyWh: number;
  recoveredWh: number;
  emergencyStops: number;
  intervalRecoveryTrams: number;
}

export interface RouteEnergySnapshot {
  routeId: string;
  label: string;
  tramCount: number;
  distanceKm: number;
  tractionKWh: number;
  auxiliaryKWh: number;
  gridDrawKWh: number;
  mechanicalBrakeKWh: number;
  grossRegeneratedKWh: number;
  acceptedRegeneratedKWh: number;
  rejectedKWh: number;
  downhillPotentialKWh: number;
  climbPotentialKWh: number;
  netGridKWh: number;
  recoveryPercent: number;
}

export interface EnergyStatisticsSnapshot {
  modelLabel: string;
  sourceLabel: string;
  studyMassTonnes: number;
  measuredDescentMeters: number;
  studyPotentialKWhPerRun: number;
  elevationSections: Array<{
    label: string;
    fromMeters: number;
    toMeters: number;
    potentialKWh: number;
  }>;
  routes: RouteEnergySnapshot[];
  total: RouteEnergySnapshot;
  powerSystem: {
    enabled: boolean;
    label: string;
    nominalVoltageV: number;
    sourceLabel: string;
    modelNote: string;
    strategy: EnergyStrategy;
    localReuseKWh: number;
    gridSupplyKWh: number;
    rejectedGeneratorKWh: number;
    flywheelStoredKWh: number;
    flywheelCapacityKWh: number;
    flywheelChargedKWh: number;
    flywheelDischargedKWh: number;
    flywheelLossesKWh: number;
    peakGridPowerKw: number;
    interventions: number;
    sections: PowerSectionSnapshot[];
  };
}

export interface PowerSectionSnapshot {
  id: string;
  label: string;
  substationId: string;
  substationLabel: string;
  confidence: PowerLocationConfidence;
  color: string;
  tramCount: number;
  tractionPowerKw: number;
  regenerationPowerKw: number;
  locallyReusedPowerKw: number;
  gridPowerKw: number;
  localReuseKWh: number;
  gridSupplyKWh: number;
  rejectedGeneratorKWh: number;
  peakGridPowerKw: number;
  utilizationPercent: number;
  flywheelModel: string | null;
  flywheelModules: number;
  flywheelSocPercent: number;
  flywheelRpm: number;
  flywheelEnergyKWh: number;
  flywheelCapacityKWh: number;
  flywheelChargePowerKw: number;
  flywheelDischargePowerKw: number;
  flywheelChargedKWh: number;
  flywheelDischargedKWh: number;
  flywheelLossesKWh: number;
  flywheelMode: "reserve" | "peak-only" | "balanced" | "space-making" | "charging" | "discharging" | "idle";
  flywheelReservePercent: number;
  flywheelTargetGridKw: number;
  forecastTractionKw: number;
  forecastRegenerationKw: number;
}

export interface SimulationSnapshot {
  running: boolean;
  time: number;
  clock: string;
  scenarioId: string;
  scenarioName: string;
  scenarioDescription: string;
  options: SimulationOptions;
  trafficPhase: TrafficPhase;
  activeTrafficTram: string | null;
  activeTrafficSignal: string | null;
  trafficControllers: TrafficControllerSnapshot[];
  stopBoards: StopBoardSnapshot[];
  selectedStopId: string | null;
  fleetGroups: FleetGroupSnapshot[];
  fleetCapacity: number;
  depots: DepotSnapshot[];
  roadVehicles: RoadVehicleSnapshot[];
  routeOperations: RouteOperationsSnapshot[];
  serviceScheduleLabel: string | null;
  serviceMinute: number;
  trams: TramSnapshot[];
  events: EventEntry[];
  obstacles: ObstacleState[];
  switches: SwitchSnapshot[];
  metrics: SimulationMetrics;
  energyStatistics: EnergyStatisticsSnapshot;
  warningCount: number;
}

interface SegmentRuntime extends TrackSegment {
  cumulative: number[];
  lengthRef: number;
  lengthMeters: number;
}

interface SpeedRestrictionRuntime {
  id: string;
  segmentId: string;
  at: number;
  reason: "curve" | "turnout";
  radiusMeters: number | null;
  infrastructureSpeedMps: number | null;
}

interface SpeedProfileGuidanceResult {
  targetSpeedMps: number;
  reason: "line" | "curve" | "turnout";
  distanceMeters: number | null;
  radiusMeters: number | null;
  nextConstraintDistanceMeters: number | null;
  nextConstraintSpeedMps: number;
  nextConstraintReason: "line" | "curve" | "turnout";
}

interface TramState {
  id: string;
  label: string;
  uid: number;
  color: string;
  routeIntent: SwitchPosition;
  fleetGroupId: string | null;
  directionLabel: string | null;
  serviceState: ServiceState;
  depotId: string | null;
  depotPortalId: string | null;
  depotProgress: number;
  /** simulationTime when this tram last entered "in-depot" — see TURNBACK_MAX_DWELL_SECONDS. */
  depotEnteredAt: number;
  depotHoldManual: boolean;
  lastPassengerStop: string | null;
  linePriority: number;
  segmentId: string;
  progress: number;
  speedMps: number;
  targetSpeedMps: number;
  status: string;
  statusTone: TramSnapshot["statusTone"];
  pwm: number;
  releaseTime: number;
  delaySeconds: number;
  scheduledDepartureAt: number | null;
  scheduledDepartureClockSeconds: number | null;
  scheduledDepartureKind: "depot" | "terminal" | null;
  scheduledDeparturePointLabel: string | null;
  lastDepartureDeviationSeconds: number | null;
  distanceMeters: number;
  /** distanceMeters snapshot taken when this service period began — see updateTramTelemetry. */
  serviceStartDistanceMeters: number;
  energyWh: number;
  recoveredWh: number;
  tractionEnergyWh: number;
  auxiliaryEnergyWh: number;
  mechanicalBrakeEnergyWh: number;
  grossRegeneratedWh: number;
  rejectedRegenerationWh: number;
  downhillPotentialWh: number;
  climbPotentialWh: number;
  lap: number;
  lapMarkerSegmentId: string;
  lastAcceleration: number;
  tractionForceN: number;
  brakeForceN: number;
  resistanceForceN: number;
  dynamicsMode: DynamicsMode;
  triggeredOnSegment: Set<string>;
  stationPhase: "none" | "crawl" | "dwell";
  stationUntil: number;
  /** True while a terminal departure is checked against the temporal headway. */
  terminalIntervalHold: boolean;
  /** 1/2 at the two Izmir terminal platforms, otherwise 0. */
  terminalBerth: 0 | 1 | 2;
  /** Terminal reader where this tram waits while both Izmir berths are occupied. */
  terminalEntryQueueReaderId: string | null;
  lastBlockKey: string | null;
  emergencyStops: number;
  manualMode: boolean;
  manualCommand: ManualCommand;
  branchOrigin: {
    switchId: string;
    routeSegmentId: string;
    routeProgress: number;
  } | null;
  desiredHeadwayMeters: number;
  etaAverageSpeedMps: number;
  /** People currently aboard, tracked by the passenger boarding model. */
  onboardPassengers: number;
  /** The "station" RFID reader id this tram is currently dwelling at, if any. */
  pendingStationReaderId: string | null;
  energyGuidanceActive: boolean;
  profileLimitMps: number;
  profileReason: "line" | "curve" | "turnout";
  restrictionDistanceMeters: number | null;
  curveRadiusMeters: number | null;
  lateralAccelerationMps2: number;
  ecoDrivingMode: "cruise" | "coast" | "predictive-brake";
  ecoConstraintDistanceMeters: number | null;
  ecoConstraintLabel: string | null;
  /** Station whose coast approach remains latched until its detector takes over. */
  ecoApproachStopId: string | null;
  ecoCoastSeconds: number;
}

interface PowerSectionRuntime {
  tractionPowerKw: number;
  regenerationPowerKw: number;
  locallyReusedPowerKw: number;
  gridPowerKw: number;
  localReuseWh: number;
  gridSupplyWh: number;
  rejectedGeneratorWh: number;
  peakGridPowerKw: number;
  flywheelEnergyWh: number;
  flywheelCapacityWh: number;
  flywheelChargePowerKw: number;
  flywheelDischargePowerKw: number;
  flywheelChargedWh: number;
  flywheelDischargedWh: number;
  flywheelLossesWh: number;
  flywheelMode: number;
  flywheelTargetGridKw: number;
  forecastTractionKw: number;
  forecastRegenerationKw: number;
}

interface TramPlan {
  start: { segmentId: string; progress: number };
  routeIntent: SwitchPosition;
  fleetGroupId: string | null;
  directionLabel: string | null;
}

type RoadVehicleState = RoadVehicleSnapshot;

interface SwitchRuntime {
  id: string;
  state: SwitchPosition;
  lockedBy: string | null;
  queue: Array<{ tramId: string; desired: SwitchPosition; requestedAt: number }>;
}

interface TrafficRequest {
  tramId: string;
  signalId: string;
  requestedAt: number;
}

interface TrafficRuntime {
  id: string;
  label: string;
  phase: TrafficPhase;
  phaseUntil: number;
  activeTramId: string | null;
  activeSignalId: string | null;
  activeTramCleared: boolean;
  activeTramEntered: boolean;
  activeGrantedAt: number;
  queue: TrafficRequest[];
  amberSeconds: number;
  tramGreenSeconds: number;
  clearanceSeconds: number;
  manualMode: TrafficManualMode;
  manualSignalId: string | null;
  manualReleasePending: boolean;
}

const OPEN_UID_VALUES = [2305050007, 3294433023];
const CLOSED_UID_VALUES = [2464178048, 1269352972];
const OPEN_UIDS = new Set(OPEN_UID_VALUES);
const CLOSED_UIDS = new Set(CLOSED_UID_VALUES);
const TRAM_UIDS = [2464178048, 2305050007, 1269352972, 3294433023];
const TRAM_COLORS = [
  "#25d4e8",
  "#f4a62a",
  "#9b8cff",
  "#42d392",
  "#ff7f8a",
  "#7fda8c",
  "#f0d45a",
  "#62a8ff",
  "#df83ef",
  "#ff9f67",
];
const REFERENCE_TO_METERS = 0.55;
const MAX_TRAMS = 20;
const PHYSICAL_TRAM_GAP_METERS = 7;
const TRAM_LENGTH_METERS = 15;
const SAFETY_HEADWAY_METERS = 30;
const FALLBACK_HEADWAY_METERS = 45;
const HEADWAY_RESTORE_THRESHOLD = 0.92;
const STOP_BOARD_REFRESH_SECONDS = 5;
const ETA_SPEED_AVERAGE_SECONDS = 90;
const ETA_CORRECTION_WEIGHT = 0.28;
const ETA_MAX_EARLY_CORRECTION_SECONDS = 10;
const ETA_MAX_LATE_CORRECTION_SECONDS = 18;
const ROAD_CAR_SPEED = 0.028;
const ROAD_CAR_GAP = 0.13;
const DEPOT_TRACK_SPEED_MPS = 8;
const DEPOT_TRANSFER_SECONDS = 12;
const SERVICE_PLAN_RECHECK_SECONDS = 20;
const TRAFFIC_GRANT_TIMEOUT_SECONDS = 25;
const ROAD_CAR_COLORS = ["#d7e4ea", "#f4a62a", "#62a8ff", "#ff7f8a"];

// --- Passenger demand & boarding model -----------------------------------
/** Single-car tram crush capacity (seated + standing), used for overcrowding checks. */
const TRAM_CAPACITY = 110;
const EMPTY_TRAM_MASS_KG = 27_500;
const PASSENGER_MASS_KG = 75;
const COMFORT_LATERAL_ACCELERATION_MPS2 = 0.65;
const PROFILE_APPROACH_DECELERATION_MPS2 = 0.72;
const PROFILE_LOOKAHEAD_METERS = 1_000;
const MAIN_TURNOUT_SPEED_MPS = 20 / 3.6;
const BRANCH_TURNOUT_SPEED_MPS = 15 / 3.6;
/** Baseline arrivals per minute at an "average" stop before time-of-day/stop weighting. */
const PASSENGER_BASE_RATE_PER_MINUTE = 1.4;
/** Fraction of onboard passengers that alight at an average stop. */
const PASSENGER_ALIGHT_FRACTION = 0.22;
const PASSENGER_DOOR_COUNT = 3;
const PASSENGER_SECONDS_PER_BOARDING = 1.3;
const PASSENGER_SECONDS_PER_ALIGHTING = 0.9;
const PASSENGER_DOOR_CYCLE_OVERHEAD_SECONDS = 3;
const PASSENGER_MIN_DWELL_SECONDS = 8;
/** Safety cap so an extreme surge can't stall a tram indefinitely. */
const PASSENGER_MAX_DWELL_SECONDS = 45;
/** A terminal/depot departure within one minute of its slot is on time. */
const DEPARTURE_ON_TIME_TOLERANCE_SECONDS = 60;
/**
 * A following tram may close a modest part of a delay, but it must not leave
 * a terminal so close behind the previous departure that the line bunches.
 * Using time here (rather than route distance) matches the passenger-facing
 * service interval and does not vary with speed or geometry.
 */
const MIN_TERMINAL_HEADWAY_FACTOR = 0.85;
/**
 * --- Dispatcher philosophy -------------------------------------------------
 * Fleet size on each route is normally set by the schedule window only
 * (targetActiveTrams below), which changes a handful of times a day and is
 * approached gradually (one tram per recheck). Day-to-day headway keeping is
 * the job of in-service trams regulating themselves via intervalGuidance
 * (anti-bunching speed control). Pulling a tram from/to the depot is
 * deliberately treated as a last resort for two specific emergencies:
 *  - sustained, severe overcrowding nobody already on the route can absorb
 *    (extraTramFromDepot below), or
 *  - a single tram catastrophically behind schedule, e.g. after being stuck
 *    behind an obstacle (shortTurn below).
 * Both require the triggering condition to hold continuously for a while
 * (not a single instant reading) and both have long cooldowns, specifically
 * so the fleet size can't oscillate. There is deliberately no "release to
 * depot because ridership dipped for a moment" — real dispatchers don't
 * shrink service off a momentary lull, and reacting to a moving average this
 * way is exactly what caused visible flapping in practice.
 */
/** Average wait (Little's Law estimate) that counts as "severely overcrowded". */
const DEMAND_EXTRA_TRAM_WAIT_SECONDS = 600;
/** How long that overcrowding must persist, continuously, before acting. */
const DEMAND_SUSTAINED_SECONDS = 300;
/** How long a granted emergency boost lasts if the overcrowding stops renewing it. */
const EMERGENCY_BOOST_DURATION_SECONDS = 1200;
/**
 * Turnback sidings are brief tactical recovery tracks, not storage — a tram
 * parked in one for longer than this is sent back into service regardless
 * of the route's target, so the (usually one-track) siding doesn't end up
 * quietly monopolized like a spare depot.
 */
const TURNBACK_MAX_DWELL_SECONDS = 600;
/** Minimum time between emergency extra-tram dispatches on the same route. */
const DEMAND_ADJUST_COOLDOWN_SECONDS = 900;
/**
 * A tram running later than (its route's planned headway × this factor) is
 * considered short-turn material — scales with the route's own schedule
 * rather than a flat number, since a 20-minute headway route running 7
 * minutes late is unremarkable, while the same 7 minutes would be a crisis
 * on a 5-minute headway route.
 */
const SHORT_TURN_HEADWAY_MULTIPLIER = 2.5;
/** Floor so a route with no configured headway still gets a sane threshold. */
const SHORT_TURN_MIN_DELAY_SECONDS = 600;
/** How long the delay must persist, continuously, before withdrawing the tram. */
const SHORT_TURN_SUSTAINED_SECONDS = 180;
/**
 * How often every stop's demand tracker gets a lazy catch-up regardless of
 * tram visits or dispatcher activity. Bounds the "stale point-in-time rate"
 * approximation in StopDemandTracker.advance() to a short window even for
 * stops nobody has visited in a while, so a long-idle route doesn't end up
 * with a wildly over/under-estimated wait time.
 */
const DEMAND_REFRESH_SECONDS = 20;

const stationBoardId = (reader: RFIDReader) =>
  reader.stopBoardId
    ? `STOP-${reader.stopBoardId}`
    : reader.stationId
    ? `STOP-${reader.stationId}`
    : reader.stationNumber
    ? `STOP-${String(reader.stationNumber).padStart(2, "0")}`
    : `STOP-${reader.label
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`;

const supportsLegacyFirmware = (scenario: ScenarioDefinition) =>
  scenario.switches.length === 1 &&
  scenario.readers.some((reader) => reader.kind === "switch");

const segment = (
  id: string,
  from: string,
  to: string,
  points: Point[],
  label: string,
  render = true,
): TrackSegment => ({ id, from, to, points, label, render });

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "prototype-loop",
    name: "Prototype Loop + Junction",
    shortName: "Prototype loop",
    description:
      "A digital version of the physical 2021 layout: one loop, an RFID-controlled depot turnout, a stop reed sensor and a protected signal.",
    useCase: "Validate the original controller before extending the network.",
    segments: [
      segment("P1", "A", "B", [{ x: 165, y: 150 }, { x: 760, y: 150 }], "North straight"),
      segment(
        "P2",
        "B",
        "C",
        [
          { x: 760, y: 150 },
          { x: 835, y: 155 },
          { x: 892, y: 210 },
          { x: 900, y: 282 },
        ],
        "East curve",
      ),
      segment(
        "P3",
        "C",
        "SW",
        [
          { x: 900, y: 282 },
          { x: 895, y: 350 },
          { x: 835, y: 398 },
          { x: 520, y: 400 },
        ],
        "Junction approach",
      ),
      segment("P4", "SW", "F", [{ x: 520, y: 400 }, { x: 180, y: 400 }], "Main line"),
      segment(
        "P5",
        "F",
        "A",
        [
          { x: 180, y: 400 },
          { x: 105, y: 397 },
          { x: 58, y: 345 },
          { x: 55, y: 270 },
          { x: 75, y: 200 },
          { x: 165, y: 150 },
        ],
        "West curve",
      ),
      segment(
        "P6",
        "SW",
        "DEPOT",
        [
          { x: 520, y: 400 },
          { x: 566, y: 422 },
          { x: 618, y: 492 },
          { x: 675, y: 590 },
        ],
        "Depot branch",
      ),
      segment(
        "P7",
        "DEPOT",
        "SW",
        [
          { x: 675, y: 590 },
          { x: 618, y: 492 },
          { x: 566, y: 422 },
          { x: 520, y: 400 },
        ],
        "Depot return",
        false,
      ),
    ],
    readers: [
      { id: "R01", segmentId: "P5", at: 0.62, kind: "station", label: "Prototype Stop" },
      { id: "R02", segmentId: "P1", at: 0.32, kind: "telemetry", label: "Telemetry checkpoint" },
      { id: "R03", segmentId: "P3", at: 0.67, kind: "switch", label: "Turnout RFID reader" },
      {
        id: "R04",
        segmentId: "P1",
        at: 0.76,
        kind: "traffic",
        label: "Signal request RFID",
        signalId: "SG-01",
      },
    ],
    signals: [{ id: "SG-01", segmentId: "P2", at: 0.78, label: "Protected signal" }],
    switches: [
      {
        id: "SW-01",
        nodeId: "SW",
        mainSegmentId: "P4",
        branchSegmentId: "P6",
        returnSegmentIds: ["P7"],
        label: "Depot turnout",
      },
    ],
    routes: [
      {
        id: "L1",
        name: "Prototype Loop",
        shortName: "L1",
        color: "#25d4e8",
        segmentIds: ["P1", "P2", "P3", "P4", "P5"],
        labelSegmentId: "P1",
        labelAt: 0.5,
        labelOffset: -27,
      },
      {
        id: "D",
        name: "Depot Branch",
        shortName: "D",
        color: "#9b8cff",
        segmentIds: ["P3", "P6", "P7"],
        labelSegmentId: "P6",
        labelAt: 0.58,
        labelOffset: 30,
      },
    ],
    starts: [
      { segmentId: "P1", progress: 0.12 },
      { segmentId: "P4", progress: 0.18 },
      { segmentId: "P2", progress: 0.18 },
      { segmentId: "P5", progress: 0.22 },
    ],
    defaultObstacles: [{ segmentId: "P4", at: 0.56 }],
  },
  {
    id: "shared-corridor",
    name: "Shared Corridor",
    shortName: "Shared corridor",
    description:
      "Two directional loops share a central junction. It exposes merge conflicts, queue order and the effect of dispatch headway.",
    useCase: "Compare FIFO, timetable and line-priority arbitration.",
    segments: [
      segment(
        "S1",
        "WA",
        "X",
        [
          { x: 115, y: 155 },
          { x: 290, y: 155 },
          { x: 405, y: 225 },
          { x: 500, y: 310 },
        ],
        "West inbound",
      ),
      segment(
        "S2",
        "X",
        "EB",
        [
          { x: 500, y: 310 },
          { x: 595, y: 395 },
          { x: 710, y: 465 },
          { x: 885, y: 465 },
        ],
        "East outbound",
      ),
      segment(
        "S3",
        "EB",
        "EA",
        [
          { x: 885, y: 465 },
          { x: 935, y: 425 },
          { x: 950, y: 310 },
          { x: 935, y: 195 },
          { x: 885, y: 155 },
        ],
        "East loop",
      ),
      segment(
        "S4",
        "EA",
        "X",
        [
          { x: 885, y: 155 },
          { x: 710, y: 155 },
          { x: 595, y: 225 },
          { x: 500, y: 310 },
        ],
        "East inbound",
      ),
      segment(
        "S5",
        "X",
        "WB",
        [
          { x: 500, y: 310 },
          { x: 405, y: 395 },
          { x: 290, y: 465 },
          { x: 115, y: 465 },
        ],
        "West outbound",
      ),
      segment(
        "S6",
        "WB",
        "WA",
        [
          { x: 115, y: 465 },
          { x: 65, y: 425 },
          { x: 50, y: 310 },
          { x: 65, y: 195 },
          { x: 115, y: 155 },
        ],
        "West loop",
      ),
    ],
    readers: [
      {
        id: "R01",
        segmentId: "S1",
        at: 0.68,
        kind: "traffic",
        label: "West signal request",
        signalId: "SG-W",
      },
      {
        id: "R02",
        segmentId: "S4",
        at: 0.68,
        kind: "traffic",
        label: "East signal request",
        signalId: "SG-E",
      },
      { id: "R03", segmentId: "S1", at: 0.86, kind: "switch", label: "West route reader" },
      { id: "R04", segmentId: "S4", at: 0.86, kind: "switch", label: "East route reader" },
      { id: "R05", segmentId: "S3", at: 0.5, kind: "station", label: "East Terminal" },
      { id: "R06", segmentId: "S6", at: 0.5, kind: "station", label: "West Terminal" },
    ],
    signals: [
      { id: "SG-W", segmentId: "S1", at: 0.93, label: "West entry" },
      { id: "SG-E", segmentId: "S4", at: 0.93, label: "East entry" },
    ],
    switches: [
      {
        id: "SW-X",
        nodeId: "X",
        mainSegmentId: "S2",
        branchSegmentId: "S5",
        label: "Central route selector",
      },
    ],
    routes: [
      {
        id: "E",
        name: "East Loop",
        shortName: "E",
        color: "#25d4e8",
        segmentIds: ["S1", "S2", "S3", "S4"],
        labelSegmentId: "S2",
        labelAt: 0.58,
        labelOffset: -28,
      },
      {
        id: "W",
        name: "West Loop",
        shortName: "W",
        color: "#f4a62a",
        segmentIds: ["S4", "S5", "S6", "S1"],
        labelSegmentId: "S5",
        labelAt: 0.58,
        labelOffset: 28,
      },
    ],
    starts: [
      { segmentId: "S1", progress: 0.05 },
      { segmentId: "S4", progress: 0.05 },
      { segmentId: "S3", progress: 0.42 },
      { segmentId: "S6", progress: 0.42 },
    ],
    defaultObstacles: [],
  },
  {
    id: "city-interchange",
    name: "Twin-loop Interchange",
    shortName: "Twin-loop interchange",
    description:
      "An outer city loop and an inner express loop reconnect at a protected junction, creating asymmetric travel times.",
    useCase: "Test mixed services, schedule recovery and junction priority.",
    segments: [
      segment("G1", "A", "B", [{ x: 100, y: 120 }, { x: 500, y: 120 }], "Northwest line"),
      segment("G2", "B", "C", [{ x: 500, y: 120 }, { x: 865, y: 120 }], "Northeast line"),
      segment(
        "G3",
        "C",
        "D",
        [
          { x: 865, y: 120 },
          { x: 930, y: 165 },
          { x: 930, y: 435 },
          { x: 865, y: 500 },
        ],
        "East line",
      ),
      segment("G4", "D", "X", [{ x: 865, y: 500 }, { x: 500, y: 500 }], "Interchange approach"),
      segment("G5", "X", "E", [{ x: 500, y: 500 }, { x: 100, y: 500 }], "Outer westbound"),
      segment(
        "G6",
        "E",
        "A",
        [
          { x: 100, y: 500 },
          { x: 45, y: 440 },
          { x: 45, y: 180 },
          { x: 100, y: 120 },
        ],
        "West line",
      ),
      segment("G7", "X", "Y", [{ x: 500, y: 500 }, { x: 500, y: 285 }], "Express link"),
      segment("G8", "Y", "B", [{ x: 500, y: 285 }, { x: 500, y: 120 }], "Express return"),
    ],
    readers: [
      {
        id: "R01",
        segmentId: "G3",
        at: 0.72,
        kind: "traffic",
        label: "Interchange request",
        signalId: "SG-X",
      },
      { id: "R02", segmentId: "G4", at: 0.7, kind: "switch", label: "Express route reader" },
      { id: "R03", segmentId: "G5", at: 0.58, kind: "station", label: "Civic Centre" },
      { id: "R04", segmentId: "G2", at: 0.5, kind: "telemetry", label: "North line checkpoint" },
      { id: "R05", segmentId: "G7", at: 0.52, kind: "station", label: "Express Interchange" },
    ],
    signals: [{ id: "SG-X", segmentId: "G4", at: 0.9, label: "Interchange entry" }],
    switches: [
      {
        id: "SW-X",
        nodeId: "X",
        mainSegmentId: "G5",
        branchSegmentId: "G7",
        label: "Express turnout",
      },
    ],
    routes: [
      {
        id: "O",
        name: "Outer Loop",
        shortName: "O",
        color: "#25d4e8",
        segmentIds: ["G1", "G2", "G3", "G4", "G5", "G6"],
        labelSegmentId: "G1",
        labelAt: 0.3,
        labelOffset: -28,
      },
      {
        id: "X",
        name: "Express Line",
        shortName: "X",
        color: "#9b8cff",
        segmentIds: ["G2", "G3", "G4", "G7", "G8"],
        labelSegmentId: "G7",
        labelAt: 0.42,
        labelOffset: -31,
      },
    ],
    starts: [
      { segmentId: "G1", progress: 0.08 },
      { segmentId: "G4", progress: 0.2 },
      { segmentId: "G2", progress: 0.35 },
      { segmentId: "G6", progress: 0.45 },
    ],
    defaultObstacles: [{ segmentId: "G2", at: 0.72 }],
  },
  ...NETWORK_CONFIGS,
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const buildSegmentRuntime = (input: TrackSegment): SegmentRuntime => {
  const cumulative = [0];
  for (let index = 1; index < input.points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + distance(input.points[index - 1], input.points[index]),
    );
  }
  const lengthRef = cumulative[cumulative.length - 1] || 1;
  return {
    ...input,
    cumulative,
    lengthRef,
    lengthMeters: input.lengthMeters ?? lengthRef * REFERENCE_TO_METERS,
  };
};

export const sampleTrackSegment = (
  segmentInput: TrackSegment | SegmentRuntime,
  progressInput: number,
): { point: Point; angle: number } => {
  const runtime =
    "cumulative" in segmentInput ? segmentInput : buildSegmentRuntime(segmentInput);
  const progress = clamp(progressInput, 0, 1);
  const target = progress * runtime.lengthRef;
  let index = 1;
  while (index < runtime.cumulative.length && runtime.cumulative[index] < target) {
    index += 1;
  }
  index = Math.min(index, runtime.points.length - 1);
  const previousDistance = runtime.cumulative[index - 1] ?? 0;
  const span = Math.max(0.0001, runtime.cumulative[index] - previousDistance);
  const local = clamp((target - previousDistance) / span, 0, 1);
  const start = runtime.points[index - 1];
  const end = runtime.points[index];
  return {
    point: {
      x: start.x + (end.x - start.x) * local,
      y: start.y + (end.y - start.y) * local,
    },
    angle: Math.atan2(end.y - start.y, end.x - start.x),
  };
};

const circumradius = (a: Point, b: Point, c: Point) => {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);
  const cross = Math.abs(
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  );
  return cross > 1e-8 ? (ab * bc * ac) / (2 * cross) : Number.POSITIVE_INFINITY;
};

export class SimulationEngine {
  private readonly fixedStepClock = new FixedStepClock(0.05, 20);
  private scenarioDefinition: ScenarioDefinition;
  private segments = new Map<string, SegmentRuntime>();
  private speedRestrictions: SpeedRestrictionRuntime[] = [];
  private speedRestrictionsBySegment = new Map<string, SpeedRestrictionRuntime[]>();
  private stationReadersBySegment = new Map<string, RFIDReader[]>();
  private trams: TramState[] = [];
  private switchStates = new Map<string, SwitchRuntime>();
  private trafficControllers = new Map<string, TrafficRuntime>();
  private roadVehicles: RoadVehicleState[] = [];
  private events: EventEntry[] = [];
  private obstacles: ObstacleState[] = [];
  private eventSequence = 0;
  private obstacleSequence = 0;
  /** One passenger demand tracker per "station" RFID reader (platform/direction). */
  private stopDemand = new Map<string, StopDemandTracker>();
  /** Cooldown timestamps so the last-resort extra-tram dispatch can't repeat quickly. */
  private lastDemandAdjustAt = new Map<string, number>();
  /** routeId -> simulationTime when severe overcrowding started, for the sustained-duration check. */
  private demandSustainedSinceAt = new Map<string, number>();
  /** routeId -> simulationTime until which an emergency extra-tram boost is authorized. */
  private emergencyBoostUntil = new Map<string, number>();
  /** tramId -> simulationTime when this tram first crossed its short-turn delay threshold. */
  private delaySustainedSinceAt = new Map<string, number>();
  /** Next unassigned absolute service-clock slot for each terminal/depot gate. */
  private nextDepartureSlotByPoint = new Map<string, number>();
  /** Last actual simulation-time departure for each route and terminal direction. */
  private lastTerminalDepartureAtByPoint = new Map<string, number>();
  /** Measured terminal intervals grouped by the active timetable window and route. */
  private terminalHeadwayStatsByRouteWindow = new Map<
    string,
    { total: number; sumSeconds: number }
  >();
  private departureStatsByRoute = new Map<
    string,
    { total: number; onTime: number; absoluteDeviationSeconds: number }
  >();
  /** Throttles the periodic all-stops demand refresh (see DEMAND_REFRESH_SECONDS). */
  private nextDemandRefreshAt = 0;
  private simulationTime = 0;
  private serviceClockOffsetSeconds = 0;
  private nextServicePlanCheckAt = 0;
  private isRunning = false;
  private tramCount = 2;
  private fleetGroupCounts: Map<string, number> | null = null;
  private selectedTramId = "T01";
  private selectedStopId: string | null = null;
  private stopBoardCache: StopBoardSnapshot[] = [];
  private stopBoardCacheSecond = -1;
  private stopBoardCacheGeneratedAt = 0;
  private stopBoardRevision = 0;
  private stopBoardCacheRevision = -1;
  private stopArrivalTimes = new Map<string, number>();
  private options: SimulationOptions = {
    speedLimit: 40,
    simulationRate: 1,
    autoDispatch: true,
    collisionAvoidance: true,
    priorityPolicy: "fifo",
    controlMode: "cooperative",
    energyStrategy: "network-optimal",
    sensorRangeMeters: 22,
  };
  private powerSectionRuntime = new Map<string, PowerSectionRuntime>();
  private energyInterventions = 0;
  private peakNetworkGridPowerKw = 0;

  constructor(scenarioId = "nizhny-routes-2-21", tramCount?: number) {
    this.scenarioDefinition =
      SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];
    this.tramCount = clamp(
      Math.round(tramCount ?? this.scenarioDefinition.defaultTramCount ?? 2),
      1,
      MAX_TRAMS,
    );
    if (tramCount === undefined) this.loadDefaultFleetGroups();
    this.reset();
  }

  get scenario() {
    return this.scenarioDefinition;
  }

  get selectedTram() {
    return this.selectedTramId;
  }

  setRunning(running: boolean) {
    this.isRunning = running;
    this.addEvent(running ? "ok" : "info", running ? "Simulation resumed" : "Simulation paused");
  }

  toggleRunning() {
    this.setRunning(!this.isRunning);
  }

  setScenario(scenarioId: string) {
    const next = networkConfigById(scenarioId) ?? SCENARIOS.find((item) => item.id === scenarioId);
    if (!next || next.id === this.scenarioDefinition.id) return;
    this.scenarioDefinition = next;
    if (!supportsLegacyFirmware(next)) {
      this.options.controlMode = "cooperative";
    }
    this.tramCount =
      next.defaultTramCount ?? Math.min(this.tramCount, 4);
    this.loadDefaultFleetGroups();
    this.reset();
  }

  exportExperimentConfig(name = "Routes 2 + 21 experiment"): ExperimentDefinition {
    return {
      format: "autonomous-tram-experiment",
      version: 1,
      name: name.trim() || "Untitled experiment",
      savedAt: new Date().toISOString(),
      networkId: this.scenarioDefinition.id,
      serviceMinute: this.serviceMinute(),
      tramCount: this.tramCount,
      fleetGroups: Object.fromEntries(this.fleetGroupCounts ?? []),
      options: { ...this.options },
      obstacles: this.obstacles.map(({ segmentId, at }) => ({ segmentId, at })),
      switches: Object.fromEntries(
        [...this.switchStates.entries()].map(([id, runtime]) => [id, runtime.state]),
      ),
      trafficManualModes: Object.fromEntries(
        [...this.trafficControllers.entries()].map(([id, runtime]) => [id, runtime.manualMode]),
      ),
      selectedTramId: this.selectedTramId || null,
      selectedStopId: this.selectedStopId,
    };
  }

  loadExperimentConfig(value: unknown) {
    const experiment = this.validateExperimentConfig(value);
    const network = networkConfigById(experiment.networkId);
    if (!network) throw new Error(`Unknown network: ${experiment.networkId}`);
    const numeric = (candidate: unknown, fallback: number) =>
      typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;

    this.scenarioDefinition = network;
    this.options = {
      speedLimit: clamp(Math.round(numeric(experiment.options.speedLimit, 40)), 10, 70),
      simulationRate: clamp(numeric(experiment.options.simulationRate, 1), 0.5, 5),
      autoDispatch: Boolean(experiment.options.autoDispatch),
      collisionAvoidance: Boolean(experiment.options.collisionAvoidance),
      priorityPolicy: experiment.options.priorityPolicy,
      controlMode:
        experiment.options.controlMode === "firmware" && supportsLegacyFirmware(network)
          ? "firmware"
          : "cooperative",
      energyStrategy: ["no-storage", "baseline", "network-optimal"].includes(
        experiment.options.energyStrategy,
      )
        ? experiment.options.energyStrategy
        : "network-optimal",
      sensorRangeMeters: clamp(numeric(experiment.options.sensorRangeMeters, 22), 5, 100),
    };

    const groups = network.fleetGroups ?? [];
    if (groups.length > 0) {
      this.fleetGroupCounts = new Map(
        groups.map((group) => [
          group.id,
          clamp(
            Math.round(numeric(experiment.fleetGroups[group.id], group.defaultCount)),
            0,
            group.maxCount ?? 10,
          ),
        ]),
      );
      this.tramCount = [...this.fleetGroupCounts.values()].reduce((sum, count) => sum + count, 0);
      if (this.tramCount < 1 || this.tramCount > MAX_TRAMS) {
        throw new Error(`Fleet size must be between 1 and ${MAX_TRAMS}`);
      }
    } else {
      this.fleetGroupCounts = null;
      this.tramCount = clamp(Math.round(numeric(experiment.tramCount, network.defaultTramCount ?? 2)), 1, MAX_TRAMS);
    }

    this.reset();
    this.setServiceClockMinutes(experiment.serviceMinute);
    this.obstacles = experiment.obstacles.map((obstacle, index) => ({
      id: `O${String(index + 1).padStart(2, "0")}`,
      segmentId: obstacle.segmentId,
      at: clamp(obstacle.at, 0, 1),
    }));
    this.obstacleSequence = this.obstacles.length;

    for (const [switchId, position] of Object.entries(experiment.switches)) {
      const runtime = this.switchStates.get(switchId);
      if (runtime && runtime.state !== position) this.toggleSwitch(switchId);
    }
    for (const [controllerId, mode] of Object.entries(experiment.trafficManualModes)) {
      const signal = this.scenarioDefinition.signals.find(
        (item) => (item.controllerId ?? item.id) === controllerId,
      );
      if (signal) this.setTrafficSignalMode(signal.id, mode);
    }
    if (experiment.selectedTramId && this.trams.some((tram) => tram.id === experiment.selectedTramId)) {
      this.selectedTramId = experiment.selectedTramId;
    }
    if (experiment.selectedStopId && this.getStopBoards().some((stop) => stop.id === experiment.selectedStopId)) {
      this.selectedStopId = experiment.selectedStopId;
    }
    this.isRunning = false;
    this.invalidateStopBoards();
    this.addEvent("ok", `Experiment loaded · ${experiment.name}`);
    return experiment;
  }

  private validateExperimentConfig(value: unknown): ExperimentDefinition {
    if (!value || typeof value !== "object") throw new Error("Experiment must be a JSON object");
    const experiment = value as Partial<ExperimentDefinition>;
    if (experiment.format !== "autonomous-tram-experiment" || experiment.version !== 1) {
      throw new Error("Unsupported experiment format or version");
    }
    if (typeof experiment.networkId !== "string" || !networkConfigById(experiment.networkId)) {
      throw new Error("Experiment references an unknown network");
    }
    if (!experiment.options || typeof experiment.options !== "object") {
      throw new Error("Experiment options are missing");
    }
    const validPriority = ["fifo", "schedule", "fleet"].includes(
      experiment.options.priorityPolicy ?? "",
    );
    const validControl = ["firmware", "cooperative"].includes(
      experiment.options.controlMode ?? "",
    );
    if (!validPriority || !validControl) throw new Error("Experiment control options are invalid");
    const network = networkConfigById(experiment.networkId)!;
    const segmentIds = new Set(network.segments.map((segment) => segment.id));
    const obstacles = Array.isArray(experiment.obstacles) ? experiment.obstacles : [];
    if (obstacles.some((item) => !item || !segmentIds.has(item.segmentId) || !Number.isFinite(item.at))) {
      throw new Error("Experiment contains an obstacle outside the selected network");
    }
    return {
      format: "autonomous-tram-experiment",
      version: 1,
      name: typeof experiment.name === "string" ? experiment.name : "Imported experiment",
      savedAt: typeof experiment.savedAt === "string" ? experiment.savedAt : new Date().toISOString(),
      networkId: experiment.networkId,
      serviceMinute: Number.isFinite(experiment.serviceMinute) ? experiment.serviceMinute! : network.serviceStartMinute ?? 0,
      tramCount: Number.isFinite(experiment.tramCount) ? experiment.tramCount! : network.defaultTramCount ?? 2,
      fleetGroups: experiment.fleetGroups && typeof experiment.fleetGroups === "object" ? experiment.fleetGroups : {},
      options: experiment.options as SimulationOptions,
      obstacles,
      switches:
        experiment.switches && typeof experiment.switches === "object"
          ? Object.fromEntries(
              Object.entries(experiment.switches).filter(
                ([, position]) => position === "main" || position === "branch",
              ),
            )
          : {},
      trafficManualModes:
        experiment.trafficManualModes && typeof experiment.trafficManualModes === "object"
          ? Object.fromEntries(
              Object.entries(experiment.trafficManualModes).filter(([, mode]) =>
                ["auto", "tram-green", "road-green"].includes(mode),
              ),
            )
          : {},
      selectedTramId: typeof experiment.selectedTramId === "string" ? experiment.selectedTramId : null,
      selectedStopId: typeof experiment.selectedStopId === "string" ? experiment.selectedStopId : null,
    };
  }

  setTramCount(count: number) {
    const next = clamp(Math.round(count), 1, MAX_TRAMS);
    if (next === this.tramCount && !this.fleetGroupCounts) return;
    this.fleetGroupCounts = null;
    this.tramCount = next;
    this.reset();
  }

  setFleetGroupCount(groupId: string, count: number) {
    const definitions = this.scenarioDefinition.fleetGroups;
    const definition = definitions?.find((item) => item.id === groupId);
    if (!definitions || !definition) return false;
    if (!this.fleetGroupCounts) this.loadDefaultFleetGroups();

    const current = this.fleetGroupCounts?.get(groupId) ?? 0;
    const next = clamp(Math.round(count), 0, definition.maxCount ?? 10);
    const nextTotal = this.tramCount - current + next;
    if (next === current || nextTotal < 1 || nextTotal > MAX_TRAMS) return false;

    this.fleetGroupCounts!.set(groupId, next);
    this.tramCount = nextTotal;
    this.reset();
    return true;
  }

  setServiceClockMinutes(minute: number) {
    const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
    this.serviceClockOffsetSeconds = normalized * 60 - this.simulationTime;
    this.nextServicePlanCheckAt = this.simulationTime;
    this.nextDepartureSlotByPoint.clear();
    this.lastTerminalDepartureAtByPoint.clear();
    this.terminalHeadwayStatsByRouteWindow.clear();
    this.departureStatsByRoute.clear();
    for (const tram of this.trams) {
      tram.scheduledDepartureAt = null;
      tram.scheduledDepartureClockSeconds = null;
      tram.scheduledDepartureKind = null;
      tram.scheduledDeparturePointLabel = null;
      tram.lastDepartureDeviationSeconds = null;
      tram.terminalIntervalHold = false;
    }
    this.reconcileServicePlan(true);
    this.invalidateStopBoards();
    this.addEvent("info", `Service clock set to ${formatClock(normalized * 60)}`);
  }

  toggleSelectedTramDepot() {
    const tram = this.trams.find((item) => item.id === this.selectedTramId);
    if (!tram || !this.scenarioDefinition.depots?.length) return false;
    if (tram.serviceState === "in-depot") {
      return this.dispatchFromDepot(tram, true, true);
    }
    if (tram.serviceState === "in-service") {
      return this.markForDepot(tram, true, true);
    }
    if (tram.serviceState === "to-depot") {
      const tramIndex = this.trams.findIndex((item) => item.id === tram.id);
      const nextState = cppDepotCommandAuthority(
        tramIndex,
        tram.serviceState,
        "cancel",
      );
      if (nextState !== "in-service") return false;
      tram.serviceState = nextState;
      tram.depotId = null;
      tram.depotPortalId = null;
      tram.lastPassengerStop = null;
      tram.depotHoldManual = false;
      tram.status = "Moving · route protected";
      tram.statusTone = "normal";
      this.initializeHeadwayTargets();
      this.invalidateStopBoards();
      this.addEvent("ok", `${tram.label} depot run cancelled · passenger service restored`);
      return true;
    }
    return false;
  }

  setSpeedLimit(value: number) {
    this.options.speedLimit = clamp(Math.round(value), 10, 70);
    this.invalidateStopBoards();
    this.addEvent("info", `Line speed set to ${this.options.speedLimit} km/h`);
  }

  setSimulationRate(value: number) {
    this.options.simulationRate = clamp(value, 0.5, 5);
  }

  setAutoDispatch(enabled: boolean) {
    this.options.autoDispatch = enabled;
    this.trams.forEach((tram) => {
      if (!enabled) tram.releaseTime = 0;
    });
    this.invalidateStopBoards();
    if (enabled) {
      this.nextServicePlanCheckAt = this.simulationTime;
      this.reconcileServicePlan(true);
    }
    this.addEvent("info", `Auto dispatch ${enabled ? "enabled" : "disabled"}`);
  }

  setCollisionAvoidance(enabled: boolean) {
    this.options.collisionAvoidance = enabled;
    this.invalidateStopBoards();
    this.addEvent(
      enabled ? "ok" : "warning",
      enabled
        ? "Active interval restoration enabled · 30m safety floor"
        : "Interval restoration disabled · physical no-passing lock remains",
    );
  }

  setPriorityPolicy(policy: PriorityPolicy) {
    this.options.priorityPolicy = policy;
    this.addEvent("info", `Junction policy changed to ${this.policyLabel(policy)}`);
  }

  setControlMode(mode: ControlMode) {
    if (mode === "firmware" && !supportsLegacyFirmware(this.scenarioDefinition)) {
      this.options.controlMode = "cooperative";
      this.addEvent(
        "warning",
        "Legacy firmware comparison is unavailable on this multi-junction network",
      );
      return;
    }
    this.options.controlMode = mode;
    this.addEvent(
      "info",
      mode === "firmware"
        ? "2021 firmware-faithful control enabled"
        : "Cooperative multi-tram control enabled",
    );
  }

  setEnergyStrategy(strategy: EnergyStrategy) {
    this.options.energyStrategy = strategy;
    this.configureTractionPowerAuthority();
    this.trams.forEach((tram) => {
      tram.energyGuidanceActive = false;
    });
    this.addEvent(
      "info",
      strategy === "network-optimal"
        ? "Energy-optimal dispatch enabled · section peaks and regenerative overlap coordinated"
        : strategy === "no-storage"
          ? "Reference case enabled · wayside flywheels disconnected"
          : "Baseline flywheel control enabled · no predictive traction coordination",
    );
  }

  selectTram(tramId: string) {
    if (this.trams.some((tram) => tram.id === tramId)) {
      this.selectedTramId = tramId;
    }
  }

  selectStop(stopId: string) {
    if (this.getStopBoards().some((board) => board.id === stopId)) {
      this.selectedStopId = stopId;
    }
  }

  setSelectedTramManual(enabled: boolean) {
    const tram = this.trams.find((item) => item.id === this.selectedTramId);
    if (!tram) return false;
    if (
      tram.serviceState === "in-depot" ||
      tram.serviceState === "depot-ingress" ||
      tram.serviceState === "depot-egress"
    ) {
      return false;
    }
    if (!enabled && tram.branchOrigin) {
      this.addEvent(
        "warning",
        `${tram.label}: return through ${tram.branchOrigin.switchId} before restoring AUTO`,
      );
      return false;
    }
    if (tram.manualMode === enabled) return true;

    tram.manualMode = enabled;
    tram.manualCommand = enabled ? "stop" : "forward";
    tram.speedMps = 0;
    tram.targetSpeedMps = 0;
    tram.pwm = 0;
    tram.releaseTime = 0;
    tram.stationPhase = "none";
    tram.stationUntil = 0;
    tram.terminalIntervalHold = false;
    tram.terminalBerth = 0;
    tram.terminalEntryQueueReaderId = null;
    tram.pendingStationReaderId = null;
    tram.lastBlockKey = null;
    tram.status = enabled ? "Manual hold" : "Autopilot restored";
    tram.statusTone = enabled ? "idle" : "normal";
    this.invalidateStopBoards();
    this.addEvent(
      enabled ? "warning" : "ok",
      `${tram.label} switched to ${enabled ? "MANUAL · HOLD" : "AUTO"}`,
    );
    return true;
  }

  setSelectedTramCommand(command: ManualCommand) {
    const tram = this.trams.find((item) => item.id === this.selectedTramId);
    if (!tram) return false;
    if (tram.serviceState !== "in-service" && tram.serviceState !== "to-depot") {
      return false;
    }
    if (command === "reverse" && !tram.branchOrigin) {
      this.addEvent(
        "warning",
        `${tram.label}: reverse is available only for recovery from an external branch`,
      );
      return false;
    }

    tram.manualMode = true;
    tram.manualCommand = command;
    tram.releaseTime = 0;
    tram.stationPhase = "none";
    tram.stationUntil = 0;
    tram.terminalIntervalHold = false;
    tram.terminalBerth = 0;
    tram.terminalEntryQueueReaderId = null;
    tram.pendingStationReaderId = null;
    tram.lastBlockKey = null;
    this.invalidateStopBoards();

    if (command === "stop") {
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.status = "Manual hold";
      tram.statusTone = "idle";
      this.addEvent("warning", `${tram.label} manual STOP`);
    } else if (command === "reverse") {
      tram.status = `Returning via ${tram.branchOrigin!.switchId}`;
      tram.statusTone = "warning";
      this.addEvent(
        "warning",
        `${tram.label} manual REVERSE → ${tram.branchOrigin!.switchId}`,
      );
    } else {
      this.promoteManualTrafficRequest(tram);
      tram.status = "Manual forward · safety active";
      tram.statusTone = "normal";
      this.addEvent("info", `${tram.label} manual FORWARD`);
    }
    return true;
  }

  reset() {
    this.fixedStepClock.reset();
    this.simulationTime = 0;
    this.serviceClockOffsetSeconds =
      (this.scenarioDefinition.serviceStartMinute ?? 0) * 60;
    this.nextServicePlanCheckAt = 0;
    this.isRunning = false;
    this.energyInterventions = 0;
    this.peakNetworkGridPowerKw = 0;
    this.powerSectionRuntime = new Map(
      (this.scenarioDefinition.tractionPowerSystem?.sections ?? []).map((section) => [
        section.id,
        {
          tractionPowerKw: 0,
          regenerationPowerKw: 0,
          locallyReusedPowerKw: 0,
          gridPowerKw: 0,
          localReuseWh: 0,
          gridSupplyWh: 0,
          rejectedGeneratorWh: 0,
          peakGridPowerKw: 0,
          flywheelEnergyWh: section.flywheel ? section.flywheel.modules * section.flywheel.moduleEnergyKWh * 1000 * section.flywheel.initialSoc : 0,
          flywheelCapacityWh: section.flywheel ? section.flywheel.modules * section.flywheel.moduleEnergyKWh * 1000 : 0,
          flywheelChargePowerKw: 0,
          flywheelDischargePowerKw: 0,
          flywheelChargedWh: 0,
          flywheelDischargedWh: 0,
          flywheelLossesWh: 0,
          flywheelMode: section.flywheel ? 3 : 0,
          flywheelTargetGridKw: 0,
          forecastTractionKw: 0,
          forecastRegenerationKw: 0,
        },
      ]),
    );
    this.events = [];
    this.eventSequence = 0;
    this.obstacleSequence = 0;
    this.stopBoardCache = [];
    this.stopBoardCacheSecond = -1;
    this.stopBoardCacheGeneratedAt = 0;
    this.stopArrivalTimes.clear();
    this.invalidateStopBoards();
    // Fresh demand trackers per scenario load/reset, seeded at t=0 so the
    // lazy catch-up in StopDemandTracker.advance() accumulates from the
    // true start of service rather than from whenever a stop is first
    // queried (which would otherwise silently drop any backlog that built
    // up before that first read).
    this.stopDemand = new Map();
    this.lastDemandAdjustAt = new Map();
    this.nextDepartureSlotByPoint = new Map();
    this.lastTerminalDepartureAtByPoint = new Map();
    this.terminalHeadwayStatsByRouteWindow = new Map();
    this.departureStatsByRoute = new Map();
    for (const reader of this.scenarioDefinition.readers) {
      if (reader.kind !== "station") continue;
      this.demandTrackerFor(reader.id).advance(
        0,
        this.serviceMinute(),
        PASSENGER_BASE_RATE_PER_MINUTE,
      );
    }
    this.segments = new Map(
      this.scenarioDefinition.segments.map((item) => [item.id, buildSegmentRuntime(item)]),
    );
    this.speedRestrictions = this.buildSpeedRestrictions();
    this.speedRestrictionsBySegment = new Map();
    for (const restriction of this.speedRestrictions) {
      const list = this.speedRestrictionsBySegment.get(restriction.segmentId) ?? [];
      list.push(restriction);
      this.speedRestrictionsBySegment.set(restriction.segmentId, list);
    }
    this.stationReadersBySegment = new Map();
    for (const reader of this.scenarioDefinition.readers) {
      if (reader.kind !== "station") continue;
      const list = this.stationReadersBySegment.get(reader.segmentId) ?? [];
      list.push(reader);
      this.stationReadersBySegment.set(reader.segmentId, list);
    }
    this.switchStates = new Map(
      this.scenarioDefinition.switches.map((item) => [
        item.id,
        {
          id: item.id,
          state: "main" as SwitchPosition,
          lockedBy: null,
          queue: [],
        },
      ]),
    );
    configureCppSwitchAuthority(this.switchStates.size);
    this.trafficControllers = new Map();
    for (const signal of this.scenarioDefinition.signals) {
      const controllerId = signal.controllerId ?? signal.id;
      if (this.trafficControllers.has(controllerId)) continue;
      this.trafficControllers.set(controllerId, {
        id: controllerId,
        label: signal.label,
        phase: "road-green",
        phaseUntil: 0,
        activeTramId: null,
        activeSignalId: null,
        activeTramCleared: false,
        activeTramEntered: false,
        activeGrantedAt: 0,
        queue: [],
        amberSeconds: signal.amberSeconds ?? 1,
        tramGreenSeconds: signal.tramGreenSeconds ?? 10,
        clearanceSeconds: signal.clearanceSeconds ?? 1,
        manualMode: "auto",
        manualSignalId: null,
        manualReleasePending: false,
      });
    }
    configureCppTrafficAuthority(this.trafficControllers.size);
    this.initializeRoadVehicles();
    this.obstacles = this.scenarioDefinition.defaultObstacles.map((item) => ({
      id: `O${String(++this.obstacleSequence).padStart(2, "0")}`,
      ...item,
    }));
    const tramPlans = this.buildTramPlans();
    this.trams = tramPlans.map((plan, index) => {
      const start = plan.start;
      const uidPool = plan.routeIntent === "branch" ? OPEN_UID_VALUES : CLOSED_UID_VALUES;
      const uid = plan.fleetGroupId
        ? uidPool[index % uidPool.length]
        : TRAM_UIDS[index % TRAM_UIDS.length];
      return {
        id: `T${String(index + 1).padStart(2, "0")}`,
        label: `TRAM ${String(index + 1).padStart(2, "0")}`,
        uid,
        color: TRAM_COLORS[index % TRAM_COLORS.length],
        routeIntent: plan.routeIntent,
        fleetGroupId: plan.fleetGroupId,
        directionLabel: plan.directionLabel,
        serviceState: "in-service" as ServiceState,
        depotId: null,
        depotPortalId: null,
        depotProgress: 0,
        depotEnteredAt: 0,
        depotHoldManual: false,
        lastPassengerStop: null,
        linePriority: index + 1,
        segmentId: start.segmentId,
        progress: start.progress,
        speedMps: 0,
        targetSpeedMps: 0,
        status:
          this.scenarioDefinition.predeployedFleet || index === 0
            ? "Ready"
            : "Scheduled",
        statusTone: "idle",
        pwm: 0,
        releaseTime:
          this.options.autoDispatch && !this.scenarioDefinition.predeployedFleet
            ? index * (this.scenarioDefinition.dispatchIntervalSeconds ?? 12)
            : 0,
        delaySeconds: 0,
        scheduledDepartureAt: null,
        scheduledDepartureClockSeconds: null,
        scheduledDepartureKind: null,
        scheduledDeparturePointLabel: null,
        lastDepartureDeviationSeconds: null,
        distanceMeters: 0,
        serviceStartDistanceMeters: 0,
        energyWh: 0,
        recoveredWh: 0,
        tractionEnergyWh: 0,
        auxiliaryEnergyWh: 0,
        mechanicalBrakeEnergyWh: 0,
        grossRegeneratedWh: 0,
        rejectedRegenerationWh: 0,
        downhillPotentialWh: 0,
        climbPotentialWh: 0,
        lap: 0,
        lapMarkerSegmentId: start.segmentId,
        lastAcceleration: 0,
        tractionForceN: 0,
        brakeForceN: 0,
        resistanceForceN: 0,
        dynamicsMode: "coast" as DynamicsMode,
        triggeredOnSegment: new Set<string>(),
        stationPhase: "none",
        stationUntil: 0,
        terminalIntervalHold: false,
        terminalBerth: 0,
        terminalEntryQueueReaderId: null,
        lastBlockKey: null,
        emergencyStops: 0,
        manualMode: false,
        manualCommand: "forward" as ManualCommand,
        branchOrigin: null,
        desiredHeadwayMeters: FALLBACK_HEADWAY_METERS,
        etaAverageSpeedMps: Math.max(
          2.5,
          (this.options.speedLimit / 3.6) * 0.58,
        ),
        onboardPassengers: 0,
        pendingStationReaderId: null,
        energyGuidanceActive: false,
        profileLimitMps: this.options.speedLimit / 3.6,
        profileReason: "line" as const,
        restrictionDistanceMeters: null,
        curveRadiusMeters: null,
        lateralAccelerationMps2: 0,
        ecoDrivingMode: "cruise" as const,
        ecoConstraintDistanceMeters: null,
        ecoConstraintLabel: null,
        ecoApproachStopId: null,
        ecoCoastSeconds: 0,
      };
    });
    this.applyInitialServicePlan();
    configureCppAuthority(this.trams.length);
    this.configureTractionPowerAuthority();
    this.initializeHeadwayTargets();
    this.selectedTramId = this.trams[0]?.id ?? "";
    this.selectedStopId = this.getStopBoards()[0]?.id ?? null;
    this.addEvent("ok", `${this.scenarioDefinition.shortName} initialized`);
    this.addEvent(
      "info",
      `Loaded ${this.tramCount} tram${this.tramCount === 1 ? "" : "s"} · ${this.options.controlMode === "firmware" ? "firmware" : "cooperative"} mode`,
    );
    if (this.obstacles.length > 0) {
      this.addEvent("warning", `${this.obstacles.length} test obstacle armed on the network`);
    }
  }

  private configureTractionPowerAuthority() {
    const powerSystem = this.scenarioDefinition.tractionPowerSystem;
    configureCppPowerAuthority(
      (powerSystem?.sections ?? []).map((section) => ({
        maxPowerKw: powerSystem?.substations.find((item) => item.id === section.substationId)?.maxPowerKw ?? 0,
        flywheel: section.flywheel ? {
          modules: section.flywheel.modules,
          modulePowerKw: section.flywheel.modulePowerKw,
          moduleEnergyWh: section.flywheel.moduleEnergyKWh * 1000,
          chargeEfficiency: section.flywheel.chargeEfficiency,
          dischargeEfficiency: section.flywheel.dischargeEfficiency,
          initialSoc: section.flywheel.initialSoc,
        } : undefined,
      })),
      this.trams.length,
      this.options.energyStrategy,
    );
  }

  private loadDefaultFleetGroups() {
    const groups = this.scenarioDefinition.fleetGroups;
    if (!groups?.length) {
      this.fleetGroupCounts = null;
      return;
    }
    this.fleetGroupCounts = new Map(
      groups.map((group) => [
        group.id,
        clamp(Math.round(group.defaultCount), 0, group.maxCount ?? 10),
      ]),
    );
    this.tramCount = Array.from(this.fleetGroupCounts.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
  }

  private buildTramPlans(): TramPlan[] {
    const groups = this.scenarioDefinition.fleetGroups;
    if (!groups?.length || !this.fleetGroupCounts) {
      return Array.from({ length: this.tramCount }, (_, index) => {
        const start =
          this.scenarioDefinition.starts[index % this.scenarioDefinition.starts.length];
        const uid = TRAM_UIDS[index % TRAM_UIDS.length];
        return {
          start,
          routeIntent: this.routeForUid(uid),
          fleetGroupId: null,
          directionLabel: null,
        };
      });
    }

    const plans: TramPlan[] = [];
    const used = new Map(groups.map((group) => [group.id, 0]));
    let added = true;
    while (plans.length < this.tramCount && added) {
      added = false;
      for (const group of groups) {
        const groupIndex = used.get(group.id) ?? 0;
        const count = this.fleetGroupCounts.get(group.id) ?? 0;
        if (groupIndex >= count || plans.length >= MAX_TRAMS) continue;
        const start = group.starts[groupIndex % group.starts.length];
        plans.push({
          start,
          routeIntent: group.routeIntent,
          fleetGroupId: group.id,
          directionLabel: group.label,
        });
        used.set(group.id, groupIndex + 1);
        added = true;
      }
    }
    return plans;
  }

  private initializeRoadVehicles() {
    this.roadVehicles = [];
    let colorIndex = 0;
    for (const controller of this.trafficControllers.values()) {
      ([1, -1] as const).forEach((direction) => {
        [0, 1].forEach((laneIndex) => {
          this.roadVehicles.push({
            id: `CAR-${controller.id}-${direction > 0 ? "A" : "B"}-${laneIndex + 1}`,
            controllerId: controller.id,
            direction,
            progress:
              direction > 0
                ? 0.06 + laneIndex * 0.47
                : 0.94 - laneIndex * 0.47,
            speed: ROAD_CAR_SPEED,
            stopped: false,
            color: ROAD_CAR_COLORS[colorIndex++ % ROAD_CAR_COLORS.length],
          });
        });
      });
    }
  }

  private serviceClockSeconds() {
    return (
      ((this.serviceClockOffsetSeconds + this.simulationTime) % 86_400) +
      86_400
    ) % 86_400;
  }

  private serviceMinute() {
    return Math.floor(this.serviceClockSeconds() / 60);
  }

  private activeServiceWindow() {
    const minute = this.serviceMinute();
    return (
      this.scenarioDefinition.serviceSchedule?.find(
        (window) => minute >= window.startMinute && minute < window.endMinute,
      ) ?? null
    );
  }

  private reserveScheduledDeparture(
    tram: TramState,
    pointKey: string,
    pointLabel: string,
    kind: "depot" | "terminal",
  ) {
    const window = this.activeServiceWindow();
    const routeId = this.routeIdForTram(tram);
    const headwayMinutes = window?.routes[routeId]?.plannedHeadwayMinutes ?? null;
    if (!window || !headwayMinutes || !(headwayMinutes > 0)) return false;

    const absoluteClockSeconds = this.serviceClockOffsetSeconds + this.simulationTime;
    const dayStartSeconds = Math.floor(absoluteClockSeconds / 86_400) * 86_400;
    const windowStartSeconds = dayStartSeconds + window.startMinute * 60;
    // Each service window has its own timetable grid. Carrying the previous
    // window's reservation into a new headway would shift every later trip.
    const reservationKey = `${window.id}:${routeId}:${kind}:${pointKey}`;
    const nextReserved = this.nextDepartureSlotByPoint.get(reservationKey) ?? null;
    const slotClockSeconds = cppDepartureSlot(
      absoluteClockSeconds,
      windowStartSeconds,
      headwayMinutes * 60,
      nextReserved,
    );
    if (!(slotClockSeconds >= 0)) return false;

    this.nextDepartureSlotByPoint.set(
      reservationKey,
      slotClockSeconds + headwayMinutes * 60,
    );
    tram.scheduledDepartureAt = slotClockSeconds - this.serviceClockOffsetSeconds;
    tram.scheduledDepartureClockSeconds = ((slotClockSeconds % 86_400) + 86_400) % 86_400;
    tram.scheduledDepartureKind = kind;
    tram.scheduledDeparturePointLabel = pointLabel;
    return true;
  }

  private terminalIntervalGap(tram: TramState) {
    if (!tram.terminalIntervalHold) return null;
    const readerId = tram.pendingStationReaderId;
    if (!readerId) return null;
    const window = this.activeServiceWindow();
    if (!window) return null;
    const routeId = this.routeIdForTram(tram);
    const plannedHeadwayMinutes = window.routes[routeId]?.plannedHeadwayMinutes ?? null;
    if (!plannedHeadwayMinutes || !(plannedHeadwayMinutes > 0)) return null;
    const departureKey = `${window.id}:${routeId}:terminal:${readerId}`;
    const previousDepartureAt = this.lastTerminalDepartureAtByPoint.get(departureKey);
    if (previousDepartureAt === undefined) return null;
    const elapsedSeconds = Math.max(0, this.simulationTime - previousDepartureAt);
    const targetSeconds = plannedHeadwayMinutes * 60 * MIN_TERMINAL_HEADWAY_FACTOR;
    return {
      elapsedSeconds,
      targetSeconds,
      remainingSeconds: Math.max(0, targetSeconds - elapsedSeconds),
    };
  }

  private isIzmirDualTrackTerminal(reader: RFIDReader | undefined) {
    return Boolean(
      this.scenarioDefinition.id === "izmir-konak" &&
      reader?.kind === "station" &&
      reader.terminal,
    );
  }

  private terminalBerthMask(readerId: string, excludeTramId?: string) {
    return this.trams.reduce((mask, other) => {
      if (
        other.id === excludeTramId ||
        other.pendingStationReaderId !== readerId ||
        other.stationPhase === "none" ||
        other.terminalBerth === 0
      ) {
        return mask;
      }
      return mask | (other.terminalBerth === 1 ? 1 : 2);
    }, 0);
  }

  private assignIzmirTerminalBerth(tram: TramState, reader: RFIDReader) {
    if (!this.isIzmirDualTrackTerminal(reader)) return 0;
    const berth = cppTerminalBerth(this.terminalBerthMask(reader.id, tram.id));
    tram.terminalBerth = berth;
    return berth;
  }

  private izmirTerminalApproachReader(tram: TramState) {
    if (this.scenarioDefinition.id !== "izmir-konak") return null;
    const readerId =
      tram.terminalEntryQueueReaderId ??
      tram.pendingStationReaderId ??
      this.nextPassengerStop(tram)?.id;
    const reader = readerId
      ? this.scenarioDefinition.readers.find((item) => item.id === readerId)
      : undefined;
    return this.isIzmirDualTrackTerminal(reader) ? reader ?? null : null;
  }

  private leaderOccupiesApproachingIzmirTerminal(
    tram: TramState,
    leader: TramState | null,
  ) {
    if (!leader) return false;
    const reader = this.izmirTerminalApproachReader(tram);
    return Boolean(
      reader &&
      leader.pendingStationReaderId === reader.id &&
      leader.stationPhase !== "none",
    );
  }

  private canUseParallelIzmirTerminalBerth(
    tram: TramState,
    leader: TramState | null,
  ) {
    const reader = this.izmirTerminalApproachReader(tram);
    if (!reader || !this.leaderOccupiesApproachingIzmirTerminal(tram, leader)) {
      return false;
    }
    return cppParallelTerminalBypass(
      true,
      this.terminalBerthMask(reader.id, tram.id),
    );
  }

  private resolveIzmirTerminalEntryQueue(tram: TramState, tramIndex: number) {
    const readerId = tram.terminalEntryQueueReaderId;
    if (!readerId) return false;
    const reader = this.scenarioDefinition.readers.find(
      (item) => item.id === readerId,
    );
    if (!reader || !this.isIzmirDualTrackTerminal(reader)) {
      tram.terminalEntryQueueReaderId = null;
      return false;
    }
    const berth = this.assignIzmirTerminalBerth(tram, reader);
    if (berth === 0) return true;

    tram.terminalEntryQueueReaderId = null;
    tram.pendingStationReaderId = reader.id;
    tram.terminalIntervalHold = true;
    tram.stationPhase = "crawl";
    tram.stationUntil = 0;
    invalidateCppStation(tramIndex);
    this.addEvent(
      "ok",
      `${tram.label}: ${reader.label} platform ${berth} released · terminal entry permitted`,
    );
    return false;
  }

  /**
   * A tram that was already restoring its interval may finish that recovery
   * while standing at the terminal. The release condition is the actual time
   * since the previous departure in this direction, not distance or a fixed
   * hold duration.
   */
  private maintainTerminalIntervalHold(tram: TramState, tramIndex: number) {
    if (!tram.terminalIntervalHold || tram.stationPhase !== "dwell") return null;
    const gap = this.terminalIntervalGap(tram);
    if (!gap || !cppTerminalIntervalHold(gap.elapsedSeconds, gap.targetSeconds)) {
      tram.terminalIntervalHold = false;
      return gap;
    }
    tram.stationUntil = Math.max(tram.stationUntil, this.simulationTime + 0.25);
    cppExtendStationDwell(tramIndex, tram.stationUntil);
    return gap;
  }

  private isDispatchControlledTerminal(reader: RFIDReader | null | undefined) {
    return Boolean(reader?.terminal && !reader.rapidTurnback);
  }

  private recordTerminalDeparture(tram: TramState) {
    const readerId = tram.pendingStationReaderId;
    if (!readerId) return;
    const reader = this.scenarioDefinition.readers.find(
      (item) => item.id === readerId && item.terminal,
    );
    if (!reader) return;
    const window = this.activeServiceWindow();
    if (!window) return;
    const routeId = this.routeIdForTram(tram);
    const departureKey = `${window.id}:${routeId}:terminal:${readerId}`;
    const previousDepartureAt = this.lastTerminalDepartureAtByPoint.get(departureKey);
    if (previousDepartureAt !== undefined) {
      const statsKey = `${window.id}:${routeId}`;
      const stats = this.terminalHeadwayStatsByRouteWindow.get(statsKey) ?? {
        total: 0,
        sumSeconds: 0,
      };
      stats.total += 1;
      stats.sumSeconds += Math.max(0, this.simulationTime - previousDepartureAt);
      this.terminalHeadwayStatsByRouteWindow.set(statsKey, stats);
    }
    this.lastTerminalDepartureAtByPoint.set(departureKey, this.simulationTime);
  }

  private recordScheduledDeparture(tram: TramState) {
    if (tram.scheduledDepartureAt === null) return;
    const deviationSeconds = this.simulationTime - tram.scheduledDepartureAt;
    const routeId = this.routeIdForTram(tram);
    const stats = this.departureStatsByRoute.get(routeId) ?? {
      total: 0,
      onTime: 0,
      absoluteDeviationSeconds: 0,
    };
    stats.total += 1;
    stats.absoluteDeviationSeconds += Math.abs(deviationSeconds);
    if (cppDepartureOnTime(deviationSeconds, DEPARTURE_ON_TIME_TOLERANCE_SECONDS)) {
      stats.onTime += 1;
    }
    this.departureStatsByRoute.set(routeId, stats);
    tram.lastDepartureDeviationSeconds = deviationSeconds;
    const point = tram.scheduledDeparturePointLabel ?? "timing point";
    const deviationLabel = Math.abs(deviationSeconds) < 1
      ? "on time"
      : `${deviationSeconds > 0 ? "+" : "−"}${Math.abs(deviationSeconds).toFixed(0)}s`;
    this.addEvent(
      Math.abs(deviationSeconds) <= DEPARTURE_ON_TIME_TOLERANCE_SECONDS ? "ok" : "warning",
      `${tram.label} departed ${point} · ${deviationLabel}`,
    );
    tram.scheduledDepartureAt = null;
    tram.scheduledDepartureClockSeconds = null;
    tram.scheduledDepartureKind = null;
    tram.scheduledDeparturePointLabel = null;
  }

  /** Get-or-create the passenger demand tracker for a "station" RFID reader. */
  private demandTrackerFor(readerId: string): StopDemandTracker {
    let tracker = this.stopDemand.get(readerId);
    if (!tracker) {
      tracker = new StopDemandTracker(readerId);
      this.stopDemand.set(readerId, tracker);
    }
    return tracker;
  }

  /** Bring a stop's queue up to date without boarding anyone (for read-only snapshots). */
  private peekDemand(readerId: string) {
    const tracker = this.demandTrackerFor(readerId);
    tracker.advance(this.simulationTime, this.serviceMinute(), PASSENGER_BASE_RATE_PER_MINUTE);
    return tracker;
  }

  /**
   * Touches every stop's demand tracker on a short, fixed cadence, independent
   * of whether a tram actually visits or the dispatcher's schedule window is
   * active. Without this, a stop that goes unvisited for a long stretch would
   * only get caught up the next time something happens to read it, applying
   * a single point-in-time rate across the whole idle gap — fine for a
   * minute or two, misleading over tens of minutes.
   */
  private refreshAllDemand() {
    for (const reader of this.scenarioDefinition.readers) {
      if (reader.kind === "station") this.peekDemand(reader.id);
    }
  }

  /**
   * Runs the passenger boarding model for a tram that has just arrived at a
   * stop: brings the stop's queue up to date, boards/alights within vehicle
   * capacity, computes a dwell time from the actual flow, and — this is the
   * fix for doors closing on people mid-boarding — extends the station
   * authority's own dwell deadline (via cppExtendStationDwell) so the tram
   * physically cannot depart before boarding is done, on both the WASM and
   * TypeScript-fallback paths.
   */
  private serviceStopPassengers(tram: TramState, tramIndex: number) {
    const readerId = tram.pendingStationReaderId;
    const reader = readerId
      ? this.scenarioDefinition.readers.find((item) => item.id === readerId)
      : null;
    if (!reader) {
      return { boarding: 0, alighting: 0, overflow: 0, dwellSeconds: PASSENGER_MIN_DWELL_SECONDS };
    }
    const tracker = this.peekDemand(reader.id);
    const { boarding, alighting, overflow } = computeBoardingAlighting({
      onboard: tram.onboardPassengers,
      capacity: TRAM_CAPACITY,
      waiting: tracker.boardable(),
      alightFraction: PASSENGER_ALIGHT_FRACTION,
    });
    tram.onboardPassengers = tram.onboardPassengers - alighting + boarding;
    tracker.board(boarding, overflow);

    const dwellSeconds = clamp(
      computeDwellSeconds({
        boarding,
        alighting,
        doorCount: PASSENGER_DOOR_COUNT,
        secondsPerBoarding: PASSENGER_SECONDS_PER_BOARDING,
        secondsPerAlighting: PASSENGER_SECONDS_PER_ALIGHTING,
        minDwellSeconds: PASSENGER_MIN_DWELL_SECONDS,
        doorCycleOverheadSeconds: PASSENGER_DOOR_CYCLE_OVERHEAD_SECONDS,
      }),
      PASSENGER_MIN_DWELL_SECONDS,
      PASSENGER_MAX_DWELL_SECONDS,
    );
    tram.stationUntil = this.simulationTime + dwellSeconds;
    cppExtendStationDwell(tramIndex, tram.stationUntil);

    if (overflow > 0) {
      this.addEvent(
        "warning",
        `${reader.label}: ${overflow} passenger(s) left waiting · tram at capacity (${tram.onboardPassengers}/${TRAM_CAPACITY})`,
      );
    }
    tram.lastPassengerStop = reader.stationId ?? reader.id;
    this.invalidateStopBoards();
    return { boarding, alighting, overflow, dwellSeconds };
  }

  private routeIdForTram(tram: TramState) {
    const group = this.scenarioDefinition.fleetGroups?.find(
      (item) => item.id === tram.fleetGroupId,
    );
    return (
      group?.routeId ??
      this.scenarioDefinition.routes[tram.routeIntent === "branch" ? 1 : 0]?.id ??
      this.scenarioDefinition.routes[0]?.id ??
      "service"
    );
  }

  /**
   * Picks the nearest reachable depot portal ahead of the tram on its
   * current route/fleet group — not just the first one listed. This is what
   * makes extra mid-route "turnback" portals actually useful: a tram
   * withdrawn for being badly delayed heads for whichever portal it reaches
   * soonest, instead of always the original terminal depot.
   */
  /** Trams currently committed to (en route to, or parked at) a given depot. */
  private depotOccupancy(depotId: string): number {
    return this.trams.filter(
      (tram) =>
        tram.depotId === depotId &&
        (tram.serviceState === "to-depot" ||
          tram.serviceState === "depot-ingress" ||
          tram.serviceState === "in-depot"),
    ).length;
  }

  private depotKind(depotId: string | null): "depot" | "turnback" {
    if (!depotId) return "depot";
    return this.scenarioDefinition.depots?.find((item) => item.id === depotId)?.kind ?? "depot";
  }

  /**
   * Picks the nearest reachable, non-full depot portal ahead of the tram on
   * its current route/fleet group. By default only real depots are
   * considered — turnback sidings are a scarce, short-stay resource meant
   * for tactical recovery (see the short-turn logic below), not routine
   * "not needed right now" storage, so ordinary schedule-driven withdrawals
   * must never land in one. Pass allowTurnback for the one case where that's
   * actually the point.
   */
  private depotPortalForTram(
    tram: TramState,
    options: { allowTurnback?: boolean } = {},
  ) {
    const allowTurnback = options.allowTurnback ?? false;
    const routeId = this.routeIdForTram(tram);
    const candidates: { depot: DepotDefinition; portal: DepotPortalDefinition }[] = [];
    for (const depot of this.scenarioDefinition.depots ?? []) {
      if (!allowTurnback && depot.kind === "turnback") continue;
      if (this.depotOccupancy(depot.id) >= (depot.capacity ?? Infinity)) continue;
      for (const portal of depot.portals) {
        if (
          portal.routeId === routeId &&
          (!tram.fleetGroupId || portal.fleetGroupIds.includes(tram.fleetGroupId))
        ) {
          candidates.push({ depot, portal });
        }
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    let nearest: { depot: DepotDefinition; portal: DepotPortalDefinition } | null = null;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = this.forwardDistanceToPosition(
        tram,
        candidate.portal.portalSegmentId,
        candidate.portal.portalAt,
      );
      if (distance !== null && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    }
    // If the forward walk couldn't reach any candidate (e.g. tram already
    // mid-transition), fall back to the first match rather than stranding it.
    return nearest ?? candidates[0];
  }

  private depotPortalById(portalId: string | null) {
    if (!portalId) return null;
    for (const depot of this.scenarioDefinition.depots ?? []) {
      const portal = depot.portals.find((item) => item.id === portalId);
      if (portal) return { depot, portal };
    }
    return null;
  }

  private applyInitialServicePlan() {
    const window = this.activeServiceWindow();
    if (!window || !this.scenarioDefinition.depots?.length) return;
    for (const route of this.scenarioDefinition.routes) {
      const routeTrams = this.trams.filter(
        (tram) => this.routeIdForTram(tram) === route.id,
      );
      const target = Math.min(
        routeTrams.length,
        window.routes[route.id]?.targetActiveTrams ?? routeTrams.length,
      );
      routeTrams
        .sort((first, second) => second.linePriority - first.linePriority)
        .slice(target)
        .forEach((tram) => this.placeInDepot(tram));
    }
  }

  private placeInDepot(tram: TramState) {
    // Prefer the portal this tram was already committed to (set by
    // markForDepot when it left service) so a short-turn into a turnback
    // siding actually lands there — re-deriving fresh here could pick a
    // different (e.g. non-turnback) portal now that the tram is close to it.
    const assignment =
      this.depotPortalById(tram.depotPortalId) ?? this.depotPortalForTram(tram);
    if (!assignment) return false;
    tram.serviceState = "in-depot";
    tram.depotId = assignment.depot.id;
    tram.depotPortalId = assignment.portal.id;
    tram.depotProgress = 1;
    tram.depotEnteredAt = this.simulationTime;
    tram.lastPassengerStop = null;
    tram.speedMps = 0;
    tram.targetSpeedMps = 0;
    tram.pwm = 0;
    tram.stationPhase = "none";
    tram.terminalIntervalHold = false;
    tram.terminalBerth = 0;
    tram.terminalEntryQueueReaderId = null;
    tram.status = `Stored · ${assignment.depot.shortName}`;
    tram.statusTone = "idle";
    tram.onboardPassengers = 0;
    tram.pendingStationReaderId = null;
    tram.scheduledDepartureAt = null;
    tram.scheduledDepartureClockSeconds = null;
    tram.scheduledDepartureKind = null;
    tram.scheduledDeparturePointLabel = null;
    tram.lastDepartureDeviationSeconds = null;
    invalidateCppDepotState(this.trams.findIndex((item) => item.id === tram.id));
    this.initializeHeadwayTargets();
    return true;
  }

  private markForDepot(
    tram: TramState,
    announce: boolean,
    manualRequest = false,
    allowTurnback = false,
  ) {
    const assignment = this.depotPortalForTram(tram, { allowTurnback });
    if (!assignment || tram.serviceState !== "in-service") return false;
    const tramIndex = this.trams.findIndex((item) => item.id === tram.id);
    const nextState = cppDepotCommandAuthority(
      tramIndex,
      tram.serviceState,
      "withdraw",
    );
    if (nextState !== "to-depot") return false;
    tram.serviceState = nextState;
    tram.depotId = assignment.depot.id;
    tram.depotPortalId = assignment.portal.id;
    tram.lastPassengerStop = assignment.portal.lastPassengerStop;
    tram.depotHoldManual = manualRequest;
    tram.stationPhase = "none";
    tram.terminalIntervalHold = false;
    tram.terminalBerth = 0;
    tram.terminalEntryQueueReaderId = null;
    tram.scheduledDepartureAt = null;
    tram.scheduledDepartureClockSeconds = null;
    tram.scheduledDepartureKind = null;
    tram.scheduledDeparturePointLabel = null;
    tram.status = `To depot · service to ${assignment.portal.lastPassengerStop}`;
    tram.statusTone = "warning";
    this.initializeHeadwayTargets();
    this.invalidateStopBoards();
    if (announce) {
      this.addEvent(
        "warning",
        `${tram.label} withdrawn · passengers to ${assignment.portal.lastPassengerStop}`,
      );
    }
    return true;
  }

  private dispatchFromDepot(
    tram: TramState,
    announce: boolean,
    manualRequest = false,
  ) {
    const assignment =
      this.depotPortalById(tram.depotPortalId) ?? this.depotPortalForTram(tram);
    if (
      !assignment ||
      tram.serviceState !== "in-depot" ||
      (!manualRequest && tram.depotHoldManual)
    ) {
      return false;
    }
    const tramIndex = this.trams.findIndex((item) => item.id === tram.id);
    const nextState = cppDepotCommandAuthority(
      tramIndex,
      tram.serviceState,
      "dispatch",
    );
    if (nextState !== "depot-egress") return false;
    tram.serviceState = nextState;
    tram.depotId = assignment.depot.id;
    tram.depotPortalId = assignment.portal.id;
    tram.depotProgress = 0;
    tram.lastPassengerStop = null;
    tram.depotHoldManual = false;
    tram.manualMode = false;
    tram.manualCommand = "forward";
    tram.status = `Leaving ${assignment.depot.shortName} · not in service`;
    tram.statusTone = "warning";
    if (!manualRequest) {
      this.reserveScheduledDeparture(
        tram,
        assignment.portal.id,
        assignment.depot.shortName,
        "depot",
      );
    }
    this.invalidateStopBoards();
    if (announce) {
      this.addEvent("ok", `${tram.label} dispatched from ${assignment.depot.shortName}`);
    }
    return true;
  }

  /** All "station" RFID readers that serve a given route (mirrors getStopBoards' route matching). */
  private stationReadersForRoute(routeId: string): RFIDReader[] {
    return this.scenarioDefinition.readers.filter((reader) => {
      if (reader.kind !== "station") return false;
      if (reader.routeId) return reader.routeId === routeId;
      const route = this.scenarioDefinition.routes.find((item) =>
        item.segmentIds.includes(reader.segmentId),
      );
      return route?.id === routeId;
    });
  }

  /** Worst-case (busiest) Little's-Law wait estimate across a route's stops right now. */
  private routeDemandPressureSeconds(routeId: string): number {
    return this.stationReadersForRoute(routeId).reduce((worst, reader) => {
      const tracker = this.peekDemand(reader.id);
      return Math.max(worst, tracker.estimateAverageWaitSeconds());
    }, 0);
  }

  private reconcileServicePlan(announce: boolean) {
    if (!this.scenarioDefinition.depots?.length) return;
    if (!this.options.autoDispatch) {
      // Auto-dispatch is off: don't let stale sustained-duration timers from
      // before it was disabled cause an instant trigger the moment it's
      // switched back on.
      this.demandSustainedSinceAt.clear();
      this.delaySustainedSinceAt.clear();
      this.emergencyBoostUntil.clear();
      return;
    }
    const window = this.activeServiceWindow();

    for (const route of this.scenarioDefinition.routes) {
      if (!window) {
        this.demandSustainedSinceAt.delete(route.id);
        continue;
      }
      const routeTrams = this.trams.filter(
        (tram) => this.routeIdForTram(tram) === route.id,
      );

      // 1. Decide whether an emergency capacity boost is authorized — this
      // is the *only* place that grants or renews one, so it can never
      // fight with the target calculation below. Only *severe, sustained*
      // overcrowding earns a boost (a momentary spike doesn't count); once
      // granted it renews automatically for as long as the overcrowding
      // continues, and is left to expire naturally (not yanked early) the
      // moment it isn't renewed — a single clean withdrawal, not a flap.
      // A fresh boost (after a previous one lapsed) still respects a long
      // cooldown so this can't cycle.
      const maxWaitSeconds = this.routeDemandPressureSeconds(route.id);
      const boostWasActive =
        this.simulationTime < (this.emergencyBoostUntil.get(route.id) ?? 0);
      if (maxWaitSeconds > DEMAND_EXTRA_TRAM_WAIT_SECONDS) {
        if (!this.demandSustainedSinceAt.has(route.id)) {
          this.demandSustainedSinceAt.set(route.id, this.simulationTime);
        }
        const sustainedSeconds =
          this.simulationTime - this.demandSustainedSinceAt.get(route.id)!;
        if (boostWasActive) {
          this.emergencyBoostUntil.set(
            route.id,
            this.simulationTime + EMERGENCY_BOOST_DURATION_SECONDS,
          );
        } else if (sustainedSeconds >= DEMAND_SUSTAINED_SECONDS) {
          const cooldownElapsed =
            this.simulationTime - (this.lastDemandAdjustAt.get(route.id) ?? -Infinity) >
            DEMAND_ADJUST_COOLDOWN_SECONDS;
          if (cooldownElapsed) {
            this.emergencyBoostUntil.set(
              route.id,
              this.simulationTime + EMERGENCY_BOOST_DURATION_SECONDS,
            );
            this.lastDemandAdjustAt.set(route.id, this.simulationTime);
            if (announce) {
              this.addEvent(
                "warning",
                `${route.shortName}: severe overcrowding sustained ~${Math.round(sustainedSeconds / 60)} min (avg wait ~${maxWaitSeconds.toFixed(0)}s) — authorizing one emergency extra tram`,
              );
            }
          }
        }
      } else {
        this.demandSustainedSinceAt.delete(route.id);
      }

      // 2. The single place that actually moves trams to/from depot for
      // fleet-size reasons: scheduled target, plus the emergency boost above
      // if one is currently authorized. Approached one tram per recheck.
      const boostActiveNow =
        this.simulationTime < (this.emergencyBoostUntil.get(route.id) ?? 0);
      const scheduledTarget = window.routes[route.id]?.targetActiveTrams ?? routeTrams.length;
      const target = Math.min(
        routeTrams.length,
        scheduledTarget + (boostActiveNow ? 1 : 0),
      );
      const passengerService = routeTrams.filter(
        (tram) =>
          tram.serviceState === "in-service" || tram.serviceState === "depot-egress",
      );
      if (passengerService.length > target) {
        const candidate = passengerService
          .filter((tram) => tram.serviceState === "in-service")
          .sort((first, second) => second.linePriority - first.linePriority)[0];
        if (candidate) this.markForDepot(candidate, announce);
      } else if (passengerService.length < target) {
        // Prefer bringing back a tram parked in a turnback siding before
        // pulling one from a real depot — sidings are a scarce, one-or-two
        // track resource meant for brief tactical use, so freeing one up
        // takes priority over which depot-stored tram happens to be next by
        // priority order.
        const candidate = routeTrams
          .filter(
            (tram) =>
              tram.serviceState === "in-depot" && !tram.depotHoldManual,
          )
          .sort((first, second) => {
            const firstTurnback = this.depotKind(first.depotId) === "turnback" ? 1 : 0;
            const secondTurnback = this.depotKind(second.depotId) === "turnback" ? 1 : 0;
            if (firstTurnback !== secondTurnback) return secondTurnback - firstTurnback;
            return first.linePriority - second.linePriority;
          })[0];
        if (candidate) this.dispatchFromDepot(candidate, announce);
      }
    }

    // 3b. Turnback sidings are for brief tactical recovery, not storage — a
    // tram that's been parked in one too long is sent back into service
    // regardless of the route's current target, so it can't quietly occupy
    // that scarce track indefinitely.
    for (const tram of this.trams) {
      if (tram.serviceState !== "in-depot") continue;
      if (this.depotKind(tram.depotId) !== "turnback") continue;
      if (this.simulationTime - tram.depotEnteredAt < TURNBACK_MAX_DWELL_SECONDS) continue;
      this.dispatchFromDepot(tram, announce);
    }

    // 3. Short turn: also a last resort, for a single tram catastrophically
    // behind schedule (e.g. stuck a long time behind an obstacle) — not a
    // routine spacing tool. The threshold scales with the route's own
    // planned headway (a route running trams every 20 minutes tolerates a
    // much bigger absolute delay than one running every 5), and the delay
    // must stay above that threshold continuously for a while before
    // anything happens, so a single slow dwell doesn't trigger it.
    // depotPortalForTram always resolves to the nearest reachable portal — a
    // mid-route turnback siding if the network defines one nearby, otherwise
    // the terminal depot.
    for (const tram of this.trams) {
      if (tram.serviceState !== "in-service") {
        this.delaySustainedSinceAt.delete(tram.id);
        continue;
      }
      const plannedHeadwayMinutes =
        window?.routes[this.routeIdForTram(tram) ?? ""]?.plannedHeadwayMinutes ?? null;
      const thresholdSeconds = Math.max(
        SHORT_TURN_MIN_DELAY_SECONDS,
        (plannedHeadwayMinutes ?? 0) * 60 * SHORT_TURN_HEADWAY_MULTIPLIER,
      );
      if (tram.delaySeconds <= thresholdSeconds) {
        this.delaySustainedSinceAt.delete(tram.id);
        continue;
      }
      if (!this.delaySustainedSinceAt.has(tram.id)) {
        this.delaySustainedSinceAt.set(tram.id, this.simulationTime);
      }
      const sustainedSeconds =
        this.simulationTime - this.delaySustainedSinceAt.get(tram.id)!;
      if (sustainedSeconds < SHORT_TURN_SUSTAINED_SECONDS) continue;

      const withdrawn = this.markForDepot(tram, false, false, true);
      this.delaySustainedSinceAt.delete(tram.id);
      if (withdrawn && announce) {
        const isTurnback = tram.depotId?.startsWith("TURNBACK") ?? false;
        this.addEvent(
          "warning",
          isTurnback
            ? `${tram.label}: short turn at ${tram.lastPassengerStop} — pulled into the turnback siding, ${tram.delaySeconds.toFixed(0)}s behind schedule for over ${Math.round(sustainedSeconds / 60)} min`
            : `${tram.label}: short turn — withdrawn to depot, ${tram.delaySeconds.toFixed(0)}s behind schedule for over ${Math.round(sustainedSeconds / 60)} min`,
        );
      }
    }
  }

  private updateRoadVehicles(delta: number) {
    const previous = new Map(
      this.roadVehicles.map((vehicle) => [vehicle.id, vehicle.progress]),
    );
    for (const vehicle of this.roadVehicles) {
      const controller = this.trafficControllers.get(vehicle.controllerId);
      const roadOpen = controller?.phase === "road-green";
      const current = previous.get(vehicle.id) ?? vehicle.progress;
      let step = ROAD_CAR_SPEED * delta * vehicle.direction;

      if (!roadOpen) {
        const stopLine = vehicle.direction > 0 ? 0.39 : 0.61;
        const approaching =
          vehicle.direction > 0
            ? current < stopLine && current + step >= stopLine
            : current > stopLine && current + step <= stopLine;
        if (approaching) step = stopLine - current;
        const held = Math.abs(current - stopLine) < 0.002;
        if (held) step = 0;
      }

      const leaders = this.roadVehicles.filter(
        (other) =>
          other.id !== vehicle.id &&
          other.controllerId === vehicle.controllerId &&
          other.direction === vehicle.direction,
      );
      const nearestGap = leaders.reduce((nearest, leader) => {
        const leaderProgress = previous.get(leader.id) ?? leader.progress;
        const gap =
          vehicle.direction > 0
            ? (leaderProgress - current + 1) % 1
            : (current - leaderProgress + 1) % 1;
        return gap > 0.0001 ? Math.min(nearest, gap) : nearest;
      }, Number.POSITIVE_INFINITY);
      if (nearestGap <= ROAD_CAR_GAP) step = 0;

      vehicle.progress = (current + step + 1) % 1;
      vehicle.speed = Math.abs(step) / Math.max(delta, 0.0001);
      vehicle.stopped = Math.abs(step) < 0.000001;
    }
  }

  private updateDepotTransition(tram: TramState, delta: number, tramIndex: number) {
    const assignment = this.depotPortalById(tram.depotPortalId);
    if (!assignment) return;
    if (
      tram.serviceState === "depot-egress" &&
      tram.scheduledDepartureAt !== null &&
      this.simulationTime + 0.000001 < tram.scheduledDepartureAt
    ) {
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.lastAcceleration = 0;
      tram.tractionForceN = 0;
      tram.brakeForceN = 0;
      tram.dynamicsMode = "coast";
      tram.pwm = 0;
      tram.status = `Depot slot · ${formatClock(tram.scheduledDepartureClockSeconds ?? 0)}`;
      tram.statusTone = "idle";
      cppOverrideVehicleMotion(tramIndex, 0, 0);
      return;
    }
    if (tram.serviceState === "depot-egress" && tram.scheduledDepartureAt !== null) {
      this.recordScheduledDeparture(tram);
    }
    const dynamics = cppStepVehicleAuthority(
      tramIndex,
      this.vehicleAuthorityState(tram),
      {
        targetSpeedMps: DEPOT_TRACK_SPEED_MPS,
        grade: 0,
        passengerCount: tram.onboardPassengers,
      },
      delta,
    );
    tram.targetSpeedMps = DEPOT_TRACK_SPEED_MPS;
    this.applyVehicleAuthorityResult(tram, dynamics);
    const depotTrackLengthMeters = DEPOT_TRACK_SPEED_MPS * DEPOT_TRANSFER_SECONDS;
    const progressStep = dynamics.distanceMeters / depotTrackLengthMeters;
    tram.depotProgress = clamp(tram.depotProgress + progressStep, 0, 1);
    tram.pwm = 24;

    if (tram.serviceState === "depot-ingress") {
      tram.status = `Entering ${assignment.depot.shortName} · not in service`;
      if (tram.depotProgress >= 0.999999) {
        const nextState = cppDepotObserveAuthority(
          tramIndex,
          tram.serviceState,
          { reachedDepot: true },
        );
        if (nextState === "in-depot") {
          this.placeInDepot(tram);
          this.addEvent("ok", `${tram.label} stored in ${assignment.depot.shortName}`);
        }
      }
      return;
    }

    tram.status = `Leaving ${assignment.depot.shortName} · not in service`;
    if (tram.depotProgress < 0.999999) return;
    const exitRuntime = this.segments.get(assignment.portal.exitSegmentId);
    const exitBlocked = this.trams.some(
      (other) =>
        other.id !== tram.id &&
        other.serviceState !== "in-depot" &&
        other.segmentId === assignment.portal.exitSegmentId &&
        Math.abs(other.progress - assignment.portal.exitProgress) < 0.08,
    );
    if (!exitRuntime || exitBlocked) {
      tram.depotProgress = 0.999;
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.lastAcceleration = 0;
      tram.tractionForceN = 0;
      tram.brakeForceN = 0;
      tram.dynamicsMode = "coast";
      tram.status = "Depot exit held · rail occupied";
      return;
    }
    const nextState = cppDepotObserveAuthority(
      tramIndex,
      tram.serviceState,
      { reachedLine: true, exitClear: true },
    );
    if (nextState !== "in-service") return;
    tram.segmentId = exitRuntime.id;
    tram.progress = assignment.portal.exitProgress;
    tram.serviceState = nextState;
    tram.depotId = null;
    tram.depotPortalId = null;
    tram.depotProgress = 0;
    tram.triggeredOnSegment.clear();
    tram.status = "Entered passenger service";
    tram.statusTone = "normal";
    tram.speedMps = 0;
    // Reset the schedule-adherence baseline: without this, delaySeconds is
    // computed against how long ago the tram *first* ever entered service,
    // ignoring however long it just sat in the depot. That made every
    // freshly redispatched tram look enormously "late" the instant it left
    // the depot, which the demand dispatcher's short-turn logic would
    // immediately act on — withdrawing it again right away, over and over.
    tram.releaseTime = this.simulationTime;
    tram.serviceStartDistanceMeters = tram.distanceMeters;
    this.initializeHeadwayTargets();
    this.invalidateStopBoards();
    this.addEvent("ok", `${tram.label} entered route ${this.routeIdForTram(tram)} service`);
  }

  step(realDeltaSeconds: number) {
    if (!this.isRunning) return;
    const elapsed = clamp(realDeltaSeconds, 0, 0.1) * this.options.simulationRate;
    this.fixedStepClock.advance(elapsed, (delta) => this.stepFixed(delta));
  }

  private stepFixed(delta: number) {
    this.simulationTime += delta;
    this.updateTraffic();
    this.updateRoadVehicles(delta);
    if (this.simulationTime >= this.nextDemandRefreshAt) {
      this.refreshAllDemand();
      this.nextDemandRefreshAt = this.simulationTime + DEMAND_REFRESH_SECONDS;
    }
    if (this.simulationTime >= this.nextServicePlanCheckAt) {
      this.reconcileServicePlan(true);
      this.nextServicePlanCheckAt =
        this.simulationTime + SERVICE_PLAN_RECHECK_SECONDS;
    }

    for (const [tramIndex, tram] of this.trams.entries()) {
      this.updateTram(tram, delta, tramIndex);
      this.updateEtaAverageSpeed(tram, delta);
    }
    this.settleTractionPower(delta);
  }

  private powerSectionForSegment(segmentId: string) {
    return this.scenarioDefinition.tractionPowerSystem?.sections.find((section) =>
      section.segmentIds.includes(segmentId),
    ) ?? null;
  }

  private energyOptimizedTarget(
    tram: TramState,
    targetSpeedMps: number,
    tramIndex: number,
    delta: number,
  ) {
    const section = this.powerSectionForSegment(tram.segmentId);
    const sections = this.scenarioDefinition.tractionPowerSystem?.sections ?? [];
    const nextStop = this.nextPassengerStop(tram);
    // The first eco-driving layer optimizes coast-to-stop trajectories.
    // Curve and turnout envelopes remain hard C++ authorities in targetSpeedMps;
    // using every geometry vertex as an eco destination would cause repeated
    // micro-coasting on a long continuous curve.
    const constraintDistanceMeters = nextStop?.distanceMeters ?? null;
    // The detector is the hand-off point, not the final stopping point. Reach
    // it at about 16 km/h and let the precise platform controller perform the
    // final braking. Crawling to the detector itself creates a large journey-
    // time penalty on closely spaced urban stops.
    const constraintSpeedMps = 4.5;
    const constraintLabel = nextStop ? `Stop · ${nextStop.label}` : null;
    const approachIsLatched = Boolean(
      nextStop && tram.ecoApproachStopId === nextStop.id,
    );
    if (tram.ecoApproachStopId && !approachIsLatched) {
      tram.ecoApproachStopId = null;
    }
    const follower = this.nearestTramBehindOnRoute(tram);
    const headwayAllowsEco =
      !follower || follower.distanceMeters >= tram.desiredHeadwayMeters * 0.9;
    const eco = cppPredictiveEcoTarget({
      index: tramIndex,
      enabled:
        PREDICTIVE_ECO_SPEED_CONTROL_ENABLED &&
        this.options.energyStrategy === "network-optimal" &&
        !tram.manualMode &&
        tram.stationPhase === "none" &&
        (approachIsLatched || headwayAllowsEco) &&
        targetSpeedMps > 0,
      speedMps: tram.speedMps,
      authorityTargetMps: targetSpeedMps,
      distanceToConstraintMeters: constraintDistanceMeters,
      constraintSpeedMps,
      grade: this.currentTrackGrade(tram),
      passengerCount: tram.onboardPassengers,
      // Do not drop an already-started approach merely because delay changes
      // by a few seconds; restoring line speed just before the stop is wasteful.
      scheduleMargin: approachIsLatched
        ? Math.max(0.2, clamp((8 - tram.delaySeconds) / 8, 0, 1))
        : clamp((8 - tram.delaySeconds) / 8, 0, 1),
    });
    if (eco.mode !== "cruise" && nextStop) {
      tram.ecoApproachStopId = nextStop.id;
    }
    tram.ecoDrivingMode = eco.mode;
    tram.ecoConstraintDistanceMeters = constraintDistanceMeters;
    tram.ecoConstraintLabel = constraintLabel;
    if (eco.mode === "coast") tram.ecoCoastSeconds += delta;
    const result = cppEnergyOptimizedTarget({
      index: tramIndex,
      sectionIndex: section ? sections.indexOf(section) : -1,
      // Do not sacrifice service indefinitely for peak shaving: once a tram is
      // seriously late, schedule recovery outranks the energy controller.
      manual: tram.manualMode || tram.delaySeconds > 45,
      inService: tram.serviceState === "in-service",
      now: this.simulationTime,
      speedMps: tram.speedMps,
      targetSpeedMps: eco.targetSpeedMps,
    });
    tram.energyGuidanceActive = result.guidance === 2 || eco.mode !== "cruise";
    if (result.guidance === 1 && section) {
      if (tram.speedMps < 5) {
        tram.status = `Energy match · ${section.label}`;
        tram.statusTone = "normal";
      }
    } else if (result.guidance === 2 && section) {
      tram.status = `Energy peak smoothing · ${section.label}`;
      tram.statusTone = "warning";
    } else if (eco.mode === "coast" && constraintDistanceMeters !== null) {
      tram.status = `Eco coast · ${constraintLabel ?? "constraint"} in ${this.formatDistance(constraintDistanceMeters)}`;
      tram.statusTone = "normal";
    } else if (eco.mode === "predictive-brake" && constraintDistanceMeters !== null) {
      tram.status = `Predictive braking · ${constraintLabel ?? "constraint"} in ${this.formatDistance(constraintDistanceMeters)}`;
      tram.statusTone = "warning";
    }
    return result.targetSpeedMps;
  }

  private settleTractionPower(delta: number) {
    const system = this.scenarioDefinition.tractionPowerSystem;
    if (!system || !(delta > 0)) return;
    const result = cppSettleTractionPower(delta, this.trams.map((tram) => ({
      sectionIndex: system.sections.findIndex((section) => section.segmentIds.includes(tram.segmentId)),
      consumedWh: tram.energyWh,
      mechanicalWh: tram.mechanicalBrakeEnergyWh,
      grossWh: tram.grossRegeneratedWh,
      acceptedWh: tram.recoveredWh,
      rejectedWh: tram.rejectedRegenerationWh,
    })));
    if (!result) return;
    result.vehicles.forEach((energy, index) => {
      this.trams[index].recoveredWh = energy.acceptedWh;
      this.trams[index].rejectedRegenerationWh = energy.rejectedWh;
    });
    result.sections.forEach((runtime, index) => this.powerSectionRuntime.set(system.sections[index].id, runtime));
    this.peakNetworkGridPowerKw = result.peakNetworkGridPowerKw;
    this.energyInterventions = result.interventions;
  }

  toggleSwitch(switchId?: string) {
    const definition =
      this.scenarioDefinition.switches.find((item) => item.id === switchId) ??
      this.scenarioDefinition.switches[0];
    if (!definition) return false;
    const runtime = this.switchStates.get(definition.id);
    if (!runtime) return false;
    const switchIndex = this.scenarioDefinition.switches.findIndex(
      (item) => item.id === definition.id,
    );
    const lockedByIndex = runtime.lockedBy
      ? this.trams.findIndex((tram) => tram.id === runtime.lockedBy)
      : -1;
    const result = cppToggleSwitchAuthority(
      switchIndex,
      runtime.state,
      lockedByIndex,
      this.options.controlMode === "cooperative",
    );
    if (!result) {
      this.addEvent("warning", `${definition.id} is route-locked by ${runtime.lockedBy}`);
      return false;
    }
    runtime.state = result.state;
    runtime.lockedBy =
      result.lockedByIndex >= 0
        ? this.trams[result.lockedByIndex]?.id ?? null
        : null;
    this.addEvent("info", `${definition.id} manually set to ${runtime.state.toUpperCase()}`);
    return true;
  }

  setTrafficSignalMode(signalId: string, mode: TrafficManualMode) {
    const controller = this.trafficForSignal(signalId);
    if (!controller) return false;
    controller.manualMode = mode;
    controller.manualSignalId = mode === "tram-green" ? signalId : null;
    invalidateCppTrafficController(this.trafficControllerIndex(controller));

    if (mode === "tram-green") {
      controller.manualReleasePending = false;
      controller.phase = "tram-green";
      controller.phaseUntil = 0;
      controller.activeSignalId = signalId;
      controller.activeTramId = null;
      controller.activeTramEntered = false;
      controller.activeTramCleared = false;
      controller.activeGrantedAt = this.simulationTime;
      this.addEvent("warning", `${controller.label}: manual TRAM GO on ${signalId} · road traffic stopped`);
      return true;
    }

    const occupied = controller.activeTramEntered && !controller.activeTramCleared;
    if (occupied) {
      controller.manualReleasePending = true;
      this.addEvent(
        "warning",
        `${controller.label}: ${mode === "auto" ? "AUTO" : "ROAD GO"} queued until the tram rear clears`,
      );
      return true;
    }

    controller.manualReleasePending = false;
    controller.phase = "road-green";
    controller.phaseUntil = 0;
    controller.activeTramId = null;
    controller.activeSignalId = null;
    controller.activeTramEntered = false;
    controller.activeTramCleared = false;
    controller.activeGrantedAt = 0;
    this.addEvent(
      mode === "auto" ? "ok" : "warning",
      `${controller.label}: ${mode === "auto" ? "automatic control restored" : "manual ROAD GO · tram signals red"}`,
    );
    return true;
  }

  addObstacleAt(point: Point) {
    const nearest = this.nearestTrack(point);
    if (!nearest || nearest.distance > 34) return false;
    const obstacle: ObstacleState = {
      id: `O${String(++this.obstacleSequence).padStart(2, "0")}`,
      segmentId: nearest.segmentId,
      at: nearest.progress,
    };
    this.obstacles.push(obstacle);
    this.invalidateStopBoards();
    this.addEvent("warning", `${obstacle.id} placed on ${nearest.segmentId}`);
    return true;
  }

  removeObstacleNear(point: Point) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.obstacles.forEach((obstacle, index) => {
      const segmentRuntime = this.segments.get(obstacle.segmentId);
      if (!segmentRuntime) return;
      const location = sampleTrackSegment(segmentRuntime, obstacle.at).point;
      const currentDistance = distance(point, location);
      if (currentDistance < bestDistance) {
        bestDistance = currentDistance;
        bestIndex = index;
      }
    });
    if (bestIndex < 0 || bestDistance > 34) return false;
    const [removed] = this.obstacles.splice(bestIndex, 1);
    this.invalidateStopBoards();
    this.addEvent("ok", `${removed.id} removed from the network`);
    return true;
  }

  clearObstacles() {
    if (this.obstacles.length === 0) return;
    const count = this.obstacles.length;
    this.obstacles = [];
    this.invalidateStopBoards();
    this.addEvent("ok", `${count} obstacle${count === 1 ? "" : "s"} cleared`);
  }

  hitTest(point: Point) {
    const tramHit = this.getTramSnapshots()
      .map((tram) => ({ id: tram.id, distance: distance(point, tram.position) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (tramHit && tramHit.distance < 30) return { type: "tram" as const, id: tramHit.id };

    for (const definition of this.scenarioDefinition.switches) {
      const location = this.getSwitchPoint(definition);
      if (!location) continue;
      if (distance(point, location) < 34) {
        return { type: "switch" as const, id: definition.id };
      }
    }

    for (const board of this.getStopBoards()) {
      if (distance(point, board.point) < 24) {
        return { type: "station" as const, id: board.id };
      }
    }

    const obstacleHit = this.obstacles
      .map((obstacle) => {
        const runtime = this.segments.get(obstacle.segmentId);
        const location = runtime
          ? sampleTrackSegment(runtime, obstacle.at).point
          : { x: -1000, y: -1000 };
        return { id: obstacle.id, distance: distance(point, location) };
      })
      .sort((a, b) => a.distance - b.distance)[0];
    if (obstacleHit && obstacleHit.distance < 30) {
      return { type: "obstacle" as const, id: obstacleHit.id };
    }
    return null;
  }

  getSnapshot(): SimulationSnapshot {
    const trams = this.getTramSnapshots();
    const trafficControllers = this.getTrafficControllerSnapshots();
    const stopBoards = this.getStopBoards();
    const primaryTraffic = this.getPrimaryTrafficController();
    const serviceWindow = this.activeServiceWindow();
    const speeds = trams.filter((tram) => tram.status !== "Scheduled").map((tram) => tram.speedKmh);
    const totalDelay = trams.reduce((sum, tram) => sum + tram.delaySeconds, 0);
    const departureTotals = [...this.departureStatsByRoute.values()].reduce(
      (total, item) => ({
        total: total.total + item.total,
        onTime: total.onTime + item.onTime,
        absoluteDeviationSeconds:
          total.absoluteDeviationSeconds + item.absoluteDeviationSeconds,
      }),
      { total: 0, onTime: 0, absoluteDeviationSeconds: 0 },
    );
    const energyWh = trams.reduce((sum, tram) => sum + tram.energyWh, 0);
    const recoveredWh = trams.reduce((sum, tram) => sum + tram.recoveredWh, 0);
    const measuredHeadways = trams
      .map((tram) => tram.headwayAheadMeters)
      .filter((value): value is number => value !== null);
    const plannedHeadways = trams
      .map((tram) => tram.targetHeadwayMeters)
      .filter((value) => value > PHYSICAL_TRAM_GAP_METERS);
    const warningCount =
      this.obstacles.length +
      trams.filter((tram) => tram.statusTone === "warning" || tram.statusTone === "danger")
        .length;
    return {
      running: this.isRunning,
      time: this.simulationTime,
      clock: formatClock(this.serviceClockSeconds()),
      scenarioId: this.scenarioDefinition.id,
      scenarioName: this.scenarioDefinition.name,
      scenarioDescription: this.scenarioDefinition.description,
      options: { ...this.options },
      trafficPhase: primaryTraffic?.phase ?? "road-green",
      activeTrafficTram: primaryTraffic?.activeTramId ?? null,
      activeTrafficSignal: primaryTraffic?.activeSignalId ?? null,
      trafficControllers,
      stopBoards,
      selectedStopId: this.selectedStopId,
      fleetGroups: (this.scenarioDefinition.fleetGroups ?? []).map((group) => ({
        id: group.id,
        label: group.label,
        shortName: group.shortName,
        routeId: group.routeId,
        routeIntent: group.routeIntent,
        count: this.fleetGroupCounts?.get(group.id) ?? 0,
        maxCount: group.maxCount ?? 10,
      })),
      fleetCapacity: MAX_TRAMS,
      depots: (this.scenarioDefinition.depots ?? []).map((depot) => ({
        id: depot.id,
        label: depot.label,
        shortName: depot.shortName,
        note: depot.note,
        point: depot.point,
        storedTrams: this.trams.filter(
          (tram) => tram.depotId === depot.id && tram.serviceState === "in-depot",
        ).length,
        inboundTrams: this.trams.filter(
          (tram) =>
            tram.depotId === depot.id &&
            (tram.serviceState === "to-depot" ||
              tram.serviceState === "depot-ingress"),
        ).length,
        outboundTrams: this.trams.filter(
          (tram) =>
            tram.depotId === depot.id && tram.serviceState === "depot-egress",
        ).length,
        kind: depot.kind ?? "depot",
        capacity: depot.capacity ?? null,
      })),
      roadVehicles: this.roadVehicles.map((vehicle) => ({ ...vehicle })),
      routeOperations: this.getRouteOperationsSnapshot(),
      serviceScheduleLabel: serviceWindow?.label ?? null,
      serviceMinute: this.serviceMinute(),
      trams,
      events: [...this.events],
      obstacles: this.obstacles.map((item) => ({ ...item })),
      switches: this.scenarioDefinition.switches.map((definition) => {
        const runtime = this.switchStates.get(definition.id);
        return {
          id: definition.id,
          label: definition.label,
          state: runtime?.state ?? "main",
          lockedBy: runtime?.lockedBy ?? null,
          queued: runtime?.queue.length ?? 0,
        };
      }),
      metrics: {
        averageSpeedKmh:
          speeds.length > 0 ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 0,
        headwayMeters:
          measuredHeadways.length > 0 ? Math.min(...measuredHeadways) : 0,
        targetHeadwayMeters:
          plannedHeadways.length > 0
            ? plannedHeadways.reduce((sum, value) => sum + value, 0) /
              plannedHeadways.length
            : FALLBACK_HEADWAY_METERS,
        onTimePercent: clamp(100 - (totalDelay / Math.max(1, trams.length)) * 1.4, 0, 100),
        scheduledDepartures: departureTotals.total,
        departureAdherencePercent: departureTotals.total
          ? (departureTotals.onTime / departureTotals.total) * 100
          : null,
        meanDepartureDeviationSeconds: departureTotals.total
          ? departureTotals.absoluteDeviationSeconds / departureTotals.total
          : null,
        completedLaps: trams.reduce((sum, tram) => sum + tram.lap, 0),
        energyWh,
        recoveredWh,
        emergencyStops: trams.reduce((sum, tram) => sum + tram.emergencyStops, 0),
        intervalRecoveryTrams: trams.filter((tram) =>
          tram.status.startsWith("Interval recovery"),
        ).length,
      },
      energyStatistics: this.getEnergyStatistics(),
      warningCount,
    };
  }

  getRenderState() {
    return {
      scenario: this.scenarioDefinition,
      trams: this.getTramSnapshots(),
      obstacles: this.obstacles.map((item) => ({ ...item })),
      switches: this.scenarioDefinition.switches.map((definition) => ({
        definition,
        runtime: { ...this.switchStates.get(definition.id)! },
      })),
      signals: this.scenarioDefinition.signals.map((definition) => {
        const controller = this.trafficControllers.get(
          definition.controllerId ?? definition.id,
        );
        return {
          definition,
          phase: controller?.phase ?? ("road-green" as TrafficPhase),
          activeTramId: controller?.activeTramId ?? null,
          activeSignalId: controller?.activeSignalId ?? null,
        };
      }),
      roadVehicles: this.roadVehicles.map((vehicle) => ({ ...vehicle })),
      depots: this.scenarioDefinition.depots ?? [],
      selectedTramId: this.selectedTramId,
      selectedStopId: this.selectedStopId,
      sensorRangeMeters: this.options.sensorRangeMeters,
      metersPerReferenceUnit:
        this.scenarioDefinition.metersPerReferenceUnit ?? REFERENCE_TO_METERS,
    };
  }

  getPointOnSegment(segmentId: string, progress: number) {
    const runtime = this.segments.get(segmentId);
    return runtime ? sampleTrackSegment(runtime, progress) : null;
  }

  private invalidateStopBoards() {
    this.stopBoardRevision += 1;
  }

  private tramMatchesStopBoardDirection(
    tram: TramState,
    reader: RFIDReader,
  ): boolean {
    if (this.scenarioDefinition.id !== "izmir-konak") return true;

    const directionOf = (segmentId: string) => {
      if (segmentId.startsWith("IZK-O")) return "outbound";
      if (segmentId.startsWith("IZK-I")) return "inbound";
      return null;
    };
    const readerDirection = directionOf(reader.segmentId);
    return readerDirection === null || directionOf(tram.segmentId) === readerDirection;
  }

  private getStopBoards(): StopBoardSnapshot[] {
    const cacheSecond = Math.floor(
      this.simulationTime / STOP_BOARD_REFRESH_SECONDS,
    );
    if (
      this.stopBoardCacheSecond === cacheSecond &&
      this.stopBoardCacheRevision === this.stopBoardRevision
    ) {
      return this.ageStopBoardEtas(this.stopBoardCache);
    }
    const stationReaders = this.scenarioDefinition.readers
      .filter((reader) => reader.kind === "station")
      .sort((first, second) =>
        Number(first.render === false) - Number(second.render === false),
      );
    const groups = new Map<
      string,
      {
        id: string;
        stationNumber: number | null;
        label: string;
        point: Point;
        readers: RFIDReader[];
      }
    >();

    for (const reader of stationReaders) {
      const segmentRuntime = this.segments.get(reader.segmentId);
      if (!segmentRuntime) continue;
      const id = stationBoardId(reader);
      const existing = groups.get(id);
      if (existing) {
        existing.readers.push(reader);
        continue;
      }
      groups.set(id, {
        id,
        stationNumber: reader.stationNumber ?? null,
        label: reader.stopBoardLabel ?? reader.label,
        point: sampleTrackSegment(
          segmentRuntime,
          reader.displayAt ?? reader.at,
        ).point,
        readers: [reader],
      });
    }

    const boards = [...groups.values()]
      .sort((first, second) => {
        if (first.stationNumber !== null && second.stationNumber !== null) {
          return first.stationNumber - second.stationNumber;
        }
        return first.label.localeCompare(second.label);
      })
      .map((group) => ({
        id: group.id,
        stationNumber: group.stationNumber,
        label: group.label,
        point: group.point,
        directions: group.readers.map((reader) => {
          const route = reader.routeId
            ? this.scenarioDefinition.routes.find((item) => item.id === reader.routeId)
            : this.scenarioDefinition.routes.find((item) =>
                item.segmentIds.includes(reader.segmentId),
              );
          const routeIndex = route
            ? this.scenarioDefinition.routes.findIndex((item) => item.id === route.id)
            : -1;
          const arrivalsByDistance = this.trams
            .filter(
              (tram) =>
                (tram.serviceState === "in-service" ||
                  tram.serviceState === "to-depot") &&
                (routeIndex < 0 ||
                  this.scenarioDefinition.id === "izmir-konak" ||
                  (tram.routeIntent === "branch" ? 1 : 0) === routeIndex),
            )
            .map((tram) => {
              const approach = this.stopBoardApproach(tram, reader);
              return approach === null
                ? null
                : this.buildStopArrival(
                    tram,
                    approach.distanceMeters,
                    `${reader.id}:${tram.id}`,
                    approach.terminalTurnaround ? 60 : 0,
                  );
            })
            .filter((arrival): arrival is StopArrivalSnapshot => arrival !== null)
            .sort(
              (first, second) =>
                first.distanceMeters - second.distanceMeters ||
                first.tramId.localeCompare(second.tramId),
            )
            .slice(0, 3);
          const serviceSpeedMps = Math.max(
            2.5,
            (this.options.speedLimit / 3.6) * 0.58,
          );
          let previousArrival: StopArrivalSnapshot | null = null;
          const arrivals = arrivalsByDistance.map((arrival) => {
            if (
              arrival.etaSeconds === null ||
              previousArrival?.etaSeconds === null ||
              previousArrival === null
            ) {
              previousArrival = arrival;
              return arrival;
            }
            const trackSeparationSeconds =
              (arrival.distanceMeters - previousArrival.distanceMeters) /
              serviceSpeedMps;
            const orderedArrival = {
              ...arrival,
              etaSeconds: Math.max(
                arrival.etaSeconds,
                previousArrival.etaSeconds + Math.max(30, trackSeparationSeconds),
              ),
            };
            previousArrival = orderedArrival;
            return orderedArrival;
          });
          const demand = this.peekDemand(reader.id);
          return {
            id: `${route?.id ?? "service"}:${reader.id}`,
            label: reader.directionLabel ?? route?.name ?? "Service",
            shortName: reader.directionShortName ?? route?.shortName ?? "TRAM",
            platformLabel: reader.label,
            color: route?.color ?? "#25d4e8",
            arrivals,
            waitingPassengers: demand.boardable(),
            averageWaitSeconds: demand.estimateAverageWaitSeconds(),
            overcrowded: demand.isOvercrowded(),
          };
        }),
      }));
    this.stopBoardCache = boards;
    this.stopBoardCacheSecond = cacheSecond;
    this.stopBoardCacheGeneratedAt = this.simulationTime;
    this.stopBoardCacheRevision = this.stopBoardRevision;
    return boards;
  }

  private ageStopBoardEtas(
    boards: StopBoardSnapshot[],
  ): StopBoardSnapshot[] {
    const elapsedSeconds = Math.max(
      0,
      this.simulationTime - this.stopBoardCacheGeneratedAt,
    );
    if (elapsedSeconds <= 0) return boards;
    return boards.map((board) => ({
      ...board,
      directions: board.directions.map((direction) => ({
        ...direction,
        arrivals: direction.arrivals.map((arrival) => ({
          ...arrival,
          etaSeconds:
            arrival.etaSeconds === null
              ? null
              : Math.max(0, arrival.etaSeconds - elapsedSeconds),
        })),
      })),
    }));
  }

  private buildStopArrival(
    tram: TramState,
    distanceMeters: number,
    estimateKey: string,
    extraWaitSeconds = 0,
  ): StopArrivalSnapshot {
    const blockingObstacle = this.obstacles.find((obstacle) => {
      const obstacleDistance = this.forwardDistanceToPosition(
        tram,
        obstacle.segmentId,
        obstacle.at,
      );
      return (
        obstacleDistance !== null &&
        obstacleDistance >= 0 &&
        obstacleDistance <= distanceMeters + 0.01
      );
    });
    const held =
      Boolean(blockingObstacle) ||
      tram.segmentId.startsWith("N2X-") ||
      (tram.manualMode && tram.manualCommand === "stop");
    if (held) {
      this.stopArrivalTimes.delete(estimateKey);
      return {
        tramId: tram.id,
        tramLabel: tram.label,
        color: tram.color,
        distanceMeters,
        etaSeconds: null,
        status: "held",
        statusLabel: blockingObstacle
          ? `${blockingObstacle.id} BLOCK`
          : tram.segmentId.startsWith("N2X-")
            ? "OFF ROUTE"
            : "MANUAL HOLD",
      };
    }

    const speedLimitMps = this.options.speedLimit / 3.6;
    const serviceSpeedMps = Math.max(2.5, speedLimitMps * 0.58);
    const effectiveSpeedMps = clamp(
      tram.etaAverageSpeedMps * 0.72 + serviceSpeedMps * 0.28,
      1.2,
      speedLimitMps,
    );
    let knownWaitSeconds =
      Math.max(0, tram.releaseTime - this.simulationTime) + extraWaitSeconds;
    if (tram.stationPhase === "dwell") {
      knownWaitSeconds += Math.max(0, tram.stationUntil - this.simulationTime);
    } else if (tram.stationPhase === "crawl") {
      knownWaitSeconds += 5;
    }

    for (const signal of this.scenarioDefinition.signals) {
      const signalDistance = this.forwardDistanceToPosition(
        tram,
        signal.segmentId,
        signal.at,
      );
      if (
        signalDistance === null ||
        signalDistance < 0 ||
        signalDistance > distanceMeters
      ) {
        continue;
      }
      const controller = this.trafficForSignal(signal.id);
      const permitted =
        controller?.phase === "tram-green" &&
        controller.activeSignalId === signal.id;
      if (!permitted) knownWaitSeconds += 4;
    }

    const rawEtaSeconds =
      knownWaitSeconds + distanceMeters / effectiveSpeedMps;
    const etaSeconds = this.smoothStopEta(estimateKey, rawEtaSeconds);
    const status: StopArrivalStatus =
      distanceMeters <= 25
        ? "due"
        : knownWaitSeconds > 0 && this.simulationTime < tram.releaseTime
          ? "scheduled"
          : tram.status.startsWith("Interval recovery")
            ? "recovering"
            : "moving";
    return {
      tramId: tram.id,
      tramLabel: tram.label,
      color: tram.color,
      distanceMeters,
      etaSeconds,
      status,
      statusLabel:
        tram.serviceState === "to-depot"
          ? `DEPOT · TO ${tram.lastPassengerStop ?? "LAST STOP"}`
          : status === "due"
          ? "DUE"
          : status === "scheduled"
            ? "DISPATCH"
            : status === "recovering"
              ? "REGULATING"
              : this.formatDistance(distanceMeters),
    };
  }

  private updateEtaAverageSpeed(tram: TramState, delta: number) {
    if (
      this.simulationTime < tram.releaseTime ||
      tram.serviceState !== "in-service" ||
      tram.segmentId.startsWith("N2X-")
    ) {
      return;
    }
    const speedLimitMps = this.options.speedLimit / 3.6;
    const weight = 1 - Math.exp(-delta / ETA_SPEED_AVERAGE_SECONDS);
    tram.etaAverageSpeedMps = clamp(
      tram.etaAverageSpeedMps +
        (tram.speedMps - tram.etaAverageSpeedMps) * weight,
      0,
      speedLimitMps,
    );
  }

  private smoothStopEta(estimateKey: string, rawEtaSeconds: number) {
    const rawArrivalTime = this.simulationTime + rawEtaSeconds;
    const previousArrivalTime = this.stopArrivalTimes.get(estimateKey);
    const tramHasPassedStop =
      previousArrivalTime !== undefined &&
      previousArrivalTime <= this.simulationTime + 30 &&
      rawEtaSeconds > 90;

    if (
      previousArrivalTime === undefined ||
      rawEtaSeconds <= 25 ||
      tramHasPassedStop
    ) {
      this.stopArrivalTimes.set(estimateKey, rawArrivalTime);
      return rawEtaSeconds;
    }

    const weightedCorrection =
      (rawArrivalTime - previousArrivalTime) * ETA_CORRECTION_WEIGHT;
    const correctedArrivalTime = Math.max(
      this.simulationTime,
      previousArrivalTime +
        clamp(
          weightedCorrection,
          -ETA_MAX_EARLY_CORRECTION_SECONDS,
          ETA_MAX_LATE_CORRECTION_SECONDS,
        ),
    );
    this.stopArrivalTimes.set(estimateKey, correctedArrivalTime);
    return correctedArrivalTime - this.simulationTime;
  }

  private forwardDistanceToPosition(
    tram: TramState,
    targetSegmentId: string,
    targetProgress: number,
    segmentScopePrefix?: string,
  ) {
    if (tram.segmentId.startsWith("N2X-")) return null;
    const current = this.segments.get(tram.segmentId);
    if (!current || !this.segments.has(targetSegmentId)) return null;
    if (
      segmentScopePrefix &&
      (!current.id.startsWith(segmentScopePrefix) ||
        !targetSegmentId.startsWith(segmentScopePrefix))
    ) {
      return null;
    }

    if (targetSegmentId === current.id) {
      const progressDifference = targetProgress - tram.progress;
      if (Math.abs(progressDifference) <= 0.000001) return 0;
      if (progressDifference > 0) {
        return progressDifference * current.lengthMeters;
      }
    }

    let distanceMeters = (1 - tram.progress) * current.lengthMeters;
    let cursor = current;
    const visited = new Set([current.id]);
    for (let guard = 0; guard <= this.segments.size; guard += 1) {
      const next = this.peekNextSegment(tram, cursor);
      if (!next) return null;
      if (segmentScopePrefix && !next.id.startsWith(segmentScopePrefix)) {
        return null;
      }
      if (next.id === targetSegmentId) {
        return distanceMeters + targetProgress * next.lengthMeters;
      }
      if (visited.has(next.id)) return null;
      visited.add(next.id);
      distanceMeters += next.lengthMeters;
      cursor = next;
    }
    return null;
  }

  private stopBoardApproach(
    tram: TramState,
    reader: RFIDReader,
  ): { distanceMeters: number; terminalTurnaround: boolean } | null {
    if (this.scenarioDefinition.id !== "izmir-konak") {
      const distanceMeters = this.forwardDistanceToPosition(
        tram,
        reader.segmentId,
        reader.at,
      );
      return distanceMeters === null
        ? null
        : { distanceMeters, terminalTurnaround: false };
    }

    const targetPrefix = reader.segmentId.startsWith("IZK-O")
      ? "IZK-O"
      : reader.segmentId.startsWith("IZK-I")
        ? "IZK-I"
        : null;
    if (!targetPrefix) return null;

    const directDistance = this.forwardDistanceToPosition(
      tram,
      reader.segmentId,
      reader.at,
      targetPrefix,
    );
    if (directDistance !== null) {
      return { distanceMeters: directDistance, terminalTurnaround: false };
    }

    const current = this.segments.get(tram.segmentId);
    if (!current || current.id.startsWith(targetPrefix)) return null;
    let distanceMeters = (1 - tram.progress) * current.lengthMeters;
    let cursor = current;
    let enteredTargetDirection = false;
    const visited = new Set([current.id]);
    for (let guard = 0; guard <= this.segments.size; guard += 1) {
      const next = this.peekNextSegment(tram, cursor);
      if (!next || visited.has(next.id)) return null;
      visited.add(next.id);
      if (next.id.startsWith(targetPrefix)) enteredTargetDirection = true;
      else if (enteredTargetDirection) return null;
      if (next.id === reader.segmentId && enteredTargetDirection) {
        return {
          distanceMeters: distanceMeters + reader.at * next.lengthMeters,
          terminalTurnaround: true,
        };
      }
      distanceMeters += next.lengthMeters;
      cursor = next;
    }
    return null;
  }

  private buildSpeedRestrictions() {
    const restrictions: SpeedRestrictionRuntime[] = [];
    if (![
      "nizhny-route-2",
      "nizhny-routes-2-21",
      "izmir-konak",
    ].includes(this.scenarioDefinition.id)) return restrictions;
    const addCurve = (id: string, segmentId: string, at: number, radiusMeters: number) => {
      if (!Number.isFinite(radiusMeters) || radiusMeters >= 230) return;
      restrictions.push({
        id,
        segmentId,
        at: clamp(at, 0, 1),
        reason: "curve",
        // Hand-drawn map vertices can mathematically be sharper than tram track.
        // 18 m is a conservative physical floor for the geometry-derived model.
        radiusMeters: Math.max(18, radiusMeters),
        infrastructureSpeedMps: null,
      });
    };

    for (const segment of this.segments.values()) {
      const scale = segment.lengthMeters / Math.max(0.001, segment.lengthRef);
      for (let index = 1; index < segment.points.length - 1; index += 1) {
        addCurve(
          `curve:${segment.id}:${index}`,
          segment.id,
          segment.cumulative[index] / segment.lengthRef,
          circumradius(
            segment.points[index - 1],
            segment.points[index],
            segment.points[index + 1],
          ) * scale,
        );
      }
    }

    // Capture bends represented by two straight segments meeting at a node.
    // This is especially important for the schematic Izmir geometry.
    for (const route of this.scenarioDefinition.routes) {
      route.segmentIds.forEach((segmentId, index) => {
        const current = this.segments.get(segmentId);
        const nextId = route.segmentIds[(index + 1) % route.segmentIds.length];
        const next = this.segments.get(nextId);
        if (!current || !next) return;
        const chordMeters = 25;
        const before = sampleTrackSegment(
          current,
          Math.max(0, 1 - chordMeters / current.lengthMeters),
        ).point;
        const node = sampleTrackSegment(current, 1).point;
        const after = sampleTrackSegment(
          next,
          Math.min(1, chordMeters / next.lengthMeters),
        ).point;
        const currentScale = current.lengthMeters / Math.max(0.001, current.lengthRef);
        const nextScale = next.lengthMeters / Math.max(0.001, next.lengthRef);
        addCurve(
          `junction:${route.id}:${segmentId}:${nextId}`,
          nextId,
          0,
          circumradius(before, node, after) * ((currentScale + nextScale) / 2),
        );
      });
    }

    for (const turnout of this.scenarioDefinition.switches) {
      const addTurnout = (segmentId: string, speedMps: number, suffix: string) => {
        if (!this.segments.has(segmentId)) return;
        restrictions.push({
          id: `turnout:${turnout.id}:${suffix}`,
          segmentId,
          at: 0.04,
          reason: "turnout",
          radiusMeters: null,
          infrastructureSpeedMps: speedMps,
        });
      };
      addTurnout(turnout.mainSegmentId, MAIN_TURNOUT_SPEED_MPS, "main");
      addTurnout(turnout.branchSegmentId, BRANCH_TURNOUT_SPEED_MPS, "branch");
      if (turnout.segmentId && turnout.at !== undefined) {
        restrictions.push({
          id: `turnout:${turnout.id}:approach`,
          segmentId: turnout.segmentId,
          at: turnout.at,
          reason: "turnout",
          radiusMeters: null,
          infrastructureSpeedMps: BRANCH_TURNOUT_SPEED_MPS,
        });
      }
    }
    return restrictions;
  }

  private speedProfileGuidance(
    tram: TramState,
    lineSpeedMps: number,
  ): SpeedProfileGuidanceResult {
    let selected: SpeedProfileGuidanceResult = {
      targetSpeedMps: lineSpeedMps,
      reason: "line" as "line" | "curve" | "turnout",
      distanceMeters: null as number | null,
      radiusMeters: null as number | null,
      nextConstraintDistanceMeters: null as number | null,
      nextConstraintSpeedMps: lineSpeedMps,
      nextConstraintReason: "line" as "line" | "curve" | "turnout",
    };
    const candidates: Array<{ restriction: SpeedRestrictionRuntime; distanceMeters: number }> = [];
    let segment = this.segments.get(tram.segmentId) ?? null;
    let distanceToSegmentStart = segment ? -tram.progress * segment.lengthMeters : 0;
    const visited = new Set<string>();
    while (segment && distanceToSegmentStart <= PROFILE_LOOKAHEAD_METERS && !visited.has(segment.id)) {
      visited.add(segment.id);
      for (const restriction of this.speedRestrictionsBySegment.get(segment.id) ?? []) {
        const distanceMeters = distanceToSegmentStart + restriction.at * segment.lengthMeters;
        if (distanceMeters >= 0 && distanceMeters <= PROFILE_LOOKAHEAD_METERS) {
          candidates.push({ restriction, distanceMeters });
        }
      }
      distanceToSegmentStart += segment.lengthMeters;
      segment = this.peekNextSegment(tram, segment);
    }
    for (const { restriction, distanceMeters } of candidates) {
      const directLimitMps = cppSpeedProfileTarget({
        lineSpeedMps,
        curveRadiusMeters: restriction.radiusMeters,
        lateralAccelerationMps2: COMFORT_LATERAL_ACCELERATION_MPS2,
        infrastructureSpeedMps: restriction.infrastructureSpeedMps,
        distanceToRestrictionMeters: 0,
      });
      if (
        selected.nextConstraintDistanceMeters === null ||
        distanceMeters < selected.nextConstraintDistanceMeters
      ) {
        selected.nextConstraintDistanceMeters = distanceMeters;
        selected.nextConstraintSpeedMps = directLimitMps;
        selected.nextConstraintReason = restriction.reason;
      }
      const effectiveDistance = distanceMeters <= 10 ? 0 : distanceMeters - 10;
      const targetSpeedMps = cppSpeedProfileTarget({
        lineSpeedMps,
        curveRadiusMeters: restriction.radiusMeters,
        lateralAccelerationMps2: COMFORT_LATERAL_ACCELERATION_MPS2,
        infrastructureSpeedMps: restriction.infrastructureSpeedMps,
        distanceToRestrictionMeters: effectiveDistance,
        approachDecelerationMps2: PROFILE_APPROACH_DECELERATION_MPS2,
      });
      if (targetSpeedMps < selected.targetSpeedMps - 0.001) {
        selected = {
          targetSpeedMps,
          reason: restriction.reason,
          distanceMeters,
          radiusMeters: restriction.radiusMeters,
          nextConstraintDistanceMeters: selected.nextConstraintDistanceMeters,
          nextConstraintSpeedMps: selected.nextConstraintSpeedMps,
          nextConstraintReason: selected.nextConstraintReason,
        };
      }
    }
    return selected;
  }

  private nextPassengerStop(tram: TramState) {
    const routeId = this.routeIdForTram(tram);
    let segment = this.segments.get(tram.segmentId) ?? null;
    let distanceToSegmentStart = segment ? -tram.progress * segment.lengthMeters : 0;
    const visited = new Set<string>();
    let selected: { id: string; distanceMeters: number; label: string } | null = null;
    while (segment && distanceToSegmentStart <= PROFILE_LOOKAHEAD_METERS && !visited.has(segment.id)) {
      visited.add(segment.id);
      for (const reader of this.stationReadersBySegment.get(segment.id) ?? []) {
        if (reader.routeId && reader.routeId !== routeId) continue;
        const distanceMeters = distanceToSegmentStart + reader.at * segment.lengthMeters;
        if (
          distanceMeters >= 0 &&
          distanceMeters <= PROFILE_LOOKAHEAD_METERS &&
          (!selected || distanceMeters < selected.distanceMeters)
        ) {
          selected = { id: reader.id, distanceMeters, label: reader.label };
        }
      }
      distanceToSegmentStart += segment.lengthMeters;
      segment = this.peekNextSegment(tram, segment);
    }
    return selected;
  }

  private getTrafficControllerSnapshots(): TrafficControllerSnapshot[] {
    return [...this.trafficControllers.values()].map((controller) => ({
      id: controller.id,
      label: controller.label,
      phase: controller.phase,
      activeTramId: controller.activeTramId,
      activeSignalId: controller.activeSignalId,
      queued: controller.queue.length,
      manualMode: controller.manualMode,
      manualSignalId: controller.manualSignalId,
      manualReleasePending: controller.manualReleasePending,
    }));
  }

  private getPrimaryTrafficController() {
    const controllers = [...this.trafficControllers.values()];
    return (
      controllers.find((controller) => controller.phase === "tram-green") ??
      controllers.find((controller) => controller.phase !== "road-green") ??
      controllers[0] ??
      null
    );
  }

  private getRouteOperationsSnapshot(): RouteOperationsSnapshot[] {
    const window = this.activeServiceWindow();
    return this.scenarioDefinition.routes.map((route) => {
      const routeTrams = this.trams.filter(
        (tram) => this.routeIdForTram(tram) === route.id,
      );
      const passengerTrams = routeTrams.filter(
        (tram) => tram.serviceState === "in-service",
      );
      const intervalMinutes: number[] = [];
      for (const tram of passengerTrams) {
        let nearestDistance: number | null = null;
        for (const other of passengerTrams) {
          if (
            other.id === tram.id ||
            other.fleetGroupId !== tram.fleetGroupId
          ) {
            continue;
          }
          const distanceMeters = this.forwardDistanceToTram(tram, other);
          if (
            distanceMeters !== null &&
            distanceMeters > PHYSICAL_TRAM_GAP_METERS &&
            (nearestDistance === null || distanceMeters < nearestDistance)
          ) {
            nearestDistance = distanceMeters;
          }
        }
        if (nearestDistance !== null) {
          intervalMinutes.push(
            nearestDistance / Math.max(2.5, tram.etaAverageSpeedMps) / 60,
          );
        } else {
          const cycleDistance = this.routeCycleDistanceMeters(tram);
          if (cycleDistance !== null) {
            intervalMinutes.push(
              cycleDistance / Math.max(2.5, tram.etaAverageSpeedMps) / 60,
            );
          }
        }
      }
      const departureStats = this.departureStatsByRoute.get(route.id);
      const measuredHeadways = window
        ? this.terminalHeadwayStatsByRouteWindow.get(`${window.id}:${route.id}`)
        : null;
      const estimatedHeadwayMinutes =
        intervalMinutes.length > 0
          ? intervalMinutes.reduce((sum, value) => sum + value, 0) /
            intervalMinutes.length
          : null;
      return {
        routeId: route.id,
        routeName: route.name,
        shortName: route.shortName,
        color: route.color,
        plannedHeadwayMinutes:
          window?.routes[route.id]?.plannedHeadwayMinutes ?? null,
        actualHeadwayMinutes: measuredHeadways?.total
          ? measuredHeadways.sumSeconds / measuredHeadways.total / 60
          : estimatedHeadwayMinutes,
        actualHeadwayMeasured: Boolean(measuredHeadways?.total),
        onRoute: passengerTrams.length,
        toDepot: routeTrams.filter(
          (tram) =>
            tram.serviceState === "to-depot" ||
            tram.serviceState === "depot-ingress",
        ).length,
        inDepot: routeTrams.filter(
          (tram) =>
            tram.serviceState === "in-depot" ||
            tram.serviceState === "depot-egress",
        ).length,
        totalFleet: routeTrams.length,
        waitingPassengers: this.stationReadersForRoute(route.id).reduce(
          (sum, reader) => sum + this.peekDemand(reader.id).boardable(),
          0,
        ),
        averageWaitSeconds: this.routeDemandPressureSeconds(route.id),
        onboardPassengers: passengerTrams.reduce(
          (sum, tram) => sum + tram.onboardPassengers,
          0,
        ),
        onboardCapacity: passengerTrams.length * TRAM_CAPACITY,
        scheduledDepartures: departureStats?.total ?? 0,
        departureAdherencePercent: departureStats?.total
          ? (departureStats.onTime / departureStats.total) * 100
          : null,
        meanDepartureDeviationSeconds: departureStats?.total
          ? departureStats.absoluteDeviationSeconds / departureStats.total
          : null,
      };
    });
  }

  private routeCycleDistanceMeters(tram: TramState) {
    const current = this.segments.get(tram.segmentId);
    if (!current || tram.segmentId.startsWith("N2X-")) return null;
    let distanceMeters = (1 - tram.progress) * current.lengthMeters;
    let cursor = current;
    const visited = new Set([current.id]);
    for (let guard = 0; guard <= this.segments.size; guard += 1) {
      const next = this.peekNextSegment(tram, cursor);
      if (!next) return null;
      if (next.id === current.id) {
        return distanceMeters + tram.progress * current.lengthMeters;
      }
      if (visited.has(next.id)) return null;
      visited.add(next.id);
      distanceMeters += next.lengthMeters;
      cursor = next;
    }
    return null;
  }

  private trafficForSignal(signalId: string) {
    const signal = this.scenarioDefinition.signals.find(
      (item) => item.id === signalId,
    );
    if (!signal) return null;
    return (
      this.trafficControllers.get(signal.controllerId ?? signal.id) ?? null
    );
  }

  private initializeHeadwayTargets() {
    const passengerTrams = this.trams.filter(
      (tram) => tram.serviceState === "in-service",
    );
    for (const tram of this.trams) {
      if (tram.serviceState !== "in-service") {
        tram.desiredHeadwayMeters = FALLBACK_HEADWAY_METERS;
        continue;
      }
      const routeId = this.routeIdForTram(tram);
      // Count only vehicles reachable ahead on this directed service cycle.
      // Route 2's opposite rails are disconnected and therefore remain
      // independent. Route 21's two terminal labels are two halves of the
      // same round trip, so both halves correctly participate in one spacing
      // plan after a tram turns at Park Dubki or Chyorny Prud.
      const cycleCohort = passengerTrams.filter(
        (other) =>
          this.routeIdForTram(other) === routeId &&
          (other.id === tram.id || this.forwardDistanceToTram(tram, other) !== null),
      );
      const cycleDistance = this.routeCycleDistanceMeters(tram);
      tram.desiredHeadwayMeters =
        cycleDistance !== null && cycleCohort.length > 0
          ? cppUniformHeadwayMeters(
              cycleDistance,
              cycleCohort.length,
              FALLBACK_HEADWAY_METERS,
            )
          : FALLBACK_HEADWAY_METERS;
    }
  }

  private intervalGuidance(
    tram: TramState,
    speedLimitMps: number,
    leader: { tram: TramState; distanceMeters: number } | null,
  ) {
    if (
      !this.options.collisionAvoidance ||
      tram.manualMode ||
      tram.serviceState !== "in-service" ||
      tram.segmentId.startsWith("N2X-")
    ) {
      return null;
    }
    if (!leader) return null;
    const targetMeters = Math.max(
      FALLBACK_HEADWAY_METERS,
      tram.desiredHeadwayMeters,
    );
    const restoreAtMeters = Math.max(
      SAFETY_HEADWAY_METERS + 5,
      targetMeters * HEADWAY_RESTORE_THRESHOLD,
    );
    if (leader.distanceMeters >= restoreAtMeters) return null;

    const speedFactor = cppHeadwaySpeedFactor(
      leader.distanceMeters,
      SAFETY_HEADWAY_METERS,
      restoreAtMeters,
    );
    return {
      leader: leader.tram,
      distanceMeters: leader.distanceMeters,
      targetMeters,
      speedFactor,
      targetSpeedMps: speedLimitMps * speedFactor,
    };
  }

  private updateTram(tram: TramState, delta: number, tramIndex: number) {
    tram.ecoConstraintDistanceMeters = null;
    tram.ecoConstraintLabel = null;
    if (tram.serviceState === "in-depot") {
      tram.ecoDrivingMode = "cruise";
      tram.ecoApproachStopId = null;
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.lastAcceleration = 0;
      tram.tractionForceN = 0;
      tram.brakeForceN = 0;
      tram.dynamicsMode = "coast";
      tram.pwm = 0;
      cppOverrideVehicleMotion(tramIndex, 0, 0);
      return;
    }
    if (
      tram.serviceState === "depot-ingress" ||
      tram.serviceState === "depot-egress"
    ) {
      tram.ecoDrivingMode = "cruise";
      tram.ecoApproachStopId = null;
      this.updateDepotTransition(tram, delta, tramIndex);
      return;
    }
    if (!tram.manualMode && this.simulationTime < tram.releaseTime) {
      tram.ecoDrivingMode = "cruise";
      tram.ecoApproachStopId = null;
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.lastAcceleration = 0;
      tram.tractionForceN = 0;
      tram.brakeForceN = 0;
      tram.dynamicsMode = "coast";
      tram.pwm = 0;
      tram.status = `Dispatch in ${Math.ceil(tram.releaseTime - this.simulationTime)}s`;
      tram.statusTone = "idle";
      cppOverrideVehicleMotion(tramIndex, 0, 0);
      return;
    }

    const terminalEntryHold = this.resolveIzmirTerminalEntryQueue(tram, tramIndex);
    const terminalIntervalGap = this.maintainTerminalIntervalHold(tram, tramIndex);
    const stationPlatform = this.pendingStationPlatform(tram);
    const stationState = cppStepStationAuthority(
      tramIndex,
      { phase: tram.stationPhase, until: tram.stationUntil, speedMps: tram.speedMps },
      this.simulationTime,
      tram.manualMode,
      stationPlatform?.aligned ?? false,
    );
    tram.stationPhase = stationState.phase;
    tram.stationUntil = stationState.until;
    if (tram.stationPhase !== "none") {
      tram.ecoDrivingMode = "cruise";
      tram.ecoApproachStopId = null;
    }
    if (stationState.event === 1) {
      tram.speedMps = 0;
      tram.lastAcceleration = 0;
      cppOverrideVehicleMotion(tramIndex, 0, 0);
      const boarding = this.serviceStopPassengers(tram, tramIndex);
      const terminalReader = tram.pendingStationReaderId
        ? this.scenarioDefinition.readers.find(
            (reader) => reader.id === tram.pendingStationReaderId && reader.terminal,
          )
        : null;
      const reservedTimetableSlot = terminalReader && this.isDispatchControlledTerminal(terminalReader)
        ? this.reserveScheduledDeparture(
          tram,
          terminalReader.id,
          terminalReader.label,
          "terminal",
        )
        : false;
      if (reservedTimetableSlot && terminalReader) {
        tram.stationUntil = Math.max(
          tram.stationUntil,
          tram.scheduledDepartureAt ?? tram.stationUntil,
        );
        this.addEvent(
          "info",
          `${tram.label} assigned ${terminalReader.label} platform ${tram.terminalBerth || 1} departure ${formatClock(tram.scheduledDepartureClockSeconds ?? 0)}`,
        );
      }
      if (reservedTimetableSlot) {
        cppExtendStationDwell(tramIndex, tram.stationUntil);
      }
      this.addEvent(
        "ok",
        `${tram.label} aligned at stop · doors open · ${boarding.boarding} on / ${boarding.alighting} off · dwell ${boarding.dwellSeconds.toFixed(0)}s`,
      );
    } else if (stationState.event === 2) {
      if (tram.scheduledDepartureKind === "terminal") {
        this.recordScheduledDeparture(tram);
      }
      this.recordTerminalDeparture(tram);
      tram.terminalIntervalHold = false;
      tram.terminalBerth = 0;
      tram.terminalEntryQueueReaderId = null;
      tram.pendingStationReaderId = null;
      this.addEvent("ok", `${tram.label} departed stop`);
    }

    const previousSpeed = tram.speedMps;
    const speedLimitMps = this.options.speedLimit / 3.6;
    const speedProfile = this.speedProfileGuidance(tram, speedLimitMps);
    tram.profileLimitMps = speedProfile.targetSpeedMps;
    tram.profileReason = speedProfile.reason;
    tram.restrictionDistanceMeters = speedProfile.distanceMeters;
    tram.curveRadiusMeters = speedProfile.radiusMeters;
    tram.lateralAccelerationMps2 = speedProfile.radiusMeters && speedProfile.distanceMeters !== null && speedProfile.distanceMeters <= 25
      ? (tram.speedMps ** 2) / speedProfile.radiusMeters
      : 0;
    if (tram.manualMode && tram.manualCommand === "reverse") {
      this.updateManualReverse(tram, delta, previousSpeed, speedLimitMps, tramIndex);
      this.updateTramTelemetry(tram, delta, speedLimitMps);
      return;
    }

    const physicalLeaderAhead = this.nearestTramAhead(tram);
    const routeLeaderAhead = this.nearestTramAhead(tram, true);
    const parallelPhysicalBypass = this.canUseParallelIzmirTerminalBerth(
      tram,
      physicalLeaderAhead?.tram ?? null,
    );
    const terminalLeaderAtApproach = this.leaderOccupiesApproachingIzmirTerminal(
      tram,
      routeLeaderAhead?.tram ?? null,
    );
    const block =
      tram.manualMode && tram.manualCommand === "stop"
        ? null
        : this.findBlockingCondition(
            tram,
            parallelPhysicalBypass ? null : physicalLeaderAhead,
          );
    const intervalGuidance = this.intervalGuidance(
      tram,
      speedLimitMps,
      terminalLeaderAtApproach ? null : routeLeaderAhead,
    );

    if (tram.manualMode && tram.manualCommand === "stop") {
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.status = tram.branchOrigin
        ? `Manual hold · return via ${tram.branchOrigin.switchId}`
        : "Manual hold";
      tram.statusTone = tram.branchOrigin ? "warning" : "idle";
      tram.lastBlockKey = null;
    } else if (!tram.manualMode && terminalEntryHold) {
      const terminal = tram.terminalEntryQueueReaderId
        ? this.scenarioDefinition.readers.find(
            (reader) => reader.id === tram.terminalEntryQueueReaderId,
          )
        : null;
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.status = `${terminal?.label ?? "Terminal"} full · approach hold`;
      tram.statusTone = "warning";
      tram.lastBlockKey = `terminal-full:${tram.terminalEntryQueueReaderId}`;
    } else if (!tram.manualMode && tram.stationPhase === "crawl") {
      tram.targetSpeedMps = speedLimitMps * (20 / 55);
      tram.pwm = 20;
      tram.status = "Stop approach · PWM 20";
      tram.statusTone = "warning";
    } else if (!tram.manualMode && tram.stationPhase === "dwell") {
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.status = tram.terminalIntervalHold && terminalIntervalGap
        ? `Terminal interval · ${(terminalIntervalGap.elapsedSeconds / 60).toFixed(1)} / ${(terminalIntervalGap.targetSeconds / 60).toFixed(1)} min`
        : tram.scheduledDepartureKind === "terminal" &&
        (tram.scheduledDepartureAt ?? tram.stationUntil) >= tram.stationUntil - 0.5
        ? `Terminal P${tram.terminalBerth || 1} · ${formatClock(tram.scheduledDepartureClockSeconds ?? 0)}`
        : tram.pendingStationReaderId && this.scenarioDefinition.readers.some(
            (reader) => reader.id === tram.pendingStationReaderId && reader.rapidTurnback,
          )
          ? `Quick turnback · ${Math.max(0, tram.stationUntil - this.simulationTime).toFixed(0)}s`
        : tram.pendingStationReaderId && this.scenarioDefinition.readers.some(
            (reader) => reader.id === tram.pendingStationReaderId && reader.terminal,
          )
          ? `Terminal dwell · ${Math.max(0, tram.stationUntil - this.simulationTime).toFixed(0)}s`
        : `Dwelling · ${Math.max(0, tram.stationUntil - this.simulationTime).toFixed(1)}s`;
      tram.statusTone = "idle";
    } else if (block) {
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.status = block.status;
      tram.statusTone = block.tone;
      if (tram.lastBlockKey !== block.key) {
        this.addEvent(block.tone === "danger" ? "danger" : "warning", `${tram.label}: ${block.event}`);
        tram.lastBlockKey = block.key;
        if (block.kind === "obstacle") tram.emergencyStops += 1;
      }
    } else if (tram.manualMode) {
      tram.targetSpeedMps = Math.min(speedLimitMps, 20 / 3.6);
      tram.pwm = 30;
      tram.status = "Manual forward · safety active";
      tram.statusTone = "normal";
      tram.lastBlockKey = null;
    } else if (intervalGuidance) {
      tram.targetSpeedMps = intervalGuidance.targetSpeedMps;
      tram.pwm = Math.round(18 + intervalGuidance.speedFactor * 37);
      tram.status = `Interval recovery · ${this.formatDistance(intervalGuidance.distanceMeters)} / ${this.formatDistance(intervalGuidance.targetMeters)}`;
      tram.statusTone = "warning";
      const recoveryKey = `interval:${intervalGuidance.leader.id}`;
      if (tram.lastBlockKey !== recoveryKey) {
        this.addEvent(
          "info",
          `${tram.label}: restoring planned interval behind ${intervalGuidance.leader.label}`,
        );
      }
      tram.lastBlockKey = recoveryKey;
    } else {
      tram.targetSpeedMps = speedLimitMps;
      tram.pwm = 55;
      tram.status =
        tram.serviceState === "to-depot"
          ? `To depot · service to ${tram.lastPassengerStop ?? "last stop"}`
          : this.options.controlMode === "firmware"
            ? "Autopilot · PWM 55"
            : "Moving · route protected";
      tram.statusTone = "normal";
      if (tram.lastBlockKey?.startsWith("interval:")) {
        this.addEvent("ok", `${tram.label}: planned interval restored`);
      }
      tram.lastBlockKey = null;
    }

    tram.targetSpeedMps = cppResolveTargetSpeed({
      speedLimitMps,
      manualMode: tram.manualMode,
      manualCommand: tram.manualCommand,
      stationPhase: tram.stationPhase,
      blocked: Boolean(block),
      intervalFactor: intervalGuidance?.speedFactor ?? null,
      dispatchHold: terminalEntryHold,
    });
    if (!tram.manualMode && tram.stationPhase === "crawl" && stationPlatform) {
      tram.targetSpeedMps = cppStationApproachSpeed(
        stationPlatform.distanceMeters,
        speedLimitMps,
      );
    }
    tram.targetSpeedMps = Math.min(
      tram.targetSpeedMps,
      speedProfile.targetSpeedMps,
    );
    if (
      !tram.manualMode &&
      tram.stationPhase === "none" &&
      !block &&
      !intervalGuidance &&
      speedProfile.reason !== "line" &&
      speedProfile.targetSpeedMps < speedLimitMps - 0.05
    ) {
      const reason = speedProfile.reason === "curve" ? "Curve" : "Turnout";
      const distanceLabel = speedProfile.distanceMeters !== null && speedProfile.distanceMeters > 12
        ? ` in ${this.formatDistance(speedProfile.distanceMeters)}`
        : "";
      tram.status = `${reason} profile · ${(speedProfile.targetSpeedMps * 3.6).toFixed(0)} km/h${distanceLabel}`;
      tram.statusTone = "warning";
    }
    tram.targetSpeedMps = this.energyOptimizedTarget(
      tram,
      tram.targetSpeedMps,
      tramIndex,
      delta,
    );

    const dynamics = cppStepVehicleAuthority(
      tramIndex,
      this.vehicleAuthorityState(tram),
      {
        targetSpeedMps: tram.targetSpeedMps,
        emergencyBrake: block?.kind === "obstacle",
        grade: this.currentTrackGrade(tram),
        passengerCount: tram.onboardPassengers,
      },
      delta,
    );
    this.applyVehicleAuthorityResult(tram, dynamics);

    let moveMeters = cppSafeMoveMeters(
      dynamics.distanceMeters,
      block?.distanceMeters ?? null,
      physicalLeaderAhead?.distanceMeters ?? null,
      PHYSICAL_TRAM_GAP_METERS,
    );
    if (
      tram.stationPhase === "crawl" &&
      stationPlatform &&
      moveMeters >= stationPlatform.distanceMeters
    ) {
      moveMeters = stationPlatform.distanceMeters;
      tram.speedMps = 0;
      tram.lastAcceleration = -previousSpeed / delta;
      cppOverrideVehicleMotion(tramIndex, 0, tram.lastAcceleration);
    }
    if (moveMeters + 0.000001 < dynamics.distanceMeters) {
      tram.speedMps = 0;
      tram.lastAcceleration = -previousSpeed / delta;
      cppOverrideVehicleMotion(tramIndex, tram.speedMps, tram.lastAcceleration);
    }

    if (moveMeters > 0) {
      this.advanceTram(tram, moveMeters, tramIndex);
      tram.distanceMeters += moveMeters;
    }

    this.updateTramTelemetry(tram, delta, speedLimitMps);
  }

  private updateManualReverse(
    tram: TramState,
    delta: number,
    previousSpeed: number,
    speedLimitMps: number,
    tramIndex: number,
  ) {
    const origin = tram.branchOrigin;
    const branch = this.segments.get(tram.segmentId);
    if (!origin || !branch || !branch.id.startsWith("N2X-")) {
      tram.manualCommand = "stop";
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.status = "Reverse unavailable · manual hold";
      tram.statusTone = "warning";
      tram.lastAcceleration = delta > 0 ? -previousSpeed / delta : 0;
      return;
    }

    tram.targetSpeedMps = Math.min(speedLimitMps, 10 / 3.6);
    tram.pwm = 18;
    tram.status = `Returning via ${origin.switchId} · reverse`;
    tram.statusTone = "warning";

    const dynamics = cppStepVehicleAuthority(
      tramIndex,
      this.vehicleAuthorityState(tram),
      {
        targetSpeedMps: tram.targetSpeedMps,
        grade: this.currentTrackGrade(tram),
        passengerCount: tram.onboardPassengers,
      },
      delta,
    );
    this.applyVehicleAuthorityResult(tram, dynamics);

    const distanceToRoute = tram.progress * branch.lengthMeters;
    let moveMeters = Math.min(dynamics.distanceMeters, distanceToRoute);
    const mergeClear = this.isBranchMergeClear(tram);
    const mergeGap = this.options.collisionAvoidance
      ? SAFETY_HEADWAY_METERS
      : PHYSICAL_TRAM_GAP_METERS;

    if (!mergeClear && distanceToRoute <= moveMeters + mergeGap) {
      moveMeters = Math.max(0, distanceToRoute - mergeGap);
      tram.progress = clamp(
        tram.progress - moveMeters / branch.lengthMeters,
        0,
        1,
      );
      tram.distanceMeters += moveMeters;
      tram.speedMps = 0;
      tram.targetSpeedMps = 0;
      tram.pwm = 0;
      tram.lastAcceleration = delta > 0 ? -previousSpeed / delta : 0;
      cppOverrideVehicleMotion(tramIndex, tram.speedMps, tram.lastAcceleration);
      tram.status = `Route entry occupied · waiting at ${origin.switchId}`;
      tram.statusTone = "warning";
      const blockKey = `merge:${origin.switchId}`;
      if (tram.lastBlockKey !== blockKey) {
        this.addEvent(
          "warning",
          `${tram.label}: ${origin.switchId} merge held until the route is clear`,
        );
        tram.lastBlockKey = blockKey;
      }
      return;
    }

    if (moveMeters > 0) {
      tram.progress = clamp(
        tram.progress - moveMeters / branch.lengthMeters,
        0,
        1,
      );
      tram.distanceMeters += moveMeters;
    }

    if (tram.progress > 0.000001) {
      tram.lastBlockKey = null;
      return;
    }

    tram.segmentId = origin.routeSegmentId;
    tram.progress = clamp(origin.routeProgress + 0.00001, 0, 0.999999);
    tram.branchOrigin = null;
    tram.manualCommand = "stop";
    tram.speedMps = 0;
    tram.targetSpeedMps = 0;
    tram.pwm = 0;
    tram.triggeredOnSegment.clear();
    tram.stationPhase = "none";
    tram.stationUntil = 0;
    tram.terminalIntervalHold = false;
    tram.terminalBerth = 0;
    tram.terminalEntryQueueReaderId = null;
    tram.lastBlockKey = null;
    cppOverrideVehicleMotion(tramIndex, 0, 0);
    tram.status = "Back on route · manual hold";
    tram.statusTone = "normal";
    this.addEvent(
      "ok",
      `${tram.label} returned to Route 2 through ${origin.switchId} · MANUAL HOLD`,
    );
  }

  private isBranchMergeClear(tram: TramState) {
    const origin = tram.branchOrigin;
    if (!origin) return false;
    const routePoint = this.getPointOnSegment(
      origin.routeSegmentId,
      origin.routeProgress,
    )?.point;
    if (!routePoint) return false;
    const metersPerReferenceUnit =
      this.scenarioDefinition.metersPerReferenceUnit ?? REFERENCE_TO_METERS;
    const clearanceMeters = this.options.collisionAvoidance
      ? SAFETY_HEADWAY_METERS
      : PHYSICAL_TRAM_GAP_METERS;

    return this.trams.every((other) => {
      if (other.id === tram.id || other.segmentId.startsWith("N2X-")) {
        return true;
      }
      const otherPoint = this.getPointOnSegment(
        other.segmentId,
        other.progress,
      )?.point;
      if (!otherPoint) return true;
      return distance(routePoint, otherPoint) * metersPerReferenceUnit >= clearanceMeters;
    });
  }

  private updateTramTelemetry(
    tram: TramState,
    delta: number,
    speedLimitMps: number,
  ) {
    const expectedDistance = Math.max(0, this.simulationTime - tram.releaseTime) * speedLimitMps * 0.62;
    // distanceMeters is a lifetime odometer (used for fleet stats), so delay
    // is measured against distance covered *since this service period began*
    // (serviceStartDistanceMeters), not the whole-lifetime total — otherwise
    // a tram redispatched from depot would look permanently on-time (or a
    // long-serving tram permanently "delayed") regardless of how its current
    // trip is actually going.
    const distanceThisService = Math.max(
      0,
      tram.distanceMeters - tram.serviceStartDistanceMeters,
    );
    tram.delaySeconds = Math.max(
      0,
      (expectedDistance - distanceThisService) / Math.max(1, speedLimitMps),
    );
  }

  private currentTrackGrade(tram: TramState) {
    const segment = this.segments.get(tram.segmentId);
    if (!segment || !segment.elevationChangeMeters) return 0;
    return segment.elevationChangeMeters / Math.max(1, segment.lengthMeters);
  }

  private vehicleAuthorityState(tram: TramState) {
    return {
      speedMps: tram.speedMps,
      accelerationMps2: tram.lastAcceleration,
      consumedEnergyWh: tram.energyWh,
      tractionEnergyWh: tram.tractionEnergyWh,
      auxiliaryEnergyWh: tram.auxiliaryEnergyWh,
      mechanicalBrakeEnergyWh: tram.mechanicalBrakeEnergyWh,
      grossRegeneratedEnergyWh: tram.grossRegeneratedWh,
      regeneratedEnergyWh: tram.recoveredWh,
      rejectedRegenerationEnergyWh: tram.rejectedRegenerationWh,
      downhillPotentialEnergyWh: tram.downhillPotentialWh,
      climbPotentialEnergyWh: tram.climbPotentialWh,
    };
  }

  private applyVehicleAuthorityResult(
    tram: TramState,
    result: CppVehicleAuthorityResult,
  ) {
    tram.speedMps = result.speedMps;
    tram.lastAcceleration = result.accelerationMps2;
    tram.tractionForceN = result.tractionForceN;
    tram.brakeForceN = result.brakeForceN;
    tram.resistanceForceN = result.resistanceForceN;
    tram.dynamicsMode = result.mode;
    tram.energyWh = result.cumulative.consumedEnergyWh;
    tram.tractionEnergyWh = result.cumulative.tractionEnergyWh;
    tram.auxiliaryEnergyWh = result.cumulative.auxiliaryEnergyWh;
    tram.mechanicalBrakeEnergyWh = result.cumulative.mechanicalBrakeEnergyWh;
    tram.grossRegeneratedWh = result.cumulative.grossRegeneratedEnergyWh;
    tram.recoveredWh = result.cumulative.regeneratedEnergyWh;
    tram.rejectedRegenerationWh =
      result.cumulative.rejectedRegenerationEnergyWh;
    tram.downhillPotentialWh = result.cumulative.downhillPotentialEnergyWh;
    tram.climbPotentialWh = result.cumulative.climbPotentialEnergyWh;
  }

  private getEnergyStatistics(): EnergyStatisticsSnapshot {
    const routeIds = this.scenarioDefinition.routes.map((route) => route.id);
    const summarize = (
      routeId: string,
      label: string,
      trams: TramState[],
    ): RouteEnergySnapshot => {
      const sum = (selector: (tram: TramState) => number) =>
        trams.reduce((total, tram) => total + selector(tram), 0);
      const gridDrawKWh = sum((tram) => tram.energyWh) / 1000;
      const acceptedRegeneratedKWh = sum((tram) => tram.recoveredWh) / 1000;
      const mechanicalBrakeKWh = sum((tram) => tram.mechanicalBrakeEnergyWh) / 1000;
      return {
        routeId,
        label,
        tramCount: trams.length,
        distanceKm: sum((tram) => tram.distanceMeters) / 1000,
        tractionKWh: sum((tram) => tram.tractionEnergyWh) / 1000,
        auxiliaryKWh: sum((tram) => tram.auxiliaryEnergyWh) / 1000,
        gridDrawKWh,
        mechanicalBrakeKWh,
        grossRegeneratedKWh: sum((tram) => tram.grossRegeneratedWh) / 1000,
        acceptedRegeneratedKWh,
        rejectedKWh: sum((tram) => tram.rejectedRegenerationWh) / 1000,
        downhillPotentialKWh: sum((tram) => tram.downhillPotentialWh) / 1000,
        climbPotentialKWh: sum((tram) => tram.climbPotentialWh) / 1000,
        netGridKWh: Math.max(0, gridDrawKWh - acceptedRegeneratedKWh),
        recoveryPercent:
          mechanicalBrakeKWh > 0
            ? (acceptedRegeneratedKWh / mechanicalBrakeKWh) * 100
            : 0,
      };
    };
    const routes = routeIds.map((routeId) => {
      const route = this.scenarioDefinition.routes.find((item) => item.id === routeId);
      return summarize(
        routeId,
        route?.name ?? `Route ${routeId}`,
        this.trams.filter((tram) => this.routeIdForTram(tram) === routeId),
      );
    });
    const system = this.scenarioDefinition.tractionPowerSystem;
    const sectionSnapshots: PowerSectionSnapshot[] = (system?.sections ?? []).map(
      (section) => {
        const runtime = this.powerSectionRuntime.get(section.id) ?? {
          tractionPowerKw: 0,
          regenerationPowerKw: 0,
          locallyReusedPowerKw: 0,
          gridPowerKw: 0,
          localReuseWh: 0,
          gridSupplyWh: 0,
          rejectedGeneratorWh: 0,
          peakGridPowerKw: 0,
          flywheelEnergyWh: 0,
          flywheelCapacityWh: 0,
          flywheelChargePowerKw: 0,
          flywheelDischargePowerKw: 0,
          flywheelChargedWh: 0,
          flywheelDischargedWh: 0,
          flywheelLossesWh: 0,
          flywheelMode: 0,
          flywheelTargetGridKw: 0,
          forecastTractionKw: 0,
          forecastRegenerationKw: 0,
        };
        const substation = system!.substations.find(
          (item) => item.id === section.substationId,
        )!;
        return {
          id: section.id,
          label: section.label,
          substationId: section.substationId,
          substationLabel: substation.label,
          confidence: substation.confidence,
          color: section.color,
          tramCount: this.trams.filter((tram) => section.segmentIds.includes(tram.segmentId)).length,
          tractionPowerKw: runtime.tractionPowerKw,
          regenerationPowerKw: runtime.regenerationPowerKw,
          locallyReusedPowerKw: runtime.locallyReusedPowerKw,
          gridPowerKw: runtime.gridPowerKw,
          localReuseKWh: runtime.localReuseWh / 1000,
          gridSupplyKWh: runtime.gridSupplyWh / 1000,
          rejectedGeneratorKWh: runtime.rejectedGeneratorWh / 1000,
          peakGridPowerKw: runtime.peakGridPowerKw,
          utilizationPercent: substation.maxPowerKw > 0
            ? (runtime.gridPowerKw / substation.maxPowerKw) * 100
            : 0,
          flywheelModel: section.flywheel?.model ?? null,
          flywheelModules: section.flywheel?.modules ?? 0,
          flywheelSocPercent: runtime.flywheelCapacityWh > 0 ? (runtime.flywheelEnergyWh / runtime.flywheelCapacityWh) * 100 : 0,
          flywheelRpm: runtime.flywheelCapacityWh > 0 ? Math.sqrt(10000 ** 2 + (runtime.flywheelEnergyWh / runtime.flywheelCapacityWh) * (20000 ** 2 - 10000 ** 2)) : 0,
          flywheelEnergyKWh: runtime.flywheelEnergyWh / 1000,
          flywheelCapacityKWh: runtime.flywheelCapacityWh / 1000,
          flywheelChargePowerKw: runtime.flywheelChargePowerKw,
          flywheelDischargePowerKw: runtime.flywheelDischargePowerKw,
          flywheelChargedKWh: runtime.flywheelChargedWh / 1000,
          flywheelDischargedKWh: runtime.flywheelDischargedWh / 1000,
          flywheelLossesKWh: runtime.flywheelLossesWh / 1000,
          flywheelMode: (["idle", "reserve", "peak-only", "balanced", "space-making", "charging", "discharging"] as const)[runtime.flywheelMode] ?? "idle",
          flywheelReservePercent: 15,
          flywheelTargetGridKw: runtime.flywheelTargetGridKw,
          forecastTractionKw: runtime.forecastTractionKw,
          forecastRegenerationKw: runtime.forecastRegenerationKw,
        };
      },
    );
    return {
      modelLabel: system
        ? `${system.label} · section-level regenerative matching`
        : "27.5 t longitudinal model · 86% generator · 82% receptivity",
      sourceLabel: "АТС АГ 2021 study · Route 2 measured elevation differences",
      studyMassTonnes: 27.5,
      measuredDescentMeters: 102,
      studyPotentialKWhPerRun: 7.84,
      elevationSections: [
        { label: "Красносельская → Горького", fromMeters: 187, toMeters: 175, potentialKWh: 0.9 },
        { label: "Горького → Маслякова", fromMeters: 175, toMeters: 166, potentialKWh: 0.83 },
        { label: "Маслякова → Нижегородская", fromMeters: 166, toMeters: 156, potentialKWh: 0.75 },
        { label: "Нижегородская → Добролюбова", fromMeters: 156, toMeters: 137, potentialKWh: 1.43 },
        { label: "Лыковая дамба (вниз)", fromMeters: 137, toMeters: 130, potentialKWh: 0.53 },
        { label: "Лыковая дамба (вверх)", fromMeters: 144, toMeters: 130, potentialKWh: 1.06 },
        { label: "Ул. Пискунова", fromMeters: 151, toMeters: 137, potentialKWh: 1.06 },
        { label: "Сенная → Белинского", fromMeters: 140, toMeters: 123, potentialKWh: 1.28 },
      ],
      routes,
      total: summarize("all", "All routes", this.trams),
      powerSystem: {
        enabled: Boolean(system),
        label: system?.label ?? "Fixed receptivity approximation",
        nominalVoltageV: system?.nominalVoltageV ?? 0,
        sourceLabel: system?.sourceLabel ?? "Reference vehicle approximation",
        modelNote: system?.modelNote ?? "No mapped traction sections in this scenario.",
        strategy: this.options.energyStrategy,
        localReuseKWh: sectionSnapshots.reduce((sum, item) => sum + item.localReuseKWh, 0),
        gridSupplyKWh: sectionSnapshots.reduce((sum, item) => sum + item.gridSupplyKWh, 0),
        rejectedGeneratorKWh: sectionSnapshots.reduce(
          (sum, item) => sum + item.rejectedGeneratorKWh,
          0,
        ),
        flywheelStoredKWh: sectionSnapshots.reduce((sum, item) => sum + item.flywheelEnergyKWh, 0),
        flywheelCapacityKWh: sectionSnapshots.reduce((sum, item) => sum + item.flywheelCapacityKWh, 0),
        flywheelChargedKWh: sectionSnapshots.reduce((sum, item) => sum + item.flywheelChargedKWh, 0),
        flywheelDischargedKWh: sectionSnapshots.reduce((sum, item) => sum + item.flywheelDischargedKWh, 0),
        flywheelLossesKWh: sectionSnapshots.reduce((sum, item) => sum + item.flywheelLossesKWh, 0),
        peakGridPowerKw: this.peakNetworkGridPowerKw,
        interventions: this.energyInterventions,
        sections: sectionSnapshots,
      },
    };
  }

  private findBlockingCondition(
    tram: TramState,
    leaderAhead: { tram: TramState; distanceMeters: number } | null,
  ) {
    const candidates: Array<{
      key: string;
      kind: "obstacle" | "signal" | "headway" | "junction";
      distanceMeters: number;
      status: string;
      tone: "warning" | "danger";
      event: string;
    }> = [];
    const currentSegment = this.segments.get(tram.segmentId);
    if (!currentSegment) return null;

    for (const obstacle of this.obstacles) {
      // Look along the declared service path, not only the current segment.
      // On a real-scale route an obstacle is often placed just beyond the next
      // segment boundary; waiting until the tram enters that segment makes the
      // virtual range sensor appear unresponsive.
      const obstacleDistance = this.forwardDistanceToPosition(
        tram,
        obstacle.segmentId,
        obstacle.at,
      );
      if (obstacleDistance === null || obstacleDistance < 0) continue;
      if (obstacleDistance <= this.options.sensorRangeMeters) {
        candidates.push({
          key: `obstacle:${obstacle.id}`,
          kind: "obstacle",
          distanceMeters: obstacleDistance,
          status: `Obstacle ${obstacleDistance.toFixed(0)}m`,
          tone: "danger",
          event: `${obstacle.id} detected inside virtual 70mm sensor envelope`,
        });
      }
    }

    for (const signal of this.scenarioDefinition.signals) {
      if (signal.segmentId !== tram.segmentId || signal.at <= tram.progress) continue;
      const signalDistance = (signal.at - tram.progress) * currentSegment.lengthMeters;
      if (signalDistance <= Math.max(32, this.options.sensorRangeMeters)) {
        const controller = this.trafficForSignal(signal.id);
        const permitted =
          controller?.phase === "tram-green" &&
          controller.activeSignalId === signal.id;
        if (!permitted) {
          // A tram may be spawned, restored from an experiment, or emerge from
          // a terminal immediately after the configured detector. Never leave
          // it permanently at red merely because it did not cross the RFID
          // reader during this process lifetime: the stop-line approach acts
          // as a fail-safe secondary request detector.
          if (
            controller &&
            controller.activeTramId !== tram.id &&
            !controller.queue.some((request) => request.tramId === tram.id)
          ) {
            controller.queue.push({
              tramId: tram.id,
              signalId: signal.id,
              requestedAt: this.simulationTime,
            });
            this.addEvent(
              "info",
              `${tram.label} requested fail-safe priority at ${signal.id}`,
            );
          }
          candidates.push({
            key: `signal:${signal.id}`,
            kind: "signal",
            distanceMeters: signalDistance,
            status: `Signal ${signal.id} · STOP`,
            tone: "warning",
            event: `holding at red signal ${signal.id}`,
          });
        }
      }
    }

    for (const zone of this.scenarioDefinition.junctionConflictZones ?? []) {
      if (zone.segmentIds.includes(tram.segmentId)) continue;
      const next = this.peekNextSegment(tram, currentSegment);
      if (!next || !zone.segmentIds.includes(next.id)) continue;
      const occupiedBy = this.trams.find(
        (other) =>
          other.id !== tram.id &&
          zone.segmentIds.includes(other.segmentId) &&
          other.serviceState !== "in-depot" &&
          other.serviceState !== "depot-ingress" &&
          other.serviceState !== "depot-egress",
      );
      if (!occupiedBy) continue;
      const entryDistance = (1 - tram.progress) * currentSegment.lengthMeters;
      if (entryDistance <= Math.max(32, this.options.sensorRangeMeters)) {
        candidates.push({
          key: `junction:${zone.id}:${occupiedBy.id}`,
          kind: "junction",
          distanceMeters: entryDistance,
          status: `${zone.label} · occupied by ${occupiedBy.label}`,
          tone: "warning",
          event: `waiting for ${occupiedBy.label} to clear ${zone.label}`,
        });
      }
    }

    const protectedHeadway = tram.manualMode
      ? PHYSICAL_TRAM_GAP_METERS
      : this.options.collisionAvoidance
        ? SAFETY_HEADWAY_METERS
        : PHYSICAL_TRAM_GAP_METERS;
    if (leaderAhead && leaderAhead.distanceMeters <= protectedHeadway + 0.01) {
      const separation = leaderAhead.distanceMeters;
      candidates.push({
        key: `headway:${leaderAhead.tram.id}`,
        kind: "headway",
        distanceMeters: Math.max(0, separation - PHYSICAL_TRAM_GAP_METERS),
        status: !tram.manualMode && this.options.collisionAvoidance
          ? `Headway hold · ${separation.toFixed(0)}m`
          : `Rail order hold · ${separation.toFixed(0)}m`,
        tone: "warning",
        event: !tram.manualMode && this.options.collisionAvoidance
          ? `safe headway enforced behind ${leaderAhead.tram.label}`
          : `physical no-passing lock behind ${leaderAhead.tram.label}`,
      });
    }

    return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters)[0] ?? null;
  }

  private nearestTramAhead(tram: TramState, sameRouteOnly = false) {
    let nearest: { tram: TramState; distanceMeters: number } | null = null;
    for (const other of this.trams) {
      if (other.id === tram.id) continue;
      if (
        other.serviceState === "in-depot" ||
        other.serviceState === "depot-ingress" ||
        other.serviceState === "depot-egress"
      ) {
        continue;
      }
      if (sameRouteOnly) {
        if (this.routeIdForTram(other) !== this.routeIdForTram(tram)) continue;
      }
      const distanceMeters = this.forwardDistanceToTram(tram, other);
      if (
        distanceMeters !== null &&
        distanceMeters >= 0 &&
        (!nearest || distanceMeters < nearest.distanceMeters)
      ) {
        nearest = { tram: other, distanceMeters };
      }
    }
    return nearest;
  }

  private nearestTramBehindOnRoute(tram: TramState) {
    let nearest: { tram: TramState; distanceMeters: number } | null = null;
    const routeId = this.routeIdForTram(tram);
    for (const other of this.trams) {
      if (other.id === tram.id || this.routeIdForTram(other) !== routeId) continue;
      if (other.serviceState !== "in-service" && other.serviceState !== "to-depot") continue;
      const distanceMeters = this.forwardDistanceToTram(other, tram);
      if (
        distanceMeters !== null &&
        distanceMeters >= 0 &&
        (!nearest || distanceMeters < nearest.distanceMeters)
      ) {
        nearest = { tram: other, distanceMeters };
      }
    }
    return nearest;
  }

  private forwardDistanceToTram(tram: TramState, other: TramState) {
    const current = this.segments.get(tram.segmentId);
    if (!current) return null;

    if (other.segmentId === tram.segmentId) {
      const progressDifference = other.progress - tram.progress;
      if (progressDifference > 0.000001) {
        return progressDifference * current.lengthMeters;
      }
      if (
        Math.abs(progressDifference) <= 0.000001 &&
        other.linePriority < tram.linePriority
      ) {
        return 0;
      }
    }

    let distanceMeters = (1 - tram.progress) * current.lengthMeters;
    let cursor = current;
    const visited = new Set([current.id]);

    for (let guard = 0; guard <= this.segments.size; guard += 1) {
      const next = this.peekNextSegment(tram, cursor);
      if (!next) return null;
      if (next.id === other.segmentId) {
        return distanceMeters + other.progress * next.lengthMeters;
      }
      if (visited.has(next.id)) return null;
      visited.add(next.id);
      distanceMeters += next.lengthMeters;
      cursor = next;
    }

    return null;
  }

  private peekNextSegment(tram: TramState, previous: SegmentRuntime) {
    const outgoing = [...this.segments.values()].filter(
      (item) => item.from === previous.to,
    );
    if (outgoing.length === 0) return null;
    if (outgoing.length === 1) return outgoing[0];

    const switchDefinition = this.scenarioDefinition.switches.find(
      (item) => item.nodeId === previous.to,
    );
    if (!switchDefinition) {
      return this.nextRouteSegment(tram, previous, outgoing) ?? outgoing[0];
    }
    if (switchDefinition.returnSegmentIds?.includes(previous.id)) {
      return (
        outgoing.find((item) => item.id === switchDefinition.mainSegmentId) ??
        outgoing[0]
      );
    }

    const selectedId =
      tram.routeIntent === "branch"
        ? switchDefinition.branchSegmentId
        : switchDefinition.mainSegmentId;
    return outgoing.find((item) => item.id === selectedId) ?? outgoing[0];
  }

  private advanceTram(
    tram: TramState,
    distanceMeters: number,
    tramIndex: number,
  ) {
    let remaining = distanceMeters;
    let guard = 0;
    while (remaining > 0.0001 && guard < 6) {
      guard += 1;
      const current = this.segments.get(tram.segmentId);
      if (!current) return;
      const distanceToEnd = (1 - tram.progress) * current.lengthMeters;
      const inlineSwitch = this.nextActiveInlineSwitch(tram, current);
      const depotPortal = this.nextDepotPortal(tram, current);
      const distanceToSwitch = inlineSwitch
        ? Math.max(0, (inlineSwitch.at - tram.progress) * current.lengthMeters)
        : Number.POSITIVE_INFINITY;
      const distanceToDepot = depotPortal
        ? Math.max(
            0,
            (depotPortal.portal.portalAt - tram.progress) * current.lengthMeters,
          )
        : Number.POSITIVE_INFINITY;
      const step = Math.min(
        remaining,
        distanceToEnd,
        distanceToSwitch,
        distanceToDepot,
      );
      const previousProgress = tram.progress;
      tram.progress = clamp(tram.progress + step / current.lengthMeters, 0, 1);
      this.triggerReaders(tram, previousProgress, tram.progress);
      this.markSignalPassage(tram, previousProgress, tram.progress);
      remaining -= step;
      if (
        depotPortal &&
        tram.progress >= depotPortal.portal.portalAt - 0.000001
      ) {
        const nextState = cppDepotObserveAuthority(
          tramIndex,
          tram.serviceState,
          { reachedPortal: true },
        );
        if (nextState !== "depot-ingress") return;
        tram.serviceState = nextState;
        tram.depotId = depotPortal.depot.id;
        tram.depotPortalId = depotPortal.portal.id;
        tram.depotProgress = 0;
        tram.stationPhase = "none";
        tram.terminalIntervalHold = false;
        tram.terminalBerth = 0;
        tram.terminalEntryQueueReaderId = null;
        tram.speedMps = 0;
        tram.status = `Entering ${depotPortal.depot.shortName} · not in service`;
        tram.statusTone = "warning";
        this.invalidateStopBoards();
        this.addEvent(
          "info",
          `${tram.label} left the passenger line for ${depotPortal.depot.shortName}`,
        );
        return;
      }
      if (
        inlineSwitch &&
        tram.progress >= inlineSwitch.at - 0.000001
      ) {
        const branch = this.segments.get(inlineSwitch.definition.branchSegmentId);
        const runtime = this.switchStates.get(inlineSwitch.definition.id);
        if (!branch || !runtime) return;
        tram.branchOrigin = {
          switchId: inlineSwitch.definition.id,
          routeSegmentId: current.id,
          routeProgress: inlineSwitch.at,
        };
        tram.segmentId = branch.id;
        tram.progress = 0;
        tram.triggeredOnSegment.clear();
        runtime.state = "main";
        runtime.lockedBy = null;
        runtime.queue = [];
        this.addEvent(
          "warning",
          `${tram.label} diverted at ${inlineSwitch.definition.id} → ${inlineSwitch.definition.label}`,
        );
        continue;
      }
      if (tram.progress >= 0.999999) {
        const next = this.chooseNextSegment(tram, current);
        if (!next) {
          tram.speedMps = 0;
          tram.targetSpeedMps = 0;
          tram.pwm = 0;
          if (current.id.startsWith("N2X-") && tram.manualMode) {
            tram.manualCommand = "stop";
          }
          tram.status = current.id.startsWith("N2X-")
            ? `External branch · return via ${tram.branchOrigin?.switchId ?? "turnout"}`
            : "Route unavailable";
          tram.statusTone = current.id.startsWith("N2X-")
            ? "warning"
            : "danger";
          return;
        }
        tram.segmentId = next.id;
        tram.progress = 0;
        tram.triggeredOnSegment.clear();
        if (next.id === tram.lapMarkerSegmentId) {
          tram.lap += 1;
          this.addEvent("ok", `${tram.label} completed lap ${tram.lap}`);
        }
      }
    }
  }

  private nextDepotPortal(tram: TramState, current: SegmentRuntime) {
    if (tram.serviceState !== "to-depot") return null;
    const assignment = this.depotPortalById(tram.depotPortalId);
    if (
      !assignment ||
      assignment.portal.portalSegmentId !== current.id ||
      assignment.portal.portalAt <= tram.progress + 0.000001
    ) {
      return null;
    }
    return assignment;
  }

  private nextActiveInlineSwitch(
    tram: TramState,
    current: SegmentRuntime,
  ) {
    const candidates = this.scenarioDefinition.switches.flatMap((definition) => {
      const approaches = [
        ...(definition.segmentId && definition.at !== undefined
          ? [{ segmentId: definition.segmentId, at: definition.at }]
          : []),
        ...(definition.alternateApproaches ?? []),
      ];
      return approaches
        .filter(
          (approach) =>
            approach.segmentId === current.id &&
            approach.at > tram.progress + 0.000001 &&
            this.switchStates.get(definition.id)?.state === "branch",
        )
        .map((approach) => ({ definition, at: approach.at }));
    });
    return candidates.sort((first, second) => first.at - second.at)[0] ?? null;
  }

  private getSwitchPoint(definition: SwitchDefinition) {
    if (definition.segmentId && definition.at !== undefined) {
      const segmentRuntime = this.segments.get(definition.segmentId);
      return segmentRuntime
        ? sampleTrackSegment(segmentRuntime, definition.at).point
        : null;
    }
    const incoming = this.scenarioDefinition.segments.find(
      (item) => item.to === definition.nodeId,
    );
    return incoming?.points[incoming.points.length - 1] ?? null;
  }

  private chooseNextSegment(tram: TramState, previous: SegmentRuntime) {
    const outgoing = [...this.segments.values()].filter((item) => item.from === previous.to);
    if (outgoing.length === 0) return null;
    if (outgoing.length === 1) return outgoing[0];

    const switchDefinition = this.scenarioDefinition.switches.find(
      (item) => item.nodeId === previous.to,
    );
    if (!switchDefinition) {
      return this.nextRouteSegment(tram, previous, outgoing) ?? outgoing[0];
    }
    if (switchDefinition.returnSegmentIds?.includes(previous.id)) {
      return (
        outgoing.find((item) => item.id === switchDefinition.mainSegmentId) ?? outgoing[0]
      );
    }

    const runtime = this.switchStates.get(switchDefinition.id);
    const selectedId =
      runtime?.state === "branch"
        ? switchDefinition.branchSegmentId
        : switchDefinition.mainSegmentId;
    const selected = outgoing.find((item) => item.id === selectedId) ?? outgoing[0];
    this.addEvent(
      "info",
      `${tram.label} passed ${switchDefinition.id} → ${runtime?.state.toUpperCase() ?? "MAIN"}`,
    );
    if (runtime?.lockedBy === tram.id) {
      const switchIndex = this.scenarioDefinition.switches.findIndex(
        (item) => item.id === switchDefinition.id,
      );
      const tramIndex = this.trams.findIndex((item) => item.id === tram.id);
      const released = cppReleaseSwitchAuthority(
        switchIndex,
        runtime.state,
        tramIndex,
        tramIndex,
      );
      runtime.state = released.state;
      runtime.lockedBy =
        released.lockedByIndex >= 0
          ? this.trams[released.lockedByIndex]?.id ?? null
          : null;
      this.applyNextSwitchRequest(runtime, switchDefinition);
    }
    return selected;
  }

  /**
   * Follow the declared directed service cycle when several rails leave the
   * same physical stop node. This is essential on bidirectional linear lines:
   * both directions share node names, but an inbound tram must not pick the
   * first outbound rail merely because it was inserted first in the config.
   */
  private nextRouteSegment(
    tram: TramState,
    previous: SegmentRuntime,
    outgoing: SegmentRuntime[],
  ) {
    if (!this.scenarioDefinition.strictRouteSequence) return null;
    const routeId = this.routeIdForTram(tram);
    const route = this.scenarioDefinition.routes.find((item) => item.id === routeId);
    if (!route) return null;
    const currentIndex = route.segmentIds.indexOf(previous.id);
    if (currentIndex < 0 || route.segmentIds.length === 0) return null;
    const nextId = route.segmentIds[(currentIndex + 1) % route.segmentIds.length];
    return outgoing.find((item) => item.id === nextId) ?? null;
  }

  private markSignalPassage(tram: TramState, from: number, to: number) {
    for (const signal of this.scenarioDefinition.signals) {
      const segment = this.segments.get(signal.segmentId);
      const frontClearAt = Math.max(
        signal.at,
        signal.clearAt ?? Math.min(0.98, signal.at + 0.18),
      );
      // A crossing is free only after the rear of the 15 m vehicle has passed
      // the configured clearance point. If that lies past the segment end,
      // updateTraffic() completes clearance after the tram enters the next one.
      const clearAt = segment
        ? frontClearAt + TRAM_LENGTH_METERS / segment.lengthMeters
        : frontClearAt;
      const entered = signal.at > from && signal.at <= to;
      const cleared = clearAt <= 1 && clearAt > from && clearAt <= to;
      if (
        signal.segmentId !== tram.segmentId ||
        (!entered && !cleared)
      ) {
        continue;
      }
      const controller = this.trafficForSignal(signal.id);
      if (
        controller?.manualMode === "tram-green" &&
        controller.manualSignalId === signal.id &&
        entered &&
        !controller.activeTramId
      ) {
        controller.activeTramId = tram.id;
      }
      if (
        !controller ||
        controller.phase !== "tram-green" ||
        controller.activeTramId !== tram.id ||
        controller.activeSignalId !== signal.id
      ) {
        continue;
      }
      if (entered && !controller.activeTramEntered) {
        controller.activeTramEntered = true;
        invalidateCppTrafficController(this.trafficControllerIndex(controller));
        this.addEvent(
          "ok",
          `${tram.label} entered ${controller.label} on ${signal.id} · tram green held`,
        );
      }
      if (
        cleared &&
        controller.activeTramEntered &&
        !controller.activeTramCleared
      ) {
        controller.activeTramCleared = true;
        invalidateCppTrafficController(this.trafficControllerIndex(controller));
        this.addEvent(
          "ok",
          `${tram.label} cleared ${signal.id} · ${controller.label} road release permitted`,
        );
      }
    }
  }

  private triggerReaders(tram: TramState, from: number, to: number) {
    const routeId = this.routeIdForTram(tram);
    for (const reader of this.scenarioDefinition.readers) {
      if (
        reader.segmentId !== tram.segmentId ||
        reader.at <= from ||
        reader.at > to ||
        (reader.kind === "station" && reader.routeId && reader.routeId !== routeId) ||
        tram.triggeredOnSegment.has(reader.id)
      ) {
        continue;
      }
      tram.triggeredOnSegment.add(reader.id);
      this.handleReader(tram, reader);
    }
  }

  private handleReader(tram: TramState, reader: RFIDReader) {
    if (reader.kind === "telemetry") {
      this.addEvent("ok", `${tram.label} passed RFID ${reader.id} · UID ${tram.uid}`);
      return;
    }
    if (reader.kind === "station") {
      if (reader.routeId && reader.routeId !== this.routeIdForTram(tram)) return;
      if (
        tram.serviceState === "in-service" &&
        !tram.manualMode &&
        tram.stationPhase === "none"
      ) {
        // Every terminal arrival checks the live departure interval. In most
        // cases this clears immediately; only an actually bunched arrival is
        // held, and only until the time gap reaches the operational minimum.
        const terminalBerth = reader.terminal
          ? this.assignIzmirTerminalBerth(tram, reader)
          : 0;
        if (this.isIzmirDualTrackTerminal(reader) && terminalBerth === 0) {
          tram.terminalIntervalHold = false;
          tram.terminalBerth = 0;
          tram.terminalEntryQueueReaderId = reader.id;
          tram.stationPhase = "none";
          tram.stationUntil = 0;
          tram.pendingStationReaderId = null;
          invalidateCppStation(this.trams.findIndex((item) => item.id === tram.id));
          this.addEvent(
            "warning",
            `${tram.label}: ${reader.label} P1/P2 occupied · holding at terminal entry`,
          );
          return;
        }
        tram.terminalEntryQueueReaderId = null;
        tram.terminalIntervalHold = this.isDispatchControlledTerminal(reader);
        tram.terminalBerth = terminalBerth;
        tram.stationPhase = "crawl";
        tram.stationUntil = 0;
        tram.pendingStationReaderId = reader.id;
        invalidateCppStation(this.trams.findIndex((item) => item.id === tram.id));
        this.addEvent(
          "info",
          `${reader.id}: reed-style stop trigger for ${tram.label}${tram.terminalBerth ? ` · platform ${tram.terminalBerth}` : ""}`,
        );
      }
      return;
    }
    if (reader.kind === "traffic") {
      const signalId = reader.signalId ?? this.scenarioDefinition.signals[0]?.id;
      if (!signalId) return;
      const controller = this.trafficForSignal(signalId);
      if (!controller) return;
      if (
        !controller.queue.some((request) => request.tramId === tram.id) &&
        controller.activeTramId !== tram.id
      ) {
        controller.queue.push({
          tramId: tram.id,
          signalId,
          requestedAt: this.simulationTime,
        });
        this.addEvent(
          "info",
          `${tram.label} requested priority at ${signalId} · ${controller.label}`,
        );
      }
      return;
    }
    if (reader.kind === "switch") {
      const definition = reader.switchId
        ? this.scenarioDefinition.switches.find((item) => item.id === reader.switchId)
        : this.scenarioDefinition.switches[0];
      if (!definition) return;
      const runtime = this.switchStates.get(definition.id);
      if (!runtime) return;
      const desired = tram.routeIntent;
      const switchIndex = this.scenarioDefinition.switches.findIndex(
        (item) => item.id === definition.id,
      );
      const tramIndex = this.trams.findIndex((item) => item.id === tram.id);
      const lockedByIndex = runtime.lockedBy
        ? this.trams.findIndex((item) => item.id === runtime.lockedBy)
        : -1;
      const result = cppRequestSwitchAuthority(
        switchIndex,
        runtime.state,
        lockedByIndex,
        desired,
        tramIndex,
        this.options.controlMode === "cooperative",
      );
      if (result) {
        runtime.state = result.state;
        runtime.lockedBy =
          result.lockedByIndex >= 0
            ? this.trams[result.lockedByIndex]?.id ?? null
            : null;
      }
      if (result && this.options.controlMode === "firmware") {
        this.addEvent(
          "ok",
          `${reader.id}: UID ${tram.uid} set servo to ${desired === "branch" ? "57°" : "127°"}`,
        );
      } else if (result) {
        this.addEvent("ok", `${definition.id} locked ${desired.toUpperCase()} for ${tram.label}`);
      } else if (!runtime.queue.some((request) => request.tramId === tram.id)) {
        runtime.queue.push({
          tramId: tram.id,
          desired,
          requestedAt: this.simulationTime,
        });
        this.addEvent("warning", `${tram.label} queued for ${definition.id}`);
      }
    }
  }

  private pendingStationPlatform(tram: TramState) {
    if (tram.stationPhase !== "crawl" || !tram.pendingStationReaderId) return null;
    const reader = this.scenarioDefinition.readers.find(
      (item) => item.id === tram.pendingStationReaderId,
    );
    const segment = this.segments.get(tram.segmentId);
    if (!reader || !segment || reader.segmentId !== tram.segmentId) return null;
    const platformAt = reader.displayAt ?? reader.at;
    const signedDistanceMeters = (platformAt - tram.progress) * segment.lengthMeters;
    return {
      distanceMeters: Math.max(0, signedDistanceMeters),
      aligned: Math.abs(signedDistanceMeters) <= 0.45,
    };
  }

  private updateTraffic() {
    for (const controller of this.trafficControllers.values()) {
      if (controller.phase === "tram-green") {
        this.reconcileActiveTrafficOccupancy(controller);
      }
      if (this.updateTrafficWithCpp(controller)) continue;
      if (controller.manualMode === "tram-green") {
        controller.phase = "tram-green";
        controller.phaseUntil = 0;
        controller.activeSignalId = controller.manualSignalId;
        continue;
      }
      if (controller.manualMode === "road-green") {
        if (controller.activeTramEntered && !controller.activeTramCleared) {
          controller.manualReleasePending = true;
          controller.phase = "tram-green";
          controller.phaseUntil = 0;
          continue;
        }
        controller.manualReleasePending = false;
        controller.phase = "road-green";
        controller.phaseUntil = 0;
        controller.activeTramId = null;
        controller.activeSignalId = null;
        controller.activeTramEntered = false;
        controller.activeTramCleared = false;
        continue;
      }
      if (controller.manualReleasePending) {
        if (!controller.activeTramEntered || controller.activeTramCleared) {
          controller.manualReleasePending = false;
          controller.phase = "road-green";
          controller.phaseUntil = 0;
          controller.activeTramId = null;
          controller.activeSignalId = null;
          controller.activeTramEntered = false;
          controller.activeTramCleared = false;
          controller.activeGrantedAt = 0;
          this.addEvent("ok", `${controller.label}: crossing clear · AUTO restored`);
        }
        continue;
      }
      if (controller.phase === "road-green" && controller.queue.length > 0) {
        const contenderCount = controller.queue.length;
        this.sortTrafficQueue(controller);
        const next = controller.queue.shift()!;
        controller.activeTramId = next.tramId;
        controller.activeSignalId = next.signalId;
        controller.activeTramCleared = false;
        controller.activeTramEntered = false;
        controller.activeGrantedAt = this.simulationTime;
        controller.phase = "amber-to-tram";
        controller.phaseUntil =
          this.simulationTime + controller.amberSeconds;
        if (contenderCount > 1) {
          this.addEvent(
            "info",
            `${this.policyLabel(this.options.priorityPolicy)} selected ${next.tramId} from ${contenderCount} requests at ${controller.label}`,
          );
        }
        this.addEvent(
          "warning",
          `${controller.label}: road clearance for ${next.tramId}`,
        );
        continue;
      }
      if (
        controller.phaseUntil <= 0 ||
        this.simulationTime < controller.phaseUntil
      ) {
        continue;
      }

      if (controller.phase === "amber-to-tram") {
        controller.phase = "tram-green";
        controller.phaseUntil =
          this.simulationTime + controller.tramGreenSeconds;
        this.addEvent(
          "ok",
          `${controller.activeSignalId} GREEN · minimum ${controller.tramGreenSeconds}s for ${controller.activeTramId}`,
        );
      } else if (controller.phase === "tram-green") {
        const activeTram = this.trams.find(
          (tram) => tram.id === controller.activeTramId,
        );
        const activeSignal = this.scenarioDefinition.signals.find(
          (signal) => signal.id === controller.activeSignalId,
        );
        const stillWaitingOnApproach = Boolean(
          activeTram &&
            activeSignal &&
            activeTram.segmentId === activeSignal.segmentId &&
            activeTram.progress < activeSignal.at &&
            !activeTram.manualMode,
        );
        const staleBeforeEntry =
          !controller.activeTramEntered &&
          this.simulationTime - controller.activeGrantedAt >=
            TRAFFIC_GRANT_TIMEOUT_SECONDS &&
          !stillWaitingOnApproach &&
          (!activeTram ||
            activeTram.serviceState === "in-depot" ||
            (activeTram.manualMode && activeTram.manualCommand === "stop"));
        if (staleBeforeEntry) {
          if (
            controller.activeTramId &&
            controller.activeSignalId &&
            !controller.queue.some(
              (request) => request.tramId === controller.activeTramId,
            )
          ) {
            controller.queue.push({
              tramId: controller.activeTramId,
              signalId: controller.activeSignalId,
              requestedAt: this.simulationTime,
            });
          }
          controller.phase = "amber-to-road";
          controller.phaseUntil =
            this.simulationTime + controller.clearanceSeconds;
          this.addEvent(
            "warning",
            `${controller.label}: stale tram grant released and requeued`,
          );
          continue;
        }
        if (!controller.activeTramCleared) {
          controller.phaseUntil = this.simulationTime + 0.25;
          continue;
        }
        controller.phase = "amber-to-road";
        controller.phaseUntil =
          this.simulationTime + controller.clearanceSeconds;
        this.addEvent(
          "warning",
          `${controller.label}: ${controller.clearanceSeconds}s junction clearance`,
        );
      } else if (controller.phase === "amber-to-road") {
        const releasedSignal = controller.activeSignalId;
        controller.phase = "road-green";
        controller.phaseUntil = 0;
        controller.activeTramId = null;
        controller.activeSignalId = null;
        controller.activeTramCleared = false;
        controller.activeTramEntered = false;
        controller.activeGrantedAt = 0;
        this.addEvent("info", `${releasedSignal} released · tram signal RED`);
      }
    }
  }

  private trafficControllerIndex(controller: TrafficRuntime) {
    return [...this.trafficControllers.values()].findIndex(
      (item) => item.id === controller.id,
    );
  }

  private updateTrafficWithCpp(controller: TrafficRuntime) {
    const controllerIndex = this.trafficControllerIndex(controller);
    if (controllerIndex < 0) return false;
    if (controller.phase === "road-green" && controller.queue.length > 0) {
      this.sortTrafficQueue(controller);
    }
    const candidate =
      controller.phase === "road-green" ? controller.queue[0] ?? null : null;
    const activeTramBefore = this.trams.find(
      (tram) => tram.id === controller.activeTramId,
    );
    const activeSignalBefore = this.scenarioDefinition.signals.find(
      (signal) => signal.id === controller.activeSignalId,
    );
    const stillWaiting = Boolean(
      activeTramBefore &&
        activeSignalBefore &&
        activeTramBefore.segmentId === activeSignalBefore.segmentId &&
        activeTramBefore.progress < activeSignalBefore.at &&
        !activeTramBefore.manualMode,
    );
    const activeInvalid = Boolean(
      !activeTramBefore ||
        activeTramBefore.serviceState === "in-depot" ||
        (activeTramBefore.manualMode && activeTramBefore.manualCommand === "stop"),
    );
    const phases: TrafficPhase[] = [
      "road-green",
      "amber-to-tram",
      "tram-green",
      "amber-to-road",
    ];
    const tramIndex = (tramId: string | null | undefined) =>
      tramId ? this.trams.findIndex((tram) => tram.id === tramId) : -1;
    const signalIndex = (signalId: string | null | undefined) =>
      signalId
        ? this.scenarioDefinition.signals.findIndex(
            (signal) => signal.id === signalId,
          )
        : -1;
    const previousActiveTramId = controller.activeTramId;
    const previousActiveSignalId = controller.activeSignalId;
    const contenderCount = controller.queue.length;
    const result = cppStepTrafficAuthority(
      controllerIndex,
      {
        phase: Math.max(0, phases.indexOf(controller.phase)),
        phaseUntil: controller.phaseUntil,
        activeTramIndex: tramIndex(controller.activeTramId),
        activeSignalIndex: signalIndex(controller.activeSignalId),
        activeTramEntered: controller.activeTramEntered,
        activeTramCleared: controller.activeTramCleared,
        activeGrantedAt: controller.activeGrantedAt,
        manualMode:
          controller.manualMode === "tram-green"
            ? 1
            : controller.manualMode === "road-green"
              ? 2
              : 0,
        manualSignalIndex: signalIndex(controller.manualSignalId),
        manualReleasePending: controller.manualReleasePending,
      },
      {
        now: this.simulationTime,
        candidateTramIndex: tramIndex(candidate?.tramId),
        candidateSignalIndex: signalIndex(candidate?.signalId),
        stillWaiting,
        activeInvalid,
        amberSeconds: controller.amberSeconds,
        tramGreenSeconds: controller.tramGreenSeconds,
        clearanceSeconds: controller.clearanceSeconds,
        grantTimeoutSeconds: TRAFFIC_GRANT_TIMEOUT_SECONDS,
      },
    );
    if (!result) return false;

    controller.phase = phases[result.phase] ?? "road-green";
    controller.phaseUntil = result.phaseUntil;
    controller.activeTramId =
      result.activeTramIndex >= 0
        ? this.trams[result.activeTramIndex]?.id ?? null
        : null;
    controller.activeSignalId =
      result.activeSignalIndex >= 0
        ? this.scenarioDefinition.signals[result.activeSignalIndex]?.id ?? null
        : null;
    controller.activeTramEntered = result.activeTramEntered;
    controller.activeTramCleared = result.activeTramCleared;
    controller.activeGrantedAt = result.activeGrantedAt;
    controller.manualReleasePending = result.manualReleasePending;

    if (result.event === 1 && candidate) {
      controller.queue = controller.queue.filter((request) => request !== candidate);
      if (contenderCount > 1) {
        this.addEvent(
          "info",
          `${this.policyLabel(this.options.priorityPolicy)} selected ${candidate.tramId} from ${contenderCount} requests at ${controller.label}`,
        );
      }
      this.addEvent("warning", `${controller.label}: road clearance for ${candidate.tramId}`);
    } else if (result.event === 2) {
      this.addEvent(
        "ok",
        `${controller.activeSignalId} GREEN · minimum ${controller.tramGreenSeconds}s for ${controller.activeTramId}`,
      );
    } else if (result.event === 3) {
      if (
        previousActiveTramId &&
        previousActiveSignalId &&
        !controller.queue.some((request) => request.tramId === previousActiveTramId)
      ) {
        controller.queue.push({
          tramId: previousActiveTramId,
          signalId: previousActiveSignalId,
          requestedAt: this.simulationTime,
        });
      }
      this.addEvent("warning", `${controller.label}: stale tram grant released and requeued`);
    } else if (result.event === 4) {
      this.addEvent(
        "warning",
        `${controller.label}: ${controller.clearanceSeconds}s junction clearance`,
      );
    } else if (result.event === 5) {
      this.addEvent("info", `${previousActiveSignalId} released · tram signal RED`);
    } else if (result.event === 6) {
      this.addEvent("ok", `${controller.label}: crossing clear · AUTO restored`);
    }
    return true;
  }

  private reconcileActiveTrafficOccupancy(controller: TrafficRuntime) {
    if (!controller.activeTramId || !controller.activeSignalId) return;
    const tram = this.trams.find((item) => item.id === controller.activeTramId);
    const signal = this.scenarioDefinition.signals.find(
      (item) => item.id === controller.activeSignalId,
    );
    if (!tram || !signal) return;

    if (
      !controller.activeTramEntered &&
      tram.segmentId === signal.segmentId &&
      tram.progress >= signal.at
    ) {
      controller.activeTramEntered = true;
      invalidateCppTrafficController(this.trafficControllerIndex(controller));
      this.addEvent(
        "ok",
        `${tram.label} entered ${controller.label} on ${signal.id} · tram green held`,
      );
    }
    if (!controller.activeTramEntered || controller.activeTramCleared) return;

    const segment = this.segments.get(signal.segmentId);
    const frontClearAt = Math.max(
      signal.at,
      signal.clearAt ?? Math.min(0.98, signal.at + 0.18),
    );
    const rearClearAt = segment
      ? frontClearAt + TRAM_LENGTH_METERS / segment.lengthMeters
      : frontClearAt;
    const fullyClear =
      tram.segmentId !== signal.segmentId ||
      (rearClearAt <= 1 && tram.progress >= rearClearAt);
    if (!fullyClear) return;

    controller.activeTramCleared = true;
    invalidateCppTrafficController(this.trafficControllerIndex(controller));
    this.addEvent(
      "ok",
      `${tram.label} fully cleared ${signal.id} · rear of tram outside ${controller.label}`,
    );
  }

  private promoteManualTrafficRequest(tram: TramState) {
    const current = this.segments.get(tram.segmentId);
    if (!current) return;
    for (const signal of this.scenarioDefinition.signals) {
      if (signal.segmentId !== tram.segmentId || signal.at <= tram.progress) {
        continue;
      }
      const distanceMeters =
        (signal.at - tram.progress) * current.lengthMeters;
      if (distanceMeters > Math.max(40, this.options.sensorRangeMeters)) {
        continue;
      }
      const controller = this.trafficForSignal(signal.id);
      if (!controller || controller.activeTramId === tram.id) continue;
      const existing = controller.queue.find(
        (request) => request.tramId === tram.id,
      );
      if (existing) {
        existing.requestedAt = this.simulationTime - 86_400;
      } else {
        controller.queue.push({
          tramId: tram.id,
          signalId: signal.id,
          requestedAt: this.simulationTime - 86_400,
        });
      }
      this.addEvent(
        "info",
        `${tram.label} manual request promoted at ${signal.id}`,
      );
    }
  }

  private sortTrafficQueue(controller: TrafficRuntime) {
    if (this.options.priorityPolicy === "fifo") {
      controller.queue.sort((a, b) => a.requestedAt - b.requestedAt);
      return;
    }
    if (this.options.priorityPolicy === "schedule") {
      controller.queue.sort((a, b) => {
        const tramA = this.trams.find((tram) => tram.id === a.tramId);
        const tramB = this.trams.find((tram) => tram.id === b.tramId);
        return (
          (tramB?.delaySeconds ?? 0) - (tramA?.delaySeconds ?? 0) ||
          a.requestedAt - b.requestedAt
        );
      });
      return;
    }
    controller.queue.sort((a, b) => {
      const tramA = this.trams.find((tram) => tram.id === a.tramId);
      const tramB = this.trams.find((tram) => tram.id === b.tramId);
      return (
        (tramA?.linePriority ?? 99) - (tramB?.linePriority ?? 99) ||
        a.requestedAt - b.requestedAt
      );
    });
  }

  private applyNextSwitchRequest(
    runtime: SwitchRuntime,
    definition: SwitchDefinition,
  ) {
    if (runtime.queue.length === 0) return;
    runtime.queue.sort((a, b) => a.requestedAt - b.requestedAt);
    const next = runtime.queue.shift()!;
    const switchIndex = this.scenarioDefinition.switches.findIndex(
      (item) => item.id === definition.id,
    );
    const tramIndex = this.trams.findIndex((item) => item.id === next.tramId);
    const result = cppRequestSwitchAuthority(
      switchIndex,
      runtime.state,
      -1,
      next.desired,
      tramIndex,
      true,
    );
    runtime.state = result?.state ?? next.desired;
    runtime.lockedBy =
      result && result.lockedByIndex >= 0
        ? this.trams[result.lockedByIndex]?.id ?? next.tramId
        : next.tramId;
    this.addEvent(
      "ok",
      `${definition.id} relocked ${next.desired.toUpperCase()} for ${next.tramId}`,
    );
  }

  private routeForUid(uid: number): SwitchPosition {
    if (OPEN_UIDS.has(uid)) return "branch";
    if (CLOSED_UIDS.has(uid)) return "main";
    return "main";
  }

  private policyLabel(policy: PriorityPolicy) {
    if (policy === "schedule") return "Most-delayed policy";
    if (policy === "fleet") return "Fixed fleet rank";
    return "FIFO policy";
  }

  private formatDistance(value: number) {
    return value >= 1_000
      ? `${(value / 1_000).toFixed(1)}km`
      : `${Math.round(value)}m`;
  }

  private addEvent(tone: EventEntry["tone"], message: string) {
    this.events.unshift({
      id: ++this.eventSequence,
      at: this.simulationTime,
      time: formatClock(this.serviceClockSeconds()),
      tone,
      message,
    });
    this.events = this.events.slice(0, 48);
  }

  private getTramSnapshots(): TramSnapshot[] {
    return this.trams.map((tram) => {
      let location = this.getPointOnSegment(tram.segmentId, tram.progress) ?? {
        point: { x: 0, y: 0 },
        angle: 0,
      };
      const depotAssignment = this.depotPortalById(tram.depotPortalId);
      if (depotAssignment && tram.serviceState === "in-depot") {
        const stored = this.trams
          .filter(
            (item) =>
              item.depotId === tram.depotId && item.serviceState === "in-depot",
          )
          .sort((first, second) => first.linePriority - second.linePriority);
        const slot = Math.max(0, stored.findIndex((item) => item.id === tram.id));
        location = {
          point: {
            x: depotAssignment.depot.point.x + (slot % 3) * 11 - 11,
            // Stored vehicles are parked in rows on the empty yard side of
            // the depot marker. Positive canvas Y points downward, so the old
            // layout placed every parked tram below the building and across
            // the service lead. Keep the nearest row just above the depot and
            // stack additional rows farther away from the running line.
            y: depotAssignment.depot.point.y - 20 - Math.floor(slot / 3) * 15,
          },
          angle: 0,
        };
      } else if (
        depotAssignment &&
        (tram.serviceState === "depot-ingress" ||
          tram.serviceState === "depot-egress")
      ) {
        const track = buildSegmentRuntime({
          id: depotAssignment.portal.id,
          from: "portal",
          to: "depot",
          points: depotAssignment.portal.trackPoints,
        });
        const progress =
          tram.serviceState === "depot-egress"
            ? 1 - tram.depotProgress
            : tram.depotProgress;
        location = sampleTrackSegment(track, progress);
        if (tram.serviceState === "depot-egress") {
          location = { ...location, angle: location.angle + Math.PI };
        }
      }
      const leader =
        tram.serviceState === "in-service"
          ? this.nearestTramAhead(tram, true)
          : null;
      const group = this.scenarioDefinition.fleetGroups?.find(
        (item) => item.id === tram.fleetGroupId,
      );
      return {
        id: tram.id,
        label: tram.label,
        uid: tram.uid,
        color: tram.color,
        routeIntent: tram.routeIntent,
        fleetGroupId: tram.fleetGroupId,
        directionLabel: tram.directionLabel,
        serviceState: tram.serviceState,
        serviceLabel:
          tram.serviceState === "in-service"
            ? group?.shortName ?? this.routeIdForTram(tram)
            : tram.serviceState === "in-depot"
              ? depotAssignment?.depot.shortName ?? "DEPOT"
              : tram.serviceState === "depot-egress"
                ? "DEPOT OUT"
                : "TO DEPOT",
        depotId: tram.depotId,
        lastPassengerStop: tram.lastPassengerStop,
        linePriority: tram.linePriority,
        speedKmh: tram.speedMps * 3.6,
        accelerationMps2: tram.lastAcceleration,
        tractionForceKn: tram.tractionForceN / 1000,
        brakeForceKn: tram.brakeForceN / 1000,
        resistanceForceKn: tram.resistanceForceN / 1000,
        dynamicsMode: tram.dynamicsMode,
        status: tram.status,
        statusTone: tram.statusTone,
        doorsOpen:
          tram.stationPhase === "dwell" &&
          tram.serviceState === "in-service" &&
          tram.speedMps < 0.15,
        pwm: tram.pwm,
        delaySeconds: tram.delaySeconds,
        // A reserved slot belongs to the next trip: planned terminal waiting
        // is on time until that slot expires. Once departed, retain the actual
        // deviation until the next terminal assigns a new slot. The distance
        // heuristic in delaySeconds is not timetable adherence.
        timetableDelaySeconds: tram.scheduledDepartureAt !== null
          ? Math.max(0, this.simulationTime - tram.scheduledDepartureAt)
          : tram.lastDepartureDeviationSeconds === null
            ? null
            : Math.max(0, tram.lastDepartureDeviationSeconds),
        scheduledDepartureClock:
          tram.scheduledDepartureClockSeconds === null
            ? null
            : formatClock(tram.scheduledDepartureClockSeconds),
        scheduledDepartureKind: tram.scheduledDepartureKind,
        scheduledDeparturePointLabel: tram.scheduledDeparturePointLabel,
        terminalBerth: tram.terminalBerth,
        lastDepartureDeviationSeconds: tram.lastDepartureDeviationSeconds,
        distanceMeters: tram.distanceMeters,
        energyWh: tram.energyWh,
        recoveredWh: tram.recoveredWh,
        tractionEnergyWh: tram.tractionEnergyWh,
        auxiliaryEnergyWh: tram.auxiliaryEnergyWh,
        mechanicalBrakeEnergyWh: tram.mechanicalBrakeEnergyWh,
        grossRegeneratedWh: tram.grossRegeneratedWh,
        rejectedRegenerationWh: tram.rejectedRegenerationWh,
        downhillPotentialWh: tram.downhillPotentialWh,
        climbPotentialWh: tram.climbPotentialWh,
        emergencyStops: tram.emergencyStops,
        lap: tram.lap,
        segmentId: tram.segmentId,
        progress: tram.progress,
        position: location.point,
        angle: location.angle,
        manualMode: tram.manualMode,
        manualCommand: tram.manualCommand,
        canReverseToRoute: Boolean(tram.branchOrigin),
        branchReturnSwitchId: tram.branchOrigin?.switchId ?? null,
        leaderTramId: leader?.tram.id ?? null,
        headwayAheadMeters: leader?.distanceMeters ?? null,
        targetHeadwayMeters: tram.desiredHeadwayMeters,
        onboardPassengers: tram.onboardPassengers,
        passengerCapacity: TRAM_CAPACITY,
        vehicleMassTonnes:
          (EMPTY_TRAM_MASS_KG + tram.onboardPassengers * PASSENGER_MASS_KG) / 1000,
        profileLimitKmh: tram.profileLimitMps * 3.6,
        profileReason: tram.profileReason,
        restrictionDistanceMeters: tram.restrictionDistanceMeters,
        curveRadiusMeters: tram.curveRadiusMeters,
        lateralAccelerationMps2: tram.lateralAccelerationMps2,
        ecoDrivingMode: tram.ecoDrivingMode,
        ecoConstraintDistanceMeters: tram.ecoConstraintDistanceMeters,
        ecoConstraintLabel: tram.ecoConstraintLabel,
        ecoApproachStopId: tram.ecoApproachStopId,
        ecoCoastSeconds: tram.ecoCoastSeconds,
      };
    });
  }

  private nearestTrack(point: Point) {
    let best: { segmentId: string; progress: number; distance: number } | null = null;
    for (const runtime of this.segments.values()) {
      if (runtime.render === false) continue;
      const samples = Math.max(20, Math.ceil(runtime.lengthRef / 8));
      for (let index = 0; index <= samples; index += 1) {
        const progress = index / samples;
        const location = sampleTrackSegment(runtime, progress).point;
        const currentDistance = distance(point, location);
        if (!best || currentDistance < best.distance) {
          best = { segmentId: runtime.id, progress, distance: currentDistance };
        }
      }
    }
    return best;
  }
}

/** Immutable-by-convention data consumed by renderers; contains no DOM/Canvas objects. */
export type SimulationRenderState = ReturnType<SimulationEngine["getRenderState"]>;
