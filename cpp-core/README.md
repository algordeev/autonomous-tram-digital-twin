# C++ Control Core

This directory contains the portable C++17 control authority and its native
tests. It has no React, DOM or Canvas dependency.

## Build and test

```bash
make test
```

or with CMake:

```bash
cmake -S . -B build-cmake
cmake --build build-cmake
ctest --test-dir build-cmake --output-on-failure
```

## Modules

| Module | Responsibility |
| --- | --- |
| `vehicle_dynamics` | Force, power, jerk, braking and energy integration |
| `service_controller` | Service plans and headway statistics |
| `stop_controller` | Stop approach, dwell and doors |
| `priority_controller` | Tram signal priority |
| `depot_controller` | Depot state and passenger-service transitions |
| `track_graph` | Directed track and turnout graph |
| `core_c_api` | Stable C interface for external runtimes |
| `wasm_live_core` | Freestanding WebAssembly browser authority |

The browser-ready module is generated under `public/wasm/`. See
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the ownership boundary and
[`docs/ru/cpp-core.md`](../docs/ru/cpp-core.md) for the detailed Russian notes.
