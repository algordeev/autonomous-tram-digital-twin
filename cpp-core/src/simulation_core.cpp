#include "tram/simulation_core.hpp"
#include "tram/core_c_api.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace tram {

LiveSimulationCore::LiveSimulationCore() { reset(); }

void LiveSimulationCore::reset() {
  time_seconds_ = 0.0;
  position_m_ = 0.0;
  consumed_wh_ = 0.0;
  regenerated_wh_ = 0.0;
  vehicle_ = {};
  command_ = {};
  priority_.reset();
  rebuild_snapshot();
}

void LiveSimulationCore::step(double delta_seconds) {
  if (!(delta_seconds > 0.0) || delta_seconds > 1.0) {
    throw std::invalid_argument("delta_seconds must be in (0, 1]");
  }
  if (command_.paused) {
    rebuild_snapshot();
    return;
  }
  time_seconds_ += delta_seconds;
  const double loop_position = std::fmod(position_m_, 500.0);
  const double crossing_distance = loop_position <= 250.0
                                       ? 250.0 - loop_position
                                       : 750.0 - loop_position;
  const bool inside = crossing_distance < 12.0;
  const auto junction = priority_.update(
      {time_seconds_, crossing_distance < 85.0
                          ? std::optional<double>{crossing_distance}
                          : std::nullopt,
       std::nullopt, inside, crossing_distance > 16.0});
  const double signal_target =
      !junction.tram_allowed && crossing_distance < 60.0 && !inside
          ? 0.0
          : command_.target_speed_mps;
  const auto result = integrate_vehicle_dynamics(
      vehicle_, {signal_target, false, 0.0}, delta_seconds);
  vehicle_ = {result.speed_mps, result.acceleration_mps2};
  position_m_ += result.distance_m;
  consumed_wh_ += result.consumed_energy_wh;
  regenerated_wh_ += result.regenerated_energy_wh;
  rebuild_snapshot();
}

void LiveSimulationCore::set_command(LiveCoreCommand command) {
  command.target_speed_mps = std::clamp(command.target_speed_mps, 0.0, 22.0);
  command_ = command;
}

void LiveSimulationCore::set_target_speed(double speed_mps) {
  command_.target_speed_mps = std::clamp(speed_mps, 0.0, 22.0);
}

void LiveSimulationCore::set_paused(bool paused) { command_.paused = paused; }

double LiveSimulationCore::simulation_time_seconds() const {
  return time_seconds_;
}

double LiveSimulationCore::vehicle_x() const {
  const double loop_position = std::fmod(position_m_, 500.0);
  return loop_position <= 250.0 ? loop_position - 125.0
                                : 375.0 - loop_position;
}

double LiveSimulationCore::vehicle_y() const {
  return std::fmod(position_m_, 500.0) <= 250.0 ? -18.0 : 18.0;
}

const VehicleState& LiveSimulationCore::vehicle_state() const { return vehicle_; }
double LiveSimulationCore::consumed_wh() const { return consumed_wh_; }
double LiveSimulationCore::regenerated_wh() const { return regenerated_wh_; }

const std::string& LiveSimulationCore::snapshot_json() {
  rebuild_snapshot();
  return snapshot_;
}

void LiveSimulationCore::rebuild_snapshot() {
  const double loop_position = std::fmod(position_m_, 500.0);
  const double x = loop_position <= 250.0 ? loop_position - 125.0
                                          : 375.0 - loop_position;
  const double y = loop_position <= 250.0 ? -18.0 : 18.0;
  std::ostringstream output;
  output << std::fixed << std::setprecision(3)
         << "{\"schemaVersion\":1,\"abiVersion\":"
         << TRAM_CORE_ABI_VERSION << ",\"time\":" << time_seconds_
         << ",\"paused\":" << (command_.paused ? "true" : "false")
         << ",\"vehicle\":{\"id\":\"tram_live_01\",\"x\":" << x
         << ",\"y\":" << y << ",\"speedMps\":" << vehicle_.speed_mps
         << ",\"accelerationMps2\":" << vehicle_.acceleration_mps2
         << "},\"energy\":{\"consumedWh\":" << consumed_wh_
         << ",\"regeneratedWh\":" << regenerated_wh_ << "}}";
  snapshot_ = output.str();
}

}  // namespace tram
