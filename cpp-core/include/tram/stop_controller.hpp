#pragma once

#include <limits>
#include <optional>
#include <string>
#include <utility>

namespace tram {

enum class StopServiceState {
  approaching,
  dwelling,
  completed,
  skipped,
};

struct StopDefinition {
  std::string id;
  std::string name;
  std::string segment_id;
  double offset_m = 0.0;
  double dwell_seconds = 12.0;
};

struct StopServiceInput {
  double distance_to_stop_m = std::numeric_limits<double>::infinity();
  double speed_mps = 0.0;
  double step_seconds = 0.0;
  double cruise_speed_mps = 11.0;
  bool passenger_service = true;
};

struct StopServiceCommand {
  double target_speed_mps = 0.0;
  double max_advance_m = std::numeric_limits<double>::infinity();
  bool doors_open = false;
  StopServiceState state = StopServiceState::approaching;
  std::optional<std::string> event;
};

class StopController {
 public:
  explicit StopController(StopDefinition definition);

  StopServiceCommand update(const StopServiceInput& input);
  const StopDefinition& definition() const;
  StopServiceState state() const;
  double dwell_elapsed_seconds() const;
  void reset();

 private:
  StopDefinition definition_;
  StopServiceState state_ = StopServiceState::approaching;
  double dwell_elapsed_seconds_ = 0.0;
};

const char* stop_service_state_name(StopServiceState state);

}  // namespace tram
