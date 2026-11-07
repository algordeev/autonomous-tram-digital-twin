# Preliminary Results

Sensitivity study of the wayside flywheel benchmark in
[EXPERIMENTS.md](EXPERIMENTS.md). All numbers are simulator outputs from the
deterministic C++/WebAssembly core. They compare strategies with each other and
are not measured savings for either operator (see [Limitations](#limitations)).

## How to reproduce

```bash
git checkout main             # results.csv rows record git_commit f2e75e0 (same models)
npm ci                        # Node ≥ 22.13 (results produced with Node v24.19.0)
npm run benchmark:sweeps      # outputs/sweeps/results.csv, ~10 min on 8 cores, resumable
npm run benchmark:sanity      # outputs/sweeps/sanity.json and sanity.md, ~4 min
python3 -m pip install pandas matplotlib
python3 scripts/plot_results.py   # docs/assets/results/fig*.png and .svg
```

One case on its own:

```bash
npm run benchmark:case -- --scenario izmir-konak --tram-count 12 --start-minute 1020 \
  --strategy reactive --csv outputs/my-cases.csv
```

Options: `--scenario`, `--tram-count`, `--start-minute`, `--warmup-minutes`,
`--window-minutes`, `--storage-scale` (multiplies every flywheel bank's power
and energy; 0 removes the banks), `--eta-scale` (multiplies charge and
discharge efficiency; a result above 1 is rejected), `--timestep-ms`,
`--strategy none|reactive|predictive` (repeatable or comma-separated),
`--csv`, `--json` (full schemaVersion 2 report) and
`--grid-power-sample-seconds`. Saving and peak reduction are always computed
against a no-storage run with exactly the same other parameters, with the
ΔE-corrected formulas in [EXPERIMENTS.md](EXPERIMENTS.md#energy-comparison).
Every row records `core_runtime` and `git_commit`; the scripts stop if the
TypeScript fallback (which has no traction-power network) is used.

The simulator is deterministic, so there are no seeds and no
"mean ± std over seeds". Variation is explored only through the one-factor
sweeps below. The data behind this page is committed as
[results.csv](assets/results/results.csv) and
[izmir-baseline-grid-power.csv](assets/results/izmir-baseline-grid-power.csv).

## Baseline

Each network's default fleet, service from 08:00, 10 min warm-up, 60 min
measured window, configured storage, 50 ms step. This reproduces the
[EXPERIMENTS.md](EXPERIMENTS.md#current-reproducible-benchmark) table exactly.

| Network, fleet | Strategy | Grid Wh/vkm | Energy saving | Peak kW | Peak reduction | 15-min peak kW | 15-min peak reduction | On-time | Interventions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| İzmir Konak, 14 | none | 1348.7 | — | 1509.7 | — | 440.4 | — | 89.4% | 0 |
| İzmir Konak, 14 | reactive | 1051.9 | 22.0% | 1325.5 | 12.2% | 341.0 | 22.6% | 89.4% | 0 |
| İzmir Konak, 14 | predictive | 1051.9 | 22.0% | 1325.5 | 12.2% | 341.0 | 22.6% | 89.4% | 0 |
| Nizhny Route 2, 10 | none | 1353.2 | — | 1487.2 | — | 367.5 | — | 91.2% | 0 |
| Nizhny Route 2, 10 | reactive | 1029.9 | 23.9% | 949.3 | 36.2% | 277.7 | 24.5% | 91.2% | 0 |
| Nizhny Route 2, 10 | predictive | 1029.9 | 23.9% | 949.3 | 36.2% | 277.7 | 24.5% | 91.2% | 0 |
| Nizhny Routes 2+21, 10 | none | 1507.2 | — | 1229.2 | — | 407.6 | — | 90.0% | 0 |
| Nizhny Routes 2+21, 10 | reactive | 1158.8 | 23.1% | 1110.5 | 9.7% | 309.1 | 24.2% | 90.0% | 0 |
| Nizhny Routes 2+21, 10 | predictive | 1158.8 | 23.1% | 1110.5 | 9.7% | 309.1 | 24.2% | 90.0% | 0 |

Peak kW is the highest network grid power at any single 50 ms step of the
window. 15-min peak kW is the highest mean network grid power over any 15 min
interval inside the window, from the core's per-step grid-energy integral
(metered supply, no ΔE correction); 15 min is a common averaging interval
for billed demand. On-time is the time mean of the share of in-service trams within ±60 s of
their interval (`onTimePercent`), sampled every 60 s without disturbing the run.
The predictive rows are identical to the reactive ones: its traction guidance
never intervenes in the baseline windows (see
[Predictive against reactive](#sensitivity)).

## Sensitivity

One factor at a time around the baseline; 25 distinct cases × 3 strategies.

- **Time of day** (06:00, 08:00, 12:00, 17:00, 21:00). Reactive energy saving
  ranges from 22.0% to 24.5% on İzmir, 23.8% to 24.3% on Nizhny Route 2 and
  21.5% to 23.1% on Nizhny 2+21, while its peak reduction ranges much more
  widely: 0.0% to 18.4%, 17.4% to 36.2% and 9.7% to 30.4%. At 12:00 on İzmir
  the reactive flywheels do not lower the peak at all.
- **Fleet size** (İzmir, 8–16 trams). Reactive saving falls from 25.1% with 8
  trams to 21.2% with 16, because more trams reuse each other's braking energy
  directly and leave less for storage; peak reduction varies non-monotonically
  between 3.3% and 19.9%. Above 12 trams the terminal headway stays at about
  4.6 min: the timetable, not the fleet, sets it.
- **Storage size** (İzmir, 0, 0.5, 1.0, 1.5 × the configured banks). Reactive
  saving rises from 0% to 15.0%, 22.0% and 25.1%, with diminishing returns.
  Peak reduction is 12.2% at every size from 0.5 to 1.5: the reactive rule only
  discharges above a fixed per-section grid setpoint (24% of substation rating,
  at most 420 kW), and at the window peak two sections sit at that setpoint with
  their flywheels 71–87% charged. The peak is set by the dispatch rule, not by
  the stored energy.
- **Efficiency** (İzmir, η scale 0.9, 0.95, 1.0 of the nominal 0.95 per
  direction, i.e. η = 0.855, 0.9025, 0.95). Reactive saving is 18.7%, 20.3% and
  22.0%; the peak reduction does not change.
- **15-min rolling-average peak.** Averaged over 15 minutes, the reactive
  peak reduction follows the energy saving rather than the single-step peak:
  17.2–24.8% across time of day and fleet size on all three networks, and
  15.0%, 22.6% and 25.9% at 0.5×, 1.0× and 1.5× storage. Over 15 minutes the
  flywheels lower grid draw by reusing braking energy, and a bank of
  0.5 kWh modules is far too small to shift demand between intervals. The flat
  12.2% under storage size therefore applies to the single-step peak only: it
  shows that the dispatch setpoint limits how far short demand spikes are
  shaved, not that storage has no effect on averaged demand.
- **Predictive against reactive.** The predictive strategy is the reactive
  flywheel logic plus one traction-guidance rule: when a section draws more
  than its grid setpoint, accelerating trams are limited. With storage
  installed the flywheels already hold each section at that setpoint, so the
  rule almost never acts. In 24 of the 25 cases it intervenes 0 to 6 times per
  hour and the result equals reactive within 0.003 points of energy saving and
  0.05 points of peak reduction. Only with no storage installed does it act
  (165 interventions): it cuts the İzmir peak by 5.4% at an energy cost of
  0.04%, with no change in on-time share; its 15-min peak is 0.2% higher than
  without guidance, so it moves demand in time rather than removing it. The predictive strategy therefore
  provides no benefit over reactive flywheels.
- **Service.** Neither storage strategy changes any service metric:
  trajectories, vehicle-km, on-time share and waits are identical to the
  no-storage run in every case.

## Sanity checks

İzmir baseline, all strategies. Target < 1% for each item. Regenerate with
`npm run benchmark:sanity`.

| Check | Result | Detail |
| --- | --- | --- |
| 1. Energy balance: grid + accepted regen = vehicle demand + flywheel losses + ΔE | pass | Residual ≤ 4.4·10⁻¹² kWh (≤ 9·10⁻¹³ %) for all three strategies |
| 2. Timestep 50 ms → 25 ms | pass | Wh/vkm ≤ 0.12%, peak ≤ 0.86%, 15-min peak ≤ 0.17%; saving 22.0% → 21.9% (reactive) |
| 3a. Warm-up 10 → 20 min (window moves to 08:20–09:20) | **fail** | Wh/vkm +1.5 to +2.1%; peak and 15-min peak unchanged; saving 22.0% → 22.4% |
| 3b. Warm-up 10 → 20 min, same 08:10–09:10 window | **fail** | Wh/vkm +0.64 to +0.77% (within target), but peak +12.2 to +13.7% (no storage 1509.7 → 1694.5 kW); peak reduction 12.2% → 11.1% (reactive and predictive) |
| 3b. Same comparison, 15-min peak | **fail** | 15-min peak +3.0 to +4.5% (no storage 440.4 → 453.5 kW, reactive 341.0 → 356.3 kW); 15-min peak reduction 22.6% → 21.4% |

What these mean:

1. The closure is an identity of the core's bookkeeping. It shows that no
   energy is lost or created between the vehicle, section and flywheel
   counters. It does not validate the physical model.
2. The 50 ms step is converged for these metrics.
3. Energy per vehicle-km is robust to the warm-up: in 3a the extra 2% comes from
   measuring a later hour, and with the window held fixed (3b) the change is
   0.8%. The **peak is not**: it is the maximum of a single instant, and starting
   the fleet 10 minutes earlier changes how trams are phased when they
   accelerate together. In this one comparison the absolute peak moved by
   12–14% and the peak reduction by 1.1 points, so peak figures on this page
   are indicative, and peak differences of a few points between strategies or
   cases are not significant. The 15-min peak is about three times less
   sensitive (3.0–4.5%) but still misses the 1% target, and its reduction moves
   by 1.2 points, so it is the more robust peak metric, not a converged one.

Grid energy per vehicle-km against published values (column to be completed
from the literature):

| Network | Strategy | Simulated Wh/vkm | Published reference (to fill in) |
| --- | --- | ---: | --- |
| İzmir Konak | none | 1348.7 | |
| İzmir Konak | reactive | 1051.9 | |
| İzmir Konak | predictive | 1051.9 | |

## Figures

Regenerate with `python3 scripts/plot_results.py`; each figure is also
available as SVG next to the PNG.

![Grid-energy saving and peak reduction by network](assets/results/fig1_savings_by_network.png)

**Figure 1.** Grid-energy saving (left) and peak grid-power reduction (right)
of reactive flywheels against no storage, baseline case on each network.¹

![İzmir network grid power with and without flywheels](assets/results/fig2_izmir_grid_power.png)

**Figure 2.** İzmir network grid power over the 08:10–09:10 measured window
(a) and a 5 min zoom around the no-storage peak (b), with and without reactive
flywheels; curves are 1 s samples, horizontal lines are each run's window peak
recorded at the 50 ms step.

![Energy saving against İzmir fleet size](assets/results/fig3_sensitivity_fleet.png)

**Figure 3.** Grid-energy saving against İzmir fleet size, with the measured
mean terminal headway under each fleet size; above 12 trams the timetable, not
the fleet, sets the headway.¹

![Energy saving and peak reduction against İzmir storage size](assets/results/fig4_storage_size.png)

**Figure 4.** Reactive grid-energy saving and peak grid-power reduction on
İzmir against flywheel storage size, as a multiple of the configured banks
(power and energy scaled together). Energy saving keeps rising with storage,
while the single-step peak reduction stays at 12.2% from 0.5× to 1.5×: the
fixed per-section discharge setpoint, not the stored energy, limits how far
short demand spikes are shaved. The 15-min rolling-average peak reduction
(15.0%, 22.6%, 25.9%) is not drawn; it follows the energy saving.¹

¹ The rule-based predictive variant equals reactive in these cases (see
[Sensitivity](#sensitivity)), so it is not drawn.

## Limitations

- **Comparative, not calibrated.** The vehicle, resistance, auxiliary and
  flywheel parameters are not calibrated against Hyundai Rotem fleet data for
  İzmir or against measurements from the Konak T2 line; five İzmir substation
  positions and the Nizhny feeder boundaries are reconstructed
  ([DATA_AND_ASSUMPTIONS.md](DATA_AND_ASSUMPTIONS.md)). Absolute Wh/vkm and kW
  should not be quoted as real consumption. Auxiliary load is a constant 4.5 kW
  per tram (no seasonal heating or cooling), which keeps absolute Wh/vkm low.
- **No electrical network model.** There is no cable or rail resistance, no
  voltage sag and no DC load flow. Regenerated energy is shared within a
  section without losses or voltage limits, which favours both direct reuse and
  storage.
- **The predictive controller is not a benefit.** Its traction guidance has
  no measurable effect while flywheels are installed, and its SOC and forecast
  dispatch also runs in the reactive strategy, so the two strategies differ
  only by that guidance rule. Earlier versions of this page reported
  predictive differences of up to ±10 points in peak reduction. They came from
  two errors in the guidance threshold, fixed in `f2e75e0`: the rule
  throttled trams while a flywheel was holding the grid exactly at the
  threshold (a floating-point tie), and a cap undid the raised threshold for
  depleted flywheels.
- **Peaks are single-instant maxima** and depend on fleet phasing (sanity
  check 3b).
- **Service metrics are model metrics.** Terminal holding makes the İzmir
  terminal headway CV close to zero by construction; Nizhny Route 2 has no
  dispatch-controlled terminal, so no headway CV or departure adherence is
  reported there. Waits are a Little's-law estimate at each route's busiest
  stop under synthetic demand.

## Ön Bulgular (2209-A)

Geliştirilen deterministik dijital ikiz (C++17 çekirdek, WebAssembly) ile İzmir
Konak (14 tramvay) ile Nijniy Novgorod 2 ve 2+21 hatlarında (10 tramvay), 10
dakikalık ısınmanın ardından 60 dakikalık ölçüm penceresinde hat kenarı volan
depolamanın etkisi incelenmiştir. Reaktif volan kontrolü, depolamasız
referansa göre araç-km başına şebeke enerjisini İzmir'de %22,0, Nijniy
hatlarında %23,1–23,9 azaltmış; tepe gücü sırasıyla %12,2 ve %9,7–36,2
düşürmüştür. Tek faktörlü duyarlılık analizinde İzmir'deki tasarruf günün
saatine ve filo büyüklüğüne göre %21,2–25,1 aralığında kalmış, tepe güç
azaltımı ise %0–19,9 arasında değişmiştir. Depolama kapasitesi 0,5–1,5 kat
aralığında değiştirildiğinde enerji tasarrufu %15,0'dan %25,1'e yükselirken
anlık tepe güç azaltımı %12,2'de sabit kalmıştır; anlık tepe gücü depolama
kapasitesi değil, sabit eşikli dağıtım kuralı sınırlamaktadır. Mevcut kural tabanlı
öngörülü çekiş yönlendirmesi volanlar devredeyken ölçülebilir bir etki
göstermemiş, reaktif kontrole göre ek enerji veya tepe güç kazancı
sağlamamıştır. Sonuçlar karşılaştırmalı olup işletme ölçümleriyle kalibre
edilmemiştir. Bu bulgular, dakikliği düşürmeden tepe gücü
ve enerjiyi birlikte iyileştiren NSGA-II/III tabanlı çok amaçlı öngörülü bir
denetleyiciye ve bunun Donanım-Döngüde (HIL) doğrulanmasına yönelik araştırma
boşluğunu ortaya koymaktadır.
