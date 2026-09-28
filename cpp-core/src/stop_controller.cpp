#include "tram/stop_controller.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace tram {
namespace {

constexpr double kAlignmentToleranceM = 0.20;
constexpr double kDoorReleaseSpeedMps = 0.12;
constexpr double kServiceDecelerationMps2 = 1.05;

}  // namespace

StopController::StopController(StopDefinition definition)
    : definition_(std::move(definition)) {
  if (definition_.id.empty() || definition_.segment_id.empty()) {
    throw std::invalid_argument("stop id and segment id must not be empty");
  }
  if (definition_.offset_m < 0.0 || definition_.dwell_seconds < 0.0) {
    throw std::invalid_argument("stop offset and dwell time must be non-negative");
  }
}

StopServiceCommand StopController::update(const StopServiceInput& input) {
  StopServiceCommand command;
  command.state = state_;
  command.target_speed_mps = std::max(0.0, input.cruise_speed_mps);

  if (state_ == StopServiceState::completed ||
      state_ == StopServiceState::skipped) {
    return command;
  }

  if (!input.passenger_service) {
    state_ = StopServiceState::skipped;
    command.state = state_;
    command.event = "skipped";
    return command;
  }

  if (state_ == StopServiceState::approaching) {
    const double distance = std::max(0.0, input.distance_to_stop_m);
    command.max_advance_m = distance;
    const double braking_distance = std::max(0.0, distance - kAlignmentToleranceM);
    const double approach_speed =
        std::sqrt(2.0 * kServiceDecelerationMps2 * braking_distance);
    command.target_speed_mps =
        std::min(command.target_speed_mps, approach_speed);

    if (distance <= kAlignmentToleranceM &&
        input.speed_mps <= kDoorReleaseSpeedMps) {
      state_ = StopServiceState::dwelling;
      dwell_elapsed_seconds_ = 0.0;
      command.state = state_;
      command.target_speed_mps = 0.0;
      command.max_advance_m = 0.0;
      command.doors_open = true;
      command.event = "arrived";
    }
    return command;
  }

  dwell_elapsed_seconds_ += std::max(0.0, input.step_seconds);
  command.target_speed_mps = 0.0;
  command.max_advance_m = 0.0;
  command.doors_open = true;
  if (dwell_elapsed_seconds_ + 1e-9 >= definition_.dwell_seconds) {
    state_ = StopServiceState::completed;
    command.state = state_;
    command.target_speed_mps = std::max(0.0, input.cruise_speed_mps);
    command.max_advance_m = std::numeric_limits<double>::infinity();
    command.doors_open = false;
    command.event = "departed";
  }
  return command;
}

const StopDefinition& StopController::definition() const { return definition_; }

StopServiceState StopController::state() const { return state_; }

double StopController::dwell_elapsed_seconds() const {
  return dwell_elapsed_seconds_;
}

void StopController::reset() {
  state_ = StopServiceState::approaching;
  dwell_elapsed_seconds_ = 0.0;
}

const char* stop_service_state_name(StopServiceState state) {
  switch (state) {
    case StopServiceState::approaching:
      return "approaching";
    case StopServiceState::dwelling:
      return "dwelling";
    case StopServiceState::completed:
      return "in_service";
    case StopServiceState::skipped:
      return "not_in_service";
  }
  return "unknown";
}

}  // namespace tram
