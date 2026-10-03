# C++ Control Core

`src/operational_core.cpp` is the single C++17 implementation compiled for both
native tests and the browser. The obsolete ABI 1 controllers and standalone
native replay demo have been removed. Browser and TypeScript headless scenarios
continue to use their existing orchestration.

## Build and test

From the repository root, after `npm ci`:

```bash
npm run build:wasm
npm run verify:wasm
npm run test:cpp
```

`build:wasm` uses the exact `browsercc` version in the npm lockfile, including its
Clang, LLD and sysroot, on every platform. It generates the import-free
`public/wasm/tram-core.wasm` and the TypeScript ABI constant. `verify:wasm`
rebuilds in memory and fails if either committed artifact differs, without
rewriting them. Commit both generated files after a core change. CI and Pages
check reproducibility before using the binary. `scripts/build-wasm.sh` delegates
to this same build; it no longer generates an incompatible Emscripten wrapper.

Native tests require a C++17 compiler, Node.js and Make:

```bash
make -C cpp-core test
```

CMake also builds the same implementation and runs both native and parity tests:

```bash
cmake -S cpp-core -B cpp-core/build-cmake -DCMAKE_BUILD_TYPE=Release
cmake --build cpp-core/build-cmake
ctest --test-dir cpp-core/build-cmake --output-on-failure
```

## Contract and coverage

`include/tram/core_c_api.h` declares the complete ABI 12. The WASM export list,
native test transport and generated TypeScript ABI version derive from it.
The core owns motion, braking, energy, station phases, signals, switch locks,
headway constraints, depot transitions and power-section balancing.

`tests/operational_core_test.cpp` tests the production implementation directly.
`../tests/wasm-core.test.mjs` checks the binary exports and runs operational
scenarios. With the native bridge enabled, each scenario records every WASM call
and replays it in a fresh native process, comparing every result with a relative
and absolute tolerance of 1e-9. This checks cross-target agreement as well as the
scenario assertions; it does not claim exhaustive coverage of all inputs.

ABI 12 uses singleton state per native process or WebAssembly instance. Handles
are tokens, not independent allocations. Each authority subsystem resets with
its `*_begin` function. This change preserves those semantics.

`include/tram/control_parameters.hpp` names the 1.25 m/s² physical service-brake
limit separately from the conservative 0.72 m/s² approach envelope needed for
jerk-limited stopping. The initial 12-second door dwell is a named default;
passenger and terminal extensions arrive through `tram_core_station_sync`.
Square roots use the compiler builtin (native sqrt / WASM f64.sqrt), rather than
an iteration-limited approximation.

See [Architecture](../docs/ARCHITECTURE.md) and
[Russian core guide](../docs/ru/cpp-core.md).

## Interlocks and faults

ABI 12 makes motion/signal/turnout sync initialization-only and adds explicit
signal manual-command and detector-observation functions. Locked turnouts
ignore control-mode bypasses. Missing clearance latches all-red without
releasing the owner. See [Safety invariants](../docs/SAFETY_INVARIANTS.md).
