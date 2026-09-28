#pragma once

#include "tram/priority_controller.hpp"
#include "tram/vehicle_dynamics.hpp"

#include <string>

namespace tram {

struct LiveCoreCommand {
  double target_speed_mps = 10.0;
  bool paused = false;
};

class LiveSimulationCore {
 public:
  LiveSimulationCore();

  void reset();
  void step(double delta_seconds);
  void set_command(LiveCoreCommand command);
  void set_target_speed(double speed_mps);
  void set_paused(bool paused);
  double simulation_time_seconds() const;
  double vehicle_x() const;
  double vehicle_y() const;
  const VehicleState& vehicle_state() const;
  double consumed_wh() const;
  double regenerated_wh() const;
  const std::string& snapshot_json();

 private:
  void rebuild_snapshot();

  double time_seconds_ = 0.0;
  double position_m_ = 0.0;
  double consumed_wh_ = 0.0;
  double regenerated_wh_ = 0.0;
  LiveCoreCommand command_{};
  VehicleState vehicle_{};
  PriorityController priority_{};
  std::string snapshot_;
};

}  // namespace tram
