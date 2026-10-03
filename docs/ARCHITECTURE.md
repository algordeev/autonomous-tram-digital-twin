# Architecture

## Design goal

The application is divided so that the visual interface is replaceable without
rewriting the deterministic control authority. The browser is currently the
main demonstration environment, but the same boundary supports native tests,
headless experiments and future physical telemetry.

## Runtime layers

| Layer | Technology | Owns |
| --- | --- | --- |
| Interface | React and Canvas | Rendering, panels, map navigation and operator input |
| Orchestration | TypeScript | Scenario binding, passenger demand, ETA, service plans, logging and experiments |
| Control authority | C++17 compiled to WebAssembly | Motion authority, braking, energy, signals, stops, doors, turnouts, headway constraints and depot state |
| Portable data | Versioned JSON | Tracks, routes, stops, readers, signals, depots and traction sections |

The current browser contract is C ABI version 11. The adapter is implemented in
`src/simulation-core/cpp-runtime.ts`; the exported interface is declared in
`cpp-core/include/tram/core_c_api.h`.

## Simulation flow

1. A network JSON file is validated by `network-config.ts`.
2. `SimulationEngine` creates vehicles, service plans, passengers and power
   sections.
3. A fixed-step clock converts browser frames into 50 ms simulation steps.
4. TypeScript supplies observations and scenario context to the C++ authority.
5. C++ returns safe movement, stop, door, turnout, depot and energy decisions.
6. TypeScript advances passengers and assembles immutable render snapshots.
7. React and Canvas display the snapshot and never become the source of truth.

## Source boundaries

### `src/simulation-core`

- `engine.ts`: integrated network simulation and render snapshots;
- `fixed-step-clock.ts`: deterministic time stepping;
- `cpp-runtime.ts`: C ABI and WebAssembly adapter;
- `vehicle-dynamics.ts`: documented TypeScript reference/fallback dynamics;
- `passenger-model.ts`: queue, boarding and alighting model;
- `traction-power.ts`: electrical section reconstruction helpers;
- `headless.ts`: non-visual simulation and energy comparisons;
- `network-config.ts`: JSON loading and validation.

### `cpp-core`

- `src/operational_core.cpp`: shared native and WASM operational authority;
- `include/tram/core_c_api.h`: complete ABI 11 declarations and export manifest;
- `include/tram/control_parameters.hpp`: named physical and approach settings;
- `scripts/compile-portable-wasm.mjs`: pinned portable Clang/LLD build;
- `scripts/generate-native-bridge.mjs`: generated test transport, without control logic;
- `tests/operational_core_test.cpp`: native checks of the production source.

The former ABI 1 modular prototype and its native replay demo were retired.
There is no second C++ implementation selected only by tests.

## Determinism

The engine uses a fixed 50 ms control step. Headless runs use the same engine
and can therefore compare strategies under identical initial state, service
clock and disturbances. Random processes must use an explicit seeded source if
introduced in future work.

## Build artifacts

`public/wasm/tram-core.wasm` is committed so ordinary web builds need no system
C++ or Emscripten installation. `npm run build:wasm` rebuilds it with the exact
`browsercc` compiler and sysroot version locked in npm and generates the adapter
ABI constant from the C header. `npm run verify:wasm` performs a fresh build and
requires byte-for-byte equality with the committed binary and ABI constant.
Both CI and Pages run this check before building the web application.

Make and CMake compile the same `operational_core.cpp` as a native library.
The native test bridge replays the WASM regression scenarios and compares every
call result. This validates the production source across both targets; the
separate TypeScript reference/fallback remains explicitly labelled as such.

## Safety boundary

The project demonstrates logic; it is not certified railway software. Physical
deployment requires independent sensing, fail-safe outputs, redundancy, hazard
analysis and compliance with applicable railway standards.
