# Operations and Dispatch

## Service plan

Each route has time-dependent planned fleet size and headway. The dispatcher
approaches the target gradually so a short passenger fluctuation does not cause
continuous depot cycling.

At a dispatching terminal, a departure is measured against a planned slot. The
current on-time tolerance is ±60 seconds. A following tram is not released when
its temporal gap is below 85% of the planned headway.

## Headway regulation

Two controls serve different purposes:

1. **Terminal control** uses time between departures. It restores the service
   pattern where waiting is operationally acceptable.
2. **In-service control** uses live separation along the route to prevent
   bunching and unsafe following. It can reduce speed but cannot override a
   signal, obstacle, door or turnout restriction.

Headway coefficient of variation is reported as:

```text
Headway CV = standard deviation of observed headways / mean headway
```

Lower values indicate more regular service. Zero represents perfectly equal
intervals.

## Nizhny Novgorod terminal policy

- Park Dubki is the full dispatching terminal for Route 21. It supports planned
  departure holding, interval recovery and longer layover.
- Chyorny Prud is a quick turnback on shared infrastructure: passengers alight
  and board, the minimum turnback is completed and the tram leaves promptly so
  Route 2 is not unnecessarily blocked.
- Route 2 remains a ring and is regulated through its service plan and spacing
  rather than a long terminal layover at Chyorny Prud.

## Izmir terminal policy

Fahrettin Altay and Halkapınar are represented with two terminal berths. The
first two arrivals may occupy separate platforms. A third arrival receives no
berth and waits at the terminal entry; vehicles cannot overlap on one platform.

## Depot control

Depot movement is an explicit state machine:

```text
passenger service → inbound → in depot → outbound → passenger service
```

Portals and occupied-track checks prevent instantaneous appearance or release
onto an occupied main line. A vehicle ceases passenger service during depot
movement.

## Emergency extra tram

The current demand-response rule authorizes one extra vehicle when estimated
average passenger waiting exceeds 10 minutes continuously for 5 minutes. The
authorization lasts 20 minutes. A 15-minute cooldown prevents repeated release
and withdrawal around the threshold.

## Passenger and dwell model

Passenger arrivals depend on service time and stop weight. The queue is not
discarded when a tram fills. Vehicle capacity is 110 passengers. Boarding and
alighting through three doors produce an 8–45 second dwell.

The stop controller opens doors only when the vehicle is in passenger service,
is within a valid stop dwell and is effectively stationary. Departure remains
blocked until dwell completion.

## ETA boards

ETA uses directed route distance, rolling service speed and current operational
state. Signals, regulation, obstacles and terminal turns influence the result.
Each board separates the two travel directions; paired platforms may share one
panel while retaining their public names.

## Time–distance diagram

Open **Time–distance** in the main toolbar to inspect recent tram movements.
Choose a route and a **10, 20, 30 or 60 minute** window; the default is 20
minutes. The diagram updates as the simulation runs. Pausing the simulation
freezes its clock and trajectories so they can be inspected.

### Reading the diagram

| Element | Meaning |
| --- | --- |
| Horizontal axis | Simulation clock, increasing from left to right |
| Vertical axis | Distance along the selected directed route sequence |
| Stop labels and horizontal reference lines | Stop positions on that sequence |
| Direction bands | Travel-direction sections of the route |
| Coloured trajectory and end label | A tram's recorded movement and vehicle number |
| Horizontal trajectory section | Dwell or another standstill, including terminal waiting |
| Steeper trajectory section | Faster progress along the route for the same time scale |
| Amber overlay | Departure lateness greater than 60 seconds |

For an out-and-back route, both directions are unfolded into one continuous
route-distance axis. Its displayed length covers the full route sequence, not
just the one-way corridor. A new cycle is drawn separately at the wraparound;
it is not connected by a line across the entire chart.

Compare time gaps between trajectories **at the same route position**. Roughly
parallel, evenly spaced lines indicate regular service. Narrowing gaps can
reveal bunching; widening gaps can reveal disruption or recovery. Several
horizontal lines at a terminal may represent a planned queue or layover. Check
the following departures before treating that pattern as a dispatch failure.

### Meaning of departure lateness

The amber overlay uses the same scheduled departure slots as the departure
statistics. While a tram has a reserved slot, lateness is the positive time
elapsed beyond that slot. Waiting before the slot is due contributes no
lateness. After departure, the actual positive departure deviation remains
attached to that trip until a new slot is assigned. Returning to the depot
clears the previous departure deviation. Without a known scheduled departure,
no amber overlay is shown.

This is **departure lateness**, not a continuously updated estimate of lateness
at every stop. The current model has no intermediate-stop timetable, so the
overlay cannot show delays acquired or recovered during the trip. It does not
use the distance-based `delaySeconds` heuristic. The on-time departure tolerance
is ±60 seconds, while the overlay specifically highlights late departures
beyond +60 seconds; early departures are not highlighted.

### History and scope

Only trams in passenger service are sampled, at most once per simulated second.
History is collected while the main application is open, even when the diagram
is closed. The application retains up to 60 simulated minutes, subject to a
60,000-sample cap; large fleets may therefore have less history available. The
summary reports the history actually available.

History clears when the scenario changes, the simulation clock moves backwards
(for example after a reset), or the page reloads. These trajectories are a live
browser-session view and are not stored in the headless experiment reports.

## Priority order

Operational optimization is subordinate to safety:

1. obstacle and emergency braking;
2. occupied track, conflict zone and safe following;
3. signal and turnout authority;
4. stop and door authority;
5. terminal and headway regulation;
6. energy optimization and eco guidance.
