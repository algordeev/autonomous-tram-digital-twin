import { geoMercator, type GeoPermissibleObjects } from "d3-geo";
import type {
  MapContext,
  Point,
  RFIDReader,
  ScenarioDefinition,
  SignalDefinition,
  SwitchDefinition,
  TrackSegment,
  TractionSubstationDefinition,
} from "./simulation-core/index.ts";
import { buildNearestSubstationSections } from "./simulation-core/traction-power.ts";

type LonLat = [longitude: number, latitude: number];

interface GeoStop {
  id: string;
  name: string;
  coordinates: LonLat;
  major?: boolean;
}

interface GeoSwitchSite {
  id: string;
  label: string;
  coordinates: LonLat;
  branchCoordinates: LonLat;
  routeALegIndex: number;
  trackProgress?: number;
}

interface GeoTrafficSite {
  code: string;
  label: string;
  coordinates: LonLat;
  routeALegIndex: number;
}

const STUDY_LENGTH_METERS = 8_600;
const TRACK_CENTERLINE_GAP = 24;
const TURNOUT_STOP_CLEARANCE = 0.18;

// Five automated turnout complexes from the 2021 Route 2 study. Each complex
// groups the paired OSM switch nodes used by the two physical tracks.
const SWITCH_SITES: GeoSwitchSite[] = [
  {
    id: "SW-LYD",
    label: "Пл. Лядова · к просп. Гагарина",
    coordinates: [43.98795, 56.30801],
    branchCoordinates: [43.98747, 56.30634],
    routeALegIndex: 16,
  },
  {
    id: "SW-KRS",
    label: "Красносельская × Ильинская",
    coordinates: [43.98342, 56.30862],
    branchCoordinates: [43.98099, 56.30885],
    routeALegIndex: 15,
    trackProgress: 0.7,
  },
  {
    id: "SW-OSH",
    label: "Белинского × Ошарская",
    coordinates: [44.01235, 56.31487],
    branchCoordinates: [44.01195, 56.31619],
    routeALegIndex: 2,
  },
  {
    id: "SW-MAS",
    label: "Маслякова × Ильинская",
    coordinates: [43.98671, 56.31518],
    branchCoordinates: [43.98897, 56.31508],
    routeALegIndex: 13,
    trackProgress: 0.7,
  },
  {
    id: "SW-CHP",
    label: "Чёрный пруд · Пискунова",
    coordinates: [44.00695, 56.324],
    branchCoordinates: [44.0076, 56.32315],
    routeALegIndex: 9,
    trackProgress: 0.7,
  },
];

// A deliberately small set of the route's major street junctions. Coordinates
// are attached to the actual intersections; approach detectors are generated
// a short distance before each stop line and stay hidden on the map.
const TRAFFIC_SITES: GeoTrafficSite[] = [
  {
    code: "LYD",
    label: "Площадь Лядова",
    coordinates: [43.985011, 56.307599],
    routeALegIndex: 16,
  },
  {
    code: "OSH",
    label: "Белинского × Ошарская",
    coordinates: [44.01235, 56.31487],
    routeALegIndex: 2,
  },
  {
    code: "SEN",
    label: "Сенная площадь",
    coordinates: [44.032528, 56.322988],
    routeALegIndex: 5,
  },
  {
    code: "BPE",
    label: "Большая Печёрская × Пискунова",
    coordinates: [44.013905, 56.326456],
    routeALegIndex: 8,
  },
  {
    code: "MAS",
    label: "Маслякова × Ильинская",
    coordinates: [43.986699, 56.315623],
    routeALegIndex: 13,
  },
];

// Stop coordinates follow the published Route 2 sequence. The duplicated
// terminus entry used by timetables is represented once on the physical map.
const STOPS: GeoStop[] = [
  {
    id: "ST01",
    name: "Рынок Средной",
    coordinates: [43.990558, 56.309433],
    major: true,
  },
  { id: "ST02", name: "Студёная", coordinates: [43.999347, 56.310453] },
  { id: "ST03", name: "Ашхабадская", coordinates: [44.006283, 56.312709] },
  {
    id: "ST04",
    name: "Оперный театр",
    coordinates: [44.016569, 56.316239],
    major: true,
  },
  { id: "ST05", name: "Полтавская", coordinates: [44.023221, 56.318054] },
  { id: "ST06", name: "Белинского", coordinates: [44.026393, 56.318946] },
  {
    id: "ST07",
    name: "Большая Печёрская",
    coordinates: [44.032528, 56.322988],
    major: true,
  },
  {
    id: "ST08",
    name: "Университет им. Добролюбова",
    coordinates: [44.027934, 56.323973],
  },
  {
    id: "ST09",
    name: "Высшая школа экономики",
    coordinates: [44.022086, 56.325159],
  },
  { id: "ST10", name: "Речное училище", coordinates: [44.013871, 56.326634] },
  {
    id: "ST11",
    name: "Чёрный Пруд",
    coordinates: [44.006962, 56.324239],
    major: true,
  },
  {
    id: "ST12",
    name: "Большая Покровская",
    coordinates: [44.000949, 56.321954],
  },
  {
    id: "ST13",
    name: "Добролюбова",
    coordinates: [43.993563, 56.324647],
  },
  { id: "ST14", name: "Нижегородская", coordinates: [43.990104, 56.321163] },
  { id: "ST15", name: "Маслякова", coordinates: [43.986979, 56.315733] },
  { id: "ST16", name: "Максима Горького", coordinates: [43.985662, 56.313211] },
  {
    id: "ST17",
    name: "Красносельская",
    coordinates: [43.983341, 56.30897],
    major: true,
  },
];

const ringFeature: GeoPermissibleObjects = {
  type: "LineString",
  coordinates: [
    ...STOPS.map((stop) => stop.coordinates),
    STOPS[0].coordinates,
  ],
};

const projection = geoMercator().fitExtent(
  [
    [92, 70],
    [908, 548],
  ],
  ringFeature,
);

const project = (coordinates: LonLat): Point => {
  const projected = projection(coordinates);
  if (!projected) throw new Error("Route 2 coordinate could not be projected");
  return { x: projected[0], y: projected[1] };
};

const projectedStops = STOPS.map((stop) => ({
  ...stop,
  point: project(stop.coordinates),
}));

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const interpolatePoint = (start: Point, end: Point, progress: number): Point => ({
  x: start.x + (end.x - start.x) * progress,
  y: start.y + (end.y - start.y) * progress,
});

// Route 2 is double-track. Build two genuine simulation paths instead of
// drawing both directions over one centreline, so trams remain visibly apart.
const offsetClosedRing = (points: Point[], offset: number) =>
  points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const incoming = {
      x: point.x - previous.x,
      y: point.y - previous.y,
    };
    const outgoing = {
      x: next.x - point.x,
      y: next.y - point.y,
    };
    const incomingLength = Math.max(0.001, Math.hypot(incoming.x, incoming.y));
    const outgoingLength = Math.max(0.001, Math.hypot(outgoing.x, outgoing.y));
    const incomingNormal = {
      x: -incoming.y / incomingLength,
      y: incoming.x / incomingLength,
    };
    const outgoingNormal = {
      x: -outgoing.y / outgoingLength,
      y: outgoing.x / outgoingLength,
    };
    const normalSum = {
      x: incomingNormal.x + outgoingNormal.x,
      y: incomingNormal.y + outgoingNormal.y,
    };
    const normalLength = Math.max(0.001, Math.hypot(normalSum.x, normalSum.y));
    const bisector = {
      x: normalSum.x / normalLength,
      y: normalSum.y / normalLength,
    };
    const miterScale = clamp(
      1 / Math.max(0.55, Math.abs(bisector.x * outgoingNormal.x + bisector.y * outgoingNormal.y)),
      1,
      1.25,
    );
    return {
      x: point.x + bisector.x * offset * miterScale,
      y: point.y + bisector.y * offset * miterScale,
    };
  });

const centrelinePoints = projectedStops.map((stop) => stop.point);
const routeAStopPoints = offsetClosedRing(
  centrelinePoints,
  -TRACK_CENTERLINE_GAP / 2,
);
const routeBStopPoints = offsetClosedRing(
  centrelinePoints,
  TRACK_CENTERLINE_GAP / 2,
);

const projectedSwitchSites = SWITCH_SITES.map((site) => ({
  ...site,
  ...(() => {
    const nextIndex = (site.routeALegIndex + 1) % projectedStops.length;
    const start = projectedStops[site.routeALegIndex].point;
    const end = projectedStops[nextIndex].point;
    const measuredPoint = project(site.coordinates);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const rawProgress =
      ((measuredPoint.x - start.x) * dx + (measuredPoint.y - start.y) * dy) /
      Math.max(0.001, dx * dx + dy * dy);
    const trackProgress = clamp(
      site.trackProgress ?? rawProgress,
      TURNOUT_STOP_CLEARANCE,
      1 - TURNOUT_STOP_CLEARANCE,
    );
    return {
      trackProgress,
      point: interpolatePoint(
        routeAStopPoints[site.routeALegIndex],
        routeAStopPoints[nextIndex],
        trackProgress,
      ),
      routeBPoint: interpolatePoint(
        routeBStopPoints[site.routeALegIndex],
        routeBStopPoints[nextIndex],
        trackProgress,
      ),
      branchPoint: project(site.branchCoordinates),
    };
  })(),
}));

const projectedTrafficSites = TRAFFIC_SITES.map((site) => ({
  ...site,
  point: project(site.coordinates),
}));

const haversineMeters = (first: LonLat, second: LonLat) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_008.8;
  const latitudeDelta = radians(second[1] - first[1]);
  const longitudeDelta = radians(second[0] - first[0]);
  const firstLatitude = radians(first[1]);
  const secondLatitude = radians(second[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const rawLegLengths = STOPS.map((stop, index) =>
  haversineMeters(stop.coordinates, STOPS[(index + 1) % STOPS.length].coordinates),
);
const routeScale =
  STUDY_LENGTH_METERS /
  rawLegLengths.reduce((total, currentLength) => total + currentLength, 0);

const routeASegments: TrackSegment[] = projectedStops.map((stop, index) => {
  const nextIndex = (index + 1) % projectedStops.length;
  const nextStop = projectedStops[nextIndex];
  const switchPoints = projectedSwitchSites
    .filter((site) => site.routeALegIndex === index)
    .map((site) => site.point);
  return {
    id: `N2A${String(index + 1).padStart(2, "0")}`,
    from: `A${String(index + 1).padStart(2, "0")}`,
    to: `A${String(nextIndex + 1).padStart(2, "0")}`,
    points: [routeAStopPoints[index], ...switchPoints, routeAStopPoints[nextIndex]],
    label: `${stop.name} → ${nextStop.name}`,
    lengthMeters: rawLegLengths[index] * routeScale,
  };
});

const routeBSegments: TrackSegment[] = projectedStops.map((stop, index) => {
  const previousIndex = (index - 1 + projectedStops.length) % projectedStops.length;
  const previousStop = projectedStops[previousIndex];
  const switchPoints = projectedSwitchSites
    .filter((site) => site.routeALegIndex === previousIndex)
    .map((site) => site.routeBPoint)
    .reverse();
  return {
    id: `N2B${String(index + 1).padStart(2, "0")}`,
    from: `B${String(index + 1).padStart(2, "0")}`,
    to: `B${String(previousIndex + 1).padStart(2, "0")}`,
    points: [
      routeBStopPoints[index],
      ...switchPoints,
      routeBStopPoints[previousIndex],
    ],
    label: `${stop.name} → ${previousStop.name}`,
    lengthMeters: rawLegLengths[previousIndex] * routeScale,
  };
});

// Elevation differences from the 2021 Route 2 energy study (102 m of measured
// descents). The reverse rail receives the opposite signed profile.
const ROUTE_2_CLOCKWISE_ELEVATION_METERS: Record<string, number> = {
  N2B07: -17,
  N2B11: -14,
  N2B12: -7,
  N2B13: -14,
  N2B14: -19,
  N2B15: -10,
  N2B16: -9,
  N2B17: -12,
};
const ROUTE_2_COUNTERCLOCKWISE_ELEVATION_METERS: Record<string, number> = {
  N2A06: 17,
  N2A10: 14,
  N2A11: 7,
  N2A12: 14,
  N2A13: 19,
  N2A14: 10,
  N2A15: 9,
  N2A16: 12,
};
for (const segment of [...routeASegments, ...routeBSegments]) {
  segment.elevationChangeMeters =
    ROUTE_2_CLOCKWISE_ELEVATION_METERS[segment.id] ??
    ROUTE_2_COUNTERCLOCKWISE_ELEVATION_METERS[segment.id] ??
    0;
}

const branchSegments: TrackSegment[] = projectedSwitchSites.map((site) => ({
  id: `N2X-${site.id.slice(3)}`,
  from: site.id,
  to: `EXIT-${site.id.slice(3)}`,
  points: [site.point, site.branchPoint],
  label: site.label,
  lengthMeters: haversineMeters(site.coordinates, site.branchCoordinates),
}));

const progressAtPoint = (segment: TrackSegment, point: Point) => {
  let distanceBeforePoint = 0;
  let totalDistance = 0;
  let found = false;
  for (let index = 1; index < segment.points.length; index += 1) {
    const previous = segment.points[index - 1];
    const current = segment.points[index];
    const legDistance = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    totalDistance += legDistance;
    if (!found) {
      distanceBeforePoint += legDistance;
      if (current === point) found = true;
    }
  }
  return totalDistance > 0 ? distanceBeforePoint / totalDistance : 0;
};

const closestProgressOnSegment = (segment: TrackSegment, point: Point) => {
  let totalLength = 0;
  const legLengths: number[] = [];
  for (let index = 1; index < segment.points.length; index += 1) {
    const length = Math.hypot(
      segment.points[index].x - segment.points[index - 1].x,
      segment.points[index].y - segment.points[index - 1].y,
    );
    legLengths.push(length);
    totalLength += length;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let distanceBefore = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    const start = segment.points[index - 1];
    const end = segment.points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = Math.max(0.000001, dx * dx + dy * dy);
    const local = Math.max(
      0,
      Math.min(
        1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) /
          squaredLength,
      ),
    );
    const candidate = {
      x: start.x + dx * local,
      y: start.y + dy * local,
    };
    const candidateDistance = Math.hypot(
      point.x - candidate.x,
      point.y - candidate.y,
    );
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestAlong = distanceBefore + legLengths[index - 1] * local;
    }
    distanceBefore += legLengths[index - 1];
  }
  return totalLength > 0 ? bestAlong / totalLength : 0;
};

const turnoutDefinitions: SwitchDefinition[] = projectedSwitchSites.map((site) => {
  const mainSegment = routeASegments[site.routeALegIndex];
  const routeBSegment =
    routeBSegments[
      (site.routeALegIndex + 1) % routeBSegments.length
    ];
  return {
    id: site.id,
    nodeId: site.id,
    mainSegmentId: mainSegment.id,
    branchSegmentId: `N2X-${site.id.slice(3)}`,
    label: site.label,
    segmentId: mainSegment.id,
    at: progressAtPoint(mainSegment, site.point),
    alternateApproaches: [
      {
        segmentId: routeBSegment.id,
        at: progressAtPoint(routeBSegment, site.routeBPoint),
      },
    ],
  };
});

const stationReaders: RFIDReader[] = [
  ...routeASegments.map((segment, index) => {
    const destinationIndex = (index + 1) % STOPS.length;
    const destination = STOPS[destinationIndex];
    return {
      id: `S${String(destinationIndex + 1).padStart(2, "0")}A`,
      segmentId: segment.id,
      at: Math.max(0.04, 0.975 - 160 / Math.max(1, segment.lengthMeters ?? 500)),
      kind: "station" as const,
      label: destination.name,
      stationNumber: destinationIndex + 1,
      showLabel: destination.major,
      displayAt: 0.975,
    };
  }),
  ...routeBSegments.map((segment, index) => {
    const destinationIndex = (index - 1 + STOPS.length) % STOPS.length;
    const destination = STOPS[destinationIndex];
    return {
      id: `S${String(destinationIndex + 1).padStart(2, "0")}B`,
      segmentId: segment.id,
      at: Math.max(0.04, 0.975 - 160 / Math.max(1, segment.lengthMeters ?? 500)),
      kind: "station" as const,
      label: destination.name,
      stationNumber: destinationIndex + 1,
      showLabel: false,
      render: false,
      displayAt: 0.975,
    };
  }),
];

const trafficControls = projectedTrafficSites.flatMap((site) =>
  (["A", "B"] as const).map((direction) => {
    const segment =
      direction === "A"
        ? routeASegments[site.routeALegIndex]
        : routeBSegments[
            (site.routeALegIndex + 1) % routeBSegments.length
          ];
    const signalAt = Math.max(
      0.06,
      Math.min(0.94, closestProgressOnSegment(segment, site.point)),
    );
    const detectorLead = Math.max(
      0.035,
      75 / Math.max(1, segment.lengthMeters ?? 1),
    );
    const signalId = `SG-${site.code}-${direction}`;
    return {
      reader: {
        id: `DET-${site.code}-${direction}`,
        segmentId: segment.id,
        at: Math.max(0.015, signalAt - detectorLead),
        kind: "traffic" as const,
        label: `${site.label} approach detector`,
        signalId,
        render: false,
      } satisfies RFIDReader,
      signal: {
        id: signalId,
        controllerId: `J-${site.code}`,
        segmentId: segment.id,
        at: signalAt,
        label: site.label,
        render: direction === "A",
        amberSeconds: 3,
        tramGreenSeconds: 8,
        clearanceSeconds: 2,
      } satisfies SignalDefinition,
    };
  }),
);

const physicalRingLength = routeASegments.reduce(
  (total, segment) =>
    total +
    segment.points.slice(1).reduce((segmentTotal, point, pointIndex) => {
      const previous = segment.points[pointIndex];
      return segmentTotal + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0),
  0,
);

const mapContext: MapContext = {
  title: "Нижний Новгород · городской центр",
  subtitle: "Географическая проекция реального кольца",
  sourceLabel: "Stops: public route map · 5 turnout complexes: OSM + 2021 study",
  lines: [
    {
      id: "BELINSKOGO",
      label: "ул. Белинского",
      kind: "primary",
      points: projectedStops.slice(0, 7).map((stop) => stop.point),
      labelAt: 0.57,
    },
    {
      id: "PECHERSKAYA",
      label: "Большая Печёрская / Пискунова",
      kind: "primary",
      points: projectedStops.slice(6, 12).map((stop) => stop.point),
      labelAt: 0.48,
    },
    {
      id: "CENTRE",
      label: "Ильинская / Маслякова",
      kind: "secondary",
      points: [
        ...projectedStops.slice(11).map((stop) => stop.point),
        projectedStops[0].point,
      ],
      labelAt: 0.56,
    },
  ],
  landmarks: [
    // Intentionally empty: operational layers carry the useful map context.
  ],
  scaleBarMeters: 1_000,
};

const routeAIds = routeASegments.map((segment) => segment.id);
const routeBIds = routeBSegments.map((segment) => segment.id);
const route2PowerSegments = [...routeASegments, ...routeBSegments, ...branchSegments];
const route2Substations: TractionSubstationDefinition[] = [
  {
    id: "NN-TP-BELINSKOGO",
    label: "Тяговая подстанция · Белинского, 105А",
    sectionLabel: "Белинского — южная дуга",
    point: projectedStops[4].point,
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022; marker snapped to nearest Route 2 rail",
  },
  {
    id: "NN-TP-BPECHERSKAYA",
    label: "Тяговая подстанция №30 · Большая Печёрская, 11Б",
    sectionLabel: "Сенная — Большая Печёрская",
    point: projectedStops[7].point,
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022; public map listing identifies TP-30",
  },
  {
    id: "NN-TP-LUDILNY",
    label: "Тяговая подстанция №15 · Лудильный пер., 2З",
    sectionLabel: "Чёрный Пруд — Нижегородская",
    point: projectedStops[11].point,
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022; marker snapped to nearest Route 2 rail",
  },
];

export const NIZHNY_ROUTE_2_SCENARIO: ScenarioDefinition = {
  id: "nizhny-route-2",
  name: "Nizhny Novgorod · Tram 2",
  shortName: "Route 2 · real map",
  description:
    "The real city-centre ring projected from stop coordinates, with both travel directions, five mapped turnout complexes and five independent priority-controlled street junctions.",
  useCase:
    "Replay the 2021 Route 2 analysis, then stress-test headways, obstacles and signal priority with ten trams.",
  segments: route2PowerSegments,
  readers: [
    ...stationReaders,
    ...trafficControls.map((control) => control.reader),
  ],
  signals: trafficControls.map((control) => control.signal),
  switches: turnoutDefinitions,
  routes: [
    {
      id: "2A",
      name: "counter-clockwise",
      shortName: "2 ↺",
      color: "#ffc13b",
      segmentIds: routeAIds,
      labelSegmentId: "N2A03",
      labelAt: 0.56,
      labelOffset: -34,
    },
    {
      id: "2B",
      name: "clockwise",
      shortName: "2 ↻",
      color: "#59d8e8",
      segmentIds: routeBIds,
      labelSegmentId: "N2A12",
      labelAt: 0.44,
      labelOffset: 36,
    },
  ],
  starts: [
    { segmentId: "N2A01", progress: 0.08 },
    { segmentId: "N2B03", progress: 0.08 },
    { segmentId: "N2A04", progress: 0.08 },
    { segmentId: "N2B07", progress: 0.08 },
    { segmentId: "N2A08", progress: 0.08 },
    { segmentId: "N2B10", progress: 0.08 },
    { segmentId: "N2A11", progress: 0.08 },
    { segmentId: "N2B13", progress: 0.08 },
    { segmentId: "N2A15", progress: 0.08 },
    { segmentId: "N2B16", progress: 0.08 },
  ],
  defaultObstacles: [],
  defaultTramCount: 10,
  fleetOptions: [1, 2, 4, 6, 10],
  dispatchIntervalSeconds: 180,
  predeployedFleet: true,
  metersPerReferenceUnit: STUDY_LENGTH_METERS / physicalRingLength,
  mapContext,
  tractionPowerSystem: {
    nominalVoltageV: 600,
    label: "Nizhny Novgorod 600 V DC traction sections",
    sourceLabel: "Nizhny Novgorod City Duma decision №96 (25 May 2022) · public property addresses",
    modelNote: "Substation buildings are verified by address. Exact feeder breakers and section-post boundaries are not public, so boundaries are reconstructed at midpoints between the nearest verified supplies.",
    substations: route2Substations,
    sections: buildNearestSubstationSections(
      route2PowerSegments,
      route2Substations,
      ["#f59e0b", "#22c55e", "#38bdf8"],
    ).map((section, index) => ({ ...section, flywheel: {
      model: "VYCON REGEN" as const,
      modules: [13, 13, 12][index] ?? 0,
      modulePowerKw: 125,
      moduleEnergyKWh: 0.520833,
      chargeEfficiency: 0.95,
      dischargeEfficiency: 0.95,
      initialSoc: 0.35,
      converterNote: "Bidirectional 600↔750 V DC converter; 90.25% modeled round-trip efficiency",
    } })),
  },
  studyBaseline: {
    label: "2021 analysis baseline",
    lengthKm: 8.6,
    directionalStops: 36,
    mappedStopLocations: STOPS.length,
    fleet: 10,
    headwayMinutes: 3,
    serviceHours: 16,
    dailyTrips: 320,
  },
};
