#include "tram/core_c_api.h"

#include <cassert>
#include <cstring>
#include <iostream>

int main() {
  assert(tram_core_abi_version() == TRAM_CORE_ABI_VERSION);
  const auto handle = tram_core_create();
  assert(handle != nullptr);
  assert(tram_core_time(handle) == 0.0);
  assert(tram_core_set_target_speed(handle, 12.0) == 1);
  for (int tick = 0; tick < 100; ++tick) {
    assert(tram_core_step(handle, 0.05) == 1);
  }
  assert(tram_core_time(handle) > 4.99);
  const double before_pause = tram_core_time(handle);
  assert(tram_core_set_paused(handle, 1) == 1);
  assert(tram_core_step(handle, 0.1) == 1);
  assert(tram_core_time(handle) == before_pause);
  assert(tram_core_set_paused(handle, 0) == 1);
  const size_t snapshot_size = tram_core_snapshot_size(handle);
  const char* snapshot = tram_core_snapshot_json(handle);
  assert(std::strstr(snapshot, "\"abiVersion\":1") != nullptr);
  assert(std::strstr(snapshot, "tram_live_01") != nullptr);
  assert(snapshot_size == std::strlen(snapshot));
  tram_core_reset(handle);
  assert(tram_core_time(handle) == 0.0);
  assert(tram_core_step(handle, 0.0) == 0);
  tram_core_destroy(handle);
  std::cout << "core_c_api_test: OK\n";
}
