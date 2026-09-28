# Data Provenance and Assumptions

## Evidence classes

Every network or physical value should be interpreted using one of these
classes:

| Class | Meaning |
| --- | --- |
| Measured | Obtained from a physical experiment or explicit route measurement |
| Verified public source | Published by an operator, municipality, manufacturer or technical specification |
| Reconstructed | Derived from public geometry, counts or nearby confirmed points |
| Engineering assumption | Plausible placeholder chosen for comparative simulation |

The user interface and documentation must not present reconstructed feeder
boundaries as an operator's real electrical diagram.

## Scenario inventory

| Scenario | Segments | Routes | Main evidence |
| --- | ---: | ---: | --- |
| N.Novgorod Route 2 | 39 | 2 directions | Route geometry, original 2021 project measurements and mapped infrastructure |
| N.Novgorod Routes 2 and 21 | 66 | 2 services | OSM route relations, mapped turnout geometry and operating topology |
| Izmir Konak Tram | 36 | 1 service, two directions | Public line length/stops, mapped alignment and municipal operating information |

The JSON configurations under `src/config/networks/` are generated snapshots
used by the application. Their TypeScript scenario sources retain richer code
comments about reconstruction choices.

## Nizhny Novgorod traction supply

Five relevant public traction-substation properties are associated with the
combined model. Their addresses are treated as verified public data. Public
feeder and section-isolator diagrams were not available, so the model assigns
track to the nearest relevant supply location and places boundaries at
reconstructed midpoints.

The Route 2-only scenario aggregates the same storage capacity into three
electrical banks. The complete Routes 2 and 21 scenario uses five sections.

## Izmir traction supply

Public municipal information reports eight transformer buildings for Konak T2:
six along the route and two in Halkapınar depot. Basmane Meydanı is treated as a
verified line location. The other five line locations are reconstructed from
the verified count, line geometry and available operating evidence. Depot
substations are shown but do not feed line sections in the current model.

## Geometry and distance

Canvas coordinates are presentation coordinates. Physical route distance is
stored or derived separately and must be used for speed, headway and energy
calculations. The 12.8 km İzmir value is the public one-way corridor length;
the simulated directed cycle includes both directions and terminal connectors.

## Physical assumptions

Reference vehicle parameters are listed in [ENERGY_MODEL.md](ENERGY_MODEL.md).
The model is internally dimensionally consistent, but several coefficients are
not calibrated to a specific fleet. Absolute energy results therefore remain
comparative.

## Known uncertainty

- Nizhny Novgorod feeder boundaries are estimates.
- Five Izmir line-substation positions are estimates.
- Izmir gradient is currently zero.
- Resistance coefficients, auxiliaries, traction power and efficiencies require
  measurement-based identification.
- Passenger arrivals are synthetic demand, not an operator ridership dataset.
- Road traffic is an interaction demonstration, not a calibrated traffic model.

## External references

- Athens Tram Series II performance specification, used for plausibility ranges
  for braking and jerk:
  <https://www.emetro.gr/wp-content/uploads/2017/02/AM_17.02.2017_Specs_RFP_311_17_engl.pdf>
- LA Metro / VYCON wayside energy storage case:
  <https://vyconenergy.com/wp-content/uploads/2018/06/Saving-Money-Every-Day-LA-Metro-Subway-Wayside-Energy-Storage-Substation-March-2015.pdf>
- TSA notice on Hyundai Rotem traction equipment for İzmir and Antalya:
  <https://tsa.at/2016/05/17/hyundai-rotem-chooses-tsa-for-trams-in-izmir-and-antalya/>

External links support parameter plausibility and product identity; they do not
convert project assumptions into measured operator data.
