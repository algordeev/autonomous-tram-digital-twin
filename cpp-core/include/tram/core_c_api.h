#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TRAM_CORE_ABI_VERSION 1

typedef void* tram_core_handle;

int tram_core_abi_version(void);
tram_core_handle tram_core_create(void);
void tram_core_destroy(tram_core_handle handle);
void tram_core_reset(tram_core_handle handle);
int tram_core_step(tram_core_handle handle, double delta_seconds);
int tram_core_set_target_speed(tram_core_handle handle, double speed_mps);
int tram_core_set_paused(tram_core_handle handle, int paused);
double tram_core_time(tram_core_handle handle);
const char* tram_core_snapshot_json(tram_core_handle handle);
size_t tram_core_snapshot_size(tram_core_handle handle);
double tram_core_vehicle_x(tram_core_handle handle);
double tram_core_vehicle_y(tram_core_handle handle);
double tram_core_vehicle_speed(tram_core_handle handle);
double tram_core_vehicle_acceleration(tram_core_handle handle);
double tram_core_consumed_wh(tram_core_handle handle);
double tram_core_regenerated_wh(tram_core_handle handle);

#ifdef __cplusplus
}
#endif
