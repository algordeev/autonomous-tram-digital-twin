#include "tram/service_controller.hpp"

#include <algorithm>
#include <numeric>
#include <stdexcept>
#include <utility>

namespace tram {

ServiceController::ServiceController(ServicePlan plan,
                                     double scheduled_start_seconds)
    : plan_(std::move(plan)),
      scheduled_start_seconds_(scheduled_start_seconds) {
  if (plan_.id.empty() || plan_.route.empty() || plan_.direction.empty()) {
    throw std::invalid_argument("service plan identity must not be empty");
  }
  if (plan_.fleet_size == 0 || plan_.planned_headway_seconds <= 0.0 ||
      plan_.nominal_spacing_m <= 0.0 || plan_.normal_speed_mps <= 0.0 ||
      plan_.recovery_speed_mps < plan_.normal_speed_mps ||
      scheduled_start_seconds_ < 0.0) {
    throw std::invalid_argument("service plan values are invalid");
  }
}

ServiceCommand ServiceController::update(const ServiceInput& input) const {
  if (input.simulation_time_seconds + 1e-9 < scheduled_start_seconds_) {
    return {false, 0.0, RegulationState::scheduled_hold};
  }

  if (!input.same_service_gap_m.has_value()) {
    return {true, plan_.normal_speed_mps, RegulationState::on_time};
  }

  const double ratio =
      std::max(0.0, input.same_service_gap_m.value()) / plan_.nominal_spacing_m;
  if (ratio < 0.90) {
    const double factor = std::clamp(0.35 + ratio * 0.65, 0.35, 0.94);
    return {true, plan_.normal_speed_mps * factor,
            RegulationState::holding_spacing};
  }
  if (ratio > 1.12) {
    return {true, plan_.recovery_speed_mps,
            RegulationState::recovering_interval};
  }
  return {true, plan_.normal_speed_mps, RegulationState::on_time};
}

const ServicePlan& ServiceController::plan() const { return plan_; }

double ServiceController::scheduled_start_seconds() const {
  return scheduled_start_seconds_;
}

HeadwayStatistics::HeadwayStatistics(std::size_t rolling_window)
    : rolling_window_(rolling_window) {
  if (rolling_window_ == 0) {
    throw std::invalid_argument("headway rolling window must be positive");
  }
}

void HeadwayStatistics::record_departure(double simulation_time_seconds) {
  if (previous_departure_.has_value()) {
    intervals_.push_back(
        std::max(0.0, simulation_time_seconds - previous_departure_.value()));
    while (intervals_.size() > rolling_window_) intervals_.pop_front();
  }
  previous_departure_ = simulation_time_seconds;
  ++departure_count_;
}

std::optional<double> HeadwayStatistics::actual_average_seconds() const {
  if (intervals_.empty()) return std::nullopt;
  const double total =
      std::accumulate(intervals_.begin(), intervals_.end(), 0.0);
  return total / static_cast<double>(intervals_.size());
}

std::size_t HeadwayStatistics::departure_count() const {
  return departure_count_;
}

const char* regulation_state_name(RegulationState state) {
  switch (state) {
    case RegulationState::scheduled_hold:
      return "scheduled_hold";
    case RegulationState::on_time:
      return "on_time";
    case RegulationState::holding_spacing:
      return "holding_spacing";
    case RegulationState::recovering_interval:
      return "recovering_interval";
  }
  return "unknown";
}

}  // namespace tram
