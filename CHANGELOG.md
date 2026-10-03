# Changelog

All notable changes to this project are documented here. The format is based on
Keep a Changelog; release labels use semantic version numbers.

## Unreleased

### Changed

- C ABI 12: initialization-only motion/signal/turnout sync, explicit signal
  commands and observations, locked-point interlocks and latched all-red faults.
- Turnout release and inline reset wait for rear clearance; rejected C++ queue
  requests cannot change the TypeScript mirror.

### Added

- Safety invariants documentation, randomized tests, detector-fault injection
  and browser integration checks with native/WASM parity.

- Live time–distance diagram (Bildfahrplan) for bunching, dwell, delay and
  service-recovery analysis.
- Top-level analysis controls for the Bildfahrplan and energy statistics.
- GitHub-ready documentation and contribution metadata.
- Reproducible dependency lockfile and complete CI verification path.
- English documentation for architecture, operations, models, data provenance,
  experiments, hardware integration and research roadmap.
- Visual project-status and research-idea reports.

## 1.0.0 - 2026-09-25

### Added

- Nizhny Novgorod Routes 2 and 21 and İzmir Konak Tram scenarios.
- C++/WebAssembly control authority and native C++ tests.
- Passenger demand, stop dwell, door safety, depots and terminal dispatch.
- Longitudinal dynamics, gradients, curve/turnout profiles and passenger mass.
- Section-level regenerative matching and flywheel storage control.
- Headless deterministic simulation and energy-strategy comparison.
- Installable static PWA and GitHub Pages workflow.
