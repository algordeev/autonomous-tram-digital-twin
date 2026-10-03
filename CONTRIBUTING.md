# Contributing

This repository combines safety logic, transport operations and energy
modelling, so changes should remain small, testable and explicit about
assumptions.

## Development setup

```bash
npm ci
npm run dev
```

Native C++ tests require a C++17 compiler and GNU Make.

## Before opening a pull request

1. Create a focused branch from `main`.
2. Keep generated network JSON synchronized with its TypeScript source.
3. Add or update tests for every behavioural change.
4. Document new parameters, data sources and assumptions.
5. Run `npm run test:all`.
6. Exclude `dist/`, native builds, experiment outputs and environment files.

## Modelling rules

- Use SI units inside the simulation core.
- Distinguish measured, sourced, reconstructed and assumed values.
- Safety authority takes precedence over timetable, headway and energy control.
- Do not change baseline motion during storage-only comparisons.
- Preserve deterministic fixed-step behaviour.
- Document network data provenance in `docs/DATA_AND_ASSUMPTIONS.md`.

## C++ and TypeScript boundary

New control decisions should normally be implemented in C++ and exposed through
the C ABI. Scenario geometry, passenger generation, experiment orchestration and
UI rendering belong in TypeScript. Avoid duplicating authoritative rules on both
sides of the boundary.

Use the supplied issue templates for defects and proposals. Security reports
should follow [SECURITY.md](SECURITY.md).

C++ changes must also pass `npm run verify:wasm`. Run `npm run build:wasm`
and commit the regenerated WASM and TypeScript ABI constant before submitting.
Native tests compile the same source as the browser and replay the WASM scenarios.
