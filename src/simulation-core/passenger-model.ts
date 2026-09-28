/**
 * Passenger demand and boarding model.
 *
 * Pure, deterministic (no Math.random — matches the rest of the engine's
 * fixed-step determinism) helpers that turn a stop's arrival intensity into
 * a waiting queue, decide how many people board/alight at a dwell event,
 * and translate that into a realistic dwell duration so a tram never closes
 * its doors while people are still boarding.
 *
 * This module has no dependency on engine.ts, WASM, or the DOM, so it can be
 * unit tested in isolation (see tests/passenger-model.test.mjs) and reused
 * from either the TypeScript engine or a future native/WASM port.
 */

const MINUTES_PER_DAY = 24 * 60;

/**
 * Deterministic "busy-ness of the day" curve, expressed as a multiplier on
 * the base arrival rate. Two broad peaks (AM/PM commute) on top of a modest
 * midday plateau and a quiet night floor. Shaped with cosine bumps instead
 * of real-world data because the network configs don't carry ridership
 * data — treat this as a reasonable placeholder, easy to swap out.
 */
export function timeOfDayDemandFactor(minuteOfDay: number): number {
  const minute = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const bump = (centerMinute: number, widthMinutes: number, height: number) => {
    const distance = Math.abs(minute - centerMinute);
    if (distance > widthMinutes) return 0;
    return height * (0.5 + 0.5 * Math.cos((distance / widthMinutes) * Math.PI));
  };
  const nightFloor = 0.12;
  const middayPlateau = bump(13 * 60, 5 * 60, 0.55);
  const morningPeak = bump(8 * 60, 75, 1.35);
  const eveningPeak = bump(17.5 * 60, 90, 1.2);
  return Math.max(nightFloor, nightFloor + middayPlateau + morningPeak + eveningPeak);
}

/**
 * Deterministic per-stop weighting so stops don't all behave identically
 * without needing extra config fields. Derived from a small string hash,
 * clamped to a modest band so no single stop dominates the network.
 */
export function stopDemandWeight(stopId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < stopId.length; index += 1) {
    hash ^= stopId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000; // [0, 1)
  return 0.7 + unit * 0.9; // [0.7, 1.6)
}

export interface BoardingAlightingInput {
  onboard: number;
  capacity: number;
  waiting: number;
  alightFraction: number;
}

export interface BoardingAlightingResult {
  boarding: number;
  alighting: number;
  /** Passengers who wanted to board but couldn't fit — stay in the queue. */
  overflow: number;
}

/** How many people get on/off at this dwell, respecting vehicle capacity. */
export function computeBoardingAlighting(
  input: BoardingAlightingInput,
): BoardingAlightingResult {
  const onboard = Math.max(0, Math.round(input.onboard));
  const alighting = Math.max(
    0,
    Math.min(onboard, Math.round(onboard * clamp01(input.alightFraction))),
  );
  const afterAlight = onboard - alighting;
  const freeCapacity = Math.max(0, Math.round(input.capacity) - afterAlight);
  const wantToBoard = Math.max(0, Math.floor(input.waiting));
  const boarding = Math.min(wantToBoard, freeCapacity);
  const overflow = wantToBoard - boarding;
  return { boarding, alighting, overflow };
}

export interface DwellModelInput {
  boarding: number;
  alighting: number;
  doorCount: number;
  secondsPerBoarding: number;
  secondsPerAlighting: number;
  minDwellSeconds: number;
  doorCycleOverheadSeconds: number;
}

/**
 * Dwell time driven by actual passenger flow rather than a fixed constant.
 * Boarding and alighting happen through all doors in parallel, so the flow
 * time is the slower of the two streams divided by the door count, plus a
 * fixed door-open/close overhead. Never shorter than minDwellSeconds so a
 * near-empty stop still gets a believable door cycle.
 */
export function computeDwellSeconds(input: DwellModelInput): number {
  const doors = Math.max(1, input.doorCount);
  const boardingSeconds = input.boarding * input.secondsPerBoarding;
  const alightingSeconds = input.alighting * input.secondsPerAlighting;
  const flowSeconds = Math.max(boardingSeconds, alightingSeconds) / doors;
  return Math.max(
    input.minDwellSeconds,
    input.doorCycleOverheadSeconds + flowSeconds,
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Tracks the waiting queue and a Little's-Law wait-time estimate for a
 * single stop/direction (one RFID "station" reader). Advances lazily: call
 * `advance()` with the current simulation time whenever you need a fresh
 * reading (on tram arrival, or when the dispatcher/UI asks for a snapshot).
 * Because the underlying rate only depends on elapsed time and the point-in
 * time-of-day, lazy catch-up gives the same result as ticking every frame
 * would, without needing a global per-stop tick loop.
 */
export class StopDemandTracker {
  readonly stopId: string;
  private waitingPassengers = 0;
  private lastUpdateSeconds: number | null = null;
  private currentRatePerSecond = 0;
  totalBoarded = 0;
  totalOverflowed = 0;

  constructor(stopId: string) {
    this.stopId = stopId;
  }

  /** Bring the queue up to date with elapsed time and the current demand rate. */
  advance(
    nowSeconds: number,
    minuteOfDay: number,
    baseRatePerMinute: number,
  ): void {
    const ratePerSecond =
      (baseRatePerMinute * timeOfDayDemandFactor(minuteOfDay) * stopDemandWeight(this.stopId)) /
      60;
    if (this.lastUpdateSeconds !== null) {
      const elapsed = Math.max(0, nowSeconds - this.lastUpdateSeconds);
      // Use the rate in effect over the elapsed window; good enough given
      // stops are typically revisited every 1-3 minutes, far shorter than
      // the demand curve's own timescale.
      this.waitingPassengers += this.currentRatePerSecond * elapsed;
    }
    this.currentRatePerSecond = ratePerSecond;
    this.lastUpdateSeconds = nowSeconds;
  }

  boardable(): number {
    return Math.max(0, Math.floor(this.waitingPassengers));
  }

  /** Remove boarded passengers from the queue and record the overflow, if any. */
  board(boarding: number, overflow: number): void {
    this.waitingPassengers = Math.max(0, this.waitingPassengers - boarding);
    this.totalBoarded += boarding;
    this.totalOverflowed += overflow;
  }

  /** Little's Law: average wait ≈ queue length / arrival rate. */
  estimateAverageWaitSeconds(): number {
    if (this.currentRatePerSecond <= 1e-6) return 0;
    return this.waitingPassengers / this.currentRatePerSecond;
  }

  isOvercrowded(overflowThreshold = 1): boolean {
    return this.waitingPassengers >= overflowThreshold && this.totalOverflowed > 0;
  }
}
