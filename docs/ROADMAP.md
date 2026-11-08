# Roadmap

This roadmap follows the TÜBİTAK 2209-A project plan. Results so far are in
[RESULTS.md](RESULTS.md).

## Done

- **Reproducible headless experiments.** Deterministic C++/WebAssembly core,
  fixed-step headless runner, and scripted studies that record the core runtime
  and the git commit in every result row.
- **Safety oracle and fault injection (simulated).** An independent per-step
  oracle checks collisions, spacing, overtaking, conflict zones, crossings,
  exposed grants and locked points, under seeded detector and switch faults on
  İzmir and Nizhny Novgorod Routes 2 + 21.
- **Disturbance study.** Recovery of the İzmir line from a held tram or a
  passenger surge, with headway regulation on, off and partly off.
- **Energy sensitivity study.** Reactive and predictive wayside flywheels
  against no storage, by time of day, fleet size, storage size and flywheel
  efficiency, with sanity checks.

## Planned stages

### (a) Calibration

- Obtain İzmir vehicle and energy data (vehicle parameters, gradients,
  traction and auxiliary consumption) and calibrate the model against them;
- report energy and peak results with uncertainty ranges instead of single
  values.

### (b) Joint multi-objective optimisation (NSGA-II/III)

- **Decision variables:** ATO speed-profile parameters, interval-regulation
  parameters and flywheel dispatch setpoints.
- **Objectives:** grid energy, instantaneous and 15-min peak power, and headway
  regularity/punctuality.
- **Constraint:** 0 safety-oracle violations.

### (c) Hardware in the loop

- Raspberry Pi as the edge computer (dispatch and optimiser), ESP32 boards as
  the tram and wayside controllers; see
  [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md).
- **Success criteria:**
  - control loop shorter than 50 ms in at least 99% of steps;
  - 0 safety-oracle violations under injected faults;
  - an operator reset procedure with a physical reset button.

### (d) Electrical network model

- DC load flow with cable and rail resistance;
- voltage sag and its limits on regeneration and storage.

### (e) Downgrade emergency braking

- Emergency braking of a full tram on a downgrade, where the level-track case
  already uses 96% of the available brake force.

## Explicitly out of scope for now

- Photorealistic 3D visualization;
- replacement of calibrated traffic simulators;
- claims of safety certification;
- claims of real-operator energy savings without measurements;
- direct control of a full-size tram.
