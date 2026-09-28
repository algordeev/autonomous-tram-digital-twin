import { geoMercator, type GeoPermissibleObjects } from "d3-geo";
import type {
  MapContext,
  Point,
  RFIDReader,
  RouteDefinition,
  ScenarioDefinition,
  SignalDefinition,
  TrackSegment,
  TractionSubstationDefinition,
} from "./simulation-core/index.ts";
import { buildNearestSubstationSections } from "./simulation-core/traction-power.ts";

type LonLat = [longitude: number, latitude: number];

interface StopSite {
  id: string;
  name: string;
  coordinates: LonLat;
  number: number;
  major?: boolean;
}

interface DirectionStop extends StopSite {
  nodeId: string;
}

// OSM route relations 2986641 / 2986642, simplified to operational geometry.
// Coordinates remain geographic until a single projection is fitted to both routes.
const ROUTE_2_CCW: LonLat[] = [
  [44.0065825, 56.3241691],
  [44.005224, 56.3240158],
  [44.0042548, 56.3221774],
  [43.9994341, 56.3219144],
  [43.9983481, 56.3221607],
  [43.9960828, 56.323592],
  [43.9942025, 56.3244356],
  [43.9923968, 56.3249489],
  [43.991883, 56.3249156],
  [43.9901394, 56.321333],
  [43.9851492, 56.3124194],
  [43.9832148, 56.3088133],
  [43.983247, 56.3086206],
  [43.9835718, 56.308442],
  [43.9878655, 56.3079812],
  [43.9981493, 56.3100697],
  [44.0129248, 56.3150441],
  [44.0231308, 56.3181021],
  [44.0286619, 56.3194804],
  [44.0304217, 56.3201722],
  [44.0342465, 56.3224404],
  [44.0340114, 56.3227184],
  [44.0142633, 56.3268109],
  [44.0121753, 56.3256141],
  [44.0090165, 56.3243752],
  [44.0065825, 56.3241691],
];

const ROUTE_2_CW: LonLat[] = [
  [44.0072186, 56.3237945],
  [44.0071915, 56.3239947],
  [44.0073846, 56.3241523],
  [44.0089254, 56.324311],
  [44.0121053, 56.3255414],
  [44.0143149, 56.3267799],
  [44.0338457, 56.3227216],
  [44.0341627, 56.322444],
  [44.0303895, 56.3201885],
  [44.0286407, 56.3195043],
  [44.0231069, 56.3181291],
  [44.0128778, 56.3150613],
  [43.9984168, 56.3101745],
  [43.9878555, 56.3080158],
  [43.9835927, 56.3084741],
  [43.9833057, 56.308623],
  [43.9832843, 56.3088313],
  [43.9852197, 56.3124314],
  [43.9901567, 56.3212304],
  [43.99194, 56.3249048],
  [43.9941635, 56.3244108],
  [43.9959377, 56.3236106],
  [43.9983304, 56.3221467],
  [43.9994247, 56.3218979],
  [44.0079099, 56.3223736],
  [44.0079829, 56.3225058],
  [44.0072186, 56.3237945],
];

// OSM route relations 2986734 / 2986735. Only the non-shared portions are
// turned into Route 21 segments; the city-centre section reuses Route 2 rails.
const ROUTE_21_OUT: LonLat[] = [
  [43.9216651, 56.2650856],
  [43.9245274, 56.2667795],
  [43.9329282, 56.2724293],
  [43.9338536, 56.2734699],
  [43.934239, 56.2744504],
  [43.9344496, 56.2760908],
  [43.9398697, 56.2834611],
  [43.9406284, 56.2889689],
  [43.9426249, 56.2930074],
  [43.9423716, 56.2939634],
  [43.9429404, 56.2953294],
  [43.9429135, 56.2961527],
  [43.9445331, 56.2984552],
  [43.945405, 56.2987944],
  [43.9480079, 56.2988192],
  [43.9699369, 56.2987984],
  [43.9720286, 56.2984253],
  [43.973094, 56.2985755],
  [43.9737036, 56.299037],
  [43.9737469, 56.299578],
  [43.973339, 56.299986],
  [43.9713063, 56.3006616],
  [43.9708664, 56.3009885],
  [43.9707276, 56.3014608],
  [43.9710403, 56.3027346],
  [43.9719171, 56.3035539],
  [43.9725065, 56.3038553],
  [43.9735531, 56.3039687],
  [43.9750821, 56.3036702],
  [43.9762242, 56.3037397],
  [43.9804624, 56.3054331],
  [43.9804391, 56.3057412],
  [43.9798272, 56.3063039],
  [43.9794552, 56.3069895],
  [43.9801199, 56.3088614],
  [43.9803395, 56.308947],
  [43.9827664, 56.3085304],
  [43.9832166, 56.3086994],
  [43.9901567, 56.3212304],
  [43.99194, 56.3249048],
  [43.9941635, 56.3244108],
  [43.9959377, 56.3236106],
  [43.9983304, 56.3221467],
  [43.9994247, 56.3218979],
  [44.0079099, 56.3223736],
  [44.0079829, 56.3225058],
  [44.0072186, 56.3237945],
];

const ROUTE_21_IN: LonLat[] = [
  [44.0065825, 56.3241691],
  [44.005224, 56.3240158],
  [44.0042548, 56.3221774],
  [43.9994341, 56.3219144],
  [43.9983481, 56.3221607],
  [43.9960828, 56.323592],
  [43.9942025, 56.3244356],
  [43.9923968, 56.3249489],
  [43.991883, 56.3249156],
  [43.9901394, 56.321333],
  [43.9831578, 56.308708],
  [43.9828073, 56.3085603],
  [43.9803883, 56.3089783],
  [43.9800865, 56.308906],
  [43.97951, 56.307547],
  [43.979409, 56.3069147],
  [43.9797101, 56.3063547],
  [43.9804163, 56.3056863],
  [43.9803838, 56.3054233],
  [43.9762081, 56.3037616],
  [43.9750776, 56.3036943],
  [43.9733144, 56.3040039],
  [43.9725648, 56.3039032],
  [43.9719267, 56.3036049],
  [43.9710517, 56.3028134],
  [43.9706747, 56.3014337],
  [43.9707628, 56.3010635],
  [43.9712376, 56.3006553],
  [43.9735293, 56.2997982],
  [43.9737308, 56.2994863],
  [43.9737078, 56.2991502],
  [43.9731845, 56.2986545],
  [43.9722158, 56.2984562],
  [43.9699871, 56.2988275],
  [43.9452162, 56.2988276],
  [43.9448384, 56.2988968],
  [43.9444651, 56.2991887],
  [43.9439127, 56.2990957],
  [43.9438088, 56.2987717],
  [43.944296, 56.2982329],
  [43.9428277, 56.2960875],
  [43.9428909, 56.2953837],
  [43.9423087, 56.2938915],
  [43.9425927, 56.2930319],
  [43.9405498, 56.2888918],
  [43.9398556, 56.283547],
  [43.9343745, 56.276093],
  [43.934176, 56.2744594],
  [43.9336435, 56.2732475],
  [43.9328881, 56.272451],
  [43.9245119, 56.2668027],
  [43.922511, 56.2656331],
  [43.9209198, 56.2653198],
];

// Route relations 2986734 / 2986735 also contain the shared Route 2 section
// between Krasnoselskaya and Chyorny Prud. Keep only the private corridor here;
// the shared section is represented by the Route 2 segments below. Starting
// ROUTE_21_IN at Chyorny Prud and then snapping it to Krasnoselskaya creates a
// false diagonal across the city, so the private paths deliberately terminate
// at the real turnout nodes.
const ROUTE_21_OUT_PRIVATE: LonLat[] = [
  ...ROUTE_21_OUT.slice(0, 38),
  [43.9832843, 56.3088313],
];
const ROUTE_21_IN_PRIVATE: LonLat[] = [
  [43.9832148, 56.3088133],
  ...ROUTE_21_IN.slice(10),
];

// OSM tram ways 694349061, 97945754, 685387516, 685410928, 664681270 and
// 694796509 at Krasnoselskaya. Together these six one-way curves form the real
// triangular junction: every approach can continue to either of the other two
// sides. Routes 2 and 21 use four curves in normal service; the remaining pair
// stays available for manual turnout experiments.
const KRS_NORTH_TO_EAST: LonLat[] = [
  [43.9832148, 56.3088133],
  [43.9832159, 56.3087464],
  [43.9832166, 56.3086994],
  [43.983247, 56.3086206],
  [43.9832966, 56.3085581],
  [43.9833334, 56.3085362],
  [43.9834013, 56.3084958],
  [43.9835718, 56.308442],
];
const KRS_NORTH_TO_WEST: LonLat[] = [
  [43.9832148, 56.3088133],
  [43.9831578, 56.308708],
  [43.9830865, 56.3086502],
  [43.9829915, 56.3085972],
  [43.9829259, 56.3085841],
  [43.9828073, 56.3085603],
];
const KRS_EAST_TO_NORTH: LonLat[] = [
  [43.9835927, 56.3084741],
  [43.9834398, 56.3085233],
  [43.9833623, 56.308564],
  [43.9833057, 56.308623],
  [43.9832815, 56.3086903],
  [43.9832789, 56.3087346],
  [43.9832843, 56.3088313],
];
const KRS_EAST_TO_WEST: LonLat[] = [
  [43.9835927, 56.3084741],
  [43.9834013, 56.3084958],
  [43.9831152, 56.308529],
  [43.9829275, 56.3085507],
  [43.9828073, 56.3085603],
];
const KRS_WEST_TO_NORTH: LonLat[] = [
  [43.9827664, 56.3085304],
  [43.9829275, 56.3085507],
  [43.9830083, 56.308567],
  [43.983082, 56.308599],
  [43.9831592, 56.3086481],
  [43.9832166, 56.3086994],
  [43.9832843, 56.3088313],
];
const KRS_WEST_TO_EAST: LonLat[] = [
  [43.9827664, 56.3085304],
  [43.9831011, 56.3084937],
  [43.9835718, 56.308442],
];

// OSM one-way terminal tracks. Chyorny Prud connects the clockwise Route 2
// rail to the counter-clockwise rail; Park Dubki closes Route 21 at the west end.
const CHYORNY_PRUD_LOOP: LonLat[] = [
  [44.0072186, 56.3237945],
  [44.0071944, 56.3238356],
  [44.007141, 56.3239299],
  [44.0066802, 56.3241736],
  [44.0065825, 56.3241691],
];

const PARK_DUBKI_LOOP: LonLat[] = [
  [43.9209198, 56.2653198],
  [43.9207978, 56.2652643],
  [43.9207254, 56.2651664],
  [43.9207381, 56.2650595],
  [43.920834, 56.2649696],
  [43.9210003, 56.2649057],
  [43.9212035, 56.2649008],
  [43.9213939, 56.2649496],
  [43.9216651, 56.2650856],
];

const ROUTE_2_STOPS: StopSite[] = [
  { id: "srednoy", name: "Рынок Средной", coordinates: [43.9890366, 56.3082128], number: 1, major: true },
  { id: "studenaya", name: "Студёная", coordinates: [43.9989664, 56.3103082], number: 2 },
  { id: "ashkhabad", name: "Ашхабадская", coordinates: [44.0063459, 56.3127484], number: 3 },
  { id: "opera", name: "Оперный театр", coordinates: [44.0165897, 56.3161609], number: 4, major: true },
  { id: "poltavskaya", name: "Полтавская", coordinates: [44.0226555, 56.3179578], number: 5 },
  { id: "belinskogo", name: "Белинского", coordinates: [44.0263575, 56.3189095], number: 6 },
  { id: "sennaya", name: "Сенная площадь", coordinates: [44.033287, 56.3228509], number: 7, major: true },
  { id: "trudovaya", name: "Трудовая", coordinates: [44.0278623, 56.3239826], number: 8 },
  { id: "hse", name: "Высшая школа экономики", coordinates: [44.022274, 56.3251257], number: 9 },
  { id: "river", name: "Речное училище", coordinates: [44.0137652, 56.3265825], number: 10 },
  { id: "chyorny-prud", name: "Чёрный Пруд", coordinates: [44.0069, 56.324], number: 11, major: true },
  { id: "pokrovskaya", name: "Большая Покровская", coordinates: [44.0009214, 56.3219726], number: 12 },
  { id: "dobrolyubova", name: "Добролюбова", coordinates: [43.9933284, 56.3247044], number: 13 },
  { id: "nizhegorodskaya", name: "Нижегородская", coordinates: [43.9902169, 56.3214902], number: 14 },
  { id: "maslyakova", name: "Маслякова", coordinates: [43.9869299, 56.3156322], number: 15 },
  { id: "gorkogo", name: "Максима Горького", coordinates: [43.9853367, 56.3127581], number: 16 },
  { id: "krasnoselskaya", name: "Красносельская", coordinates: [43.9832854, 56.3089455], number: 17, major: true },
];

const ROUTE_21_PRIVATE: StopSite[] = [
  { id: "park-dubki", name: "Парк «Дубки»", coordinates: [43.9212, 56.2652], number: 18, major: true },
  { id: "nakhimova", name: "Нахимова", coordinates: [43.9262481, 56.2679053], number: 19 },
  { id: "gleba-uspenskogo", name: "Глеба Успенского", coordinates: [43.9305709, 56.2708227], number: 20 },
  { id: "oktava", name: "ЖК «Октава»", coordinates: [43.9340522, 56.2738652], number: 21 },
  { id: "komarova", name: "Комарова", coordinates: [43.9350816, 56.2769949], number: 22 },
  { id: "goncharova", name: "Гончарова", coordinates: [43.9378947, 56.2807863], number: 23 },
  { id: "zarechny", name: "Заречный бульвар", coordinates: [43.9400958, 56.2850186], number: 24, major: true },
  { id: "school-185", name: "Школа №185", coordinates: [43.9406513, 56.2890322], number: 25 },
  { id: "education", name: "Центр дополнительного образования", coordinates: [43.9423118, 56.2923365], number: 26 },
  { id: "komsomol-highway", name: "Комсомольское шоссе", coordinates: [43.9428792, 56.2960648], number: 27 },
  { id: "komsomol-square", name: "Комсомольская площадь", coordinates: [43.9459544, 56.2987958], number: 28, major: true },
  { id: "malaya-yamskaya", name: "Малая Ямская", coordinates: [43.9797047, 56.3064672], number: 29 },
];

const byRoute2Number = (number: number) => ROUTE_2_STOPS[number - 1];

const routeASequence: DirectionStop[] = [11, 12, 13, 14, 15, 16, 17, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(
  (number) => ({ ...byRoute2Number(number), nodeId: `A${String(number).padStart(2, "0")}` }),
);
const routeBSequence: DirectionStop[] = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 17, 16, 15, 14, 13, 12, 11].map(
  (number) => ({ ...byRoute2Number(number), nodeId: `B${String(number).padStart(2, "0")}` }),
);

const route21OutboundSequence: DirectionStop[] = [
  ...ROUTE_21_PRIVATE.map((stop, index) => ({
    ...stop,
    nodeId: index === 0 ? "PARK-O" : `21O-${stop.id}`,
  })),
  { ...byRoute2Number(17), nodeId: "B17" },
];

const route21InboundSequence: DirectionStop[] = [
  { ...byRoute2Number(17), nodeId: "A17" },
  ...[...ROUTE_21_PRIVATE].reverse().map((stop, index, values) => ({
    ...stop,
    nodeId: index === values.length - 1 ? "PARK-I" : `21I-${stop.id}`,
  })),
];

const networkFeature: GeoPermissibleObjects = {
  type: "MultiLineString",
  coordinates: [
    ROUTE_2_CCW,
    ROUTE_2_CW,
    ROUTE_21_OUT_PRIVATE,
    ROUTE_21_IN_PRIVATE,
  ],
};

const projection = geoMercator().fitExtent(
  [
    [72, 62],
    [928, 554],
  ],
  networkFeature,
);

const project = (coordinate: LonLat): Point => {
  const value = projection(coordinate);
  if (!value) throw new Error("Nizhny Novgorod coordinate could not be projected");
  return { x: value[0], y: value[1] };
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const haversineMeters = (first: LonLat, second: LonLat) => {
  const latitudeDelta = radians(second[1] - first[1]);
  const longitudeDelta = radians(second[0] - first[0]);
  const firstLatitude = radians(first[1]);
  const secondLatitude = radians(second[1]);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const pathLengthMeters = (points: LonLat[]) =>
  points.slice(1).reduce(
    (total, point, index) => total + haversineMeters(points[index], point),
    0,
  );

const projectedLength = (points: Point[]) =>
  points.slice(1).reduce(
    (total, point, index) =>
      total + Math.hypot(point.x - points[index].x, point.y - points[index].y),
    0,
  );

interface PathPosition {
  legIndex: number;
  local: number;
}

const pointAtPosition = (points: Point[], position: PathPosition): Point => {
  const first = points[position.legIndex];
  const second = points[position.legIndex + 1];
  return {
    x: first.x + (second.x - first.x) * position.local,
    y: first.y + (second.y - first.y) * position.local,
  };
};

const coordinateAtPosition = (path: LonLat[], position: PathPosition): LonLat => {
  const first = path[position.legIndex];
  const second = path[position.legIndex + 1];
  return [
    first[0] + (second[0] - first[0]) * position.local,
    first[1] + (second[1] - first[1]) * position.local,
  ];
};

const sliceAtPositions = <T,>(
  values: T[],
  start: PathPosition,
  end: PathPosition,
  interpolate: (values: T[], position: PathPosition) => T,
) => {
  const result: T[] = [interpolate(values, start)];
  for (let index = start.legIndex + 1; index <= end.legIndex; index += 1) {
    result.push(values[index]);
  }
  result.push(interpolate(values, end));
  return result;
};

const monotonicStopPositions = (path: LonLat[], stops: DirectionStop[]) => {
  const projectedPath = path.map(project);
  let cursor: PathPosition = { legIndex: 0, local: 0 };
  return stops.map((stop, stopIndex) => {
    if (stopIndex === 0) return cursor;
    if (stopIndex === stops.length - 1 && stop.id === stops[0].id) {
      cursor = { legIndex: path.length - 2, local: 1 };
      return cursor;
    }
    const target = project(stop.coordinates);
    let best = cursor;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let legIndex = cursor.legIndex; legIndex < projectedPath.length - 1; legIndex += 1) {
      const first = projectedPath[legIndex];
      const second = projectedPath[legIndex + 1];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const denominator = Math.max(0.001, dx * dx + dy * dy);
      const minimumLocal = legIndex === cursor.legIndex ? cursor.local : 0;
      const local = Math.max(
        minimumLocal,
        Math.min(1, ((target.x - first.x) * dx + (target.y - first.y) * dy) / denominator),
      );
      const candidate = { x: first.x + dx * local, y: first.y + dy * local };
      const distance = Math.hypot(target.x - candidate.x, target.y - candidate.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { legIndex, local };
      }
    }
    cursor = best;
    return best;
  });
};

const offsetPath = (points: Point[], offset: number) =>
  points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
  });

const turnDegrees = (first: Point, middle: Point, last: Point) => {
  const incoming = { x: middle.x - first.x, y: middle.y - first.y };
  const outgoing = { x: last.x - middle.x, y: last.y - middle.y };
  const denominator = Math.max(
    0.001,
    Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y),
  );
  const cosine = Math.max(
    -1,
    Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
};

// OSM route relations occasionally contain a tiny side excursion around a
// platform or relation join. It is valid map metadata, but not rail geometry:
// a vehicle following it would visibly reverse and then reverse again.
const removeBacktracking = (points: Point[], maximumTurn = 105) => {
  const cleaned = points.reduce<Point[]>((result, point) => {
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.01) {
      result.push({ ...point });
    }
    return result;
  }, []);
  let changed = true;
  while (changed && cleaned.length > 2) {
    changed = false;
    let worstIndex = -1;
    let worstTurn = maximumTurn;
    for (let index = 1; index < cleaned.length - 1; index += 1) {
      const turn = turnDegrees(cleaned[index - 1], cleaned[index], cleaned[index + 1]);
      if (turn > worstTurn) {
        worstTurn = turn;
        worstIndex = index;
      }
    }
    if (worstIndex >= 0) {
      cleaned.splice(worstIndex, 1);
      changed = true;
    }
  }
  return cleaned;
};

const operationalRail = (points: Point[]) => removeBacktracking(points);

const buildSegments = (
  prefix: string,
  path: LonLat[],
  sequence: DirectionStop[],
  projectedPath: Point[],
  idForOrigin: (origin: DirectionStop, index: number) => string,
) => {
  const positions = monotonicStopPositions(path, sequence);
  const segments: TrackSegment[] = [];
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const origin = sequence[index];
    const destination = sequence[index + 1];
    const start = positions[index];
    const end = positions[index + 1];
    const rawSlice = sliceAtPositions(path, start, end, coordinateAtPosition);
    // Stops are operational markers near the track, not control points of the
    // rail itself. The split position is projected onto the OSM centreline.
    const pointSlice = operationalRail(
      sliceAtPositions(projectedPath, start, end, pointAtPosition),
    );
    const mappedLength = pathLengthMeters(rawSlice);
    segments.push({
      id: idForOrigin(origin, index),
      from: origin.nodeId,
      to: destination.nodeId,
      points: pointSlice,
      lengthMeters:
        mappedLength > 1
          ? mappedLength
          : haversineMeters(origin.coordinates, destination.coordinates),
      label: `${prefix} · ${origin.name} → ${destination.name}`,
    });
  }
  return segments;
};

const routeAProjected = offsetPath(ROUTE_2_CCW.map(project), -4);
const routeBProjected = offsetPath(ROUTE_2_CW.map(project), 4);
const route21OutProjected = offsetPath(ROUTE_21_OUT_PRIVATE.map(project), 4);
const route21InProjected = offsetPath(ROUTE_21_IN_PRIVATE.map(project), -4);

const routeASegments = buildSegments(
  "Route 2 ↺",
  ROUTE_2_CCW,
  routeASequence,
  routeAProjected,
  (origin) => `N2A${String(origin.number).padStart(2, "0")}`,
);
const routeBSegments = buildSegments(
  "Route 2 ↻",
  ROUTE_2_CW,
  routeBSequence,
  routeBProjected,
  (origin) => `N2B${String(origin.number).padStart(2, "0")}`,
);

// 2021 Route 2 study profile. The clockwise rail contains the eight measured
// descending sections (102 m total); the counter-clockwise rail is their
// signed reverse. Unlisted legs remain level until surveyed data is available.
const ROUTE_2_CLOCKWISE_ELEVATION_METERS: Record<string, number> = {
  N2B07: -17, // Сенная площадь → Белинского
  N2B11: -14, // ул. Пискунова
  N2B12: -7,  // Лыковая дамба, lower branch
  N2B13: -14, // Лыковая дамба, upper branch
  N2B14: -19, // Нижегородская → Добролюбова
  N2B15: -10, // Маслякова → Нижегородская
  N2B16: -9,  // Горького → Маслякова
  N2B17: -12, // Красносельская → Горького
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
const route21OutboundSegments = buildSegments(
  "Route 21 → Chyorny Prud",
  ROUTE_21_OUT_PRIVATE,
  route21OutboundSequence,
  route21OutProjected,
  (_origin, index) => `N21O${String(index + 1).padStart(2, "0")}`,
);
const route21InboundSegments = buildSegments(
  "Route 21 → Park Dubki",
  ROUTE_21_IN_PRIVATE,
  route21InboundSequence,
  route21InProjected,
  (_origin, index) => `N21I${String(index + 1).padStart(2, "0")}`,
);

const segmentById = (segments: TrackSegment[], id: string) => {
  const found = segments.find((segment) => segment.id === id);
  if (!found) throw new Error(`Missing segment ${id}`);
  return found;
};

const splitPointsAtClosest = (points: Point[], target: Point) => {
  let bestLeg = 0;
  let bestLocal = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let legIndex = 0; legIndex < points.length - 1; legIndex += 1) {
    const first = points[legIndex];
    const second = points[legIndex + 1];
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const denominator = Math.max(0.001, dx * dx + dy * dy);
    const local = Math.max(
      0,
      Math.min(1, ((target.x - first.x) * dx + (target.y - first.y) * dy) / denominator),
    );
    const candidate = { x: first.x + dx * local, y: first.y + dy * local };
    const candidateDistance = Math.hypot(target.x - candidate.x, target.y - candidate.y);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestLeg = legIndex;
      bestLocal = local;
    }
  }
  const split = { ...target };
  return {
    before: operationalRail([...points.slice(0, bestLeg + 1), split]),
    after: operationalRail([split, ...points.slice(bestLeg + 1)]),
    local: bestLeg + bestLocal,
  };
};

const trimSegmentStart = (segment: TrackSegment, target: Point, nodeId: string) => {
  const originalLength = projectedLength(segment.points);
  const { after } = splitPointsAtClosest(segment.points, target);
  const retainedRatio = projectedLength(after) / Math.max(0.001, originalLength);
  segment.points = after;
  segment.from = nodeId;
  if (segment.lengthMeters) segment.lengthMeters *= retainedRatio;
};

const trimSegmentEnd = (segment: TrackSegment, target: Point, nodeId: string) => {
  const originalLength = projectedLength(segment.points);
  const { before } = splitPointsAtClosest(segment.points, target);
  const retainedRatio = projectedLength(before) / Math.max(0.001, originalLength);
  segment.points = before;
  segment.to = nodeId;
  if (segment.lengthMeters) segment.lengthMeters *= retainedRatio;
};

const alignSegmentEndpoint = (
  segment: TrackSegment,
  target: Point,
  endpoint: "start" | "end",
) => {
  const endpointIndex = endpoint === "start" ? 0 : segment.points.length - 1;
  const current = segment.points[endpointIndex];
  const delta = { x: target.x - current.x, y: target.y - current.y };
  // Bend into a turnout without moving the opposite endpoint. Moving every
  // point of a short approach pulled its shared Gorkogo endpoint away from the
  // neighbouring segment and created the visible break at stop 16.
  const blendCount = Math.min(4, Math.max(1, segment.points.length - 1));
  for (let offset = 0; offset < blendCount; offset += 1) {
    const index = endpoint === "start" ? offset : segment.points.length - 1 - offset;
    const weight = (blendCount - offset) / blendCount;
    segment.points[index] = {
      x: segment.points[index].x + delta.x * weight,
      y: segment.points[index].y + delta.y * weight,
    };
  }
};

const fittedPath = (coordinates: LonLat[], start: Point, end: Point) => {
  const points = coordinates.map(project);
  const first = points[0];
  const last = points[points.length - 1];
  return points.map((point, index) => {
    const progress = index / Math.max(1, points.length - 1);
    return {
      x:
        point.x +
        (start.x - first.x) * (1 - progress) +
        (end.x - last.x) * progress,
      y:
        point.y +
        (start.y - first.y) * (1 - progress) +
        (end.y - last.y) * progress,
    };
  });
};

const junctionSegment = (
  id: string,
  from: string,
  to: string,
  coordinates: LonLat[],
  label: string,
): TrackSegment => ({
  id,
  from,
  to,
  points: coordinates.map(project),
  lengthMeters: pathLengthMeters(coordinates),
  label,
});

const krsNorth = project(KRS_NORTH_TO_EAST[0]);
const krsEastOut = project(KRS_NORTH_TO_EAST.at(-1)!);
const krsEastIn = project(KRS_EAST_TO_NORTH[0]);
const krsWestIn = project(KRS_WEST_TO_NORTH[0]);
const krsWestOut = project(KRS_NORTH_TO_WEST.at(-1)!);

// Route segments stop at the three real tips of the triangle; the six short
// OSM curves below own all movement inside it. This prevents any route builder
// from drawing a direct connection across the block.
trimSegmentStart(segmentById(routeASegments, "N2A17"), krsEastOut, "KRS-E-OUT");
trimSegmentEnd(segmentById(routeBSegments, "N2B01"), krsEastIn, "KRS-E-IN");
trimSegmentEnd(route21OutboundSegments.at(-1)!, krsWestIn, "KRS-W-IN");
trimSegmentStart(route21InboundSegments[0], krsWestOut, "KRS-W-OUT");
alignSegmentEndpoint(segmentById(routeASegments, "N2A16"), krsNorth, "end");
alignSegmentEndpoint(
  segmentById(routeBSegments, "N2B17"),
  project(KRS_EAST_TO_NORTH.at(-1)!),
  "start",
);

const krasnoselskayaSegments: TrackSegment[] = [
  junctionSegment(
    "KRS-N-E",
    "A17",
    "KRS-E-OUT",
    KRS_NORTH_TO_EAST,
    "Красносельская · север → восток",
  ),
  junctionSegment(
    "KRS-N-W",
    "A17",
    "KRS-W-OUT",
    KRS_NORTH_TO_WEST,
    "Красносельская · север → запад",
  ),
  junctionSegment(
    "KRS-E-N",
    "KRS-E-IN",
    "B17",
    KRS_EAST_TO_NORTH,
    "Красносельская · восток → север",
  ),
  junctionSegment(
    "KRS-E-W",
    "KRS-E-IN",
    "KRS-W-OUT",
    KRS_EAST_TO_WEST,
    "Красносельская · восток → запад",
  ),
  junctionSegment(
    "KRS-W-N",
    "KRS-W-IN",
    "B17",
    KRS_WEST_TO_NORTH,
    "Красносельская · запад → север",
  ),
  junctionSegment(
    "KRS-W-E",
    "KRS-W-IN",
    "KRS-E-OUT",
    KRS_WEST_TO_EAST,
    "Красносельская · запад → восток",
  ),
];

const route2ChyornyPrudB = segmentById(routeBSegments, "N2B11").points[0];
const route2ChyornyPrudA = segmentById(routeASegments, "N2A11").points[0];
const chyornyPrudPoints = fittedPath(
  CHYORNY_PRUD_LOOP,
  route2ChyornyPrudB,
  route2ChyornyPrudA,
);

const parkInboundSegment = route21InboundSegments.at(-1)!;
const parkOutboundSegment = route21OutboundSegments[0];
const route21ParkInbound = parkInboundSegment.points.at(-1)!;
const route21ParkOutbound = parkOutboundSegment.points[0];
const parkDubkiPoints = fittedPath(
  PARK_DUBKI_LOOP,
  route21ParkInbound,
  route21ParkOutbound,
);

const terminalSegments: TrackSegment[] = [
  {
    id: "N21-CHP-LOOP",
    from: "B11",
    to: "A11",
    points: chyornyPrudPoints,
    lengthMeters: pathLengthMeters(CHYORNY_PRUD_LOOP),
    label: "Route 21 · real Chyorny Prud terminal curve",
  },
  {
    id: "N21-PARK-LOOP",
    from: "PARK-I",
    to: "PARK-O",
    points: parkDubkiPoints,
    lengthMeters: pathLengthMeters(PARK_DUBKI_LOOP),
    label: "Route 21 · Park Dubki terminal loop",
  },
];

const route2AIds = routeASegments.flatMap((segment) =>
  segment.id === "N2A17" ? ["KRS-N-E", segment.id] : [segment.id],
);
const route2BIds = routeBSegments.flatMap((segment) =>
  segment.id === "N2B01" ? [segment.id, "KRS-E-N"] : [segment.id],
);
const route21OutboundIds = [
  ...route21OutboundSegments.map((segment) => segment.id),
  "KRS-W-N",
];
const route21InboundIds = [
  "KRS-N-W",
  ...route21InboundSegments.map((segment) => segment.id),
];
const route21SharedOutboundIds = ["N2B17", "N2B16", "N2B15", "N2B14", "N2B13", "N2B12"];
const route21SharedInboundIds = ["N2A11", "N2A12", "N2A13", "N2A14", "N2A15", "N2A16"];

const routes: RouteDefinition[] = [
  {
    id: "2",
    name: "Route 2 · city ring",
    shortName: "2",
    color: "#ffc13b",
    segmentIds: [...route2AIds, ...route2BIds],
    labelSegmentId: "N2A03",
    labelAt: 0.5,
    labelOffset: -30,
  },
  {
    id: "21",
    name: "Route 21 · Park Dubki — Chyorny Prud",
    shortName: "21",
    color: "#59d8e8",
    segmentIds: [
      ...route21OutboundIds,
      ...route21SharedOutboundIds,
      "N21-CHP-LOOP",
      ...route21SharedInboundIds,
      ...route21InboundIds,
      "N21-PARK-LOOP",
    ],
    labelSegmentId: "N21O07",
    labelAt: 0.45,
    labelOffset: 30,
  },
];

const stationReader = (
  id: string,
  segmentId: string,
  stop: StopSite,
  routeId: "2" | "21",
  directionShortName: string,
  directionLabel: string,
  visible: boolean,
): RFIDReader => {
  // At Maslyakova the passenger platforms are before the Ilyinskaya crossing
  // in both directions. The signal heads remain immediately before the
  // conflict zone: platform -> signal -> crossing -> opposing signal.
  const platformAt =
    stop.id === "maslyakova" &&
    (segmentId === "N2A14" || segmentId === "N2B16")
      ? 0.38
      : 0.975;
  const stationSegment = [...routeASegments, ...routeBSegments, ...route21OutboundSegments, ...route21InboundSegments]
    .find((segment) => segment.id === segmentId);
  const at = Math.max(
    0.04,
    platformAt - 160 / Math.max(1, stationSegment?.lengthMeters ?? 500),
  );
  return {
    id,
    segmentId,
    at,
    kind: "station",
    label: stop.name,
    stationId: stop.id,
    stationNumber: stop.number,
    routeId,
    directionShortName,
    directionLabel,
    showLabel: visible && Boolean(stop.major),
    render: visible,
    displayAt: platformAt,
    labelDistancePx: stop.id === "chyorny-prud" ? 72 : undefined,
    terminal:
      routeId === "21" &&
      (stop.id === "park-dubki" || stop.id === "chyorny-prud")
        ? true
        : undefined,
    rapidTurnback:
      routeId === "21" && stop.id === "chyorny-prud" ? true : undefined,
  };
};

const route2StationReaders: RFIDReader[] = [
  ...routeASegments.map((segment, index) => {
    const destination = routeASequence[index + 1];
    return stationReader(
      `R2A-${destination.id}`,
      segment.id,
      destination,
      "2",
      "2 ↺",
      "counter-clockwise",
      true,
    );
  }),
  ...routeBSegments.map((segment, index) => {
    const destination = routeBSequence[index + 1];
    return stationReader(
      `R2B-${destination.id}`,
      segment.id,
      destination,
      "2",
      "2 ↻",
      "clockwise",
      false,
    );
  }),
];

const route21PrivateReaders: RFIDReader[] = [
  ...route21OutboundSegments.map((segment, index) => {
    const destination = route21OutboundSequence[index + 1];
    return stationReader(
      `R21O-${destination.id}`,
      segment.id,
      destination,
      "21",
      "21 →",
      "to Chyorny Prud",
      true,
    );
  }),
  ...route21InboundSegments.map((segment, index) => {
    const destination = route21InboundSequence[index + 1];
    return stationReader(
      `R21I-${destination.id}`,
      segment.id,
      destination,
      "21",
      "21 ←",
      "to Park Dubki",
      false,
    );
  }),
];

const route21SharedReaders: RFIDReader[] = [
  ...route21SharedOutboundIds.map((segmentId) => {
    const segment = segmentById(routeBSegments, segmentId);
    const destinationNumber = Number(segment.to.slice(1));
    const stop = byRoute2Number(destinationNumber);
    return stationReader(
      `R21O-${stop.id}`,
      segmentId,
      stop,
      "21",
      "21 →",
      "to Chyorny Prud",
      false,
    );
  }),
  ...route21SharedInboundIds.map((segmentId) => {
    const segment = segmentById(routeASegments, segmentId);
    const destinationNumber = Number(segment.to.slice(1));
    const stop = byRoute2Number(destinationNumber);
    return stationReader(
      `R21I-${stop.id}`,
      segmentId,
      stop,
      "21",
      "21 ←",
      "to Park Dubki",
      false,
    );
  }),
];

const signalApproach = (
  controllerId: string,
  code: string,
  segmentId: string,
  label: string,
  render: boolean,
  signalAt = 0.68,
  detectorAt = Math.max(0.08, signalAt - 0.2),
  clearAt = Math.min(0.98, signalAt + 0.28),
) => ({
  reader: {
    id: `DET-${code}`,
    segmentId,
    at: detectorAt,
    kind: "traffic" as const,
    label: `${label} approach detector`,
    signalId: `SG-${code}`,
    render: false,
  } satisfies RFIDReader,
  signal: {
    id: `SG-${code}`,
    controllerId,
    segmentId,
    at: signalAt,
    clearAt,
    label,
    render,
    amberSeconds: 3,
    tramGreenSeconds: 8,
    clearanceSeconds: 2,
  } satisfies SignalDefinition,
});

const trafficControls = [
  // The crossing is between Ashkhabadskaya and Opera. A03 and B04 are the two
  // opposite approaches to the same physical point; placing A on A02 put the
  // Ashkhabadskaya stop between the two signal heads.
  signalApproach(
    "J-OSH",
    "OSH-A",
    "N2A03",
    "Белинского × Ошарская",
    true,
    0.32,
    0.12,
    0.6,
  ),
  signalApproach("J-OSH", "OSH-B", "N2B04", "Белинского × Ошарская", true),
  signalApproach("J-SEN", "SEN-A", "N2A06", "Сенная площадь", true),
  signalApproach("J-SEN", "SEN-B", "N2B08", "Сенная площадь", true),
  signalApproach("J-MAS", "MAS-A", "N2A14", "Маслякова × Ильинская", true),
  signalApproach("J-MAS", "MAS-B", "N2B16", "Маслякова × Ильинская", true),
  // Krasnoselskaya is not modelled as a single perpendicular road crossing:
  // Krasnoselskaya and Ilyinskaya carry several road movements through the
  // turnout triangle. The rail conflict zone below protects trams there;
  // drawing one invented car signal was misleading, so it is intentionally
  // omitted from the automotive controller list.
  signalApproach(
    "J-CHP-MERGE",
    "CHP-R2",
    "N2A10",
    "Чёрный Пруд · merge",
    true,
    0.935,
    0.735,
    0.995,
  ),
  // This terminal connector is only about 61m long. Its request detector must
  // sit before the 32m signal-protection envelope, otherwise an approaching
  // tram stops at red before it can request a green phase.
  signalApproach(
    "J-CHP-MERGE",
    "CHP-R21",
    "N21-CHP-LOOP",
    "Чёрный Пруд · merge",
    true,
    0.6,
    0.04,
    0.995,
  ),
];

const switches = [
  {
    id: "SW-21-KRS",
    nodeId: "A17",
    mainSegmentId: "KRS-N-E",
    branchSegmentId: "KRS-N-W",
    label: "Красносельская · северная стрелка",
  },
  {
    id: "SW-KRS-EAST",
    nodeId: "KRS-E-IN",
    mainSegmentId: "KRS-E-N",
    branchSegmentId: "KRS-E-W",
    label: "Красносельская · восточная стрелка",
  },
  {
    id: "SW-KRS-WEST",
    nodeId: "KRS-W-IN",
    mainSegmentId: "KRS-W-E",
    branchSegmentId: "KRS-W-N",
    label: "Красносельская · западная стрелка",
  },
  {
    id: "SW-21-CHP",
    nodeId: "B11",
    mainSegmentId: "N2B11",
    branchSegmentId: "N21-CHP-LOOP",
    label: "Чёрный Пруд · Route 2 / Route 21",
    displayArmLengthPx: 46,
    showArmLabels: false,
  },
];

const switchReaders: RFIDReader[] = [
  {
    id: "RF-SW-21-KRS",
    segmentId: "N2A16",
    at: 0.72,
    kind: "switch",
    switchId: "SW-21-KRS",
    label: "Route reader · Красносельская",
    render: false,
  },
  {
    id: "RF-SW-KRS-EAST",
    segmentId: "N2B01",
    at: 0.72,
    kind: "switch",
    switchId: "SW-KRS-EAST",
    label: "Route reader · Красносельская восток",
    render: false,
  },
  {
    id: "RF-SW-KRS-WEST",
    segmentId: route21OutboundSegments.at(-1)!.id,
    at: 0.72,
    kind: "switch",
    switchId: "SW-KRS-WEST",
    label: "Route reader · Красносельская запад",
    render: false,
  },
  {
    id: "RF-SW-21-CHP",
    segmentId: "N2B12",
    at: 0.72,
    kind: "switch",
    switchId: "SW-21-CHP",
    label: "Route reader · Чёрный Пруд",
    render: false,
  },
];

const route2ReferenceLength = routeASegments.reduce(
  (total, segment) => total + (segment.lengthMeters ?? 0),
  0,
) + (krasnoselskayaSegments.find((segment) => segment.id === "KRS-N-E")?.lengthMeters ?? 0);
const route2ReferenceUnits = routeASegments.reduce(
  (total, segment) => total + projectedLength(segment.points),
  0,
) + projectedLength(
  krasnoselskayaSegments.find((segment) => segment.id === "KRS-N-E")!.points,
);

const pointOnTrack = (segment: TrackSegment, progressInput: number): Point => {
  const progress = Math.max(0, Math.min(1, progressInput));
  const lengths = [0];
  for (let index = 1; index < segment.points.length; index += 1) {
    lengths.push(
      lengths[index - 1] +
        Math.hypot(
          segment.points[index].x - segment.points[index - 1].x,
          segment.points[index].y - segment.points[index - 1].y,
        ),
    );
  }
  const target = lengths[lengths.length - 1] * progress;
  let leg = 1;
  while (leg < lengths.length - 1 && lengths[leg] < target) leg += 1;
  const start = segment.points[leg - 1];
  const end = segment.points[leg];
  const local =
    (target - lengths[leg - 1]) /
    Math.max(0.0001, lengths[leg] - lengths[leg - 1]);
  return {
    x: start.x + (end.x - start.x) * local,
    y: start.y + (end.y - start.y) * local,
  };
};

const depot1Point: Point = { x: 862, y: 238 };
const depot2Point: Point = { x: 135, y: 500 };
const depot1CounterclockwiseGate = pointOnTrack(
  segmentById(routeASegments, "N2A05"),
  0.45,
);
const depot1ClockwiseGate = pointOnTrack(
  segmentById(routeBSegments, "N2B05"),
  0.45,
);
const depot2Gate = pointOnTrack(route21OutboundSegments[0], 0.45);

// Mid-route turnback sidings — short reversing pockets (not full depots) used
// by the demand dispatcher to short-turn a badly delayed tram without
// dragging it all the way to the terminal depot. Positioned roughly halfway
// along each route so a withdrawal from anywhere on the loop reaches a
// portal (turnback or terminal depot, whichever is nearer) reasonably soon.
const turnback1Point: Point = { x: 695, y: 100 };
const turnback2Point: Point = { x: 355, y: 397 };
const turnback1GateCCW = pointOnTrack(segmentById(routeASegments, "N2A09"), 0.5);
const turnback1GateCW = pointOnTrack(segmentById(routeBSegments, "N2B09"), 0.5);
const turnback2GateOut = pointOnTrack(segmentById(route21OutboundSegments, "N21O06"), 0.5);
const turnback2GateIn = pointOnTrack(segmentById(route21InboundSegments, "N21I06"), 0.5);

const depots: NonNullable<ScenarioDefinition["depots"]> = [
  {
    id: "DEPOT-1",
    label: "Трамвайное депо №1",
    shortName: "DEPOT 1",
    note: "Route 2 · off-map service connection from Полтавская",
    kind: "depot",
    point: depot1Point,
    portals: [
      {
        id: "D1-PORTAL-2-CCW",
        routeId: "2",
        fleetGroupIds: ["route-2-counterclockwise"],
        portalSegmentId: "N2A05",
        portalAt: 0.45,
        exitSegmentId: "N2A05",
        exitProgress: 0.08,
        lastPassengerStop: "Полтавская",
        trackPoints: [
          depot1CounterclockwiseGate,
          { x: 778, y: 160 },
          { x: 821, y: 204 },
          depot1Point,
        ],
      },
      {
        id: "D1-PORTAL-2-CW",
        routeId: "2",
        fleetGroupIds: ["route-2-clockwise"],
        portalSegmentId: "N2B05",
        portalAt: 0.45,
        exitSegmentId: "N2B05",
        exitProgress: 0.08,
        lastPassengerStop: "Полтавская",
        trackPoints: [
          depot1ClockwiseGate,
          { x: 775, y: 171 },
          { x: 816, y: 217 },
          { x: depot1Point.x, y: depot1Point.y + 7 },
        ],
      },
    ],
  },
  {
    id: "DEPOT-2",
    label: "Трамвайное депо №2",
    shortName: "DEPOT 2",
    note: "Route 21 · off-map service run via Парк «Дубки»",
    kind: "depot",
    point: depot2Point,
    portals: [
      {
        id: "D2-PORTAL-21",
        routeId: "21",
        fleetGroupIds: [
          "route-21-to-chyorny-prud",
          "route-21-to-park-dubki",
        ],
        portalSegmentId: "N21O01",
        portalAt: 0.45,
        exitSegmentId: "N21O01",
        exitProgress: 0.08,
        lastPassengerStop: "Парк «Дубки»",
        trackPoints: [
          depot2Gate,
          { x: 218, y: 535 },
          { x: 177, y: 506 },
          depot2Point,
        ],
      },
    ],
  },
  {
    id: "TURNBACK-1",
    label: "Разворотный тупик · Высшая школа экономики",
    shortName: "TURNBACK 1",
    note: "Route 2 · short-turn siding, not a full depot",
    kind: "turnback",
    capacity: 1,
    point: turnback1Point,
    portals: [
      {
        id: "T1-PORTAL-2-CCW",
        routeId: "2",
        fleetGroupIds: ["route-2-counterclockwise"],
        portalSegmentId: "N2A09",
        portalAt: 0.5,
        exitSegmentId: "N2A09",
        exitProgress: 0.45,
        lastPassengerStop: "Высшая школа экономики",
        trackPoints: [turnback1GateCCW, { x: 685, y: 88 }, turnback1Point],
      },
      {
        id: "T1-PORTAL-2-CW",
        routeId: "2",
        fleetGroupIds: ["route-2-clockwise"],
        portalSegmentId: "N2B09",
        portalAt: 0.5,
        exitSegmentId: "N2B09",
        exitProgress: 0.45,
        lastPassengerStop: "Высшая школа экономики",
        trackPoints: [turnback1GateCW, { x: 700, y: 92 }, turnback1Point],
      },
    ],
  },
  {
    id: "TURNBACK-2",
    label: "Разворотный тупик · Заречный бульвар",
    shortName: "TURNBACK 2",
    note: "Route 21 · short-turn siding, not a full depot",
    kind: "turnback",
    capacity: 1,
    point: turnback2Point,
    portals: [
      {
        id: "T2-PORTAL-21-OUT",
        routeId: "21",
        fleetGroupIds: ["route-21-to-chyorny-prud"],
        portalSegmentId: "N21O06",
        portalAt: 0.5,
        exitSegmentId: "N21O06",
        exitProgress: 0.45,
        lastPassengerStop: "Заречный бульвар",
        trackPoints: [turnback2GateOut, { x: 345, y: 405 }, turnback2Point],
      },
      {
        id: "T2-PORTAL-21-IN",
        routeId: "21",
        fleetGroupIds: ["route-21-to-park-dubki"],
        portalSegmentId: "N21I06",
        portalAt: 0.5,
        exitSegmentId: "N21I06",
        exitProgress: 0.45,
        lastPassengerStop: "Заречный бульвар",
        trackPoints: [turnback2GateIn, { x: 348, y: 388 }, turnback2Point],
      },
    ],
  },
];

// Planned headways below are back-computed from each route's real cycle
// time (length / realistic average speed, including dwell at every stop)
// divided by the tram count for that window, plus ~8% recovery padding —
// not round numbers picked by eye. Route 2 is a 17.44 km loop (~55.8 min
// cycle with 46 stops); Route 21 is a 21.92 km loop (~67.9 min cycle with
// 48 stops). The previous numbers assumed roughly double the achievable
// frequency for the given fleet size, which meant the dispatcher was
// permanently "behind schedule" by design — see docs/PASSENGER_MODEL_CHANGES_RU.md.
const serviceSchedule: NonNullable<ScenarioDefinition["serviceSchedule"]> = [
  {
    id: "night",
    label: "Night storage",
    startMinute: 0,
    endMinute: 330,
    routes: {
      "2": { plannedHeadwayMinutes: null, targetActiveTrams: 0 },
      "21": { plannedHeadwayMinutes: null, targetActiveTrams: 0 },
    },
  },
  {
    id: "early",
    label: "Early service",
    startMinute: 330,
    endMinute: 420,
    routes: {
      "2": { plannedHeadwayMinutes: 20, targetActiveTrams: 3 },
      "21": { plannedHeadwayMinutes: 37, targetActiveTrams: 2 },
    },
  },
  {
    id: "morning-peak",
    label: "Morning peak",
    startMinute: 420,
    endMinute: 600,
    routes: {
      "2": { plannedHeadwayMinutes: 12, targetActiveTrams: 5 },
      "21": { plannedHeadwayMinutes: 15, targetActiveTrams: 5 },
    },
  },
  {
    id: "daytime",
    label: "Daytime off-peak",
    startMinute: 600,
    endMinute: 960,
    routes: {
      "2": { plannedHeadwayMinutes: 15, targetActiveTrams: 4 },
      "21": { plannedHeadwayMinutes: 24.5, targetActiveTrams: 3 },
    },
  },
  {
    id: "evening-peak",
    label: "Evening peak",
    startMinute: 960,
    endMinute: 1140,
    routes: {
      "2": { plannedHeadwayMinutes: 12, targetActiveTrams: 5 },
      "21": { plannedHeadwayMinutes: 15, targetActiveTrams: 5 },
    },
  },
  {
    id: "evening",
    label: "Evening off-peak",
    startMinute: 1140,
    endMinute: 1350,
    routes: {
      "2": { plannedHeadwayMinutes: 15, targetActiveTrams: 4 },
      "21": { plannedHeadwayMinutes: 24.5, targetActiveTrams: 3 },
    },
  },
  {
    id: "late",
    label: "Late service",
    startMinute: 1350,
    endMinute: 1440,
    routes: {
      "2": { plannedHeadwayMinutes: 30, targetActiveTrams: 2 },
      "21": { plannedHeadwayMinutes: 73, targetActiveTrams: 1 },
    },
  },
];

const mapContext: MapContext = {
  title: "Нижний Новгород · routes 2 + 21",
  subtitle: "Shared-track operational topology",
  sourceLabel: "OSM relations 227555 + 240660 · turnout ways mapped",
  lines: [
    {
      id: "CITY-RING",
      label: "Route 2 city ring",
      kind: "primary",
      points: ROUTE_2_CCW.map(project),
    },
    {
      id: "DUBKI-CORRIDOR",
      label: "Route 21 corridor",
      kind: "secondary",
      points: ROUTE_21_OUT_PRIVATE.map(project),
    },
  ],
  landmarks: [],
  scaleBarMeters: 1_000,
};

const combinedPowerSegments = [
  ...routeASegments,
  ...routeBSegments,
  ...route21OutboundSegments,
  ...route21InboundSegments,
  ...krasnoselskayaSegments,
  ...terminalSegments,
];
const route2StopPoint = (id: string) =>
  project(ROUTE_2_STOPS.find((stop) => stop.id === id)!.coordinates);
const route21StopPoint = (id: string) =>
  project(ROUTE_21_PRIVATE.find((stop) => stop.id === id)!.coordinates);
const combinedSubstations: TractionSubstationDefinition[] = [
  {
    id: "NN-TP27-GLEBA",
    label: "Тяговая подстанция №27 · Глеба Успенского, 20",
    sectionLabel: "Парк Дубки — Глеба Успенского",
    point: route21StopPoint("gleba-uspenskogo"),
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022",
  },
  {
    id: "NN-TP8-OKTYABRSKOY",
    label: "Тяговая подстанция №8 · Октябрьской Революции, 78А",
    sectionLabel: "Заречная часть — Комсомольская площадь",
    point: route21StopPoint("komsomol-square"),
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022; marker snapped to route corridor",
  },
  {
    id: "NN-TP-BELINSKOGO",
    label: "Тяговая подстанция · Белинского, 105А",
    sectionLabel: "Красносельская — Белинского",
    point: route2StopPoint("opera"),
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022",
  },
  {
    id: "NN-TP-BPECHERSKAYA",
    label: "Тяговая подстанция №30 · Большая Печёрская, 11Б",
    sectionLabel: "Сенная — Большая Печёрская",
    point: route2StopPoint("sennaya"),
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022; public map listing identifies TP-30",
  },
  {
    id: "NN-TP15-LUDILNY",
    label: "Тяговая подстанция №15 · Лудильный пер., 2З",
    sectionLabel: "Чёрный Пруд — Нижегородская",
    point: route2StopPoint("pokrovskaya"),
    nominalVoltageV: 600,
    maxPowerKw: 1_800,
    confidence: "verified-address",
    evidence: "Решение городской Думы Нижнего Новгорода №96 от 25.05.2022; marker snapped to route corridor",
  },
];

export const NIZHNY_ROUTES_2_21_SCENARIO: ScenarioDefinition = {
  id: "nizhny-routes-2-21",
  name: "Nizhny Novgorod · Routes 2 + 21",
  shortName: "Routes 2 + 21 · shared network",
  description:
    "Real reference alignments for Route 2 and Route 21's established ≈11.1 km Park Dubki — Chyorny Prud corridor, including the three-turnout Krasnoselskaya triangle, the Chyorny Prud terminal connector and their shared city-centre rails.",
  useCase:
    "Observe mixed-route ordering, turnout queues and signal arbitration where Route 21 joins and leaves the Route 2 ring. Route 21 is modelled as its established pre-reconstruction topology.",
  segments: combinedPowerSegments,
  readers: [
    ...route2StationReaders,
    ...route21PrivateReaders,
    ...route21SharedReaders,
    ...trafficControls.map((control) => control.reader),
    ...switchReaders,
  ],
  signals: trafficControls.map((control) => control.signal),
  switches,
  junctionConflictZones: [
    {
      id: "KRS-TRIANGLE",
      label: "Красносельская · стрелочный треугольник",
      segmentIds: [
        "KRS-N-E",
        "KRS-N-W",
        "KRS-E-N",
        "KRS-E-W",
        "KRS-W-N",
        "KRS-W-E",
      ],
    },
  ],
  depots,
  serviceSchedule,
  serviceStartMinute: 450,
  routes,
  starts: [
    { segmentId: "N2A03", progress: 0.12 },
    { segmentId: "N21O03", progress: 0.18 },
    { segmentId: "N2B08", progress: 0.18 },
    { segmentId: "N21I04", progress: 0.18 },
    { segmentId: "N2A09", progress: 0.12 },
    { segmentId: "N2B15", progress: 0.18 },
    { segmentId: "N2B14", progress: 0.12 },
    { segmentId: "N2A13", progress: 0.18 },
    { segmentId: "N2A15", progress: 0.12 },
    { segmentId: "N21O09", progress: 0.18 },
  ],
  defaultObstacles: [],
  defaultTramCount: 10,
  fleetOptions: [2, 4, 6, 8, 10],
  fleetGroups: [
    {
      id: "route-2-counterclockwise",
      label: "Route 2 · counter-clockwise",
      shortName: "2 ↺",
      routeIntent: "main",
      routeId: "2",
      defaultCount: 3,
      maxCount: 10,
      starts: [
        { segmentId: "N2A03", progress: 0.12 },
        { segmentId: "N2A09", progress: 0.12 },
        { segmentId: "N2A15", progress: 0.12 },
        { segmentId: "N2A01", progress: 0.18 },
        { segmentId: "N2A05", progress: 0.18 },
        { segmentId: "N2A07", progress: 0.18 },
        { segmentId: "N2A11", progress: 0.18 },
        { segmentId: "N2A13", progress: 0.18 },
        { segmentId: "N2A16", progress: 0.18 },
        { segmentId: "N2A17", progress: 0.35 },
      ],
    },
    {
      id: "route-2-clockwise",
      label: "Route 2 · clockwise",
      shortName: "2 ↻",
      routeIntent: "main",
      routeId: "2",
      defaultCount: 2,
      maxCount: 10,
      starts: [
        { segmentId: "N2B03", progress: 0.18 },
        { segmentId: "N2B09", progress: 0.18 },
        { segmentId: "N2B15", progress: 0.18 },
        { segmentId: "N2B01", progress: 0.18 },
        { segmentId: "N2B05", progress: 0.18 },
        { segmentId: "N2B07", progress: 0.18 },
        { segmentId: "N2B11", progress: 0.18 },
        { segmentId: "N2B13", progress: 0.18 },
        { segmentId: "N2B16", progress: 0.18 },
        { segmentId: "N2B17", progress: 0.35 },
      ],
    },
    {
      id: "route-21-to-chyorny-prud",
      label: "Route 21 · to Chyorny Prud",
      shortName: "21 → Chyorny Prud",
      routeIntent: "branch",
      routeId: "21",
      defaultCount: 3,
      maxCount: 10,
      starts: [
        { segmentId: "N21O01", progress: 0.22 },
        { segmentId: "N21O03", progress: 0.18 },
        { segmentId: "N21O05", progress: 0.18 },
        { segmentId: "N21O07", progress: 0.18 },
        { segmentId: "N21O09", progress: 0.18 },
        { segmentId: "N21O11", progress: 0.18 },
        { segmentId: "N21O02", progress: 0.18 },
        { segmentId: "N21O04", progress: 0.18 },
        { segmentId: "N21O06", progress: 0.18 },
        { segmentId: "N21O08", progress: 0.18 },
      ],
    },
    {
      id: "route-21-to-park-dubki",
      label: "Route 21 · to Park Dubki",
      shortName: "21 → Park Dubki",
      routeIntent: "branch",
      routeId: "21",
      defaultCount: 2,
      maxCount: 10,
      starts: [
        { segmentId: "N21I01", progress: 0.22 },
        { segmentId: "N21I03", progress: 0.18 },
        { segmentId: "N21I05", progress: 0.18 },
        { segmentId: "N21I07", progress: 0.18 },
        { segmentId: "N21I09", progress: 0.18 },
        { segmentId: "N21I11", progress: 0.18 },
        { segmentId: "N21I02", progress: 0.18 },
        { segmentId: "N21I04", progress: 0.18 },
        { segmentId: "N21I06", progress: 0.18 },
        { segmentId: "N21I08", progress: 0.18 },
      ],
    },
  ],
  dispatchIntervalSeconds: 180,
  predeployedFleet: true,
  metersPerReferenceUnit: route2ReferenceLength / route2ReferenceUnits,
  mapContext,
  tractionPowerSystem: {
    nominalVoltageV: 600,
    label: "Nizhny Novgorod 600 V DC traction sections",
    sourceLabel: "Nizhny Novgorod City Duma decision №96 (25 May 2022) · public property addresses",
    modelNote: "Five route-relevant substation buildings are verified by address. Exact feeder breakers and section-post boundaries remain reconstructed from nearest-supply midpoints until an operator diagram is available.",
    substations: combinedSubstations,
    sections: buildNearestSubstationSections(
      combinedPowerSegments,
      combinedSubstations,
      ["#fb7185", "#f59e0b", "#22c55e", "#38bdf8", "#a78bfa"],
    ).map((section, index) => ({ ...section, flywheel: {
      model: "VYCON REGEN" as const,
      modules: [8, 8, 8, 7, 7][index] ?? 0,
      modulePowerKw: 125,
      moduleEnergyKWh: 0.520833,
      chargeEfficiency: 0.95,
      dischargeEfficiency: 0.95,
      initialSoc: 0.35,
      converterNote: "Bidirectional 600↔750 V DC converter; 90.25% modeled round-trip efficiency",
    } })),
  },
};
