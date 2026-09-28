#include "tram/core_c_api.h"
#include "tram/simulation_core.hpp"

#include <exception>

namespace {
tram::LiveSimulationCore* core(tram_core_handle handle) {
  return static_cast<tram::LiveSimulationCore*>(handle);
}
}  // namespace

extern "C" {

int tram_core_abi_version(void) { return TRAM_CORE_ABI_VERSION; }

tram_core_handle tram_core_create(void) {
  try {
    return new tram::LiveSimulationCore{};
  } catch (...) {
    return nullptr;
  }
}

void tram_core_destroy(tram_core_handle handle) { delete core(handle); }

void tram_core_reset(tram_core_handle handle) {
  if (handle) core(handle)->reset();
}

int tram_core_step(tram_core_handle handle, double delta_seconds) {
  if (!handle) return 0;
  try {
    core(handle)->step(delta_seconds);
    return 1;
  } catch (...) {
    return 0;
  }
}

int tram_core_set_target_speed(tram_core_handle handle, double speed_mps) {
  if (!handle) return 0;
  core(handle)->set_target_speed(speed_mps);
  return 1;
}

int tram_core_set_paused(tram_core_handle handle, int paused) {
  if (!handle) return 0;
  core(handle)->set_paused(paused != 0);
  return 1;
}

double tram_core_time(tram_core_handle handle) {
  return handle ? core(handle)->simulation_time_seconds() : 0.0;
}

const char* tram_core_snapshot_json(tram_core_handle handle) {
  return handle ? core(handle)->snapshot_json().c_str() : "{}";
}

size_t tram_core_snapshot_size(tram_core_handle handle) {
  return handle ? core(handle)->snapshot_json().size() : 2;
}

double tram_core_vehicle_x(tram_core_handle handle) {
  return handle ? core(handle)->vehicle_x() : 0.0;
}
double tram_core_vehicle_y(tram_core_handle handle) {
  return handle ? core(handle)->vehicle_y() : 0.0;
}
double tram_core_vehicle_speed(tram_core_handle handle) {
  return handle ? core(handle)->vehicle_state().speed_mps : 0.0;
}
double tram_core_vehicle_acceleration(tram_core_handle handle) {
  return handle ? core(handle)->vehicle_state().acceleration_mps2 : 0.0;
}
double tram_core_consumed_wh(tram_core_handle handle) {
  return handle ? core(handle)->consumed_wh() : 0.0;
}
double tram_core_regenerated_wh(tram_core_handle handle) {
  return handle ? core(handle)->regenerated_wh() : 0.0;
}

}  // extern "C"
