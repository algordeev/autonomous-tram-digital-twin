# Control-state ownership and safety invariants

## Ownership in ABI 12

`operational_core.cpp` owns live motion/energy accumulators, signal reservations,
phases, detector flags and turnout positions/locks. `authority_sync`,
`signal_sync` and `switch_sync` seed a subsystem **once after its `*_begin`**;
subsequent calls return `0` without changing state. A new simulation uses an
explicit subsystem reset. Changing a rendering snapshot is not a reset.

The browser adapter reads C++ state back into TypeScript. It sends manual mode
requests through `signal_manual` and entry/rear-clear observations through
`signal_observe`, rather than invalidating the controller and importing a
replacement state. Manual mode is a requested policy, not permission to erase
the current reservation. Motion correction can reduce speed or stop a tram;
it cannot increase speed or inject positive acceleration.

This does not move the entire network engine into C++. TypeScript still owns
route positions, geometry-based detector generation, passenger demand,
schedules, queues, experiments and render snapshots. Station/depot adaptation
and the explicit TypeScript fallback are separate boundaries. In the browser,
C++ safety decisions depend on truthful physical observations from that layer;
these tests are simulator checks, not a certification of physical signalling.

## Invariants

| Invariant | Enforcement | Verification |
| --- | --- | --- |
| At most one tram occupies a conflict zone | One reservation per signal controller; browser permission requires the reserved tram as well as its approach. Geometric core zones clip swept movement at another owner's boundary. Invalid overlapping initialization is rejected. | Independent occupant oracle on every randomized signal step, geometric fleet checks and browser network zone checks. |
| Points cannot move while locked | `switch_toggle` refuses every locked turnout; `switch_request` permits only the existing owner requesting its existing position. Both control modes acquire and respect locks. | Random requests/toggles and foreign releases; explicit tests of `cooperative=0` and the owner's attempt to change position. |
| A conflicting grant cannot replace an occupied reservation | Manual requests drain the old reservation and wait for clearance; the step rechecks occupancy if entry arrives after the command. Foreign clears cannot release the owner. | Command/entry ordering tests, same-approach owner checks, manual overrides and corrupted TypeScript mirrors. |
| Time alone never proves clearance | Missing rear-clear detection latches all-red, retains the owner and blocks new grants. | Dropped/duplicate entry, wrong-tram clear and missing-clear injections, with assertions on every step. |

The browser retains a turnout lock until the rear has travelled 15 m beyond
its crossing point. The inline turnout's automatic reset is also delayed until
that point. A queued request that C++ refuses stays queued; it cannot update
the mirrored position anyway.

## Fault policy

The browser currently passes a **25 s assumed demonstration timeout** after
observed entry. The C API accepts the timeout as an input so other scenarios can
choose it explicitly. A very slow or stopped tram can legitimately exceed it:
the safe result is still a blocked zone with all-red indications, not automatic
release. Duplicate entry observations do not restart the timer.

| Phase / fault | Behaviour | Recovery |
| --- | --- | --- |
| Phase 4, fault 1: clearance timeout | All tram and road lights red; reservation retained; one transition event rather than perpetual green re-arming. | Matching owner's rear-clear observation, then the configured all-red/amber clearance interval before another grant. |
| Phase 4, fault 2: unexpected entry | All-red latched; no reassignment or release by a normal owner's clear. | Inspect the inconsistent occupancy, then explicitly reset the simulation/subsystem. A manual green request cannot reset it. |

Clearance is measured for the rear, including when it extends onto the next
segment. Operator commands cannot erase an occupied grant or skip its clearance
interval. Unentered reservations may be withdrawn only when the approach is no
longer waiting and the requesting tram is invalid; occupancy timeouts never use
that withdrawal rule.

## Reproducible checks

```bash
npm ci
npm run test:all
```

`test:wasm` includes 24 seeds × 1,000 signal/switch steps and 12 seeds × 1,800
geometric fleet steps. `test:safety` checks the browser adapter and 3 seeds ×
2,400 fixed network steps with randomized operator commands. Invariants are
asserted on **every** step, with seeds in failure messages. The exported
`safety_invariants` bitmask additionally checks geometric occupancy and signal
phase consistency; switch movement is checked against the previous step.

`test:cpp` replays the same recorded ABI calls against the native build and
compares every return value with WASM. CI runs these checks through `npm test`
and `test:cpp`, and rebuilds the committed binary through `verify:wasm`.
