import type {
  ElectricalSectionDefinition,
  Point,
  TrackSegment,
  TractionSubstationDefinition,
} from "./engine.ts";

const squaredDistance = (first: Point, second: Point) =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2;

const segmentMidpoint = (segment: TrackSegment): Point => {
  const first = segment.points[0];
  const last = segment.points.at(-1) ?? first;
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
};

/**
 * Public transport documents normally identify traction-substation buildings,
 * but rarely publish the live feeder diagram. Until an operator diagram is
 * available, split the schematic at the midpoint between the nearest verified
 * or reconstructed supply locations. Every estimate remains labelled as such
 * in the scenario metadata and UI.
 */
export function buildNearestSubstationSections(
  segments: TrackSegment[],
  substations: TractionSubstationDefinition[],
  colors: string[],
): ElectricalSectionDefinition[] {
  const feedingSubstations = substations.filter((item) => item.feedsMainLine !== false);
  const assignments = new Map<string, string[]>();
  feedingSubstations.forEach((item) => assignments.set(item.id, []));

  for (const segment of segments) {
    const midpoint = segmentMidpoint(segment);
    const nearest = feedingSubstations.reduce((best, candidate) =>
      squaredDistance(midpoint, candidate.point) < squaredDistance(midpoint, best.point)
        ? candidate
        : best,
    );
    assignments.get(nearest.id)!.push(segment.id);
  }

  return feedingSubstations.map((substation, index) => ({
    id: `SECTION-${substation.id}`,
    label: substation.sectionLabel ?? substation.label,
    substationId: substation.id,
    segmentIds: assignments.get(substation.id) ?? [],
    color: colors[index % colors.length],
  }));
}
