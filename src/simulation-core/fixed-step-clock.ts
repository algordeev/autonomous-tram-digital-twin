/**
 * Converts irregular render-frame time into deterministic simulation ticks.
 * This module deliberately has no browser, React or Canvas dependencies.
 */
export class FixedStepClock {
  private accumulatorSeconds = 0;
  readonly stepSeconds: number;
  readonly maxStepsPerFrame: number;

  constructor(
    stepSeconds = 0.05,
    maxStepsPerFrame = 20,
  ) {
    if (!(stepSeconds > 0)) throw new Error("stepSeconds must be positive");
    if (!(maxStepsPerFrame > 0)) throw new Error("maxStepsPerFrame must be positive");
    this.stepSeconds = stepSeconds;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  reset() {
    this.accumulatorSeconds = 0;
  }

  advance(simulatedSeconds: number, update: (stepSeconds: number) => void) {
    if (!Number.isFinite(simulatedSeconds) || simulatedSeconds <= 0) return 0;
    this.accumulatorSeconds += simulatedSeconds;
    let steps = 0;
    while (
      this.accumulatorSeconds + 1e-9 >= this.stepSeconds &&
      steps < this.maxStepsPerFrame
    ) {
      update(this.stepSeconds);
      this.accumulatorSeconds -= this.stepSeconds;
      if (Math.abs(this.accumulatorSeconds) < 1e-9) this.accumulatorSeconds = 0;
      steps += 1;
    }

    // Prevent a backgrounded tab from creating an unbounded catch-up queue.
    if (steps === this.maxStepsPerFrame) {
      this.accumulatorSeconds = Math.min(
        this.accumulatorSeconds,
        this.stepSeconds * this.maxStepsPerFrame,
      );
    }
    return steps;
  }
}
