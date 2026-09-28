#include "tram/vehicle_dynamics.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

namespace {

void test_acceleration_and_power_limits() {
  tram::VehicleState state{};
  for (int i = 0; i < 200; ++i) {
    const auto step = tram::integrate_vehicle_dynamics(
        state, tram::VehicleCommand{20.0, false, 0.0}, 0.1);
    assert(step.acceleration_mps2 <= 1.15 + 1e-9);
    assert(step.traction_force_n <= 32'000.0 + 1e-9);
    state = {step.speed_mps, step.acceleration_mps2};
  }
  assert(state.speed_mps > 0.0);
}

void test_service_braking_regenerates_energy() {
  const auto step = tram::integrate_vehicle_dynamics(
      tram::VehicleState{12.0, 0.0},
      tram::VehicleCommand{0.0, false, 0.0}, 0.5);
  assert(step.mode == tram::DynamicsMode::service_brake);
  assert(step.brake_force_n > 0.0);
  assert(step.gross_regenerated_energy_wh > 0.0);
  assert(step.regenerated_energy_wh > 0.0);
  assert(step.regenerated_energy_wh < step.gross_regenerated_energy_wh);
}

void test_downhill_energy_is_accounted() {
  const auto step = tram::integrate_vehicle_dynamics(
      tram::VehicleState{10.0, 0.0},
      tram::VehicleCommand{8.0, false, -0.02}, 0.5);
  assert(step.downhill_potential_energy_wh > 0.0);
  assert(step.climb_potential_energy_wh == 0.0);
}

void test_invalid_step_is_rejected() {
  bool thrown = false;
  try {
    static_cast<void>(tram::integrate_vehicle_dynamics({}, {}, 0.0));
  } catch (const std::invalid_argument&) {
    thrown = true;
  }
  assert(thrown);
}

}  // namespace

int main() {
  test_acceleration_and_power_limits();
  test_service_braking_regenerates_energy();
  test_downhill_energy_is_accounted();
  test_invalid_step_is_rejected();
  std::cout << "vehicle_dynamics_test: all checks passed\n";
}
