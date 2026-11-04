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
  // Electric braking is limited by the motors (32 kN, 240 kW) and fades out
  // at low speed; friction supplies the rest, and only the electric share is
  // generator output. A full tram's emergency stop from 40 km/h needs about
  // 570 kW at the start, well beyond the motors.
  {
    assert(tram_core_authority_begin(1) == 1);
    assert(tram_core_authority_sync(0, 11.1, -2.4, 0, 0, 0, 0, 0, 0, 0, 0, 0) ==
           1);
    bool friction_used = false;
    for (int n = 0; n < 400 && tram_core_authority_speed(0) > 0; ++n) {
      const double speed = tram_core_authority_speed(0),
                   gross = tram_core_authority_gross_regenerated(0),
                   wheel = tram_core_authority_mechanical_brake(0);
      assert(tram_core_authority_step(0, 0, 1, 0, 110, .05) == 1);
      const double electric_wh =
          (tram_core_authority_gross_regenerated(0) - gross) / .86,
                   wheel_wh = tram_core_authority_mechanical_brake(0) - wheel;
      assert(electric_wh <= tram::kMotorPowerLimitW * .05 / 3600 + 1e-9);
      assert(electric_wh <= wheel_wh + 1e-9);
      if (speed <= tram::kElectricBrakeZeroSpeedMps)
        assert(electric_wh == 0);
      if (wheel_wh > electric_wh * 1.01)
        friction_used = true;
    }
    assert(tram_core_authority_speed(0) == 0);
    assert(friction_used);
  }
  // Emergency braking reaches 2.4 m/s2 empty and full, within about 0.5 s,
  // with track brakes and a fast build-up; service braking keeps 1.25 m/s2
  // and the comfort jerk.
  const int passenger_loads[] = {0, 110}, emergency_modes[] = {1, 0};
  for (const int passengers : passenger_loads) {
    for (const int emergency : emergency_modes) {
      assert(tram_core_authority_begin(1) == 1);
      assert(tram_core_authority_sync(0, 11.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) ==
             1);
      double distance = 0, peak = 0, reached = -1, previous = 0;
      for (int n = 0; n < 600 && tram_core_authority_speed(0) > 1e-9; ++n) {
        assert(tram_core_authority_step(0, 0, emergency, 0, passengers, .05) ==
               1);
        const double deceleration = -tram_core_authority_acceleration(0);
        distance += tram_core_authority_distance(0);
        if (deceleration > peak)
          peak = deceleration;
        if (reached < 0 && deceleration >= .99 * tram::kEmergencyDecelerationMps2)
          reached = (n + 1) * .05;
        if (!emergency && tram_core_authority_speed(0) > .5)
          assert(deceleration - previous <=
                 tram::kMaximumJerkMps3 * .05 + 1e-9);
        previous = deceleration;
      }
      if (emergency) {
        assert(peak <= tram::kEmergencyDecelerationMps2 + 1e-9);
        assert(reached > 0 && reached <= .6);
        assert(distance < 30);
      } else {
        assert(peak <= tram::kServiceDecelerationMps2 + 1e-9);
        assert(distance > 40);
      }
    }
  }
  // Native and WASM share reset semantics and reject invalid time steps.
  assert(tram_core_step(nullptr, 0) == 0);
  assert(tram_core_step(nullptr, 1.1) == 0);
}
