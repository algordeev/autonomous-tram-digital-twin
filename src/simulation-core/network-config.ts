import route2Network from "../config/networks/nizhny-route-2.json" with { type: "json" };
import routes2And21Network from "../config/networks/nizhny-routes-2-21.json" with { type: "json" };
import izmirKonakNetwork from "../config/networks/izmir-konak.json" with { type: "json" };
import type { ScenarioDefinition } from "./engine.ts";

export const NETWORK_CONFIG_VERSION = 1;

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function validateNetworkConfig(value: unknown): ScenarioDefinition {
  if (!value || typeof value !== "object") throw new Error("Network config must be an object");
  const network = value as Partial<ScenarioDefinition>;
  if (!network.id || !network.name || !network.shortName) {
    throw new Error("Network config is missing id, name or shortName");
  }
  if (!Array.isArray(network.segments) || network.segments.length === 0) {
    throw new Error("Network config must contain track segments");
  }
  const segmentIds = new Set<string>();
  for (const segment of network.segments) {
    if (!segment.id || segmentIds.has(segment.id)) {
      throw new Error(`Duplicate or missing segment id: ${segment.id ?? "unknown"}`);
    }
    if (!Array.isArray(segment.points) || segment.points.length < 2 || !segment.points.every(isPoint)) {
      throw new Error(`Segment ${segment.id} has invalid geometry`);
    }
    segmentIds.add(segment.id);
  }
  for (const route of network.routes ?? []) {
    if (!route.segmentIds.every((id) => segmentIds.has(id))) {
      throw new Error(`Route ${route.id} references an unknown segment`);
    }
  }
  for (const reader of network.readers ?? []) {
    if (!segmentIds.has(reader.segmentId)) {
      throw new Error(`Reader ${reader.id} references unknown segment ${reader.segmentId}`);
    }
  }
  for (const signal of network.signals ?? []) {
    if (!segmentIds.has(signal.segmentId)) {
      throw new Error(`Signal ${signal.id} references unknown segment ${signal.segmentId}`);
    }
  }
  const substationIds = new Set(
    (network.tractionPowerSystem?.substations ?? []).map((item) => item.id),
  );
  for (const section of network.tractionPowerSystem?.sections ?? []) {
    if (!substationIds.has(section.substationId)) {
      throw new Error(`Power section ${section.id} references unknown substation ${section.substationId}`);
    }
    if (!section.segmentIds.every((id) => segmentIds.has(id))) {
      throw new Error(`Power section ${section.id} references an unknown segment`);
    }
  }
  return network as ScenarioDefinition;
}

export const NETWORK_CONFIGS: ScenarioDefinition[] = [
  validateNetworkConfig(route2Network),
  validateNetworkConfig(routes2And21Network),
  validateNetworkConfig(izmirKonakNetwork),
];

export function networkConfigById(id: string) {
  return NETWORK_CONFIGS.find((network) => network.id === id) ?? null;
}
