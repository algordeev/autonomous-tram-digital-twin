# Roadmap

## Stage 1 Repository and reproducibility

- Public repository structure and bilingual documentation;
- dependency lockfile and continuous integration;
- reproducible headless experiments;
- published parameter and data-provenance register;
- versioned release archive.

## Stage 2 Calibration

- Record prototype speed, position, PWM, current and voltage;
- identify resistance, traction and braking parameters;
- calibrate stop approach and energy against measurements;
- obtain or estimate İzmir gradient and vehicle data;
- add uncertainty ranges to reported energy results.

## Stage 3 MATLAB and Simulink reference models

- Longitudinal vehicle reference model;
- 600/750 V DC power-flow model with line resistance and voltage sag;
- flywheel/converter efficiency and power-limit maps;
- identical JSON scenario runner;
- automated error comparison against C++/WASM output.

MATLAB remains a validation and identification environment rather than a
mandatory runtime dependency for the web application.

## Stage 4 Research experiments

- Passenger-energy trade-off in headway regulation;
- predictive acceleration/braking coordination inside electrical sections;
- robust SOC control under uncertain demand and disturbances;
- storage sizing by section;
- repeated experiments with statistical confidence intervals.

## Stage 5 Hardware in the loop

- Versioned telemetry protocol;
- Arduino/edge adapter for the shared C++ authority;
- synchronized physical/virtual state;
- fault injection and safety-invariant testing;
- public demonstration dataset and reproducibility package.

## Stage 6 Engineering maturity

- Detailed interlocking and formal safety invariants;
- automatic scenario validation and schema generation;
- calibrated passenger and road-traffic inputs;
- external model comparison with SUMO/OpenTrack where useful;
- release DOI and archived research datasets.

## Explicitly out of scope for now

- Photorealistic 3D visualization;
- replacement of calibrated traffic simulators;
- claims of safety certification;
- claims of real-operator energy savings without measurements;
- direct control of a full-size tram.
