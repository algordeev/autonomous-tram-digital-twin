# Documentation

This directory explains the implemented system, the origin of its data and the
limits of the current research model.

## Start here

| Document | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Component boundaries, runtime flow and C++/TypeScript ownership |
| [Feature catalogue](FEATURES.md) | What is implemented and where it is tested |
| [Operations](OPERATIONS.md) | Headways, terminals, passenger service, depots, disruptions and the time–distance diagram |
| [Network configuration](NETWORK_CONFIGURATION.md) | Portable JSON structure and validation rules |
| [Energy model](ENERGY_MODEL.md) | Vehicle dynamics, regeneration, traction sections and flywheels |
| [Data and assumptions](DATA_AND_ASSUMPTIONS.md) | Provenance classes, scenario inventory and known uncertainty |
| [Experiments](EXPERIMENTS.md) | Reproducible headless runs, metrics and benchmark interpretation |
| [Hardware integration](HARDWARE_INTEGRATION.md) | Arduino and hardware-in-the-loop migration boundary |
| [Roadmap](ROADMAP.md) | Calibration, MATLAB/Simulink and publication milestones |

## Russian engineering notes

The original detailed engineering documentation is indexed in
[docs/ru/README.md](ru/README.md). These files are retained because they contain
implementation history and explanations useful to Russian-speaking reviewers.

## Documentation rules

- Code and configuration are authoritative for implemented behaviour.
- Every physical parameter should state units and evidence status.
- Measured, public-source, reconstructed and assumed values must not be mixed.
- Comparative simulator results must not be presented as real-operator savings.
- Changes to the C ABI, JSON configuration or report schema require a version
  note in the relevant document and `CHANGELOG.md`.
