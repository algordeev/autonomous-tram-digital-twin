#pragma once

#include <cstddef>
#include <deque>
#include <optional>
#include <string>

namespace tram {

enum class RegulationState {
  scheduled_hold,
  on_time,
  holding_spacing,
  recovering_interval,
};

struct ServicePlan {
  std::string id;
  std::string route;
  std::string direction;
  std::size_t fleet_size = 1;
  double planned_headway_seconds = 180.0;
  double nominal_spacing_m = 120.0;
  double normal_speed_mps = 10.5;
  double recovery_speed_mps = 11.5;
};

struct ServiceInput {
  double simulation_time_seconds = 0.0;
  std::optional<double> same_service_gap_m;
};

struct ServiceCommand {
  bool dispatch_allowed = false;
  double target_speed_mps = 0.0;
  RegulationState state = RegulationState::scheduled_hold;
};

class ServiceController {
 public:
  ServiceController(ServicePlan plan, double scheduled_start_seconds);

  ServiceCommand update(const ServiceInput& input) const;
  const ServicePlan& plan() const;
  double scheduled_start_seconds() const;

 private:
  ServicePlan plan_;
  double scheduled_start_seconds_ = 0.0;
};

class HeadwayStatistics {
 public:
  explicit HeadwayStatistics(std::size_t rolling_window = 5);

  void record_departure(double simulation_time_seconds);
  std::optional<double> actual_average_seconds() const;
  std::size_t departure_count() const;

 private:
  std::size_t rolling_window_ = 5;
  std::optional<double> previous_departure_;
  std::deque<double> intervals_;
  std::size_t departure_count_ = 0;
};

const char* regulation_state_name(RegulationState state);

}  // namespace tram
