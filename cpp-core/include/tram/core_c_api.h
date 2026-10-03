#pragma once

// Canonical ABI shared by the native core, WASM build and test bridge.
#define TRAM_CORE_ABI_VERSION 12
#ifdef __cplusplus
extern "C" {
#endif

// ABI 12 is a singleton per process / WebAssembly instance. Handles are tokens,
// not separately allocated simulations. Authority subsystems reset via *_begin.
typedef void *tram_core_handle;
int tram_core_abi_version(void);
double tram_core_uniform_headway(double, int, double);
double tram_core_headway_speed_factor(double, double, double);
int tram_core_terminal_interval_hold(double, double);
int tram_core_terminal_berth(int);
int tram_core_parallel_terminal_bypass(int, int);
double tram_core_departure_slot(double, double, double, double);
int tram_core_departure_on_time(double, double);
int tram_core_authority_begin(int);
int tram_core_power_begin(int, int, int);
int tram_core_power_configure_section(int, double);
int tram_core_power_configure_flywheel(int, int, double, double, double, double,
                                       double);
int tram_core_power_set_strategy(int);
double tram_core_power_target(int, int, int, int, double, double, double);
int tram_core_power_guidance(int);
int tram_core_power_sync_vehicle(int, int, double, double, double, double,
                                 double);
int tram_core_power_step(double);
int tram_core_power_section_flywheel_mode(int);
double tram_core_power_vehicle_accepted(int);
double tram_core_power_vehicle_rejected(int);
double tram_core_power_network_peak(void);
int tram_core_power_interventions(void);
int tram_core_signal_begin(int);
int tram_core_switch_begin(int);
int tram_core_switch_sync(int, int, int);
int tram_core_switch_toggle(int, int);
int tram_core_switch_request(int, int, int, int);
int tram_core_switch_release(int, int);
int tram_core_switch_state(int);
int tram_core_switch_locked_by(int);
int tram_core_signal_sync(int, int, double, int, int, int, int, double, int,
                          int, int);
// Sync is initialization only. Commands and detector observations cannot import
// a replacement grant or erase occupancy. Phase 4 is a latched all-red fault.
int tram_core_signal_manual(int, int, int);
int tram_core_signal_observe(int, int, int, int, double);
int tram_core_signal_fault(int);
int tram_core_signal_step(int, double, int, int, int, int, double, double,
                          double, double);
int tram_core_signal_phase(int);
double tram_core_signal_until(int);
int tram_core_signal_active_tram(int);
int tram_core_signal_active_signal(int);
int tram_core_signal_entered(int);
int tram_core_signal_cleared(int);
double tram_core_signal_granted_at(int);
int tram_core_signal_pending(int);
int tram_core_signal_event(int);
int tram_core_authority_sync(int, double, double, double, double, double,
                             double, double, double, double, double, double);
int tram_core_authority_override_motion(int, double, double);
int tram_core_station_sync(int, int, double);
int tram_core_station_step(int, double, int, int);
int tram_core_station_phase(int);
double tram_core_station_until(int);
int tram_core_station_event(int);
int tram_core_depot_sync(int, int);
int tram_core_depot_command(int, int);
int tram_core_depot_observe(int, int, int, int, int);
int tram_core_depot_state(int);
double tram_core_speed_profile_target(double, double, double, double, double,
                                      double);
double tram_core_predictive_eco_target(int, int, double, double, double, double,
                                       double, double, double);
int tram_core_authority_step(int, double, int, double, double, double);
double tram_core_station_approach_speed(double, double);
double tram_core_resolve_target_speed(double, int, int, int, int, double, int);
double tram_core_safe_move(double, double, double, double);
int tram_core_authority_mode(int);
int tram_core_authority_eco_mode(int);
void *tram_core_create(void);
void tram_core_destroy(void *);
void tram_core_reset(void *);
int tram_core_set_paused(void *, int);
int tram_core_begin_network(void *, int, int, int);
int tram_core_route_meta(void *, int, int, int);
int tram_core_add_route_point(void *, int, double, double);
int tram_core_configure_zone(void *, int, double);
int tram_core_set_zone_route(void *, int, int, double);
int tram_core_configure_tram(void *, int, int, double);
int tram_core_set_target_speed(void *, double);
int tram_core_set_tram_manual(void *, int, int, int);
int tram_core_set_tram_service(void *, int, int);
int tram_core_step(void *, double);
double tram_core_time(void *);
int tram_core_tram_count(void *);
double tram_core_vehicle_x_at(void *, int);
double tram_core_vehicle_y_at(void *, int);
double tram_core_vehicle_speed_at(void *, int);
double tram_core_vehicle_acceleration_at(void *, int);
double tram_core_vehicle_distance_at(void *, int);
double tram_core_consumed_wh_at(void *, int);
double tram_core_regenerated_wh_at(void *, int);
int tram_core_vehicle_route_at(void *, int);
int tram_core_vehicle_service_at(void *, int);
int tram_core_zone_owner(void *, int);
// Bit 1: multiple trams in a geometric conflict zone. Bit 2: entered
// reservation exposed to a conflicting phase. Zero means both checks pass.
int tram_core_safety_invariants(void);
double tram_core_vehicle_x(void *);
double tram_core_vehicle_y(void *);
double tram_core_vehicle_speed(void *);
double tram_core_vehicle_acceleration(void *);
double tram_core_consumed_wh(void *);
double tram_core_regenerated_wh(void *);
double tram_core_power_section_traction(int);
double tram_core_power_section_regeneration(int);
double tram_core_power_section_reused(int);
double tram_core_power_section_grid(int);
double tram_core_power_section_reused_wh(int);
double tram_core_power_section_grid_wh(int);
double tram_core_power_section_rejected_wh(int);
double tram_core_power_section_peak(int);
double tram_core_power_section_flywheel_energy(int);
double tram_core_power_section_flywheel_capacity(int);
double tram_core_power_section_flywheel_charge_power(int);
double tram_core_power_section_flywheel_discharge_power(int);
double tram_core_power_section_flywheel_charged_wh(int);
double tram_core_power_section_flywheel_discharged_wh(int);
double tram_core_power_section_flywheel_losses_wh(int);
double tram_core_power_section_forecast_traction(int);
double tram_core_power_section_forecast_regeneration(int);
double tram_core_power_section_flywheel_target_grid(int);
double tram_core_authority_speed(int);
double tram_core_authority_acceleration(int);
double tram_core_authority_distance(int);
double tram_core_authority_traction_force(int);
double tram_core_authority_brake_force(int);
double tram_core_authority_resistance_force(int);
double tram_core_authority_consumed(int);
double tram_core_authority_traction_energy(int);
double tram_core_authority_auxiliary_energy(int);
double tram_core_authority_mechanical_brake(int);
double tram_core_authority_gross_regenerated(int);
double tram_core_authority_regenerated(int);
double tram_core_authority_rejected(int);
double tram_core_authority_downhill(int);
double tram_core_authority_climb(int);

#ifdef __cplusplus
}
#endif
