/**
 * İzmir · Konak Tramvayı (T2), Halkapınar ↔ Fahrettin Altay.
 *
 * Real-world sourcing:
 * - 19 stations, exact coordinates from İzmir Büyükşehir Belediyesi open data
 *   (acikveri.bizizmir.com, "Konak Tramvayı İstasyon ve Konum Bilgileri").
 *   Five stations near the Fahrettin Altay end have separate "sağ/sol peron"
 *   (right/left platform) coordinates in that dataset — real, physically
 *   separate single-track platforms on that stretch (Wikipedia: "the
 *   Halkapınar and Fahrettin Altay bound tracks run on opposite sides of
 *   Mustafa Kemal Sahil Bulvarı from Fahrettin Altay to Sadık Bey").
 * - Üniversite and Alsancak Stadyumu serve Halkapınar-bound trams only;
 *   Havagazı serves Fahrettin Altay-bound trams only — the line splits into
 *   a one-way pair (Şehitler Caddesi / Liman Caddesi) between Alsancak Gar
 *   and Halkapınar (per each station's individual Wikipedia entry).
 * - Depot: Halkapınar Depo Sahası, İzmir Metro A.Ş.'s own maintenance yard
 *   for this line (izmirmetro.com.tr construction notice; Wikipedia infobox
 *   "Depot(s): Halkapınar").
 * - Fleet: 21 Hyundai Rotem tramcars serve the line (multiple sources).
 * - Headway: Mon–Sat roughly 6–7.5 min, Sunday 7.5–10 min, widening toward
 *   5–18 min across the full service day (İBB / WikiZero); service runs
 *   06:00–00:20/00:00.
 * - Line length 12.6–12.8 km one-way, ~41 min one-way running time.
 *
 * Honest limitation: only station coordinates were available from open data
 * — no traced street-centreline survey (unlike the Nizhny Novgorod scenario,
 * which used an OSM route relation). Track between consecutive real stations
 * is a straight interpolation, not a street-accurate polyline. Major
 * intersections are real, named, and placed at/near their real station
 * where one exists there; the few placed *between* stations (Vahap Özaltay
 * Meydanı) are interpolated along the straight segment and flagged as such
 * below — real named landmark, approximate position.
 */
import type {
  DepotDefinition,
  DepotPortalDefinition,
  FleetGroupDefinition,
  Point,
  RFIDReader,
  RouteDefinition,
  ScenarioDefinition,
  SignalDefinition,
  TrackSegment,
  TractionSubstationDefinition,
} from "./simulation-core/index.ts";
import { buildNearestSubstationSections } from "./simulation-core/traction-power.ts";

// ---------------------------------------------------------------------------
// Projection: plain equirectangular, centred on the route, scaled to roughly
// match the canvas magnitude used by the other real-world scenario (Nizhny
// Novgorod uses ~14.6 real metres per canvas unit). No d3-geo dependency —
// the route is short and far enough from the poles that this is accurate to
// well under a metre of error over the whole 12.8 km line.
// ---------------------------------------------------------------------------
const METERS_PER_DEGREE_LAT = 110_574;
const REFERENCE_LAT = 38.415; // roughly the route's midpoint latitude
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((REFERENCE_LAT * Math.PI) / 180);
const CANVAS_UNITS_PER_METER = 1 / 13.5;
export const METERS_PER_REFERENCE_UNIT = 13.5;

function project(lon: number, lat: number): Point {
  const xMeters = (lon - 27.12) * METERS_PER_DEGREE_LON;
  const yMeters = (REFERENCE_LAT - lat) * METERS_PER_DEGREE_LAT; // north is up (smaller y)
  return {
    x: xMeters * CANVAS_UNITS_PER_METER + 500,
    y: yMeters * CANVAS_UNITS_PER_METER + 320,
  };
}

function haversineMeters(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * METERS_PER_REFERENCE_UNIT;
}

// ---------------------------------------------------------------------------
// Real station coordinates (İBB open data, "tramvay-konak-konumlar.csv").
// ---------------------------------------------------------------------------
interface StopSite {
  id: string;
  name: string;
  /** Direction(s) this physical stop serves. "both" = shared/paired track. */
  serves: "both" | "outbound" | "inbound";
  outbound: Point;
  inbound: Point;
}

const stop = (
  id: string,
  name: string,
  serves: StopSite["serves"],
  lonLatOutbound: [number, number],
  lonLatInbound?: [number, number],
): StopSite => ({
  id,
  name,
  serves,
  outbound: project(lonLatOutbound[0], lonLatOutbound[1]),
  inbound: project((lonLatInbound ?? lonLatOutbound)[0], (lonLatInbound ?? lonLatOutbound)[1]),
});

// Outbound = Halkapınar -> Fahrettin Altay (westbound). Inbound = the return.
// For the five split-platform stations, "sağ peron" is used for the
// Halkapınar-bound (inbound/eastbound) platform and "sol peron" for the
// Fahrettin Altay-bound (outbound/westbound) platform — the open-data set
// doesn't label which side is which direction, so this is a documented
// assumption, not a sourced fact; the two platforms sit ~20-30m apart either way.
const STOPS: StopSite[] = [
  stop("halkapinar", "Halkapınar", "both", [27.17199, 38.43405]),
  stop("havagazi", "Havagazı", "outbound", [27.15824, 38.43974]),
  stop("universite", "Üniversite", "inbound", [27.16084, 38.43724]),
  stop("alsancak_stadyumu", "Alsancak Stadyumu", "inbound", [27.152, 38.43821]),
  stop("alsancak_gar", "Alsancak Gar", "both", [27.14813, 38.43961]),
  stop("ataturk_spor_salonu", "Atatürk Spor Salonu", "both", [27.14721, 38.43467]),
  stop("hocazade_camii", "Hocazade Camii", "both", [27.14407, 38.43305]),
  stop("kulturpark", "Kültürpark", "both", [27.14146, 38.42922]),
  stop("gazi_bulvari", "Gazi Bulvarı", "both", [27.13703, 38.42417]),
  stop("konak_iskele", "Konak İskele", "both", [27.12725, 38.41883]),
  stop("karatas", "Karataş", "both", [27.11875, 38.41055]),
  stop("karantina", "Karantina", "both", [27.10563, 38.40786]),
  stop("kopru", "Köprü", "both", [27.09872, 38.40583], [27.09852, 38.40601]),
  stop("sadikbey", "Sadıkbey", "both", [27.0959, 38.40327], [27.09533, 38.40317]),
  stop("goztepe", "Göztepe", "both", [27.09166, 38.40025], [27.09159, 38.40064]),
  stop("guzelyali", "Güzelyalı", "both", [27.08486, 38.39843], [27.08307, 38.39938]),
  stop("aassm", "Ahmed Adnan Saygun S.M.", "both", [27.07713, 38.40048], [27.07793, 38.40067]),
  stop("uckuyular", "Üçkuyular", "both", [27.07152, 38.40312]),
  stop("fahrettin_altay", "Fahrettin Altay", "both", [27.06944, 38.39796]),
];

const byId = (id: string) => {
  const found = STOPS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown stop ${id}`);
  return found;
};

const OUTBOUND_ORDER = [
  "halkapinar",
  "havagazi",
  "alsancak_gar",
  "ataturk_spor_salonu",
  "hocazade_camii",
  "kulturpark",
  "gazi_bulvari",
  "konak_iskele",
  "karatas",
  "karantina",
  "kopru",
  "sadikbey",
  "goztepe",
  "guzelyali",
  "aassm",
  "uckuyular",
  "fahrettin_altay",
];

const INBOUND_ORDER = [
  "fahrettin_altay",
  "uckuyular",
  "aassm",
  "guzelyali",
  "goztepe",
  "sadikbey",
  "kopru",
  "karantina",
  "karatas",
  "konak_iskele",
  "gazi_bulvari",
  "kulturpark",
  "hocazade_camii",
  "ataturk_spor_salonu",
  "alsancak_gar",
  "alsancak_stadyumu",
  "universite",
  "halkapinar",
];

function pointFor(stopId: string, direction: "outbound" | "inbound"): Point {
  const site = byId(stopId);
  return direction === "outbound" ? site.outbound : site.inbound;
}

/** Gentle midpoint bow so consecutive-stop hops aren't perfectly straight lines. */
function arcPoints(a: Point, b: Point, bow = 0.06): Point[] {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const nx = -dy * bow;
  const ny = dx * bow;
  const mid = { x: mx + nx, y: my + ny };
  const points: Point[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    // quadratic bezier a -> mid -> b
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mid.x + t * t * b.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * mid.y + t * t * b.y;
    points.push({ x, y });
  }
  return points;
}

function buildPath(order: string[], direction: "outbound" | "inbound", prefix: string) {
  const segments: TrackSegment[] = [];
  for (let i = 0; i < order.length - 1; i += 1) {
    const fromId = order[i];
    const toId = order[i + 1];
    const a = pointFor(fromId, direction);
    const b = pointFor(toId, direction);
    const points = arcPoints(a, b, direction === "outbound" ? 0.05 : -0.05);
    const id = `${prefix}${String(i + 1).padStart(2, "0")}`;
    segments.push({
      id,
      from: fromId,
      to: toId,
      points,
      lengthMeters: haversineMeters(a, b),
      label: `${byId(fromId).name} → ${byId(toId).name}`,
    });
  }
  return segments;
}

const outboundSegments = buildPath(OUTBOUND_ORDER, "outbound", "IZO");
const inboundSegments = buildPath(INBOUND_ORDER, "inbound", "IZI");
const allSegments = [...outboundSegments, ...inboundSegments];

const segmentIndexFor = (order: string[], stopId: string) => {
  const idx = order.indexOf(stopId);
  if (idx < 0) throw new Error(`${stopId} not on this path`);
  return idx;
};

const STATION_APPROACH_METERS = 160;

/** A platform marker plus an upstream approach detector for smooth braking. */
function stationReader(
  order: string[],
  segments: TrackSegment[],
  stopId: string,
  routeId: string,
  directionLabel: string,
  directionShortName: string,
): RFIDReader | null {
  const idx = segmentIndexFor(order, stopId);
  if (idx === 0) return null; // first stop on this path — no arriving segment
  const segment = segments[idx - 1];
  const platformAt = 0.88;
  const at = Math.max(
    0.04,
    platformAt - STATION_APPROACH_METERS / Math.max(1, segment.lengthMeters ?? 500),
  );
  return {
    id: `R-${segment.id}`,
    segmentId: segment.id,
    at,
    kind: "station",
    label: byId(stopId).name,
    routeId,
    stationId: stopId,
    stopBoardId:
      stopId === "havagazi" || stopId === "universite"
        ? "havagazi-universite"
        : undefined,
    stopBoardLabel:
      stopId === "havagazi" || stopId === "universite"
        ? "Havagazı / Üniversite"
        : undefined,
    directionLabel,
    directionShortName,
    displayAt: platformAt,
    terminal: stopId === "halkapinar" || stopId === "fahrettin_altay",
  };
}

const stationReaders: RFIDReader[] = [
  ...OUTBOUND_ORDER.map((id) =>
    stationReader(OUTBOUND_ORDER, outboundSegments, id, "izmir-konak", "To Fahrettin Altay", "→ F.ALTAY"),
  ),
  ...INBOUND_ORDER.map((id) =>
    stationReader(INBOUND_ORDER, inboundSegments, id, "izmir-konak", "To Halkapınar", "→ HALKAPINAR"),
  ),
].filter((reader): reader is RFIDReader => reader !== null);

// ---------------------------------------------------------------------------
// Real, named intersections — traffic-signal-controlled crossings the tram
// shares with road traffic. Gazi Bulvarı, Konak İskele (Cumhuriyet /
// Bahribaba square) and Üçkuyular are placed exactly at their namesake
// station, since the crossing and the stop are the same real location.
// Vahap Özaltay Meydanı is a real square on Şair Eşref Bulvarı between Gazi
// Bulvarı and Alsancak Gar where the one-way pair begins/ends — no station
// sits there, so it's placed at the segment midpoint (approximate, flagged).
// ---------------------------------------------------------------------------
const signals: SignalDefinition[] = [];
const trafficReaders: RFIDReader[] = [];

function addIntersection(
  code: string,
  label: string,
  outboundSegmentId: string,
  outboundAt: number,
  inboundSegmentId: string,
  inboundAt: number,
) {
  const controllerId = `JCT-${code}`;
  const approach = (segId: string, at: number, tag: string) => {
    trafficReaders.push({
      id: `DET-${code}-${tag}`,
      segmentId: segId,
      at: Math.max(0.04, at - 0.22),
      kind: "traffic",
      label: `${label} approach (${tag})`,
      signalId: `SG-${code}-${tag}`,
      render: false,
    });
    signals.push({
      id: `SG-${code}-${tag}`,
      controllerId,
      segmentId: segId,
      at,
      clearAt: Math.min(0.97, at + 0.24),
      label,
      render: true,
      amberSeconds: 3,
      tramGreenSeconds: 9,
      clearanceSeconds: 2,
    });
  };
  approach(outboundSegmentId, outboundAt, "OUT");
  approach(inboundSegmentId, inboundAt, "IN");
}

// Gazi Bulvarı — the line turns from the Şair Eşref corridor onto the
// coastal Cumhuriyet Bulvarı alignment here; a real, busy boulevard junction.
addIntersection(
  "GAZI",
  "Gazi Bulvarı junction",
  outboundSegments[segmentIndexFor(OUTBOUND_ORDER, "kulturpark")].id,
  0.9,
  inboundSegments[segmentIndexFor(INBOUND_ORDER, "gazi_bulvari")].id,
  0.15,
);

// Vahap Özaltay Meydanı — real square on Şair Eşref Bulvarı where the
// outbound/inbound one-way pair begins (per İBB project notices). No station
// here, so placed at this hop's midpoint — approximate along a real,
// straight-interpolated segment, not an independently surveyed position.
addIntersection(
  "VAHAP",
  "Vahap Özaltay Meydanı",
  outboundSegments[segmentIndexFor(OUTBOUND_ORDER, "hocazade_camii")].id,
  0.5,
  inboundSegments[segmentIndexFor(INBOUND_ORDER, "kulturpark")].id,
  0.5,
);

// Konak İskele — Cumhuriyet Meydanı / Bahribaba square, the tram's busiest
// interchange (metro, ferry, bus) and a major road crossing.
addIntersection(
  "KONAK",
  "Konak İskele – Cumhuriyet Meydanı",
  outboundSegments[segmentIndexFor(OUTBOUND_ORDER, "gazi_bulvari")].id,
  0.92,
  inboundSegments[segmentIndexFor(INBOUND_ORDER, "karatas")].id,
  0.08,
);

// Üçkuyular — the southern interchange square (metro terminus area, bus
// station, ferry) where several arterial roads converge.
addIntersection(
  "UCKUYULAR",
  "Üçkuyular junction",
  outboundSegments[segmentIndexFor(OUTBOUND_ORDER, "aassm")].id,
  0.9,
  inboundSegments[segmentIndexFor(INBOUND_ORDER, "fahrettin_altay")].id,
  0.1,
);

// ---------------------------------------------------------------------------
// Depot: Halkapınar Depo Sahası, İzmir Metro A.Ş.'s real maintenance yard for
// this line, sited past the Halkapınar terminus (news coverage of
// construction describes it beyond "Halkapınar Geçiş Köprüsü", the bridge
// past Meles Köprüsü). Modelled the same way as other off-map depots here:
// a short spur off the main line near the real terminus, not drawn as an
// actual surveyed yard track (that layout isn't public).
// ---------------------------------------------------------------------------
const depotGateOutbound = pointFor("halkapinar", "outbound");
const depotGateInbound = pointFor("halkapinar", "inbound");
const depotPoint: Point = {
  x: (depotGateOutbound.x + depotGateInbound.x) / 2 + 30,
  y: (depotGateOutbound.y + depotGateInbound.y) / 2 - 34,
};

const depotPortals: DepotPortalDefinition[] = [
  {
    id: "DEPOT-PORTAL-T2-OUT",
    routeId: "izmir-konak",
    fleetGroupIds: ["t2-to-fahrettin-altay"],
    portalSegmentId: outboundSegments[0].id,
    portalAt: 0.08,
    exitSegmentId: outboundSegments[0].id,
    exitProgress: 0.03,
    lastPassengerStop: "Halkapınar",
    trackPoints: [depotGateOutbound, { x: depotGateOutbound.x + 16, y: depotGateOutbound.y - 18 }, depotPoint],
  },
  {
    id: "DEPOT-PORTAL-T2-IN",
    routeId: "izmir-konak",
    fleetGroupIds: ["t2-to-halkapinar"],
    portalSegmentId: inboundSegments[inboundSegments.length - 1].id,
    portalAt: 0.92,
    exitSegmentId: inboundSegments[inboundSegments.length - 1].id,
    exitProgress: 0.97,
    lastPassengerStop: "Halkapınar",
    trackPoints: [depotGateInbound, { x: depotGateInbound.x + 12, y: depotGateInbound.y - 12 }, depotPoint],
  },
];

const depots: DepotDefinition[] = [
  {
    id: "HALKAPINAR-DEPO",
    label: "Halkapınar Depo Sahası",
    shortName: "HALKAPINAR DEPO",
    note: "T2 · İzmir Metro A.Ş. maintenance yard, past the terminus bridge",
    kind: "depot",
    point: depotPoint,
    portals: depotPortals,
  },
];

// ---------------------------------------------------------------------------
// Route + fleet groups
// ---------------------------------------------------------------------------
const route: RouteDefinition = {
  id: "izmir-konak",
  name: "Konak Tramvayı (T2)",
  shortName: "T2",
  color: "#e0355b",
  segmentIds: [...outboundSegments.map((s) => s.id), ...inboundSegments.map((s) => s.id)],
  labelSegmentId: outboundSegments[segmentIndexFor(OUTBOUND_ORDER, "konak_iskele")].id,
  labelAt: 0.5,
  labelOffset: 26,
};

const fleetGroups: FleetGroupDefinition[] = [
  {
    id: "t2-to-fahrettin-altay",
    label: "Halkapınar → Fahrettin Altay",
    shortName: "→ F.ALTAY",
    routeIntent: "main",
    routeId: "izmir-konak",
    defaultCount: 8,
    maxCount: 11,
    starts: outboundSegments
      .filter((_, index) => index % 3 === 0)
      .map((segment) => ({ segmentId: segment.id, progress: 0.5 })),
  },
  {
    id: "t2-to-halkapinar",
    label: "Fahrettin Altay → Halkapınar",
    shortName: "→ HALKAPINAR",
    routeIntent: "main",
    routeId: "izmir-konak",
    defaultCount: 7,
    maxCount: 10,
    starts: inboundSegments
      .filter((_, index) => index % 3 === 1)
      .map((segment) => ({ segmentId: segment.id, progress: 0.5 })),
  },
];

const starts = [...fleetGroups[0].starts, ...fleetGroups[1].starts];

// ---------------------------------------------------------------------------
// Service schedule — real headways (İBB / WikiZero): roughly 6-7.5 min on
// weekday peaks/midday, widening toward the 5-18 min range across the full
// 06:00-00:20 service day. targetActiveTrams is back-computed the same way
// as the Nizhny Novgorod scenario: real ~41 min one-way running time (İBB) →
// ~90 min full round trip including dwell and terminal recovery, divided by
// the headway. 21 real tramcars serve the line in total, which comfortably
// covers the peak requirement below with a maintenance/spare margin — a
// second real-world number this schedule was checked against, not just
// picked to look right.
// ---------------------------------------------------------------------------
const ROUND_TRIP_MINUTES = 90;
const headwayTrams = (headwayMinutes: number) =>
  Math.min(19, Math.max(2, Math.round(ROUND_TRIP_MINUTES / headwayMinutes)));

const serviceSchedule: NonNullable<ScenarioDefinition["serviceSchedule"]> = [
  {
    id: "night",
    label: "Night (closed)",
    startMinute: 0,
    endMinute: 6 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: null, targetActiveTrams: 0 } },
  },
  {
    id: "early",
    label: "Early service",
    startMinute: 6 * 60,
    endMinute: 7 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: 12, targetActiveTrams: headwayTrams(12) } },
  },
  {
    id: "morning-peak",
    label: "Morning peak",
    startMinute: 7 * 60,
    endMinute: 9.5 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: 6, targetActiveTrams: headwayTrams(6) } },
  },
  {
    id: "daytime",
    label: "Daytime",
    startMinute: 9.5 * 60,
    endMinute: 17 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: 7.5, targetActiveTrams: headwayTrams(7.5) } },
  },
  {
    id: "evening-peak",
    label: "Evening peak",
    startMinute: 17 * 60,
    endMinute: 19.5 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: 6, targetActiveTrams: headwayTrams(6) } },
  },
  {
    id: "evening",
    label: "Evening",
    startMinute: 19.5 * 60,
    endMinute: 22 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: 9, targetActiveTrams: headwayTrams(9) } },
  },
  {
    id: "late",
    label: "Late service",
    startMinute: 22 * 60,
    endMinute: 24 * 60 + 20,
    routes: { "izmir-konak": { plannedHeadwayMinutes: 15, targetActiveTrams: headwayTrams(15) } },
  },
  {
    id: "night2",
    label: "Night (closed)",
    startMinute: 24 * 60 + 20,
    endMinute: 24 * 60,
    routes: { "izmir-konak": { plannedHeadwayMinutes: null, targetActiveTrams: 0 } },
  },
];

const izmirLineSubstations: TractionSubstationDefinition[] = [
  {
    id: "IZM-SS-FAHRETTIN",
    label: "Konak line transformer · Fahrettin Altay area",
    sectionLabel: "Fahrettin Altay — Göztepe",
    point: pointFor("fahrettin_altay", "outbound"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "İBB confirms six line transformer buildings; exact building-to-feeder drawing is not publicly available",
  },
  {
    id: "IZM-SS-GOZTEPE",
    label: "Konak line transformer · Göztepe/Karantina area",
    sectionLabel: "Göztepe — Karantina",
    point: pointFor("goztepe", "outbound"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "Location reconstructed from the official count and operational section boundaries",
  },
  {
    id: "IZM-SS-KONAK",
    label: "Konak line transformer · Konak İskele area",
    sectionLabel: "Karantina — Konak İskele",
    point: pointFor("konak_iskele", "outbound"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "Location reconstructed from the official count and operational section boundaries",
  },
  {
    id: "IZM-SS-BASMANE",
    label: "Basmane Meydanı traction transformer",
    sectionLabel: "Konak İskele — Atatürk Spor Salonu",
    point: pointFor("kulturpark", "outbound"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-address",
    evidence: "İBB 2 Dec 2024 fault notice identifies the Basmane transformer feeding the line; marker snapped to nearest rail",
  },
  {
    id: "IZM-SS-ALSANCAK",
    label: "Konak line transformer · Alsancak area",
    sectionLabel: "Atatürk Spor Salonu — Alsancak",
    point: pointFor("alsancak_gar", "outbound"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "Location reconstructed from the official count and the one-way-pair geometry",
  },
  {
    id: "IZM-SS-HALKAPINAR",
    label: "Konak line transformer · Halkapınar approach",
    sectionLabel: "Alsancak — Halkapınar",
    point: pointFor("halkapinar", "inbound"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "İBB confirms six transformer buildings along the line; exact feeder limits are not public",
  },
];
const izmirDepotSubstations: TractionSubstationDefinition[] = [
  {
    id: "IZM-DEPOT-SS-A",
    label: "Halkapınar depot transformer A",
    point: { x: depotPoint.x - 9, y: depotPoint.y - 8 },
    nominalVoltageV: 750,
    maxPowerKw: 1_200,
    confidence: "verified-count-estimated-location",
    evidence: "İBB confirms two transformer buildings in the Konak depot area",
    feedsMainLine: false,
  },
  {
    id: "IZM-DEPOT-SS-B",
    label: "Halkapınar depot transformer B",
    point: { x: depotPoint.x + 9, y: depotPoint.y - 8 },
    nominalVoltageV: 750,
    maxPowerKw: 1_200,
    confidence: "verified-count-estimated-location",
    evidence: "İBB confirms two transformer buildings in the Konak depot area",
    feedsMainLine: false,
  },
];

export const IZMIR_KONAK_SCENARIO: ScenarioDefinition = {
  id: "izmir-konak",
  name: "İzmir · Konak Tramvayı (T2)",
  shortName: "Konak Tram · İzmir",
  description:
    "Real alignment of İzmir's T2 Konak Tram, Halkapınar to Fahrettin Altay: 19 real stations at their real coordinates, the genuine one-way-pair split around Alsancak (Şehitler/Liman Caddesi) and along the coast, the Halkapınar depot, and four real named road junctions with their own signals.",
  useCase:
    "A real, currently-operating 12.8 km city tram line for testing dispatcher and passenger-demand logic against realistic scale and headways.",
  segments: allSegments,
  readers: [...stationReaders, ...trafficReaders],
  signals,
  switches: [],
  routes: [route],
  starts,
  defaultObstacles: [],
  defaultTramCount: 15,
  fleetOptions: [6, 10, 15, 18, 21],
  fleetGroups,
  depots,
  serviceSchedule,
  serviceStartMinute: 7 * 60,
  dispatchIntervalSeconds: 180,
  predeployedFleet: true,
  metersPerReferenceUnit: METERS_PER_REFERENCE_UNIT,
  mapContext: {
    title: "İzmir · Konak Tramvayı (T2)",
    subtitle: "Halkapınar ↔ Fahrettin Altay · 12.8 km · 19 stations",
    sourceLabel: "İBB açık veri (station coordinates) · straight-line interpolation between stops",
    lines: [],
    landmarks: [
      { label: "Halkapınar Depo Sahası", point: depotPoint },
      { label: "Konak İskele", point: pointFor("konak_iskele", "outbound") },
      { label: "Üçkuyular", point: pointFor("uckuyular", "outbound") },
    ],
    scaleBarMeters: 1000,
  },
  tractionPowerSystem: {
    nominalVoltageV: 750,
    label: "Konak T2 750 V DC traction sections",
    sourceLabel: "İzmir Metropolitan Municipality: 8 transformer buildings (6 line + 2 depot); Basmane feeder fault report, 2 Dec 2024",
    modelNote: "The official transformer count and Basmane supply location are verified. Other line markers and section boundaries are explicitly reconstructed estimates. Each of the six line sections has a three-module 750 V VYCON experimental bank.",
    substations: [...izmirLineSubstations, ...izmirDepotSubstations],
    sections: buildNearestSubstationSections(
      allSegments,
      izmirLineSubstations,
      ["#fb7185", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#a78bfa"],
    ).map((section) => ({ ...section, flywheel: {
      model: "VYCON REGEN" as const,
      modules: 3,
      modulePowerKw: 125,
      moduleEnergyKWh: 0.520833,
      chargeEfficiency: 0.95,
      dischargeEfficiency: 0.95,
      initialSoc: 0.35,
      converterNote: "Direct 750 V DC traction-bus interface; 90.25% modeled round-trip efficiency",
    } })),
  },
};
