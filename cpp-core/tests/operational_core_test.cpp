#include "tram/control_parameters.hpp"
#include "tram/core_c_api.h"
#include <cassert>
#include <cmath>

int main() {
  assert(tram_core_abi_version() == TRAM_CORE_ABI_VERSION);
  assert(tram_core_authority_begin(0) == 0);
  assert(tram_core_authority_begin(2) == 1);
  assert(tram_core_authority_step(-1, 10, 0, 0, 0, .05) == 0);
  assert(tram_core_authority_step(0, 10, 0, 0, 0, .05) == 0); // unsynchronised
  for (int i = 0; i < 2; ++i)
    assert(tram_core_authority_sync(i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) == 1);
  for (int n = 0; n < 200; ++n) {
    assert(tram_core_authority_step(0, 11.1, 0, 0, 0, .05) == 1);
    assert(tram_core_authority_step(1, 11.1, 0, 0, 110, .05) == 1);
  }
  assert(tram_core_authority_speed(0) > tram_core_authority_speed(1));
  assert(tram_core_authority_consumed(0) > 0);
  for (int n = 0; n < 300; ++n)
    assert(tram_core_authority_step(0, 0, 0, 0, 0, .05) == 1);
  assert(tram_core_authority_speed(0) <= 0.12);
  assert(tram_core_authority_regenerated(0) > 0);
  tram_core_station_sync(0, 1, 0);
  tram_core_station_step(0, 20, 0, 1);
  assert(tram_core_station_until(0) == 20 + tram::kInitialDwellSeconds);
  assert(tram_core_station_phase(0) == 2);
  assert(tram_core_station_approach_speed(.35, 15) == 0);
  // The curve is lowered by the speed-tracking lag, with a walking-pace floor.
  assert(std::abs(tram_core_station_approach_speed(80, 15) -
                  (std::sqrt(2 * tram::kApproachDecelerationMps2 * (80 - .35)) -
                   tram::kApproachDecelerationMps2 *
                       tram::kSpeedTrackingTimeConstantSeconds)) < 1e-12);
  assert(tram_core_station_approach_speed(1, 15) == tram::kStopCreepSpeedMps);
  // A tram tracking the curve from line speed reaches the platform at walking
  // pace (the uncompensated curve arrived at about 2 m/s).
  {
    assert(tram_core_authority_begin(1) == 1);
    assert(tram_core_authority_sync(0, 11.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) == 1);
    double remaining = 120;
    for (int tick = 0; tick < 2400; ++tick) {
      assert(tram_core_authority_step(
                 0, tram_core_station_approach_speed(remaining, 11.1), 0, 0, 0,
                 .05) == 1);
      const double move = tram_core_authority_distance(0);
      if (move >= remaining) // the engine's interlock stops it at the platform
        break;
      remaining -= move;
      if (remaining <= 0.45 && tram_core_authority_speed(0) <= 0.12)
        break; // aligned without the interlock
    }
    assert(tram_core_authority_speed(0) < 0.5);
  }
  // Native and WASM share reset semantics and reject invalid time steps.
  assert(tram_core_step(nullptr, 0) == 0);
  assert(tram_core_step(nullptr, 1.1) == 0);
}
