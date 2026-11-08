# Changelog

All notable changes to this project are documented here. The format is based on
Keep a Changelog; release labels use semantic version numbers.

## Unreleased

### Fixed

- A crossing whose entry detection was lost is released once the owner's
  odometer shows its rear clear of the crossing, instead of staying reserved for
  a tram that has gone.
- A turnout approach lock for a tram that never reaches the points (a spurious
  reader report) lapses after 60 s while its owner is not committed to the
  points, instead of deadlocking the network.
- Keep clear: a tram does not enter a crossing it cannot leave, and gives back
  a grant while its exit is blocked. An İzmir tram queueing for the full
  Fahrettin Altay terminal no longer stops inside the Üçkuyular crossing.
- The clearance-detector timeout scales with the configured crossing zone
  (minimum 25 s, 2.5 m/s traversal), so trams crossing the long Konak, Gazi and
  Nizhny zones in normal service no longer latch all-red.
- A crossing is granted only to the first tram in line on its approach, so a
  tram queued behind one keeping the crossing clear cannot hold it green.
- The safety oracle times junction and points blocks from when the first tram
  starts waiting, not from the last phase or owner change.
- `docs/RESULTS.md`, `docs/EXPERIMENTS.md`, the result data and figures 1–7
  regenerated with the fixed logic (`cddcca2`).

### Changed

- C ABI 13: `switch_expire` and a separate clearance timeout for `signal_step`.
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
- A late tram is exempt from energy peak smoothing beyond the ±60 s on-time
  tolerance (previously 45 s), and `onTimePercent` is the share of in-service
  trams within that tolerance.
- Benchmark figures in `docs/EXPERIMENTS.md` regenerated for the new physics.
- Simulation rate options add 20× and 30× (the maximum rises from 5×).
- Simulation steps are 7-22× faster (İzmir 8.0 → 0.5 ms, routes 2 + 21
  4.0 → 0.2 ms): the distance to the tram ahead uses a cached forward path
  and indexed track lookups instead of walking and rescanning the network for
  every pair of trams. Results are bit-identical.

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
- `npm run simulate:headless` ran on the TypeScript fallback instead of the
  C++ core, so its reports had no traction-power data (0 kWh grid supply).
  Reports now state the core in `coreRuntime`.
- Tram delay grew without bound in normal running: it compared distance with
  62% of the speed limit since dispatch, so planned dwells and terminal holds
  counted as lateness and loop routes never reset. Healthy trams were
  short-turned in long runs, and energy peak smoothing switched off for most of
  the fleet. Delay is now the interval delay at stop departures, and short
  turns use continuous unplanned hold time; see `docs/OPERATIONS.md`.
- The automatic-dispatch help text described triggers that did not exist.
- Service windows crossing midnight stopped at 00:00, so İzmir had no service
  from 00:00 to 00:20. After-midnight departures also stay on the window's
  timetable grid from the previous evening.
- A rejected experiment (for example an empty fleet) still switched the
  scenario and options while keeping the old trams.
- Experiments exported from the built-in layouts (prototype loop, shared
  corridor, city interchange) were rejected on import as an unknown network.
- A withdrawn tram kept its claims on the line. Its queued turnout and signal
  requests are now dropped when it leaves the line, locks on points it never
  reached are released, and points it crossed are released once it is stored.
  A crossing grant it never used is released once instead of being requeued
  for a tram in the depot, and a crossing it entered is reported clear once it
  is stored rather than latching all-red.
- A tram rejoining the main line from a depot return track crossed the points
  without locking them, so they could be thrown under it or claimed by another
  tram. It now locks them to its leg, waits while another tram holds them, and
  the points are restored after its rear clears.
- Curve speed limits ended at the curve's apex, so trams accelerated through
  the second half of every curve. The limit now holds until the rear of the
  tram has left the curve, including across a segment end. In a 1-hour run,
  fleet distance falls 4.3% on İzmir and 2.1% on routes 2 + 21, with energy
  down 3.7% and 2.6%.
- Trams sped up after starting a stop approach and then braked: the platform
  envelope replaced the target instead of capping it, eco-driving aimed for a
  16 km/h crossing of the detector 160 m before the platform, and a tram slowed
  by a curve, interval recovery or a departure was pulled up to the envelope.
  An approach now keeps the speed it began with (or creeps in at the PWM 20
  approach speed from rest), and eco-driving coasts and brakes towards the
  platform itself. In a 1-hour run, grid energy falls 6.6% on İzmir and 6.8% on
  routes 2 + 21 at practically unchanged distance, and friction braking about
  11%.
- Look-ahead could follow a different route from the one the tram took. At a
  node turnout it predicted the tram's route while the tram followed the points
  as they lay; it now requests the leg it looked along, as its approach reader
  does. An inline turnout set to its branch diverted trams mid-segment, but
  look-ahead stayed on the main line, so a diverting tram could not see a tram
  or obstacle on the branch. Results are unchanged when no diversion is set.
- Depot exits deadlocked: a tram waiting on depot track kept its line position
  at the portal, within the ±8% exit window of the other portal trams, so
  waiting trams blocked one another. In a 2-hour İzmir morning run from 05:50,
  2 trams left the depot instead of 14. The check also missed trams
  approaching from the previous segment. A tram now joins only when the tram
  ahead leaves it room to stop and a tram behind can stop behind it.
- Turnout speed limits ended at the points like curve limits did; they now
  hold until the rear is 20 m past the points. Straight through an inline
  turnout uses its 20 km/h main-leg limit rather than the 15 km/h branch
  limit, and its misplaced main-leg limit at the start of the approach segment
  is gone.
- Passengers never all got off: every stop, terminus included, used the same
  alighting share. Everyone now leaves at a terminus before boarding for the
  return trip, and at the last stop of a tram heading out of service, which
  takes nobody on; previously those passengers vanished when it was stored.
  In a 1-hour run the average load falls 27% on İzmir and 9% on routes 2 + 21.
- A stop's "overcrowded" flag stayed on for good after its first overflow. It
  now reflects the last tram to board there: it clears once a tram takes
  everyone waiting.
- "Comparison worker failed to start" after an update: the offline service
  worker answered every request from its cache first, including the page, so
  the browser ran an older build whose hashed worker and chunks had already
  been removed (sometimes the whole app failed to load). The page and unhashed
  files such as `tram-core.wasm` now come from the network first, with the
  cache as the offline fallback; the cache version hashes file contents, so a
  C++-only change replaces the cached core; and an open page reloads once when
  an updated service worker takes over. Browsers still on the old service
  worker need one more reload after this update.
- "C++ energy core could not be loaded" in the energy comparison whenever the
  app was hosted under a sub-path, as on GitHub Pages: a worker has no
  document, so it requested the core from the site root (`/wasm/...`, a 404).
  The page now passes the resolved core URL to the worker, and a failed load
  reports its cause.
- The emergency brake could not reach its stated 2.4 m/s²: it was capped by
  the 52 kN wheel brakes (about 1.95 m/s² empty, 1.5 m/s² full) and built up
  at the 0.9 m/s³ comfort jerk, so it took 2.7 s to reach even that. A stop
  from 40 km/h took 43 m empty and 50 m full. Emergency braking now adds 36 kN
  of magnetic track brakes and builds up at 5 m/s³: empty or full, it reaches
  2.4 m/s² within 0.45 s and stops from 40 km/h in 28 m. Service braking is
  unchanged, and normal running sees no difference.
- The energy benchmark was not a fair comparison. A fixed tram count bypassed
  the fleet groups, so all 14 İzmir trams started from one point and Nizhny
  2+21 stacked 12 trams on 10 start positions; ten minutes from a cold start
  measured mostly the start-up wave; and energy still stored in the flywheels
  at the end was ignored (on Nizhny 2+21, more than the claimed saving). The
  comparison now uses each network's fleet groups (`setFleetSize` spreads a
  plain count over them, also for `--tram-count`), measures a window after a
  warm-up with the peak taken inside it, and corrects grid energy for the
  change in flywheel charge. The benchmark (10-minute warm-up, 60 minutes
  measured) and its chart are regenerated with all corrections in this
  release: about 22-24% grid-energy saving on every network, with the
  predictive controller no better than reactive flywheels. The in-app
  comparison uses the current fleet with a 5-minute warm-up and 10 measured
  minutes.
- Regenerative braking counted all wheel braking as generator input, without
  the motors' limits: a 52 kN brake at 40 km/h is about 570 kW, against a
  240 kW motor rating, and recovery continued to standstill. Braking is now
  blended: the motors brake electrically up to 32 kN and 240 kW, fading out
  between 7.2 and 1.8 km/h, and friction brakes supply the rest. Braking force
  and stopping distances are unchanged; only the electric share is generator
  output. Normal service braking is almost all electric, so in 1-hour runs
  generator output falls only 0.6-1.4% and net grid energy rises 0.3-0.9%;
  an emergency stop from 40 km/h is now under half electric instead of 100%.
  The energy screen shows friction brake heat.

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
