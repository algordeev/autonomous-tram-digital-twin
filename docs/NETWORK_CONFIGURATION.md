# Network Configuration

## Purpose

The browser loads portable network snapshots from `src/config/networks/`. The
format separates route data from the interface and allows the same network to
be used by interactive and headless runs.

`NETWORK_CONFIG_VERSION` is currently 1. `validateNetworkConfig` rejects missing
identifiers, duplicate segment IDs, invalid geometry and references to unknown
segments or substations.

## Top-level structure

| Field | Purpose |
| --- | --- |
| `id`, `name`, `shortName` | Stable machine ID and display names |
| `description`, `sourceLabel`, `operationalNote` | Human-readable scope and provenance |
| `segments` | Directed physical track pieces |
| `routes` | Ordered service paths over segment IDs |
| `stops` | Passenger platforms and service metadata |
| `readers` | RFID-style position/trigger observations |
| `signals` | Tram signal and protected crossing definitions |
| `crossings` | Road geometry and vehicle signal interaction |
| `switches` | Turnout position and branch selection |
| `conflictZones` | Mutually exclusive rail occupancy areas |
| `depots` | Portal, storage and route assignment data |
| `servicePeriods` | Time-dependent fleet and headway plans |
| `tractionPowerSystem` | Voltage, substations, sections and storage banks |

## Track segments

Each segment has a stable ID, directed polyline, physical length and speed
limit. Optional elevation and curve metadata affect physics. Canvas point
distance is not assumed to equal physical metres.

```json
{
  "id": "segment-id",
  "points": [{ "x": 0, "y": 0 }, { "x": 100, "y": 20 }],
  "lengthMeters": 420,
  "speedLimitKmh": 40,
  "elevationChangeMeters": -6
}
```

Routes list segment IDs in exact travel order. Two directions may share
geometry but remain separate directed sequences.

## Stops and readers

Stops identify a route-facing platform point and passenger-service properties.
Readers bind control events to a segment position. A stop trigger and its visual
platform may have different schematic points; the stop offset is chosen so the
vehicle body aligns with the platform when stationary.

## Service periods

A service period selects planned active fleet and headway for a time range. The
dispatcher uses these values as targets, not instantaneous commands. Terminal
departure slots are derived from the active period.

## Traction power

The power system defines nominal voltage, substations and electrical sections.
Every section references a valid substation and a list of track segment IDs.
Flywheel metadata specifies module count, module power/energy, interface
efficiencies and initial SOC.

## Updating a network

1. Edit the TypeScript scenario source.
2. Run the relevant generator under `scripts/`.
3. Run `npm run test:config`.
4. Run the full scenario regression.
5. Document changed evidence or assumptions.
6. Review the rendered route, both travel directions, stops, terminals,
   switches, signals and power-section assignment.

Do not manually change generated JSON without making the source and generation
path consistent.
