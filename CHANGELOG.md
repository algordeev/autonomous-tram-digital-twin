# Changelog

All notable changes to this project are documented here. The format is based on
Keep a Changelog; release labels use semantic version numbers.

## Unreleased

### Changed

- C ABI 12: initialization-only motion/signal/turnout sync, explicit signal
  commands and observations, locked-point interlocks and latched all-red faults.
- Turnout release and inline reset wait for rear clearance; rejected C++ queue
  requests cannot change the TypeScript mirror.
- Trams brake to stop points on the approach envelope instead of stopping in
  one 50 ms step: signals, turnout locks, conflict zones and leaders are found
  along the path at least one braking distance ahead. Peak deceleration falls
  from 160-220 m/s² to 6.5 m/s²; trams cover 1-6% less distance per hour.
- Minimum spacing includes the 15 m vehicle: 22 m front to front, with
  brick-wall braking behind a leader.
- Station approach curve compensates for the speed-tracking lag; trams reach
  the platform at about 0.2 m/s instead of 2 m/s.
- A manual tram green clears the road through amber first.
- Manual STOP and hold service-brake through the C++ core.
- Benchmark figures in `docs/EXPERIMENTS.md` regenerated for the new physics.

### Fixed

- Trams overlapped: spacing ignored the vehicle length.
- Conflict-zone occupancy ignored a tram whose rear was still in the zone.
- Speed set by TypeScript (manual STOP, depot exit hold, interlock halts) was
  not passed to the C++ core, which kept the tram moving.
- Switching energy strategy restarted the power subsystem and reported each
  tram's lifetime energy as a single 50 ms pulse (gigawatt peaks).
- A flywheel above 80% charge throttled every accelerating tram.
- The second İzmir terminal platform was unusable: arriving trams waited
  behind the tram at the other platform, and a departing tram could wait for
  its neighbour. In a 3-hour run, on-time departures rose from 84% to 92%.
- The dashboard reported a 0 m headway for trams side by side at İzmir
  terminals.

### Added

- `npm run benchmark:energy` regenerates the energy benchmark table, and with
  `--write-chart` its chart.
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
