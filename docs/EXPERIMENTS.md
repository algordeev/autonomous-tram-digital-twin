# Experiments and Metrics

## Headless simulation

Run a deterministic scenario without the interface:

```bash
npm run simulate:headless -- \
  --scenario nizhny-routes-2-21 \
  --tram-count 12 \
  --duration-hours 1 \
  --start-minute 480 \
  --sample-seconds 60 \
  --output outputs/nizhny-0800.json
```

On a network with fleet groups, `--tram-count` is spread over the groups, so
the trams keep their groups' start positions, directions and routes.

The report schema is versioned as `schemaVersion: 1` and contains:

- the core that ran it (`coreRuntime`: `cpp-wasm`, as in the browser, or
  `typescript-fallback`, which does not simulate the traction-power network);
- requested and simulated duration;
- start/end service clock;
- final network metrics;
- route-level operations;
- energy statistics;
- event counts;
- periodic samples.

Taking a snapshot is not free of side effects: it brings every stop's
passenger queue up to date, and the queue integrates arrivals with the rate of
its previous update, so extra snapshots change later boarding and therefore the
run. A `--sample-seconds` run is deterministic but not identical to an
unsampled one. The energy comparison samples its window through a
side-effect-free path instead (`getServiceSample`, `getNetworkGridPowerKw`).

## Energy comparison

`runEnergyComparison` executes three identical service cases:

1. no wayside storage;
2. reactive flywheel storage;
3. predictive: the same flywheel dispatch plus peak-limiting traction guidance.

Each case uses the network's configured fleet (its fleet groups, start
positions and directions), runs a warm-up, and is measured over a following
window only, so the start-up wave of every tram leaving its start position is
not what is compared. The peak is the network grid-power peak inside that
window.

Energy left in the flywheels when the window ends is not yet a saving, and a
bank drained during the window was not free, so grid energy is corrected by
the change in stored energy: a gain is credited at the discharge efficiency
(what it will later displace), a loss is charged at the charge efficiency (what
it costs to restore). Energy saving then uses grid energy per
vehicle-kilometre, so small strategy-dependent distance differences do not
bias the comparison.

```text
ΔE = flywheel energy at window end - at window start
grid* = grid supply - ΔE·η_discharge   (ΔE ≥ 0)
grid* = grid supply - ΔE / η_charge    (ΔE < 0)
grid Wh/vkm = grid* Wh / simulated vehicle distance km
energy saving = (reference - strategy) / reference · 100%
peak reduction = (reference peak - strategy peak) / reference peak · 100%
15-min peak = max over t of (grid supply(t) - grid supply(t - 15 min)) / 0.25 h,
              for intervals inside the window (metered, read every 0.5 s)
```

The comparison report is versioned as `schemaVersion: 2`. Version 2 adds the
core runtime, the run settings (fixed step, storage and efficiency scale) and,
per strategy, the energy-balance terms (vehicle demand, accepted regeneration,
flywheel charge, discharge and ΔE), headway CV, time-mean on-time share and
wait, left-behind passengers, an optional grid-power series and the max 15 min
rolling-average grid power (`peakRollingAverageKw`, `rollingPeakReductionPercent`,
null for windows shorter than 15 min). The earlier,
unversioned report is version 1; its fields are unchanged.

## Current reproducible benchmark

![Energy and peak-power benchmark](assets/energy-benchmark.svg)

Each network's default fleet, service from 08:00, a 10-minute warm-up and a
60-minute measured window. Regenerate the table with
`npm run benchmark:energy`, and the chart with
`npm run benchmark:energy -- --write-chart` (about three minutes):

| Scenario and controller | Grid-energy saving | Peak-power reduction | Flywheel charge, start → end | Notes |
| --- | ---: | ---: | ---: | --- |
| İzmir, 14 trams, reactive | 22.0% | 12.4% | 7.7 → 7.8 kWh | Flywheel only, no traction guidance |
| İzmir, 14 trams, predictive | 22.0% | 12.4% | 7.7 → 7.8 kWh | 0 interventions |
| Nizhny 2+21, 10 trams, reactive | 23.1% | 8.7% | 15.2 → 16.3 kWh | Flywheel only, no traction guidance |
| Nizhny 2+21, 10 trams, predictive | 23.1% | 8.7% | 15.2 → 16.3 kWh | 0 interventions |
| Nizhny Route 2, 10 trams, reactive | 23.9% | 36.2% | 15.4 → 15.5 kWh | Flywheel only, no traction guidance |
| Nizhny Route 2, 10 trams, predictive | 23.9% | 36.2% | 15.4 → 15.5 kWh | 0 interventions |

These are simulator outputs, not measured savings for either real operator.
Sensitivity sweeps around this baseline (time of day, fleet size, storage size,
flywheel efficiency), the credibility checks and the figures are in
[RESULTS.md](RESULTS.md).

The predictive controller does not improve on reactive flywheels; its results
are identical. Both strategies run the same SOC and forecast dispatch, and the
only difference, a traction-guidance rule that limits accelerating trams above
the section's grid setpoint, never fires while the flywheels hold the grid at
that setpoint. Earlier versions of this table showed predictive differences
(for example 14.5% peak reduction on İzmir, 28.5% on Route 2). They were
artefacts of two errors in that threshold, fixed in `f2e75e0`. The traction
guidance should not be presented as a benefit.

Earlier figures (10.6% and 24.4% for İzmir, for example) are not comparable and
were withdrawn. They covered ten minutes from a cold start, so the start-up
wave dominated; the İzmir case started all 14 trams from one point because a
fixed tram count bypassed its fleet groups; Nizhny 2+21 stacked 12 trams on 10
start positions; and energy still stored in the flywheels at the end was
ignored (on Nizhny 2+21, more than the claimed saving). They also predate the
model corrections of this release: braking to stop points, curve and turnout
limits held through the curve, no acceleration during stop approaches,
corrected depot exits and passenger loads, blended electric and friction
braking, and track brakes for emergency stops.

## Service metrics

| Metric | Interpretation |
| --- | --- |
| Mean headway | Average time or route separation between consecutive vehicles |
| Headway CV | Standard deviation divided by mean headway; lower is more regular |
| Departure adherence | Share of planned terminal departures inside the tolerance window |
| Mean departure deviation | Mean absolute timing difference from the reserved slot |
| Interval delay | How much later than planned a tram left its last stop, relative to the previous tram of its route |
| On-time share (`onTimePercent`) | Share of in-service trams with an interval delay within ±60 s |
| Average passenger wait | Estimated waiting time from queues and service state |
| Left behind | Passengers remaining because capacity was reached |
| Interventions | Energy-controller changes to vehicle traction guidance |

## Experimental discipline

- Compare one control variable at a time.
- Hold scenario, fleet, service clock and duration constant.
- Report distance-normalized energy and absolute peak power.
- Preserve negative or inconvenient results.
- Repeat future stochastic experiments with disclosed seeds and confidence
  intervals.
- Separate calibration data from validation data.

