#pragma once

namespace tram {

enum class DynamicsMode {
  coast,
  traction,
  service_brake,
  emergency_brake,
};

struct VehicleParameters {
  double mass_kg = 27'500.0;
  double max_traction_force_n = 32'000.0;
  double max_brake_force_n = 52'000.0;
  double max_traction_power_w = 240'000.0;
  double max_acceleration_mps2 = 1.15;
  double service_deceleration_mps2 = 1.25;
  double emergency_deceleration_mps2 = 2.4;
  double max_jerk_mps3 = 0.9;
  double resistance_a_n = 1'100.0;
  double resistance_b_ns_per_m = 32.0;
  double resistance_c_ns2_per_m2 = 2.1;
  double drivetrain_efficiency = 0.88;
  double regeneration_efficiency = 0.86;
  double grid_receptivity = 0.82;
  double auxiliary_power_w = 4'500.0;
};

struct VehicleState {
  double speed_mps = 0.0;
  double acceleration_mps2 = 0.0;
};

struct VehicleCommand {
  double target_speed_mps = 0.0;
  bool emergency_brake = false;
  double grade = 0.0;
};

struct VehicleStepResult : VehicleState {
  double distance_m = 0.0;
  double traction_force_n = 0.0;
  double brake_force_n = 0.0;
  double resistance_force_n = 0.0;
  double consumed_energy_wh = 0.0;
  double traction_energy_wh = 0.0;
  double auxiliary_energy_wh = 0.0;
  double mechanical_brake_energy_wh = 0.0;
  double gross_regenerated_energy_wh = 0.0;
  double regenerated_energy_wh = 0.0;
  double rejected_regeneration_energy_wh = 0.0;
  double downhill_potential_energy_wh = 0.0;
  double climb_potential_energy_wh = 0.0;
  DynamicsMode mode = DynamicsMode::coast;
};

double rolling_resistance_force(double speed_mps,
                                const VehicleParameters& parameters = {});

VehicleStepResult integrate_vehicle_dynamics(
    const VehicleState& state,
    const VehicleCommand& command,
    double delta_seconds,
    const VehicleParameters& parameters = {});

const char* dynamics_mode_name(DynamicsMode mode);

}  // namespace tram
