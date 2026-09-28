export type DynamicsMode = "coast" | "traction" | "service-brake" | "emergency-brake";

export interface TramVehicleParameters {
  massKg: number;
  maxTractionForceN: number;
  maxBrakeForceN: number;
  maxTractionPowerW: number;
  maxAccelerationMps2: number;
  serviceDecelerationMps2: number;
  emergencyDecelerationMps2: number;
  maxJerkMps3: number;
  resistanceA_N: number;
  resistanceB_NsPerM: number;
  resistanceC_Ns2PerM2: number;
  drivetrainEfficiency: number;
  regenerationEfficiency: number;
  gridReceptivity: number;
  auxiliaryPowerW: number;
}

export interface VehicleDynamicsState {
  speedMps: number;
  accelerationMps2: number;
}

export interface VehicleDynamicsCommand {
  targetSpeedMps: number;
  emergencyBrake?: boolean;
  /** Signed slope: +0.01 is a 10‰ climb, -0.01 is a 10‰ descent. */
  grade?: number;
}

export interface VehicleDynamicsResult extends VehicleDynamicsState {
  distanceMeters: number;
  tractionForceN: number;
  brakeForceN: number;
  resistanceForceN: number;
  consumedEnergyWh: number;
  tractionEnergyWh: number;
  auxiliaryEnergyWh: number;
  mechanicalBrakeEnergyWh: number;
  grossRegeneratedEnergyWh: number;
  regeneratedEnergyWh: number;
  rejectedRegenerationEnergyWh: number;
  downhillPotentialEnergyWh: number;
  climbPotentialEnergyWh: number;
  mode: DynamicsMode;
}

/** Reference values for a medium-size four-axle city tram. */
export const REFERENCE_TRAM_PARAMETERS: Readonly<TramVehicleParameters> = {
  // The 27.5 t study mass reproduces the mgh values in the 2021 Route 2 deck.
  massKg: 27_500,
  maxTractionForceN: 32_000,
  maxBrakeForceN: 52_000,
  maxTractionPowerW: 240_000,
  maxAccelerationMps2: 1.15,
  serviceDecelerationMps2: 1.25,
  emergencyDecelerationMps2: 2.4,
  maxJerkMps3: 0.9,
  resistanceA_N: 1_100,
  resistanceB_NsPerM: 32,
  resistanceC_Ns2PerM2: 2.1,
  drivetrainEfficiency: 0.88,
  regenerationEfficiency: 0.86,
  gridReceptivity: 0.82,
  auxiliaryPowerW: 4_500,
};

const clampValue = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const rollingResistanceForce = (
  speedMps: number,
  parameters: TramVehicleParameters,
) =>
  parameters.resistanceA_N +
  parameters.resistanceB_NsPerM * Math.max(0, speedMps) +
  parameters.resistanceC_Ns2PerM2 * Math.max(0, speedMps) ** 2;

/**
 * One-dimensional longitudinal dynamics with force/power limits, Davis-style
 * rolling resistance, jerk limiting and regenerative braking.
 */
export function integrateVehicleDynamics(
  state: VehicleDynamicsState,
  command: VehicleDynamicsCommand,
  deltaSeconds: number,
  parameters: TramVehicleParameters = REFERENCE_TRAM_PARAMETERS,
): VehicleDynamicsResult {
  if (!(deltaSeconds > 0)) {
    throw new Error("deltaSeconds must be positive");
  }

  const speed = Math.max(0, state.speedMps);
  const targetSpeed = Math.max(0, command.targetSpeedMps);
  const speedError = targetSpeed - speed;
  // A stopped wheelset cannot retain a negative acceleration state: once the
  // brake is released, the next traction request starts from zero acceleration.
  const currentAcceleration =
    speed <= 1e-6 && speedError > 0
      ? Math.max(0, state.accelerationMps2)
      : state.accelerationMps2;
  const emergency = Boolean(command.emergencyBrake && speedError < 0);
  const accelerationLimit = emergency
    ? parameters.emergencyDecelerationMps2
    : parameters.serviceDecelerationMps2;
  const desiredAcceleration = emergency
    ? -parameters.emergencyDecelerationMps2
    : clampValue(speedError / 1.4, -accelerationLimit, parameters.maxAccelerationMps2);
  const jerkStep = parameters.maxJerkMps3 * deltaSeconds;
  const requestedAcceleration = clampValue(
    desiredAcceleration,
    currentAcceleration - jerkStep,
    currentAcceleration + jerkStep,
  );
  const resistanceForceN = rollingResistanceForce(speed, parameters);
  const grade = clampValue(command.grade ?? 0, -0.12, 0.12);
  const gradeForceN = parameters.massKg * 9.80665 * grade;

  let tractionForceN = 0;
  let brakeForceN = 0;
  let accelerationMps2 = requestedAcceleration;
  let mode: DynamicsMode = "coast";

  const forceForAcceleration =
    parameters.massKg * requestedAcceleration + resistanceForceN + gradeForceN;
  if (forceForAcceleration >= 0) {
    const powerLimitedForce = parameters.maxTractionPowerW / Math.max(speed, 1);
    tractionForceN = Math.min(
      forceForAcceleration,
      parameters.maxTractionForceN,
      powerLimitedForce,
    );
    accelerationMps2 =
      (tractionForceN - resistanceForceN - gradeForceN) / parameters.massKg;
    if (tractionForceN > resistanceForceN + 1) mode = "traction";
  } else {
    brakeForceN = Math.min(parameters.maxBrakeForceN, -forceForAcceleration);
    accelerationMps2 =
      (-brakeForceN - resistanceForceN - gradeForceN) / parameters.massKg;
    mode = emergency ? "emergency-brake" : "service-brake";
  }

  let nextSpeedMps = Math.max(0, speed + accelerationMps2 * deltaSeconds);
  if (
    (speedError >= 0 && nextSpeedMps > targetSpeed) ||
    (speedError < 0 && nextSpeedMps < targetSpeed)
  ) {
    nextSpeedMps = targetSpeed;
    accelerationMps2 = (nextSpeedMps - speed) / deltaSeconds;
  }

  const averageSpeedMps = (speed + nextSpeedMps) / 2;
  const distanceMeters = averageSpeedMps * deltaSeconds;
  const tractionEnergyWh =
    ((tractionForceN * averageSpeedMps) / parameters.drivetrainEfficiency) *
    deltaSeconds / 3600;
  const auxiliaryEnergyWh = parameters.auxiliaryPowerW * deltaSeconds / 3600;
  const consumedEnergyWh = tractionEnergyWh + auxiliaryEnergyWh;
  const mechanicalBrakeEnergyWh =
    brakeForceN * averageSpeedMps * deltaSeconds / 3600;
  const grossRegeneratedEnergyWh =
    mechanicalBrakeEnergyWh * parameters.regenerationEfficiency;
  const regeneratedEnergyWh = grossRegeneratedEnergyWh * parameters.gridReceptivity;
  const rejectedRegenerationEnergyWh = Math.max(
    0,
    mechanicalBrakeEnergyWh - regeneratedEnergyWh,
  );
  const gravitationalEnergyWh =
    Math.abs(gradeForceN) * averageSpeedMps * deltaSeconds / 3600;
  const downhillPotentialEnergyWh = grade < 0 ? gravitationalEnergyWh : 0;
  const climbPotentialEnergyWh = grade > 0 ? gravitationalEnergyWh : 0;

  return {
    speedMps: nextSpeedMps,
    accelerationMps2,
    distanceMeters,
    tractionForceN,
    brakeForceN,
    resistanceForceN,
    consumedEnergyWh,
    tractionEnergyWh,
    auxiliaryEnergyWh,
    mechanicalBrakeEnergyWh,
    grossRegeneratedEnergyWh,
    regeneratedEnergyWh,
    rejectedRegenerationEnergyWh,
    downhillPotentialEnergyWh,
    climbPotentialEnergyWh,
    mode,
  };
}
