#include "tram/service_controller.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
  const tram::ServicePlan plan{"R2-CW", "2", "clockwise", 2, 180.0, 120.0,
                               10.0, 11.5};
  const tram::ServiceController controller(plan, 30.0);

  const auto scheduled = controller.update({29.9, std::nullopt});
  assert(!scheduled.dispatch_allowed);
  assert(scheduled.target_speed_mps == 0.0);
  assert(scheduled.state == tram::RegulationState::scheduled_hold);

  const auto free = controller.update({30.0, std::nullopt});
  assert(free.dispatch_allowed);
  assert(free.target_speed_mps == 10.0);

  const auto close = controller.update({60.0, 55.0});
  assert(close.state == tram::RegulationState::holding_spacing);
  assert(close.target_speed_mps < plan.normal_speed_mps);

  const auto late = controller.update({60.0, 155.0});
  assert(late.state == tram::RegulationState::recovering_interval);
  assert(late.target_speed_mps == plan.recovery_speed_mps);

  tram::HeadwayStatistics first_direction;
  tram::HeadwayStatistics opposite_direction;
  first_direction.record_departure(100.0);
  first_direction.record_departure(286.0);
  opposite_direction.record_departure(140.0);
  assert(std::abs(first_direction.actual_average_seconds().value() - 186.0) <
         1e-9);
  assert(!opposite_direction.actual_average_seconds().has_value());

  std::cout << "service_controller_test: all checks passed\n";
}
