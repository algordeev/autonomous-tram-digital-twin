#include "tram/stop_controller.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
  tram::StopController controller(
      {"STOP-KRS-E", "Krasnoselskaya", "E-straight", 85.0, 8.0});

  const auto approach = controller.update({25.0, 8.0, 0.1, 11.0, true});
  assert(approach.state == tram::StopServiceState::approaching);
  assert(approach.target_speed_mps < 8.0);
  assert(std::abs(approach.max_advance_m - 25.0) < 1e-9);
  assert(!approach.doors_open);

  const auto arrival = controller.update({0.05, 0.05, 0.1, 11.0, true});
  assert(arrival.state == tram::StopServiceState::dwelling);
  assert(arrival.doors_open);
  assert(arrival.event == "arrived");

  for (int index = 0; index < 79; ++index) {
    const auto dwell = controller.update({0.0, 0.0, 0.1, 11.0, true});
    assert(dwell.doors_open);
    assert(dwell.target_speed_mps == 0.0);
  }
  const auto departure = controller.update({0.0, 0.0, 0.1, 11.0, true});
  assert(departure.state == tram::StopServiceState::completed);
  assert(!departure.doors_open);
  assert(departure.event == "departed");
  assert(departure.target_speed_mps == 11.0);

  tram::StopController depot_run(
      {"STOP-KRS-W", "Krasnoselskaya", "W-straight", 75.0, 8.0});
  const auto skipped = depot_run.update({15.0, 5.0, 0.1, 11.0, false});
  assert(skipped.state == tram::StopServiceState::skipped);
  assert(!skipped.doors_open);
  assert(skipped.event == "skipped");

  std::cout << "stop_controller_test: all checks passed\n";
}
