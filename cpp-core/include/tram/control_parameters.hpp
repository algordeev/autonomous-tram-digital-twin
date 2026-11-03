#pragma once

namespace tram {
// Physical brake limit and conservative approach envelope have different roles.
inline constexpr double kServiceDecelerationMps2 = 1.25;
inline constexpr double kApproachDecelerationMps2 = 0.72;
inline constexpr double kMaximumAccelerationMps2 = 1.15;
inline constexpr double kMaximumJerkMps3 = 0.9;
// The traction motors provide the electric (regenerative) brake. It is limited
// by the same 32 kN force and 240 kW rating as traction, and fades out between
// these speeds (7.2 and 1.8 km/h); friction brakes supply the rest of the
// braking force and complete the stop.
inline constexpr double kMotorForceLimitN = 32000.0;
inline constexpr double kMotorPowerLimitW = 240000.0;
inline constexpr double kElectricBrakeFullSpeedMps = 2.0;
inline constexpr double kElectricBrakeZeroSpeedMps = 0.5;
// Speed error is converted to an acceleration request over this time constant,
// so a tram tracking a decelerating target lags it by about a * tau.
inline constexpr double kSpeedTrackingTimeConstantSeconds = 1.4;
// Final creep below the 0.12 m/s alignment speed, so a tram that stopped short
// of the platform still reaches the alignment window.
inline constexpr double kStopCreepSpeedMps = 0.1;
// Initial door dwell only; the orchestrator supplies passenger/terminal
// extensions.
inline constexpr double kInitialDwellSeconds = 12.0;
} // namespace tram
