#include "tram/vehicle_dynamics.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace tram {
namespace {

double clamp(double value, double minimum, double maximum) {
  return std::min(maximum, std::max(minimum, value));
}

}  // namespace

double rolling_resistance_force(double speed_mps,
                                const VehicleParameters& parameters) {
  const double speed = std::max(0.0, speed_mps);
  return parameters.resistance_a_n +
         parameters.resistance_b_ns_per_m * speed +
         parameters.resistance_c_ns2_per_m2 * speed * speed;
}

VehicleStepResult integrate_vehicle_dynamics(
    const VehicleState& state,
    const VehicleCommand& command,
    double delta_seconds,
    const VehicleParameters& parameters) {
  if (!(delta_seconds > 0.0)) {
    throw std::invalid_argument("delta_seconds must be positive");
  }

  const double speed = std::max(0.0, state.speed_mps);
  const double target_speed = std::max(0.0, command.target_speed_mps);
  const double speed_error = target_speed - speed;
  const double current_acceleration =
      speed <= 1e-6 && speed_error > 0.0
          ? std::max(0.0, state.acceleration_mps2)
          : state.acceleration_mps2;
  const bool emergency = command.emergency_brake && speed_error < 0.0;
  const double deceleration_limit =
      emergency ? parameters.emergency_deceleration_mps2
                : parameters.service_deceleration_mps2;
  const double desired_acceleration =
      emergency
          ? -parameters.emergency_deceleration_mps2
          : clamp(speed_error / 1.4, -deceleration_limit,
                  parameters.max_acceleration_mps2);
  const double jerk_step = parameters.max_jerk_mps3 * delta_seconds;
  const double requested_acceleration =
      clamp(desired_acceleration, current_acceleration - jerk_step,
            current_acceleration + jerk_step);
  const double resistance_force =
      rolling_resistance_force(speed, parameters);
  const double grade = clamp(command.grade, -0.12, 0.12);
  const double grade_force = parameters.mass_kg * 9.80665 * grade;

  double traction_force = 0.0;
  double brake_force = 0.0;
  double acceleration = requested_acceleration;
  DynamicsMode mode = DynamicsMode::coast;
  const double force_for_acceleration =
      parameters.mass_kg * requested_acceleration + resistance_force +
      grade_force;

  if (force_for_acceleration >= 0.0) {
    const double power_limited_force =
        parameters.max_traction_power_w / std::max(speed, 1.0);
    traction_force =
        std::min({force_for_acceleration, parameters.max_traction_force_n,
                  power_limited_force});
    acceleration =
        (traction_force - resistance_force - grade_force) / parameters.mass_kg;
    if (traction_force > resistance_force + 1.0) {
      mode = DynamicsMode::traction;
    }
  } else {
    brake_force =
        std::min(parameters.max_brake_force_n, -force_for_acceleration);
    acceleration =
        (-brake_force - resistance_force - grade_force) / parameters.mass_kg;
    mode = emergency ? DynamicsMode::emergency_brake
                     : DynamicsMode::service_brake;
  }

  double next_speed = std::max(0.0, speed + acceleration * delta_seconds);
  if ((speed_error >= 0.0 && next_speed > target_speed) ||
      (speed_error < 0.0 && next_speed < target_speed)) {
    next_speed = target_speed;
    acceleration = (next_speed - speed) / delta_seconds;
  }

  const double average_speed = (speed + next_speed) / 2.0;
  const double distance = average_speed * delta_seconds;
  const double traction_energy =
      ((traction_force * average_speed) / parameters.drivetrain_efficiency) *
      delta_seconds / 3600.0;
  const double auxiliary_energy =
      parameters.auxiliary_power_w * delta_seconds / 3600.0;
  const double mechanical_brake_energy =
      brake_force * average_speed * delta_seconds / 3600.0;
  const double gross_regenerated_energy =
      mechanical_brake_energy * parameters.regeneration_efficiency;
  const double regenerated_energy =
      gross_regenerated_energy * parameters.grid_receptivity;
  const double gravitational_energy =
      std::abs(grade_force) * average_speed * delta_seconds / 3600.0;

  return {
      next_speed,
      acceleration,
      distance,
      traction_force,
      brake_force,
      resistance_force,
      traction_energy + auxiliary_energy,
      traction_energy,
      auxiliary_energy,
      mechanical_brake_energy,
      gross_regenerated_energy,
      regenerated_energy,
      std::max(0.0, mechanical_brake_energy - regenerated_energy),
      grade < 0.0 ? gravitational_energy : 0.0,
      grade > 0.0 ? gravitational_energy : 0.0,
      mode,
  };
}

const char* dynamics_mode_name(DynamicsMode mode) {
  switch (mode) {
    case DynamicsMode::coast:
      return "coast";
    case DynamicsMode::traction:
      return "traction";
    case DynamicsMode::service_brake:
      return "service-brake";
    case DynamicsMode::emergency_brake:
      return "emergency-brake";
  }
  return "coast";
}

}  // namespace tram
