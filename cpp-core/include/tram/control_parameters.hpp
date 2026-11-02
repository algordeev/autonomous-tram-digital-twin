#pragma once

namespace tram {
// Physical brake limit and conservative approach envelope have different roles.
inline constexpr double kServiceDecelerationMps2 = 1.25;
inline constexpr double kApproachDecelerationMps2 = 0.72;
inline constexpr double kMaximumAccelerationMps2 = 1.15;
inline constexpr double kMaximumJerkMps3 = 0.9;
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
