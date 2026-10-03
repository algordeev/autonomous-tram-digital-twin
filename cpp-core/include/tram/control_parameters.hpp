#pragma once

namespace tram {
// Physical brake limit and conservative approach envelope have different roles.
inline constexpr double kServiceDecelerationMps2 = 1.25;
inline constexpr double kApproachDecelerationMps2 = 0.72;
inline constexpr double kMaximumAccelerationMps2 = 1.15;
inline constexpr double kMaximumJerkMps3 = 0.9;
// Initial door dwell only; the orchestrator supplies passenger/terminal
// extensions.
inline constexpr double kInitialDwellSeconds = 12.0;
} // namespace tram
