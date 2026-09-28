#include "tram/priority_controller.hpp"

#include <cassert>
#include <iostream>

using tram::JunctionObservation;
using tram::JunctionPhase;
using tram::PriorityController;

namespace {

void advance_to_tram_green(PriorityController& controller,
                           bool westbound) {
  JunctionObservation observation{};
  observation.simulation_time_s = 10.0;
  if (westbound) observation.westbound_distance_m = 60.0;
  else observation.eastbound_distance_m = 60.0;
  assert(controller.update(observation).phase == JunctionPhase::road_amber);

  observation.simulation_time_s = 13.0;
  assert(controller.update(observation).phase ==
         JunctionPhase::all_red_to_tram);
  observation.simulation_time_s = 14.5;
  assert(controller.update(observation).phase == JunctionPhase::tram_green);
}

void test_both_directions_request_the_same_safe_cycle() {
  PriorityController westbound;
  advance_to_tram_green(westbound, true);
  assert(westbound.command().signal_state == "rrGG");

  PriorityController eastbound;
  advance_to_tram_green(eastbound, false);
  assert(eastbound.command().signal_state == "rrGG");
}

void test_slow_tram_holds_green_until_fully_clear() {
  PriorityController controller;
  advance_to_tram_green(controller, true);

  JunctionObservation observation{};
  observation.westbound_distance_m = 0.0;
  observation.tram_in_conflict_zone = true;
  for (double time = 15.0; time <= 45.0; time += 1.0) {
    observation.simulation_time_s = time;
    const auto command = controller.update(observation);
    assert(command.phase == JunctionPhase::tram_green);
    assert(command.tram_grant_latched);
  }

  observation.tram_in_conflict_zone = false;
  observation.active_tram_fully_cleared = true;
  observation.westbound_distance_m.reset();
  observation.simulation_time_s = 46.0;
  assert(controller.update(observation).phase == JunctionPhase::tram_green);
  // Clearance is an edge-triggered detector event, not a level that remains
  // active for the whole safety hold.
  observation.active_tram_fully_cleared = false;
  observation.simulation_time_s = 47.5;
  assert(controller.update(observation).phase == JunctionPhase::tram_amber);
}

void test_request_does_not_cut_minimum_road_green() {
  PriorityController controller;
  JunctionObservation observation{};
  observation.eastbound_distance_m = 10.0;
  observation.simulation_time_s = 2.0;
  assert(controller.update(observation).phase == JunctionPhase::road_green);
  observation.simulation_time_s = 10.0;
  assert(controller.update(observation).phase == JunctionPhase::road_amber);
}

}  // namespace

int main() {
  test_both_directions_request_the_same_safe_cycle();
  test_slow_tram_holds_green_until_fully_clear();
  test_request_does_not_cut_minimum_road_green();
  std::cout << "priority_controller_test: all checks passed\n";
  return 0;
}
