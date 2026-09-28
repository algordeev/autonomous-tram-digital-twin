#include "tram/priority_controller.hpp"

#include <algorithm>

namespace tram {

PriorityController::PriorityController(PriorityParameters parameters)
    : parameters_(parameters) {}

void PriorityController::reset(double simulation_time_s) {
  phase_ = JunctionPhase::road_green;
  phase_started_s_ = simulation_time_s;
  clearance_started_s_.reset();
  tram_entered_ = false;
}

bool PriorityController::has_approaching_tram(
    const JunctionObservation& observation) const {
  const auto inside_detection_zone = [this](const std::optional<double> distance) {
    return distance.has_value() && distance.value() >= 0.0 &&
           distance.value() <= parameters_.detection_distance_m;
  };
  return inside_detection_zone(observation.westbound_distance_m) ||
         inside_detection_zone(observation.eastbound_distance_m);
}

void PriorityController::transition(JunctionPhase next,
                                    double simulation_time_s) {
  phase_ = next;
  phase_started_s_ = simulation_time_s;
  clearance_started_s_.reset();
  if (next == JunctionPhase::road_green) tram_entered_ = false;
}

JunctionCommand PriorityController::update(
    const JunctionObservation& observation) {
  const double elapsed =
      std::max(0.0, observation.simulation_time_s - phase_started_s_);
  const bool tram_requested = has_approaching_tram(observation);

  switch (phase_) {
    case JunctionPhase::road_green:
      if (tram_requested && elapsed >= parameters_.minimum_road_green_s) {
        transition(JunctionPhase::road_amber, observation.simulation_time_s);
      }
      break;
    case JunctionPhase::road_amber:
      if (elapsed >= parameters_.amber_s) {
        transition(JunctionPhase::all_red_to_tram,
                   observation.simulation_time_s);
      }
      break;
    case JunctionPhase::all_red_to_tram:
      if (elapsed >= parameters_.all_red_s) {
        transition(JunctionPhase::tram_green, observation.simulation_time_s);
      }
      break;
    case JunctionPhase::tram_green:
      if (observation.tram_in_conflict_zone) {
        tram_entered_ = true;
        clearance_started_s_.reset();
      }

      // Once a tram has entered, no timer is allowed to revoke its green.
      // The phase may change only after the detector reports that the complete
      // vehicle has left the conflict zone and the clearance interval elapsed.
      // The detector edge is a one-step pulse, so clearance_started_s_ must
      // latch it instead of requiring the pulse throughout the hold period.
      if (tram_entered_) {
        if (!observation.tram_in_conflict_zone &&
            (observation.active_tram_fully_cleared ||
             clearance_started_s_.has_value())) {
          if (!clearance_started_s_.has_value()) {
            clearance_started_s_ = observation.simulation_time_s;
          }
          if (observation.simulation_time_s - clearance_started_s_.value() >=
              parameters_.clearance_hold_s) {
            transition(JunctionPhase::tram_amber,
                       observation.simulation_time_s);
          }
        }
      } else if (!tram_requested &&
                 elapsed >= parameters_.minimum_tram_green_s) {
        transition(JunctionPhase::tram_amber, observation.simulation_time_s);
      }
      break;
    case JunctionPhase::tram_amber:
      if (elapsed >= parameters_.amber_s) {
        transition(JunctionPhase::all_red_to_road,
                   observation.simulation_time_s);
      }
      break;
    case JunctionPhase::all_red_to_road:
      if (elapsed >= parameters_.all_red_s) {
        transition(JunctionPhase::road_green, observation.simulation_time_s);
      }
      break;
  }
  return command();
}

JunctionCommand PriorityController::command() const {
  switch (phase_) {
    case JunctionPhase::road_green:
      return {phase_, "GGrr", true, false, false};
    case JunctionPhase::road_amber:
      return {phase_, "yyrr", false, false, false};
    case JunctionPhase::all_red_to_tram:
    case JunctionPhase::all_red_to_road:
      return {phase_, "rrrr", false, false, tram_entered_};
    case JunctionPhase::tram_green:
      return {phase_, "rrGG", false, true, tram_entered_};
    case JunctionPhase::tram_amber:
      return {phase_, "rryy", false, false, tram_entered_};
  }
  return {};
}

}  // namespace tram
