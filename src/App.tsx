"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  SCENARIOS,
  SimulationEngine,
  initializeCppRuntime,
  isCppRuntimeReady,
  sampleTrackSegment,
  type Point,
  type ExperimentDefinition,
  type EnergyComparisonReport,
  type ScenarioDefinition,
  type SimulationRenderState,
  type SimulationSnapshot,
  type TrackSegment,
} from "./simulation-core/index.ts";
import { clampMapPan } from "./map-viewport.ts";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 620;
const MIN_MAP_ZOOM = 0.75;
const MAX_MAP_ZOOM = 18;
const OPERATIONAL_SCENARIOS = SCENARIOS.filter(
  (scenario) => scenario.id !== "prototype-loop",
);

interface MapFocusPreset {
  id: string;
  label: string;
  segmentId: string;
  at: number;
  zoom: number;
}

const MAP_FOCUS_PRESETS: Record<string, MapFocusPreset[]> = {
  "nizhny-routes-2-21": [
    { id: "krasnoselskaya", label: "Красносельская · треугольник стрелок", segmentId: "KRS-N-E", at: 0.45, zoom: 15 },
    { id: "chyorny-prud", label: "Чёрный Пруд · стрелка и треугольник", segmentId: "N21-CHP-LOOP", at: 0.5, zoom: 8.5 },
    { id: "park-dubki", label: "Парк Дубки · конечная", segmentId: "N21-PARK-LOOP", at: 0.5, zoom: 7 },
    { id: "maslyakova", label: "Маслякова · остановка и перекрёсток", segmentId: "N2A14", at: 0.58, zoom: 7 },
    { id: "sennaya", label: "Сенная · перекрёсток", segmentId: "N2A06", at: 0.88, zoom: 6 },
    { id: "osharskaya", label: "Белинского × Ошарская", segmentId: "N2A03", at: 0.32, zoom: 6 },
  ],
};

function screenSpaceScale(zoom: number) {
  return 1 / Math.max(MIN_MAP_ZOOM, zoom);
}

function withScreenSpace(
  context: CanvasRenderingContext2D,
  point: Point,
  zoom: number,
  draw: () => void,
) {
  context.save();
  context.translate(point.x, point.y);
  const inverseZoom = screenSpaceScale(zoom);
  context.scale(inverseZoom, inverseZoom);
  draw();
  context.restore();
}

function stopBoardIdForReader(
  reader: ScenarioDefinition["readers"][number],
) {
  return reader.stopBoardId
    ? `STOP-${reader.stopBoardId}`
    : reader.stationId
    ? `STOP-${reader.stationId}`
    : reader.stationNumber
    ? `STOP-${String(reader.stationNumber).padStart(2, "0")}`
    : `STOP-${reader.label
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`;
}

function traceSegment(context: CanvasRenderingContext2D, segment: TrackSegment) {
  tracePoints(context, segment.points);
}

function tracePoints(context: CanvasRenderingContext2D, points: Point[]) {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
}

function offsetTrackPoints(segment: TrackSegment, offset: number) {
  return segment.points.map((point, index, points) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return {
      x: point.x - (dy / length) * offset,
      y: point.y + (dx / length) * offset,
    };
  });
}

function segmentLength(segment: TrackSegment) {
  let length = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    length += Math.hypot(
      segment.points[index].x - segment.points[index - 1].x,
      segment.points[index].y - segment.points[index - 1].y,
    );
  }
  return length;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function drawGrid(context: CanvasRenderingContext2D) {
  context.save();
  context.strokeStyle = "rgba(56, 91, 112, 0.18)";
  context.lineWidth = 1;
  for (let x = 30; x < WORLD_WIDTH; x += 50) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, WORLD_HEIGHT);
    context.stroke();
  }
  for (let y = 30; y < WORLD_HEIGHT; y += 50) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WORLD_WIDTH, y);
    context.stroke();
  }
  context.fillStyle = "rgba(142, 172, 191, 0.72)";
  context.font = "600 12px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  for (let index = 0; index < 10; index += 1) {
    context.fillText(String.fromCharCode(65 + index), 80 + index * 95, 24);
  }
  context.textAlign = "left";
  for (let index = 0; index < 6; index += 1) {
    context.fillText(String(index + 1), 14, 84 + index * 92);
  }
  context.restore();
}

function drawMapContext(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  zoom: number,
) {
  const map = scenario.mapContext;
  if (!map) return;

  context.save();
  context.fillStyle = "rgba(14, 31, 42, 0.72)";
  context.fillRect(34, 34, WORLD_WIDTH - 68, WORLD_HEIGHT - 68);

  for (const line of map.lines) {
    tracePoints(context, line.points);
    context.strokeStyle =
      line.kind === "primary"
        ? "rgba(64, 84, 96, 0.74)"
        : "rgba(48, 68, 80, 0.64)";
    context.lineWidth = (line.kind === "primary" ? 26 : 19) / zoom;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();

    tracePoints(context, line.points);
    context.strokeStyle =
      line.kind === "primary"
        ? "rgba(121, 140, 151, 0.23)"
        : "rgba(104, 124, 136, 0.17)";
    context.lineWidth = 1.2 / zoom;
    context.setLineDash([8, 8]);
    context.stroke();
    context.setLineDash([]);
  }

  if (zoom > 1.2) {
    context.restore();
    return;
  }

  context.save();
  context.translate(948, 72);
  context.strokeStyle = "#9ab0bd";
  context.fillStyle = "#9ab0bd";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(0, 19);
  context.lineTo(0, -13);
  context.stroke();
  context.beginPath();
  context.moveTo(0, -18);
  context.lineTo(-5, -8);
  context.lineTo(5, -8);
  context.closePath();
  context.fill();
  context.font = "800 9px ui-monospace, SFMono-Regular, monospace";
  context.textAlign = "center";
  context.fillText("N", 0, -25);
  context.restore();

  const metersPerUnit = scenario.metersPerReferenceUnit ?? 1;
  const scaleWidth = map.scaleBarMeters / metersPerUnit;
  const scaleX = 55;
  const scaleY = 585;
  context.strokeStyle = "#c6d5dc";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(scaleX, scaleY);
  context.lineTo(scaleX + scaleWidth, scaleY);
  context.moveTo(scaleX, scaleY - 5);
  context.lineTo(scaleX, scaleY + 5);
  context.moveTo(scaleX + scaleWidth, scaleY - 5);
  context.lineTo(scaleX + scaleWidth, scaleY + 5);
  context.stroke();
  context.fillStyle = "#90a7b4";
  context.font = "650 8px ui-monospace, SFMono-Regular, monospace";
  context.textAlign = "center";
  context.fillText(
    `${(map.scaleBarMeters / 1000).toFixed(map.scaleBarMeters >= 1000 ? 0 : 1)} km`,
    scaleX + scaleWidth / 2,
    scaleY - 8,
  );

  context.fillStyle = "rgba(111, 136, 150, 0.7)";
  context.font = "500 8px Inter, system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(map.sourceLabel, 946, 590);
  context.restore();
}

function drawTrack(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  activeSegments: Set<string>,
  zoom: number,
) {
  for (const segment of scenario.segments) {
    if (segment.render === false) continue;
    const sleepers = Math.max(4, Math.ceil((segmentLength(segment) * zoom) / 23));
    context.save();
    context.strokeStyle = "#3d4b55";
    context.lineWidth = 3.2 / zoom;
    for (let index = 0; index <= sleepers; index += 1) {
      const location = sampleTrackSegment(segment, index / sleepers);
      const perpendicular = location.angle + Math.PI / 2;
      const half = 7 / zoom;
      context.beginPath();
      context.moveTo(
        location.point.x - Math.cos(perpendicular) * half,
        location.point.y - Math.sin(perpendicular) * half,
      );
      context.lineTo(
        location.point.x + Math.cos(perpendicular) * half,
        location.point.y + Math.sin(perpendicular) * half,
      );
      context.stroke();
    }
    traceSegment(context, segment);
    context.strokeStyle = "#687681";
    context.lineWidth = 10 / zoom;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
    traceSegment(context, segment);
    context.strokeStyle = "#0b141d";
    context.lineWidth = 6 / zoom;
    context.stroke();
    traceSegment(context, segment);
    context.strokeStyle = activeSegments.has(segment.id)
      ? "rgba(210, 235, 242, 0.38)"
      : "rgba(81, 126, 148, 0.38)";
    context.shadowBlur = activeSegments.has(segment.id) ? 7 : 0;
    context.shadowColor = "#d6edf5";
    context.lineWidth = (activeSegments.has(segment.id) ? 2.4 : 1.1) / zoom;
    context.stroke();
    context.restore();
  }
}

function drawRoutes(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  activeSegments: Set<string>,
  zoom: number,
) {
  for (const segment of scenario.segments) {
    if (segment.render === false) continue;
    const routes = scenario.routes.filter((route) =>
      route.segmentIds.includes(segment.id),
    );
    routes.forEach((route, index) => {
      const offset = (index - (routes.length - 1) / 2) * 4.5;
      context.save();
      tracePoints(context, offsetTrackPoints(segment, offset));
      context.strokeStyle = route.color;
      context.globalAlpha = activeSegments.has(segment.id) ? 1 : 0.62;
      context.lineWidth = (activeSegments.has(segment.id) ? 3.2 : 2.4) / zoom;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowColor = route.color;
      context.shadowBlur = activeSegments.has(segment.id) ? 7 : 2;
      context.stroke();
      context.restore();
    });
  }

  if (scenario.mapContext) return;

  for (const route of scenario.routes) {
    const segment = scenario.segments.find(
      (item) => item.id === route.labelSegmentId,
    );
    if (!segment) continue;
    const location = sampleTrackSegment(segment, route.labelAt);
    const normal = location.angle - Math.PI / 2;
    const x = location.point.x + Math.cos(normal) * route.labelOffset;
    const y = location.point.y + Math.sin(normal) * route.labelOffset;
    context.save();
    context.font = "700 10px Inter, system-ui, sans-serif";
    const labelWidth = Math.max(88, context.measureText(route.name).width + 45);
    roundedRect(context, x - labelWidth / 2, y - 13, labelWidth, 26, 7);
    context.fillStyle = "rgba(7, 17, 24, 0.94)";
    context.strokeStyle = route.color;
    context.lineWidth = 1.4;
    context.shadowColor = route.color;
    context.shadowBlur = 7;
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = route.color;
    context.font = "800 10px ui-monospace, SFMono-Regular, monospace";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(route.shortName, x - labelWidth / 2 + 10, y + 0.5);
    context.fillStyle = "#d9e6ed";
    context.font = "650 10px Inter, system-ui, sans-serif";
    context.fillText(route.name, x - labelWidth / 2 + 31, y + 0.5);
    context.restore();
  }
}

function drawTractionSubstations(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  zoom: number,
) {
  const system = scenario.tractionPowerSystem;
  if (!system) return;
  for (const substation of system.substations) {
    const section = system.sections.find((item) => item.substationId === substation.id);
    const color = section?.color ?? "#94a3b8";
    withScreenSpace(context, substation.point, zoom, () => {
      context.save();
      if (section?.flywheel?.modules) {
        context.beginPath();
        context.arc(0, 0, 11, 0, Math.PI * 2);
        context.fillStyle = "rgba(85, 215, 232, 0.12)";
        context.strokeStyle = "#55d7e8";
        context.lineWidth = 1.4;
        context.fill();
        context.stroke();
      }
      context.rotate(Math.PI / 4);
      context.fillStyle = substation.confidence === "verified-address"
        ? "rgba(7, 19, 28, 0.96)"
        : "rgba(7, 19, 28, 0.72)";
      context.strokeStyle = color;
      context.lineWidth = 1.8;
      context.setLineDash(
        substation.confidence === "verified-address" ? [] : [3, 2],
      );
      context.fillRect(-6, -6, 12, 12);
      context.strokeRect(-6, -6, 12, 12);
      context.restore();
      context.fillStyle = color;
      context.font = "800 7px ui-monospace, SFMono-Regular, monospace";
      context.textAlign = "center";
      context.fillText("SS", 0, 2.5);
      if (section?.flywheel?.modules) {
        context.fillStyle = "#55d7e8";
        context.font = "800 6px ui-monospace, SFMono-Regular, monospace";
        context.fillText(`FW×${section.flywheel.modules}`, 0, 19);
      }
      if (zoom >= 2.2) {
        context.font = "700 8px Inter, system-ui, sans-serif";
        context.textAlign = "left";
        context.fillStyle = "#d8e5eb";
        context.fillText(section?.label ?? substation.label, 10, 3);
      }
    });
  }
}

function drawStation(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  reader: ScenarioDefinition["readers"][number],
  selected: boolean,
  zoom: number,
) {
  const segment = scenario.segments.find((item) => item.id === reader.segmentId);
  if (!segment) return;
  const location = sampleTrackSegment(segment, reader.displayAt ?? reader.at);

  if (scenario.mapContext) {
    const visiblePoints = scenario.segments
      .filter((item) => item.render !== false)
      .flatMap((item) => item.points);
    const centroid = visiblePoints.reduce(
      (current, point) => ({
        x: current.x + point.x / visiblePoints.length,
        y: current.y + point.y / visiblePoints.length,
      }),
      { x: 0, y: 0 },
    );
    const normalA = location.angle - Math.PI / 2;
    const normalB = normalA + Math.PI;
    const candidateA = {
      x: location.point.x + Math.cos(normalA) * 34,
      y: location.point.y + Math.sin(normalA) * 34,
    };
    const candidateB = {
      x: location.point.x + Math.cos(normalB) * 34,
      y: location.point.y + Math.sin(normalB) * 34,
    };
    const distanceA = Math.hypot(candidateA.x - centroid.x, candidateA.y - centroid.y);
    const normal = distanceA >= Math.hypot(candidateB.x - centroid.x, candidateB.y - centroid.y)
      ? normalA
      : normalB;

    withScreenSpace(context, location.point, zoom, () => {
      if (selected) {
        context.beginPath();
        context.arc(0, 0, 11, 0, Math.PI * 2);
        context.strokeStyle = "#59d8e8";
        context.lineWidth = 2;
        context.shadowColor = "#59d8e8";
        context.shadowBlur = 9;
        context.stroke();
        context.shadowBlur = 0;
      }
      context.beginPath();
      context.arc(0, 0, reader.showLabel ? 6 : 4.5, 0, Math.PI * 2);
      context.fillStyle = "#07131c";
      context.strokeStyle = selected ? "#59d8e8" : "#ffc13b";
      context.lineWidth = selected ? 2.4 : reader.showLabel ? 2.1 : 1.5;
      context.shadowColor = selected ? "#59d8e8" : "#ffc13b";
      context.shadowBlur = reader.showLabel ? 6 : 2;
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = "#ffd778";
      context.font = "800 6px ui-monospace, SFMono-Regular, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(reader.stationNumber ?? ""), 0, 0.5);

      if (reader.showLabel) {
        context.font = "700 9px Inter, system-ui, sans-serif";
        const labelWidth = Math.max(82, context.measureText(reader.label).width + 22);
        const labelDistance = reader.labelDistancePx ?? 48;
        const labelX = Math.cos(normal) * labelDistance;
        const labelY = Math.sin(normal) * labelDistance;
        context.beginPath();
        context.moveTo(Math.cos(normal) * 8, Math.sin(normal) * 8);
        context.lineTo(
          Math.cos(normal) * Math.max(34, labelDistance - 14),
          Math.sin(normal) * Math.max(34, labelDistance - 14),
        );
        context.strokeStyle = "rgba(255, 193, 59, 0.72)";
        context.lineWidth = 1;
        context.stroke();
        roundedRect(context, labelX - labelWidth / 2, labelY - 11, labelWidth, 22, 6);
        context.fillStyle = "rgba(7, 18, 26, 0.94)";
        context.strokeStyle = "rgba(255, 193, 59, 0.72)";
        context.fill();
        context.stroke();
        context.fillStyle = "#edf3f6";
        context.textAlign = "center";
        context.fillText(reader.label, labelX, labelY + 0.5);
      }
    });
    return;
  }

  context.save();
  context.font = "700 10px Inter, system-ui, sans-serif";
  const labelWidth = Math.max(112, context.measureText(reader.label).width + 42);
  context.restore();
  let normal = location.angle - Math.PI / 2;
  const preferredLabel = {
    x: location.point.x + Math.cos(normal) * 45,
    y: location.point.y + Math.sin(normal) * 45,
  };
  if (
    preferredLabel.x - labelWidth / 2 < 24 ||
    preferredLabel.x + labelWidth / 2 > WORLD_WIDTH - 24 ||
    preferredLabel.y - 18 < 36 ||
    preferredLabel.y + 18 > WORLD_HEIGHT - 24
  ) {
    normal += Math.PI;
  }
  const platformOffset = 17;
  const platformX = location.point.x + Math.cos(normal) * platformOffset;
  const platformY = location.point.y + Math.sin(normal) * platformOffset;
  const labelOffset = 45;
  const labelX = location.point.x + Math.cos(normal) * labelOffset;
  const labelY = location.point.y + Math.sin(normal) * labelOffset;

  context.save();
  context.translate(platformX, platformY);
  context.rotate(location.angle);
  roundedRect(context, -30, -5, 60, 10, 3);
  context.fillStyle = "#14212b";
  context.strokeStyle = "#f4a62a";
  context.lineWidth = 2;
  context.shadowColor = "#f4a62a";
  context.shadowBlur = 7;
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = "#f4a62a";
  context.fillRect(-21, -2, 42, 4);
  context.restore();

  context.save();
  context.font = "700 10px Inter, system-ui, sans-serif";
  roundedRect(
    context,
    labelX - labelWidth / 2,
    labelY - 16,
    labelWidth,
    32,
    7,
  );
  context.fillStyle = "rgba(9, 20, 29, 0.97)";
  context.strokeStyle = "#f4a62a";
  context.lineWidth = 1.4;
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(labelX - labelWidth / 2 + 13, labelY, 5, 0, Math.PI * 2);
  context.fillStyle = "#f4a62a";
  context.shadowColor = "#f4a62a";
  context.shadowBlur = 7;
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#f4a62a";
  context.font = "800 8px ui-monospace, SFMono-Regular, monospace";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(reader.id, labelX - labelWidth / 2 + 24, labelY - 6);
  context.fillStyle = "#e6eef3";
  context.font = "650 10px Inter, system-ui, sans-serif";
  context.fillText(reader.label, labelX - labelWidth / 2 + 24, labelY + 7);
  context.restore();
}

function drawReader(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  reader: ScenarioDefinition["readers"][number],
  pulse: number,
  selectedStopId: string | null,
  zoom: number,
) {
  if (reader.render === false) return;
  if (reader.kind === "station") {
    drawStation(
      context,
      scenario,
      reader,
      stopBoardIdForReader(reader) === selectedStopId,
      zoom,
    );
    return;
  }
  const segment = scenario.segments.find((item) => item.id === reader.segmentId);
  if (!segment) return;
  const location = sampleTrackSegment(segment, reader.displayAt ?? reader.at);
  const offsetAngle = location.angle - Math.PI / 2;
  const point = {
    x: location.point.x + Math.cos(offsetAngle) * 24,
    y: location.point.y + Math.sin(offsetAngle) * 24,
  };
  const color = reader.kind === "switch" ? "#9b8cff" : "#25d4e8";
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 6 + pulse * 4;
  context.fillStyle = "#0d1923";
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(point.x, point.y, 15, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = "#dcecf5";
  context.font = "600 10px ui-monospace, SFMono-Regular, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(reader.id, point.x, point.y + 0.5);
  context.restore();
}

function drawStationPlatforms(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  zoom: number,
) {
  const rendered = new Set<string>();
  for (const reader of scenario.readers) {
    if (reader.kind !== "station") continue;
    const key = `${reader.segmentId}:${reader.stationId ?? reader.id}`;
    if (rendered.has(key)) continue;
    rendered.add(key);
    const segment = scenario.segments.find((item) => item.id === reader.segmentId);
    if (!segment) continue;
    // The approach detector is deliberately upstream.  Platforms belong at
    // the actual boarding marker, which is also where the tram aligns.
    const location = sampleTrackSegment(segment, reader.displayAt ?? reader.at);
    const routeColor =
      scenario.routes.find((route) => route.id === reader.routeId)?.color ?? "#f4a62a";
    withScreenSpace(context, location.point, zoom, () => {
      context.rotate(location.angle);
      if (scenario.id === "izmir-konak" && reader.terminal) {
        // Both Konak Tram termini have two platform tracks. Keep this short
        // parallel berth leg in screen space so it remains readable at every
        // map zoom while the operational core treats it as an independent bay.
        const secondTrackY = -16;
        context.strokeStyle = "#586975";
        context.lineWidth = 2.2;
        context.beginPath();
        context.moveTo(-36, secondTrackY - 2.5);
        context.lineTo(36, secondTrackY - 2.5);
        context.moveTo(-36, secondTrackY + 2.5);
        context.lineTo(36, secondTrackY + 2.5);
        context.stroke();
        context.strokeStyle = "rgba(116, 137, 150, 0.75)";
        context.lineWidth = 1;
        for (let x = -32; x <= 32; x += 8) {
          context.beginPath();
          context.moveTo(x, secondTrackY - 5);
          context.lineTo(x, secondTrackY + 5);
          context.stroke();
        }
        roundedRect(context, -25, secondTrackY - 18.5, 50, 9, 3.5);
        context.fillStyle = "#455663";
        context.strokeStyle = "#8ea1ac";
        context.lineWidth = 1.2;
        context.fill();
        context.stroke();
        context.fillStyle = routeColor;
        context.font = "800 7px ui-monospace, SFMono-Regular, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("P2", 0, secondTrackY - 14);
      }
      const platformY = 14;
      roundedRect(context, -25, platformY - 4.5, 50, 9, 3.5);
      context.fillStyle = "#455663";
      context.strokeStyle = "#8ea1ac";
      context.lineWidth = 1.2;
      context.fill();
      context.stroke();
      context.strokeStyle = "#f1c84b";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-21, platformY - 4.5);
      context.lineTo(21, platformY - 4.5);
      context.stroke();
      context.fillStyle = routeColor;
      context.beginPath();
      context.arc(-18, platformY, 2.2, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(225, 237, 243, 0.82)";
      context.fillRect(-9, platformY - 1.2, 18, 2.4);
      if (scenario.id === "izmir-konak" && reader.terminal) {
        context.fillStyle = routeColor;
        context.font = "800 7px ui-monospace, SFMono-Regular, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("P1", 0, platformY);
      }
    });
  }
}

function drawSignal(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  signal: ScenarioDefinition["signals"][number],
  phase: SimulationSnapshot["trafficPhase"],
  activeSignalId: string | null,
  zoom: number,
) {
  if (signal.render === false) return;
  const segment = scenario.segments.find((item) => item.id === signal.segmentId);
  if (!segment) return;
  const location = sampleTrackSegment(segment, signal.at);
  const offsetAngle = location.angle + Math.PI / 2;
  const isSelectedApproach = activeSignalId === signal.id;
  const active =
    phase === "tram-green" && isSelectedApproach
      ? { color: "#42d392", index: 2 }
      : (phase === "amber-to-tram" || phase === "amber-to-road") &&
          isSelectedApproach
        ? { color: "#f4a62a", index: 1 }
        : { color: "#ff5c66", index: 0 };
  withScreenSpace(context, location.point, zoom, () => {
    const x = Math.cos(offsetAngle) * 22;
    const y = Math.sin(offsetAngle) * 22;
    context.strokeStyle = "#536a78";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, y + 12);
    context.lineTo(x, y + 23);
    context.stroke();
    roundedRect(context, x - 6.5, y - 15, 13, 30, 4);
    context.fillStyle = "#091018";
    context.strokeStyle = "#7a8d99";
    context.lineWidth = 1.2;
    context.fill();
    context.stroke();
    ["#61252b", "#604721", "#204d3d"].forEach((inactive, index) => {
      context.beginPath();
      context.arc(x, y - 8.5 + index * 8.5, 3, 0, Math.PI * 2);
      context.fillStyle = index === active.index ? active.color : inactive;
      context.shadowBlur = index === active.index ? 6 : 0;
      context.shadowColor = active.color;
      context.fill();
    });
  });
}

function drawSwitch(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  item: ReturnType<SimulationEngine["getRenderState"]>["switches"][number],
  zoom: number,
) {
  const inlineSegment =
    item.definition.segmentId && item.definition.at !== undefined
      ? scenario.segments.find(
          (segment) => segment.id === item.definition.segmentId,
        )
      : null;
  const incoming = scenario.segments.find(
    (segment) => segment.to === item.definition.nodeId,
  );
  const point = inlineSegment
    ? sampleTrackSegment(inlineSegment, item.definition.at!).point
    : incoming?.points[incoming.points.length - 1];
  if (!point) return;
  const mainActive = item.runtime.state === "main";
  const markerColor = mainActive ? "#25d4e8" : "#f4a62a";
  if (zoom < 1.8) {
    withScreenSpace(context, point, zoom, () => {
      context.beginPath();
      context.arc(0, 0, 4, 0, Math.PI * 2);
      context.fillStyle = markerColor;
      context.strokeStyle = "#07131c";
      context.lineWidth = 1.5;
      context.fill();
      context.stroke();
    });
    return;
  }
  const mainSegment = scenario.segments.find(
    (segment) => segment.id === item.definition.mainSegmentId,
  );
  const branchSegment = scenario.segments.find(
    (segment) => segment.id === item.definition.branchSegmentId,
  );
  if (!mainSegment || !branchSegment) return;

  const arm = (segment: TrackSegment, startAt: number) => {
    const desiredWorldLength =
      (item.definition.displayArmLengthPx ?? 74) / zoom;
    const visibleFraction = Math.max(
      0.08,
      Math.min(1, desiredWorldLength / segmentLength(segment)),
    );
    const endAt = Math.min(
      1,
      startAt + visibleFraction,
    );
    const points = Array.from({ length: 9 }, (_value, index) =>
      sampleTrackSegment(segment, startAt + ((endAt - startAt) * index) / 8).point,
    );
    const endLocation = sampleTrackSegment(segment, endAt);
    return { points, endLocation };
  };
  const mainArm = arm(mainSegment, inlineSegment ? item.definition.at ?? 0 : 0);
  const branchArm = arm(branchSegment, 0);

  const drawArm = (
    geometry: ReturnType<typeof arm>,
    active: boolean,
    activeColor: string,
  ) => {
    context.save();
    tracePoints(context, geometry.points);
    context.strokeStyle = "rgba(4, 12, 18, 0.94)";
    context.lineWidth = 8 / zoom;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
    tracePoints(context, geometry.points);
    context.strokeStyle = active ? activeColor : "#a8bac5";
    context.globalAlpha = active ? 1 : 0.82;
    context.lineWidth = (active ? 4.5 : 2.8) / zoom;
    context.shadowColor = activeColor;
    context.shadowBlur = active ? 8 : 0;
    context.stroke();
    context.restore();

    withScreenSpace(context, geometry.endLocation.point, zoom, () => {
      context.rotate(geometry.endLocation.angle);
      context.beginPath();
      context.moveTo(7, 0);
      context.lineTo(-5, -5);
      context.lineTo(-5, 5);
      context.closePath();
      context.fillStyle = active ? activeColor : "#a8bac5";
      context.fill();
    });
  };

  drawArm(mainArm, mainActive, "#25d4e8");
  drawArm(branchArm, !mainActive, "#f4a62a");

  if (
    zoom >= 5.2 &&
    item.definition.showArmLabels !== false &&
    !item.definition.label.includes("Красносельская")
  ) {
    const drawArmLabel = (
      geometry: ReturnType<typeof arm>,
      label: string,
      active: boolean,
      color: string,
      side: number,
    ) => {
      withScreenSpace(context, geometry.endLocation.point, zoom, () => {
        const normal = geometry.endLocation.angle + (Math.PI / 2) * side;
        const x = Math.cos(normal) * 15;
        const y = Math.sin(normal) * 15;
        context.font = "750 8px Inter, system-ui, sans-serif";
        const width = context.measureText(label).width + 14;
        roundedRect(context, x - width / 2, y - 8, width, 16, 4);
        context.fillStyle = "rgba(5, 15, 22, 0.94)";
        context.strokeStyle = active ? color : "#718793";
        context.lineWidth = 1;
        context.fill();
        context.stroke();
        context.fillStyle = active ? "#edf6f8" : "#b6c5cd";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, x, y + 0.5);
      });
    };
    drawArmLabel(mainArm, "ПРЯМО", mainActive, "#25d4e8", -1);
    drawArmLabel(branchArm, "СЪЕЗД", !mainActive, "#f4a62a", 1);
  }

  const incomingAngle = incoming
    ? sampleTrackSegment(incoming, 1).angle + Math.PI
    : mainArm.endLocation.angle + Math.PI;
  withScreenSpace(context, point, zoom, () => {
    context.beginPath();
    context.arc(0, 0, 11, 0, Math.PI * 2);
    context.fillStyle = "#07131c";
    context.strokeStyle = markerColor;
    context.lineWidth = 2;
    context.shadowColor = markerColor;
    context.shadowBlur = item.runtime.lockedBy ? 8 : 4;
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = "#dceaf0";
    context.lineWidth = 1.8;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(Math.cos(incomingAngle) * 8, Math.sin(incomingAngle) * 8);
    context.lineTo(0, 0);
    context.lineTo(
      Math.cos(mainArm.endLocation.angle) * 8,
      Math.sin(mainArm.endLocation.angle) * 8,
    );
    context.moveTo(0, 0);
    context.lineTo(
      Math.cos(branchArm.endLocation.angle) * 8,
      Math.sin(branchArm.endLocation.angle) * 8,
    );
    context.stroke();
  });
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  obstacle: SimulationSnapshot["obstacles"][number],
  zoom: number,
) {
  const segment = scenario.segments.find((item) => item.id === obstacle.segmentId);
  if (!segment) return;
  const location = sampleTrackSegment(segment, obstacle.at);
  withScreenSpace(context, location.point, zoom, () => {
    const y = -25;
    context.shadowColor = "#f4a62a";
    context.shadowBlur = 10;
    context.beginPath();
    context.moveTo(0, y - 13);
    context.lineTo(15, y + 13);
    context.lineTo(-15, y + 13);
    context.closePath();
    context.fillStyle = "#332312";
    context.strokeStyle = "#f4a62a";
    context.lineWidth = 2.5;
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "#f4a62a";
    context.font = "800 15px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("!", 0, y + 9);
  });
}

function drawTram(
  context: CanvasRenderingContext2D,
  tram: SimulationSnapshot["trams"][number],
  selected: boolean,
  sensorRangeMeters: number,
  metersPerReferenceUnit: number,
  compact: boolean,
  zoom: number,
) {
  const length = compact ? 30 : 46;
  const width = compact ? 14 : 20;
  const berthOffsetWorld = tram.terminalBerth === 2 ? -16 / Math.max(zoom, 0.1) : 0;
  const berthNormal = tram.angle - Math.PI / 2;
  const displayPosition = berthOffsetWorld
    ? {
        x: tram.position.x + Math.cos(berthNormal) * berthOffsetWorld,
        y: tram.position.y + Math.sin(berthNormal) * berthOffsetWorld,
      }
    : tram.position;
  if (selected) {
    const range = sensorRangeMeters / metersPerReferenceUnit;
    const bodyHalfWorld = length / (2 * zoom);
    context.save();
    context.strokeStyle =
      tram.statusTone === "danger"
        ? "rgba(255, 92, 102, 0.6)"
        : "rgba(37, 212, 232, 0.34)";
    context.lineWidth = 1.5 / zoom;
    context.setLineDash([4 / zoom, 5 / zoom]);
    context.beginPath();
    context.moveTo(
      displayPosition.x + Math.cos(tram.angle) * bodyHalfWorld,
      displayPosition.y + Math.sin(tram.angle) * bodyHalfWorld,
    );
    context.lineTo(
      displayPosition.x + Math.cos(tram.angle) * (bodyHalfWorld + range),
      displayPosition.y + Math.sin(tram.angle) * (bodyHalfWorld + range),
    );
    context.stroke();
    context.restore();
  }
  withScreenSpace(context, displayPosition, zoom, () => {
    context.rotate(tram.angle);
    context.shadowColor = tram.color;
    context.shadowBlur = selected ? 16 : 7;
    roundedRect(context, -length / 2, -width / 2, length, width, 7);
    context.fillStyle = "#d8e1e5";
    context.strokeStyle = tram.color;
    context.lineWidth = selected ? 2.4 : 1.2;
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    roundedRect(
      context,
      compact ? -9 : -13,
      compact ? -5 : -7,
      compact ? 18 : 26,
      compact ? 10 : 14,
      3,
    );
    context.fillStyle = "#102330";
    context.fill();
    context.fillStyle = tram.color;
    context.fillRect(compact ? -6 : -8, compact ? -3.5 : -5, compact ? 3 : 4, compact ? 7 : 10);
    context.fillRect(compact ? 3 : 4, compact ? -3.5 : -5, compact ? 3 : 4, compact ? 7 : 10);
    if (tram.doorsOpen) {
      const doorwayLength = compact ? 7 : 10;
      const doorwayGap = compact ? 2.5 : 4;
      const bodyEdge = width / 2;
      const leafOffset = compact ? 4.5 : 7;
      context.fillStyle = "#061018";
      context.fillRect(-doorwayLength - 1, -bodyEdge - 1.5, doorwayLength, 3.5);
      context.fillRect(1, -bodyEdge - 1.5, doorwayLength, 3.5);
      context.fillRect(-doorwayLength - 1, bodyEdge - 2, doorwayLength, 3.5);
      context.fillRect(1, bodyEdge - 2, doorwayLength, 3.5);
      context.fillStyle = "#42d392";
      context.strokeStyle = "#dffcf2";
      context.lineWidth = 0.8;
      context.shadowColor = "#42d392";
      context.shadowBlur = 10;
      [-1, 1].forEach((side) => {
        const y = side * (bodyEdge + leafOffset);
        [-7, 5].forEach((doorX) => {
          context.fillRect(doorX - doorwayGap, y - 1.5, doorwayGap, 3);
          context.strokeRect(doorX - doorwayGap, y - 1.5, doorwayGap, 3);
        });
      });
      context.shadowBlur = 0;
    }
    context.fillStyle = "#677783";
    context.beginPath();
    const wheelX = compact ? 10 : 17;
    const wheelY = compact ? 5 : 8;
    const wheelRadius = compact ? 2 : 3;
    context.arc(-wheelX, -wheelY, wheelRadius, 0, Math.PI * 2);
    context.arc(wheelX, -wheelY, wheelRadius, 0, Math.PI * 2);
    context.arc(-wheelX, wheelY, wheelRadius, 0, Math.PI * 2);
    context.arc(wheelX, wheelY, wheelRadius, 0, Math.PI * 2);
    context.fill();
    if (compact) {
      context.fillStyle = "#07131c";
      context.font = "900 7px ui-monospace, SFMono-Regular, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(tram.linePriority), 0, 0.5);
    }
  });

  if (compact && !selected) return;

  withScreenSpace(context, displayPosition, zoom, () => {
    const labelWidth = 64;
    const labelY = -27;
    roundedRect(context, -labelWidth / 2, labelY - 11, labelWidth, 20, 4);
    context.fillStyle = "#08131b";
    context.strokeStyle = tram.color;
    context.lineWidth = 1.2;
    context.fill();
    context.stroke();
    context.fillStyle = tram.color;
    context.font = "700 9px ui-monospace, SFMono-Regular, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      tram.serviceState === "in-service" ? tram.label : tram.serviceLabel,
      0,
      labelY - 1,
    );
    if (tram.doorsOpen) {
      const badgeY = labelY - 19;
      roundedRect(context, -34, badgeY - 7, 68, 14, 4);
      context.fillStyle = "rgba(7, 26, 24, 0.96)";
      context.strokeStyle = "#42d392";
      context.lineWidth = 1.2;
      context.fill();
      context.stroke();
      context.fillStyle = "#78edbe";
      context.font = "800 7px ui-monospace, SFMono-Regular, monospace";
      context.fillText("ДВЕРИ ОТКРЫТЫ", 0, badgeY);
    }
  });
}

function drawDepots(
  context: CanvasRenderingContext2D,
  depots: NonNullable<ScenarioDefinition["depots"]>,
  zoom: number,
) {
  for (const depot of depots) {
    for (const portal of depot.portals) {
      tracePoints(context, portal.trackPoints);
      context.strokeStyle = "rgba(6, 14, 20, 0.96)";
      context.lineWidth = 9 / zoom;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
      tracePoints(context, portal.trackPoints);
      context.strokeStyle = "#637887";
      context.lineWidth = 5 / zoom;
      context.stroke();
      tracePoints(context, portal.trackPoints);
      context.strokeStyle = "#14232d";
      context.lineWidth = 2.4 / zoom;
      context.stroke();
    }

    const isTurnback = depot.kind === "turnback";
    withScreenSpace(context, depot.point, zoom, () => {
      const w = isTurnback ? 46 : 70;
      const h = isTurnback ? 26 : 36;
      roundedRect(context, -w / 2, -h / 2, w, h, 6);
      context.fillStyle = "#0b1720";
      context.strokeStyle = isTurnback ? "#c98a2e" : "#8ea4b2";
      context.lineWidth = 1.4;
      context.fill();
      context.stroke();
      const ties = isTurnback ? [0] : [-20, 0, 20];
      ties.forEach((x) => {
        context.strokeStyle = isTurnback ? "#6b5326" : "#435966";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, -h / 2 + 8);
        context.lineTo(x, h / 2 - 7);
        context.stroke();
      });
      context.fillStyle = "#e2edf2";
      context.font = "700 9px ui-monospace, SFMono-Regular, monospace";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText(depot.shortName, 0, -h / 2 - 5);
      context.fillStyle = isTurnback ? "#c98a2e" : "#78909f";
      context.font = "600 7px Inter, system-ui, sans-serif";
      context.textBaseline = "top";
      context.fillText(
        isTurnback ? `SHORT-TURN SIDING · ${depot.capacity ?? 1} TRACK` : "OFF-MAP SERVICE GATE",
        0,
        h / 2 + 5,
      );
    });
  }
}

const ROAD_CROSSING_LENGTH_PX = 126;

function roadCrossingGeometry(
  scenario: ScenarioDefinition,
  state: ReturnType<SimulationEngine["getRenderState"]>,
  controllerId: string,
) {
  const approaches = state.signals
    .filter(
      (item) =>
        (item.definition.controllerId ?? item.definition.id) === controllerId,
    )
    .map((signalState) => {
      const segment = scenario.segments.find(
        (item) => item.id === signalState.definition.segmentId,
      );
      return segment
        ? sampleTrackSegment(segment, signalState.definition.at)
        : null;
    })
    .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample));
  if (approaches.length === 0) return null;

  // A crossing belongs to the controller, not to one arbitrarily selected
  // direction. Its centre is between both tram stop lines, so clockwise and
  // counter-clockwise approaches protect the exact same piece of road.
  const point = approaches.reduce(
    (sum, approach) => ({
      x: sum.x + approach.point.x / approaches.length,
      y: sum.y + approach.point.y / approaches.length,
    }),
    { x: 0, y: 0 },
  );
  const roadAngle = approaches[0].angle + Math.PI / 2;
  return {
    point,
    roadAngle,
    ux: Math.cos(roadAngle),
    uy: Math.sin(roadAngle),
    nx: -Math.sin(roadAngle),
    ny: Math.cos(roadAngle),
  };
}

function drawRoadCrossings(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  state: ReturnType<SimulationEngine["getRenderState"]>,
  zoom: number,
) {
  const roadHalfLength = ROAD_CROSSING_LENGTH_PX / 2 / zoom;
  const roadWidth = 22 / zoom;
  const stopLineOffset = ROAD_CROSSING_LENGTH_PX * 0.11 / zoom;
  const controllerIds = new Set(
    state.roadVehicles.map((vehicle) => vehicle.controllerId),
  );
  for (const controllerId of controllerIds) {
    const crossing = roadCrossingGeometry(scenario, state, controllerId);
    if (!crossing) continue;
    const { point, ux, uy, nx, ny } = crossing;
    const controllerPhase = state.signals.find(
      (item) =>
        (item.definition.controllerId ?? item.definition.id) === controllerId,
    )?.phase ?? "road-green";
      context.save();
      context.lineCap = "butt";
      context.strokeStyle = "rgba(43, 61, 72, 0.92)";
      context.lineWidth = roadWidth;
      context.beginPath();
      context.moveTo(
      point.x - ux * roadHalfLength,
      point.y - uy * roadHalfLength,
      );
      context.lineTo(
      point.x + ux * roadHalfLength,
      point.y + uy * roadHalfLength,
      );
      context.stroke();
      context.strokeStyle = "rgba(137, 158, 169, 0.58)";
      context.lineWidth = 1 / zoom;
      context.setLineDash([7 / zoom, 7 / zoom]);
      context.beginPath();
      context.moveTo(
      point.x - ux * roadHalfLength,
      point.y - uy * roadHalfLength,
      );
      context.lineTo(
      point.x + ux * roadHalfLength,
      point.y + uy * roadHalfLength,
      );
      context.stroke();
      context.setLineDash([]);

      context.strokeStyle = "rgba(226, 237, 242, 0.88)";
      context.lineWidth = 2 / zoom;
      for (const side of [-1, 1]) {
      const cx = point.x + ux * stopLineOffset * side;
      const cy = point.y + uy * stopLineOffset * side;
        context.beginPath();
        context.moveTo(cx - nx * roadWidth * 0.42, cy - ny * roadWidth * 0.42);
        context.lineTo(cx + nx * roadWidth * 0.42, cy + ny * roadWidth * 0.42);
        context.stroke();

        // Dedicated road signal. Tram heads are drawn separately beside the
        // rails, so the driver-facing red/amber/green state must be explicit.
        const signalX = cx + nx * roadWidth * 0.68 * side;
        const signalY = cy + ny * roadWidth * 0.68 * side;
        context.save();
        context.translate(signalX, signalY);
        context.rotate(Math.atan2(uy, ux));
        roundedRect(context, -4.5 / zoom, -10 / zoom, 9 / zoom, 20 / zoom, 2 / zoom);
        context.fillStyle = "#071018";
        context.strokeStyle = "#82939d";
        context.lineWidth = 1 / zoom;
        context.fill();
        context.stroke();
        const roadLamp =
          controllerPhase === "road-green"
            ? 2
            : controllerPhase === "tram-green"
              ? 0
              : 1;
        ["#ff5c66", "#f4a62a", "#42d392"].forEach((color, index) => {
          context.beginPath();
          context.arc(0, (-5.5 + index * 5.5) / zoom, 1.8 / zoom, 0, Math.PI * 2);
          context.fillStyle = index === roadLamp ? color : "#26323a";
          context.shadowColor = color;
          context.shadowBlur = index === roadLamp ? 5 / zoom : 0;
          context.fill();
        });
        context.restore();
      }
      context.restore();
  }
}

function drawRoadVehicles(
  context: CanvasRenderingContext2D,
  scenario: ScenarioDefinition,
  state: ReturnType<SimulationEngine["getRenderState"]>,
  zoom: number,
) {
  for (const vehicle of state.roadVehicles) {
    const crossing = roadCrossingGeometry(
      scenario,
      state,
      vehicle.controllerId,
    );
    if (!crossing) continue;
    const { point: crossingPoint, roadAngle, ux, uy, nx, ny } = crossing;
    const along =
      ((vehicle.progress - 0.5) * ROAD_CROSSING_LENGTH_PX) / zoom;
    // Road paint and vehicles stay the same apparent size while zooming, so
    // the lane offset also has to be converted from screen to world space.
    const lane = (vehicle.direction * 5) / zoom;
    const point = {
      x: crossingPoint.x + ux * along + nx * lane,
      y: crossingPoint.y + uy * along + ny * lane,
    };
    withScreenSpace(context, point, zoom, () => {
      context.rotate(roadAngle + (vehicle.direction < 0 ? Math.PI : 0));
      roundedRect(context, -6, -3.2, 12, 6.4, 2.2);
      context.fillStyle = vehicle.color;
      context.strokeStyle = vehicle.stopped ? "#f4a62a" : "#172630";
      context.lineWidth = 1;
      context.fill();
      context.stroke();
      context.fillStyle = "#203440";
      context.fillRect(-2, -2.4, 4.5, 4.8);
      context.fillStyle = "#f8e6a4";
      context.fillRect(4.7, -2.3, 1, 1.3);
      context.fillRect(4.7, 1, 1, 1.3);
    });
  }
}

function drawLegend(context: CanvasRenderingContext2D) {
  const x = 790;
  const y = 500;
  context.save();
  roundedRect(context, x, y, 190, 98, 8);
  context.fillStyle = "rgba(7, 17, 24, 0.9)";
  context.strokeStyle = "#334b5c";
  context.lineWidth = 1;
  context.fill();
  context.stroke();
  const entries = [
    ["#25d4e8", "Colour-coded route"],
    ["#6f7c86", "Rail network"],
    ["#f4a62a", "Named stop"],
    ["#42d392", "Cleared signal"],
  ];
  context.font = "500 10px Inter, system-ui, sans-serif";
  entries.forEach(([color, label], index) => {
    const rowY = y + 21 + index * 20;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + 14, rowY);
    context.lineTo(x + 37, rowY);
    context.stroke();
    context.fillStyle = "#b9cad5";
    context.fillText(label, x + 47, rowY + 3);
  });
  context.restore();
}

function drawScene(
  canvas: HTMLCanvasElement,
  state: SimulationRenderState,
  zoom: number,
  pan: Point,
) {
  const rectangle = canvas.getBoundingClientRect();
  if (rectangle.width < 10 || rectangle.height < 10) return;
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(rectangle.width * pixelRatio);
  const targetHeight = Math.round(rectangle.height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  const scaleX = (rectangle.width / WORLD_WIDTH) * pixelRatio;
  const scaleY = (rectangle.height / WORLD_HEIGHT) * pixelRatio;
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.fillStyle = "#07131c";
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.save();
  context.translate(
    WORLD_WIDTH / 2 + pan.x,
    WORLD_HEIGHT / 2 + pan.y,
  );
  context.scale(zoom, zoom);
  context.translate(-WORLD_WIDTH / 2, -WORLD_HEIGHT / 2);

  if (state.scenario.mapContext) drawMapContext(context, state.scenario, zoom);
  else drawGrid(context);
  drawDepots(context, state.depots, zoom);
  // Asphalt is below the rails; it may cross them, but can no longer cover or
  // visually cut the track continuation.
  drawRoadCrossings(context, state.scenario, state, zoom);
  const activeSegments = new Set<string>();
  state.trams.forEach((tram) => activeSegments.add(tram.segmentId));
  state.switches.forEach((item) =>
    activeSegments.add(
      item.runtime.state === "main"
        ? item.definition.mainSegmentId
        : item.definition.branchSegmentId,
    ),
  );
  drawTrack(context, state.scenario, activeSegments, zoom);
  drawRoutes(context, state.scenario, activeSegments, zoom);
  drawTractionSubstations(context, state.scenario, zoom);
  drawStationPlatforms(context, state.scenario, zoom);
  drawRoadVehicles(context, state.scenario, state, zoom);
  const pulse = (Math.sin(performance.now() / 260) + 1) / 2;
  const renderedStations = new Set<string>();
  state.scenario.readers.forEach((reader) => {
    const stationKey = reader.kind === "station" ? reader.stationId ?? reader.id : null;
    if (stationKey && renderedStations.has(stationKey)) return;
    if (stationKey) renderedStations.add(stationKey);
    drawReader(context, state.scenario, reader, pulse, state.selectedStopId, zoom);
  });
  state.signals.forEach((signal) =>
    drawSignal(
      context,
      state.scenario,
      signal.definition,
      signal.phase,
      signal.activeSignalId,
      zoom,
    ),
  );
  state.switches.forEach((item) => drawSwitch(context, state.scenario, item, zoom));
  state.obstacles.forEach((obstacle) =>
    drawObstacle(context, state.scenario, obstacle, zoom),
  );
  state.trams.forEach((tram) =>
    drawTram(
      context,
      tram,
      tram.id === state.selectedTramId,
      state.sensorRangeMeters,
      state.metersPerReferenceUnit,
      Boolean(state.scenario.mapContext),
      zoom,
    ),
  );
  if (zoom <= 1.05 && !state.scenario.mapContext) drawLegend(context);
  context.restore();
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${checked ? "toggle-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function StatusLed({
  tone = "ok",
  children,
}: {
  tone?: "ok" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <span className="status-label">
      <span className={`status-dot status-${tone}`} />
      {children}
    </span>
  );
}

function SpeedGauge({
  label,
  speed,
  limit,
  color,
}: {
  label: string;
  speed: number;
  limit: number;
  color: string;
}) {
  const percentage = Math.min(100, (speed / Math.max(1, limit)) * 100);
  return (
    <article className="metric-card speed-card">
      <span className="metric-label">{label} speed</span>
      <div
        className="speed-gauge"
        style={
          {
            "--gauge-value": `${percentage * 2.7}deg`,
            "--gauge-color": color,
          } as CSSProperties
        }
      >
        <div className="gauge-center">
          <strong>{speed.toFixed(1)}</strong>
          <span>km/h</span>
        </div>
      </div>
      <span className="metric-caption">Limit {limit} km/h</span>
    </article>
  );
}

function formatStopEta(seconds: number | null) {
  if (seconds === null) return "HOLD";
  if (seconds < 25) return "DUE";
  if (seconds < 60) return "<1 min";
  return `${Math.ceil(seconds / 60)} min`;
}

function formatHeadway(minutes: number | null) {
  if (minutes === null) return "—";
  return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} min`;
}

function formatWaitShort(seconds: number) {
  if (seconds < 1) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function formatDistanceLabel(meters: number) {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

function formatEnergy(kWh: number) {
  return kWh < 0.1 ? `${(kWh * 1000).toFixed(0)} Wh` : `${kWh.toFixed(2)} kWh`;
}

function formatPower(kW: number) {
  return kW >= 1_000 ? `${(kW / 1_000).toFixed(2)} MW` : `${kW.toFixed(0)} kW`;
}

function EnergyStatisticsWindow({
  snapshot,
  onClose,
}: {
  snapshot: SimulationSnapshot;
  onClose: () => void;
}) {
  const statistics = snapshot.energyStatistics;
  const [comparison, setComparison] = useState<EnergyComparisonReport | null>(null);
  const [comparisonRunning, setComparisonRunning] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const runComparison = () => {
    setComparisonRunning(true);
    setComparisonError("");
    const [hours, minutes] = snapshot.clock.split(":").map(Number);
    const worker = new Worker(new URL("./energy-comparison-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; report?: EnergyComparisonReport; message?: string }>) => {
      if (event.data.ok && event.data.report) setComparison(event.data.report);
      else setComparisonError(event.data.message ?? "Comparison failed");
      setComparisonRunning(false);
      worker.terminate();
    };
    worker.onerror = () => {
      setComparisonError("Comparison worker failed to start");
      setComparisonRunning(false);
      worker.terminate();
    };
    worker.postMessage({
      scenarioId: snapshot.scenarioId,
      tramCount: Math.min(6, snapshot.trams.length),
      durationSeconds: 600,
      startServiceMinute: hours * 60 + minutes,
    });
  };
  return (
    <div className="energy-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="energy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="energy-statistics-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="energy-modal-header">
          <div>
            <span>ENERGY MODEL · LIVE TOTALS</span>
            <h2 id="energy-statistics-title">Traction & regeneration</h2>
            <p>{statistics.modelLabel}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close energy statistics">×</button>
        </header>

        <div className="energy-summary-grid">
          <article>
            <span>Vehicle electrical demand</span>
            <strong>{formatEnergy(statistics.total.gridDrawKWh)}</strong>
            <small>traction + 4.5 kW auxiliaries before reuse</small>
          </article>
          <article className="energy-positive">
            <span>Accepted regeneration</span>
            <strong>{formatEnergy(statistics.total.acceptedRegeneratedKWh)}</strong>
            <small>{statistics.total.recoveryPercent.toFixed(0)}% of wheel braking energy</small>
          </article>
          <article>
            <span>Substation grid supply</span>
            <strong>{formatEnergy(statistics.powerSystem.enabled ? statistics.powerSystem.gridSupplyKWh : statistics.total.netGridKWh)}</strong>
            <small>after direct reuse and flywheel discharge</small>
          </article>
          <article>
            <span>Downhill potential</span>
            <strong>{formatEnergy(statistics.total.downhillPotentialKWh)}</strong>
            <small>gravity observed during this run</small>
          </article>
        </div>

        <section className="energy-comparison" aria-labelledby="energy-comparison-title">
          <header>
            <div>
              <span>CONTROLLED A/B/C EXPERIMENT</span>
              <strong id="energy-comparison-title">Same six-tram reference fleet · same clock · 10 simulated minutes</strong>
            </div>
            <button type="button" onClick={runComparison} disabled={comparisonRunning}>
              {comparisonRunning ? "Running three cases…" : comparison ? "Run again" : "Run comparison"}
            </button>
          </header>
          {comparison ? (
            <div className="energy-comparison-table" role="table" aria-label="Energy strategy comparison">
              <div className="energy-comparison-row energy-comparison-head" role="row">
                <span>Strategy</span><span>Grid</span><span>Peak</span><span>Rejected</span><span>Energy/km saved</span><span>Peak cut</span>
              </div>
              {comparison.rows.map((row) => (
                <div className={`energy-comparison-row ${row.energySavingPercent === Math.max(...comparison.rows.map((item) => item.energySavingPercent)) ? "is-best" : ""}`} role="row" key={row.strategy}>
                  <strong>
                    {row.label}
                    <small>
                      {row.distanceKm.toFixed(1)} km · {row.averageSpeedKmh.toFixed(1)} km/h · {row.departureAdherencePercent === null
                        ? "timed departures pending"
                        : `${row.departureAdherencePercent.toFixed(0)}% timed departures · ${row.scheduledDepartures} recorded · ${row.meanDepartureDeviationSeconds?.toFixed(0) ?? "—"}s mean deviation`}
                    </small>
                  </strong>
                  <span>{formatEnergy(row.gridSupplyKWh)}</span>
                  <span>{formatPower(row.peakGridPowerKw)}</span>
                  <span>{formatEnergy(row.rejectedRegenerationKWh)}</span>
                  <b>{row.strategy === "no-storage" ? "reference" : `${row.energySavingPercent >= 0 ? "+" : ""}${row.energySavingPercent.toFixed(1)}%`}</b>
                  <b>{row.strategy === "no-storage" ? "reference" : `${row.peakReductionPercent >= 0 ? "+" : ""}${row.peakReductionPercent.toFixed(1)}%`}</b>
                </div>
              ))}
            </div>
          ) : (
            <p>Runs identical starting conditions without storage, with reactive flywheels, and with forecast SOC plus section peak dispatch. Speed-target eco-coasting is withheld after service-quality validation; energy remains normalized per vehicle-kilometre.</p>
          )}
          {comparisonError && <p className="energy-comparison-error">{comparisonError}</p>}
          <small>Results are simulation estimates, not measurements from the real İzmir or Nizhny Novgorod traction network.</small>
        </section>

        <div className="energy-route-list">
          {statistics.routes.map((route) => {
            const scale = Math.max(route.gridDrawKWh, 0.001);
            return (
              <article className="energy-route-card" key={route.routeId}>
                <header>
                  <div>
                    <span>ROUTE {route.routeId}</span>
                    <strong>{route.label}</strong>
                  </div>
                  <small>{route.tramCount} trams · {route.distanceKm.toFixed(1)} km simulated</small>
                </header>
                <div className="energy-flow-bars" aria-label={`Energy balance for route ${route.routeId}`}>
                  <div><span>Vehicle demand</span><i style={{ width: `${Math.min(100, (route.gridDrawKWh / scale) * 100)}%` }} /><b>{formatEnergy(route.gridDrawKWh)}</b></div>
                  <div className="regen-bar"><span>Accepted</span><i style={{ width: `${Math.min(100, (route.acceptedRegeneratedKWh / scale) * 100)}%` }} /><b>{formatEnergy(route.acceptedRegeneratedKWh)}</b></div>
                </div>
                <dl className="energy-breakdown">
                  <div><dt>Traction</dt><dd>{formatEnergy(route.tractionKWh)}</dd></div>
                  <div><dt>Auxiliaries</dt><dd>{formatEnergy(route.auxiliaryKWh)}</dd></div>
                  <div><dt>Wheel braking</dt><dd>{formatEnergy(route.mechanicalBrakeKWh)}</dd></div>
                  <div><dt>Generator output</dt><dd>{formatEnergy(route.grossRegeneratedKWh)}</dd></div>
                  <div><dt>Rejected + losses</dt><dd>{formatEnergy(route.rejectedKWh)}</dd></div>
                  <div><dt>Climb potential</dt><dd>{formatEnergy(route.climbPotentialKWh)}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>

        {statistics.powerSystem.enabled && (
          <section className="power-system-panel" aria-labelledby="power-system-title">
            <header>
              <div>
                <span>TRACTION NETWORK · {statistics.powerSystem.nominalVoltageV} V DC</span>
                <strong id="power-system-title">Electrical sections & substations</strong>
              </div>
              <small>
                {statistics.powerSystem.strategy === "network-optimal"
                  ? `${statistics.powerSystem.interventions} energy-dispatch interventions`
                  : "Baseline dispatch"}
              </small>
            </header>
            <div className="power-network-summary">
              <div><span>Local reuse</span><b>{formatEnergy(statistics.powerSystem.localReuseKWh)}</b></div>
              <div><span>Grid supply</span><b>{formatEnergy(statistics.powerSystem.gridSupplyKWh)}</b></div>
              <div><span>Rejected generator output</span><b>{formatEnergy(statistics.powerSystem.rejectedGeneratorKWh)}</b></div>
              <div><span>Network peak</span><b>{formatPower(statistics.powerSystem.peakGridPowerKw)}</b></div>
              {statistics.powerSystem.flywheelCapacityKWh > 0 && <>
                <div><span>Flywheel charge</span><b>{formatEnergy(statistics.powerSystem.flywheelStoredKWh)} / {formatEnergy(statistics.powerSystem.flywheelCapacityKWh)}</b></div>
                <div><span>Captured by storage</span><b>{formatEnergy(statistics.powerSystem.flywheelChargedKWh)}</b></div>
                <div><span>Returned from storage</span><b>{formatEnergy(statistics.powerSystem.flywheelDischargedKWh)}</b></div>
                <div><span>Converter losses</span><b>{formatEnergy(statistics.powerSystem.flywheelLossesKWh)}</b></div>
              </>}
            </div>
            <div className="power-section-list">
              {statistics.powerSystem.sections.map((section) => (
                <article key={section.id} style={{ "--section-color": section.color } as CSSProperties}>
                  <header>
                    <div><i /><strong>{section.label}</strong></div>
                    <small>{section.tramCount} trams · {section.confidence === "verified-address" ? "verified substation" : "estimated position"}</small>
                  </header>
                  <dl>
                    <div><dt>Grid now</dt><dd>{formatPower(section.gridPowerKw)}</dd></div>
                    <div><dt>Regen now</dt><dd>{formatPower(section.regenerationPowerKw)}</dd></div>
                    <div><dt>Reused now</dt><dd>{formatPower(section.locallyReusedPowerKw)}</dd></div>
                    <div><dt>Peak</dt><dd>{formatPower(section.peakGridPowerKw)}</dd></div>
                    {section.flywheelModules > 0 && <>
                      <div><dt>Flywheel SOC</dt><dd>{section.flywheelSocPercent.toFixed(0)}%</dd></div>
                      <div><dt>SOC controller</dt><dd>{section.flywheelMode}</dd></div>
                      <div><dt>Rotor speed</dt><dd>{section.flywheelRpm.toFixed(0)} rpm</dd></div>
                      <div><dt>Storage flow</dt><dd>{section.flywheelChargePowerKw > 0 ? `+${formatPower(section.flywheelChargePowerKw)}` : section.flywheelDischargePowerKw > 0 ? `−${formatPower(section.flywheelDischargePowerKw)}` : "idle"}</dd></div>
                      <div><dt>Grid target</dt><dd>{formatPower(section.flywheelTargetGridKw)}</dd></div>
                      <div><dt>Forecast</dt><dd>↑{formatPower(section.forecastTractionKw)} · ↓{formatPower(section.forecastRegenerationKw)}</dd></div>
                      <div><dt>Bank</dt><dd>{section.flywheelModules} × 125 kW</dd></div>
                    </>}
                  </dl>
                  <small>{section.substationLabel}{section.flywheelModel ? ` · ${section.flywheelModel} · ${section.flywheelEnergyKWh.toFixed(2)}/${section.flywheelCapacityKWh.toFixed(2)} kWh` : ""}</small>
                </article>
              ))}
            </div>
            <p>{statistics.powerSystem.modelNote}</p>
            <small>Source: {statistics.powerSystem.sourceLabel}</small>
          </section>
        )}

        <section className="elevation-profile-table" aria-labelledby="elevation-profile-title">
          <header>
            <div>
              <span>MEASURED INPUT DATA</span>
              <strong id="elevation-profile-title">Route 2 elevation sections</strong>
            </div>
            <small>Values reproduced from the supplied 2021 presentation</small>
          </header>
          <div className="elevation-profile-grid">
            {statistics.elevationSections.map((section) => (
              <div key={section.label}>
                <span>{section.label}</span>
                <b>{section.fromMeters} → {section.toMeters} m</b>
                <i>−{section.fromMeters - section.toMeters} m</i>
                <strong>{section.potentialKWh.toFixed(2)} kWh mgh</strong>
              </div>
            ))}
          </div>
        </section>

        <aside className="energy-study-note">
          <strong>2021 Route 2 reference</strong>
          <span>{statistics.studyMassTonnes.toFixed(1)} t · {statistics.measuredDescentMeters} m measured descent · {statistics.studyPotentialKWhPerRun.toFixed(2)} kWh theoretical mgh</span>
          <p>
            The original 7.84 kWh is gravitational potential, not guaranteed electrical return.
            This twin applies 86% motor/inverter conversion. In mapped networks, electrical output is
            first transferred to another tram in the same section, then stored in the section&apos;s VYCON flywheel bank;
            only the remaining surplus is rejected. The Nizhny model includes 38 modules (4.75 MW / 19.79 kWh)
            behind bidirectional 600↔750 V converters. Route 21 uses the measured
            profile only while sharing Route 2 rails; its private section is level until surveyed.
          </p>
          <small>Source: {statistics.sourceLabel}</small>
        </aside>
      </section>
    </div>
  );
}

function storedExperiments(): ExperimentDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(localStorage.getItem("tram-twin-experiments-v1") ?? "[]");
    return Array.isArray(stored)
      ? stored.filter(
          (item): item is ExperimentDefinition =>
            item?.format === "autonomous-tram-experiment" && item?.version === 1,
        )
      : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [engine] = useState(() => new SimulationEngine());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const experimentFileRef = useRef<HTMLInputElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPan: Point;
    moved: boolean;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() =>
    engine.getSnapshot(),
  );
  const [zoom, setZoom] = useState(1);
  const [activeMapFocus, setActiveMapFocus] = useState("network");
  const [isDragging, setIsDragging] = useState(false);
  const [obstacleMode, setObstacleMode] = useState(false);
  const [energyWindowOpen, setEnergyWindowOpen] = useState(false);
  const [experimentName, setExperimentName] = useState("Morning peak 2 + 21");
  const [savedExperiments, setSavedExperiments] = useState<ExperimentDefinition[]>(storedExperiments);
  const [selectedExperimentSavedAt, setSelectedExperimentSavedAt] = useState(
    () => savedExperiments[0]?.savedAt ?? "",
  );
  const [experimentMessage, setExperimentMessage] = useState("");
  const [cppRuntimeReady, setCppRuntimeReady] = useState(() =>
    isCppRuntimeReady(),
  );

  const refresh = useCallback(() => {
    setSnapshot(engine.getSnapshot());
  }, [engine]);

  const mutate = useCallback(
    (operation: (engine: SimulationEngine) => void) => {
      operation(engine);
      refresh();
    },
    [engine, refresh],
  );

  const persistExperiments = useCallback((experiments: ExperimentDefinition[]) => {
    setSavedExperiments(experiments);
    localStorage.setItem("tram-twin-experiments-v1", JSON.stringify(experiments));
  }, []);

  const resetExperimentViewport = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setActiveMapFocus("network");
  }, []);

  const saveExperimentInBrowser = useCallback(() => {
    const experiment = engine.exportExperimentConfig(experimentName);
    const next = [experiment, ...savedExperiments].slice(0, 20);
    persistExperiments(next);
    setSelectedExperimentSavedAt(experiment.savedAt);
    setExperimentMessage(`Saved: ${experiment.name}`);
  }, [engine, experimentName, persistExperiments, savedExperiments]);

  const loadExperiment = useCallback(
    (experiment: ExperimentDefinition) => {
      try {
        const loaded = engine.loadExperimentConfig(experiment);
        resetExperimentViewport();
        refresh();
        setExperimentName(loaded.name);
        setExperimentMessage(`Loaded: ${loaded.name}`);
      } catch (error) {
        setExperimentMessage(error instanceof Error ? error.message : "Experiment could not be loaded");
      }
    },
    [engine, refresh, resetExperimentViewport],
  );

  const exportExperimentJson = useCallback(() => {
    const experiment = engine.exportExperimentConfig(experimentName);
    const blob = new Blob([`${JSON.stringify(experiment, null, 2)}\n`], {
      type: "application/json",
    });
    const link = document.createElement("a");
    const safeName = experiment.name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName || "tram-experiment"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setExperimentMessage("Experiment JSON exported");
  }, [engine, experimentName]);

  const importExperimentJson = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const value = JSON.parse(await file.text());
        const loaded = engine.loadExperimentConfig(value);
        resetExperimentViewport();
        refresh();
        setExperimentName(loaded.name);
        setExperimentMessage(`Imported: ${loaded.name}`);
      } catch (error) {
        setExperimentMessage(error instanceof Error ? error.message : "Invalid experiment JSON");
      } finally {
        if (experimentFileRef.current) experimentFileRef.current.value = "";
      }
    },
    [engine, refresh, resetExperimentViewport],
  );

  useEffect(() => {
    let active = true;
    void initializeCppRuntime().then((ready) => {
      if (!active) return;
      setCppRuntimeReady(ready);
      refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    let frameId = 0;
    let previous = performance.now();
    let lastRefresh = previous;
    const frame = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      engine.step(delta);
      if (canvasRef.current) {
        drawScene(
          canvasRef.current,
          engine.getRenderState(),
          zoomRef.current,
          panRef.current,
        );
      }
      if (now - lastRefresh > 100) {
        setSnapshot(engine.getSnapshot());
        lastRefresh = now;
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [engine]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setObstacleMode(false);
        setEnergyWindowOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const clampPan = useCallback(
    (next: Point, zoomLevel = zoomRef.current): Point =>
      clampMapPan(next, zoomLevel, WORLD_WIDTH, WORLD_HEIGHT),
    [],
  );

  const toCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current!;
    const rectangle = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rectangle.left) / rectangle.width) * WORLD_WIDTH,
      y: ((clientY - rectangle.top) / rectangle.height) * WORLD_HEIGHT,
    };
  }, []);

  const changeZoom = useCallback(
    (next: number, anchor?: Point) => {
      const previousZoom = zoomRef.current;
      const normalized = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, next));
      if (anchor && normalized !== previousZoom) {
        const currentPan = panRef.current;
        const worldAtAnchor = {
          x:
            (anchor.x - WORLD_WIDTH / 2 - currentPan.x) / previousZoom +
            WORLD_WIDTH / 2,
          y:
            (anchor.y - WORLD_HEIGHT / 2 - currentPan.y) / previousZoom +
            WORLD_HEIGHT / 2,
        };
        const nextPan = clampPan(
          {
            x:
              anchor.x -
              WORLD_WIDTH / 2 -
              normalized * (worldAtAnchor.x - WORLD_WIDTH / 2),
            y:
              anchor.y -
              WORLD_HEIGHT / 2 -
              normalized * (worldAtAnchor.y - WORLD_HEIGHT / 2),
          },
          normalized,
        );
        panRef.current = nextPan;
      }
      zoomRef.current = normalized;
      setZoom(normalized);
    },
    [clampPan],
  );

  const resetViewport = useCallback(() => {
    const origin = { x: 0, y: 0 };
    zoomRef.current = 1;
    panRef.current = origin;
    setZoom(1);
    setActiveMapFocus("network");
  }, []);

  const toWorldPoint = useCallback((clientX: number, clientY: number): Point => {
    const normalized = toCanvasPoint(clientX, clientY);
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    return {
      x:
        (normalized.x - WORLD_WIDTH / 2 - currentPan.x) / currentZoom +
        WORLD_WIDTH / 2,
      y:
        (normalized.y - WORLD_HEIGHT / 2 - currentPan.y) / currentZoom +
        WORLD_HEIGHT / 2,
    };
  }, [toCanvasPoint]);

  const handleCanvasAction = useCallback(
    (clientX: number, clientY: number) => {
      const point = toWorldPoint(clientX, clientY);
      const hit = engine.hitTest(point);
      if (obstacleMode) {
        if (hit?.type === "obstacle") engine.removeObstacleNear(point);
        else engine.addObstacleAt(point);
      } else if (hit?.type === "tram") {
        engine.selectTram(hit.id);
      } else if (hit?.type === "switch") {
        engine.toggleSwitch(hit.id);
      } else if (hit?.type === "station") {
        engine.selectStop(hit.id);
      } else if (hit?.type === "obstacle") {
        engine.removeObstacleNear(point);
      }
      refresh();
    },
    [engine, obstacleMode, refresh, toWorldPoint],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPan: panRef.current,
        moved: false,
      };
      setIsDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rectangle = canvas.getBoundingClientRect();
      const clientDeltaX = event.clientX - drag.startClientX;
      const clientDeltaY = event.clientY - drag.startClientY;
      if (Math.hypot(clientDeltaX, clientDeltaY) > 4) drag.moved = true;
      const nextPan = clampPan({
        x:
          drag.startPan.x +
          (clientDeltaX / Math.max(1, rectangle.width)) * WORLD_WIDTH,
        y:
          drag.startPan.y +
          (clientDeltaY / Math.max(1, rectangle.height)) * WORLD_HEIGHT,
      });
      panRef.current = nextPan;
      if (drag.moved) setActiveMapFocus("custom");
    },
    [clampPan],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, runAction: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      setIsDragging(false);
      if (runAction && !drag.moved) {
        handleCanvasAction(event.clientX, event.clientY);
      }
    },
    [handleCanvasAction],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      changeZoom(
        zoomRef.current + (event.deltaY < 0 ? 0.2 : -0.2),
        toCanvasPoint(event.clientX, event.clientY),
      );
      setActiveMapFocus("custom");
    },
    [changeZoom, toCanvasPoint],
  );

  const selectedTram =
    snapshot.trams.find((tram) => tram.id === engine.selectedTram) ??
    snapshot.trams[0];
  const secondTram =
    snapshot.trams.find((tram) => tram.id !== selectedTram?.id) ?? selectedTram;
  const activeScenario = useMemo(
    () => SCENARIOS.find((item) => item.id === snapshot.scenarioId) ?? SCENARIOS[0],
    [snapshot.scenarioId],
  );
  const mapFocusPresets = useMemo(
    () => MAP_FOCUS_PRESETS[activeScenario.id] ?? [],
    [activeScenario.id],
  );
  const focusMap = useCallback(
    (focusId: string) => {
      if (focusId === "network") {
        resetViewport();
        return;
      }
      const preset = mapFocusPresets.find((item) => item.id === focusId);
      if (!preset) return;
      const segment = activeScenario.segments.find(
        (item) => item.id === preset.segmentId,
      );
      if (!segment) return;
      const point = sampleTrackSegment(segment, preset.at).point;
      const nextZoom = preset.zoom;
      const nextPan = clampPan(
        {
          x: -nextZoom * (point.x - WORLD_WIDTH / 2),
          y: -nextZoom * (point.y - WORLD_HEIGHT / 2),
        },
        nextZoom,
      );
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setActiveMapFocus(focusId);
    },
    [activeScenario, clampPan, mapFocusPresets, resetViewport],
  );
  const fleetOptions = activeScenario.fleetOptions ?? [1, 2, 3, 4];
  const supportsFirmwareComparison =
    activeScenario.switches.length === 1 &&
    activeScenario.readers.some((reader) => reader.kind === "switch");
  const selectedStopBoard =
    snapshot.stopBoards.find((board) => board.id === snapshot.selectedStopId) ??
    snapshot.stopBoards[0];
  const routeForIntent = useCallback(
    (intent: "main" | "branch") =>
      activeScenario.routes[intent === "branch" ? 1 : 0] ??
      activeScenario.routes[0],
    [activeScenario],
  );
  const selectedRoute = selectedTram
    ? routeForIntent(selectedTram.routeIntent)
    : activeScenario.routes[0];
  const tramGreenJunctions = snapshot.trafficControllers.filter(
    (controller) => controller.phase === "tram-green",
  ).length;
  const clearingJunctions = snapshot.trafficControllers.filter(
    (controller) =>
      controller.phase === "amber-to-tram" ||
      controller.phase === "amber-to-road",
  ).length;
  const signalTone =
    tramGreenJunctions > 0
      ? "ok"
      : clearingJunctions > 0
        ? "warning"
        : "danger";
  const signalLabel =
    activeScenario.mapContext
      ? tramGreenJunctions > 0
        ? `${tramGreenJunctions}/${snapshot.trafficControllers.length} tram priority`
        : clearingJunctions > 0
          ? `${clearingJunctions} junction clearing`
          : `${snapshot.trafficControllers.length} independent junctions`
      : snapshot.trafficPhase === "tram-green"
        ? `${snapshot.activeTrafficSignal ?? "Tram"} green`
        : snapshot.trafficPhase === "road-green"
          ? "All tram signals red"
          : `${snapshot.activeTrafficSignal ?? "Signal"} amber`;
  const showNizhnyInfrastructure = snapshot.scenarioId !== "prototype-loop";
  const tramsOnRoute = snapshot.routeOperations.reduce(
    (sum, route) => sum + route.onRoute,
    0,
  );
  const tramsInDepot = snapshot.routeOperations.reduce(
    (sum, route) => sum + route.inDepot,
    0,
  );
  const flywheelModules = snapshot.energyStatistics.powerSystem.sections.reduce(
    (sum, section) => sum + section.flywheelModules,
    0,
  );
  const flywheelSoc = snapshot.energyStatistics.powerSystem.flywheelCapacityKWh > 0
    ? (snapshot.energyStatistics.powerSystem.flywheelStoredKWh /
      snapshot.energyStatistics.powerSystem.flywheelCapacityKWh) * 100
    : 0;

  return (
    <main className="sim-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <h1>Autonomous Tram Digital Twin</h1>
            <p>Arduino control logic · browser simulation</p>
          </div>
        </div>
        <div className="health-strip" aria-label="System status">
          <StatusLed>System OK</StatusLed>
          <StatusLed>Control loop 20 Hz</StatusLed>
          <StatusLed tone={snapshot.warningCount > 0 ? "warning" : "ok"}>
            {snapshot.warningCount} warning{snapshot.warningCount === 1 ? "" : "s"}
          </StatusLed>
          <span className="system-clock">◷ {snapshot.clock}</span>
        </div>
        <div className="transport-controls">
          <button
            className={`control-button run-button ${snapshot.running ? "active" : ""}`}
            type="button"
            onClick={() => mutate((engine) => engine.setRunning(true))}
            aria-label="Run simulation"
          >
            <span aria-hidden="true">▶</span> Run
          </button>
          <button
            className={!snapshot.running ? "control-button active" : "control-button"}
            type="button"
            onClick={() => mutate((engine) => engine.setRunning(false))}
            aria-label="Pause simulation"
          >
            <span aria-hidden="true">Ⅱ</span> Pause
          </button>
          <button
            className="control-button"
            type="button"
            onClick={() => mutate((engine) => engine.reset())}
            aria-label="Reset simulation"
          >
            <span aria-hidden="true">↻</span> Reset
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="network-panel">
          <div className="network-heading">
            <div>
              <span className="eyebrow">Live network</span>
              <strong>{snapshot.scenarioName}</strong>
            </div>
            <div className="network-tags">
              <span>
                {cppRuntimeReady
                  ? "C++ WASM motion + signals · TS map/UI"
                  : "TS fallback · C++ core loading"}
              </span>
              <span>
                {snapshot.depots.length > 0 ? tramsOnRoute : snapshot.trams.length} on route
              </span>
              {snapshot.depots.length > 0 && <span>{tramsInDepot} in depot</span>}
              <span>{snapshot.obstacles.length} obstacles</span>
              {activeScenario.studyBaseline && (
                <span>{activeScenario.studyBaseline.lengthKm} km real route</span>
              )}
              {supportsFirmwareComparison && (
                <span>{snapshot.options.controlMode}</span>
              )}
            </div>
          </div>
          <div
            className={`canvas-wrap ${obstacleMode ? "placing-obstacle" : ""} ${
              isDragging ? "dragging-map" : ""
            }`}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishPointer(event, true)}
              onPointerCancel={(event) => finishPointer(event, false)}
              onWheel={handleWheel}
              aria-label="Interactive two-dimensional tram network. Drag to move the map, use the wheel to zoom, or click a tram, stop, or turnout."
              tabIndex={0}
            />
            <div className="map-route-key" aria-label="Route line legend">
              {activeScenario.routes.map((route) => (
                <span
                  className="map-route-chip"
                  style={{ "--route-color": route.color } as CSSProperties}
                  key={route.id}
                >
                  <b>{route.shortName}</b>
                  {route.name}
                </span>
              ))}
              <span className="map-station-key">
                <i aria-hidden="true" />
                {activeScenario.studyBaseline
                  ? `${activeScenario.studyBaseline.mappedStopLocations} mapped stops`
                  : "Named stops"}
              </span>
            </div>
            {mapFocusPresets.length > 0 && (
              <label className="map-focus-control">
                <span>Узел карты</span>
                <select
                  value={activeMapFocus}
                  aria-label="Быстрый переход к перекрёстку или конечной"
                  onChange={(event) => focusMap(event.target.value)}
                >
                  <option value="network">Вся сеть</option>
                  {activeMapFocus === "custom" && (
                    <option value="custom">Свободный обзор</option>
                  )}
                  {mapFocusPresets.map((preset) => (
                    <option value={preset.id} key={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="canvas-toolbar" aria-label="Map controls">
              <button
                type="button"
                onClick={resetViewport}
                aria-label="Fit network to view"
              >
                ◎
              </button>
              <button
                type="button"
                onClick={() => {
                  changeZoom(zoom - 0.25);
                  setActiveMapFocus("custom");
                }}
                aria-label="Zoom out"
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => {
                  changeZoom(zoom + 0.25);
                  setActiveMapFocus("custom");
                }}
                aria-label="Zoom in"
              >
                +
              </button>
            </div>
            <div className="canvas-context">
              <span className={`mode-indicator ${obstacleMode ? "mode-warning" : ""}`} />
              {obstacleMode
                ? "Click rail to place · drag to move · Esc exits"
                : activeScenario.mapContext
                  ? "Drag map · wheel zooms · click tram, stop or turnout"
                  : "Drag map · wheel zooms · click tram or switch"}
            </div>
          </div>
        </div>

        <aside className="control-panel" aria-label="Scenario controls">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Scenario control</span>
              <h2>Operations desk</h2>
            </div>
            <span className="live-badge">Live</span>
          </div>

          <label className="field-label" htmlFor="scenario">
            Network and routes
          </label>
          <select
            id="scenario"
            className="select-control"
            value={snapshot.scenarioId}
            onChange={(event) => {
              resetViewport();
              mutate((engine) => engine.setScenario(event.target.value));
            }}
          >
            {OPERATIONAL_SCENARIOS.map((scenario) => (
              <option value={scenario.id} key={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
          <p className="scenario-note">{activeScenario.description}</p>
          <section className="experiment-panel" aria-label="Save and load simulation experiments">
            <div className="experiment-heading">
              <div>
                <span>Experiment configuration</span>
                <strong>Save / load scenario</strong>
              </div>
              <b>JSON v1</b>
            </div>
            <label className="experiment-name-field">
              <span>Experiment name</span>
              <input
                value={experimentName}
                maxLength={80}
                onChange={(event) => setExperimentName(event.target.value)}
                placeholder="Morning peak test"
              />
            </label>
            <div className="experiment-actions">
              <button type="button" onClick={saveExperimentInBrowser}>Save on this computer</button>
              <button type="button" onClick={exportExperimentJson}>Export JSON</button>
              <button type="button" onClick={() => experimentFileRef.current?.click()}>Import JSON</button>
              <input
                ref={experimentFileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void importExperimentJson(event.target.files?.[0])}
              />
            </div>
            {savedExperiments.length > 0 && (
              <div className="saved-experiment-row">
                <select
                  aria-label="Saved experiments on this computer"
                  value={selectedExperimentSavedAt}
                  onChange={(event) => setSelectedExperimentSavedAt(event.target.value)}
                >
                  {savedExperiments.map((experiment) => (
                    <option value={experiment.savedAt} key={experiment.savedAt}>
                      {experiment.name} · {experiment.networkId === "nizhny-route-2" ? "Route 2" : "Routes 2 + 21"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const experiment = savedExperiments.find((item) => item.savedAt === selectedExperimentSavedAt);
                    if (experiment) loadExperiment(experiment);
                  }}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="danger-subtle"
                  onClick={() => {
                    const next = savedExperiments.filter((item) => item.savedAt !== selectedExperimentSavedAt);
                    persistExperiments(next);
                    setSelectedExperimentSavedAt(next[0]?.savedAt ?? "");
                    setExperimentMessage("Saved experiment deleted");
                  }}
                >
                  Delete
                </button>
              </div>
            )}
            <small className={experimentMessage.toLowerCase().includes("invalid") || experimentMessage.toLowerCase().includes("unknown") ? "error" : ""}>
              {experimentMessage || "Stores route choice, fleet, clock, controls, obstacles, turnouts and manual signal modes."}
            </small>
          </section>
          {activeScenario.studyBaseline && (
            <section className="study-baseline" aria-label="Route 2 study baseline">
              <div className="study-heading">
                <div>
                  <span>Route 2</span>
                  <strong>{activeScenario.studyBaseline.label}</strong>
                </div>
                <b>2</b>
              </div>
              <div className="study-metrics">
                <span>
                  <strong>{activeScenario.studyBaseline.lengthKm}</strong>
                  km
                </span>
                <span>
                  <strong>{activeScenario.studyBaseline.directionalStops}</strong>
                  stop calls
                </span>
                <span>
                  <strong>{activeScenario.studyBaseline.fleet}</strong>
                  trams
                </span>
                <span>
                  <strong>{activeScenario.studyBaseline.headwayMinutes}</strong>
                  min
                </span>
              </div>
              <small>
                {activeScenario.studyBaseline.mappedStopLocations} unique locations ·{" "}
                {activeScenario.studyBaseline.serviceHours} h service ·{" "}
                {activeScenario.studyBaseline.dailyTrips} daily trips both ways
              </small>
            </section>
          )}

          {snapshot.routeOperations.length > 0 && snapshot.depots.length > 0 && (
            <section
              className="service-operations-panel"
              aria-label="Timetable, route headways and depot allocation"
            >
              <div className="service-operations-heading">
                <div>
                  <span>Daily service plan</span>
                  <strong>{snapshot.serviceScheduleLabel ?? "Unscheduled"}</strong>
                </div>
                <time>{snapshot.clock.slice(0, 5)}</time>
              </div>
              <div className="service-time-presets" aria-label="Service time presets">
                {[
                  [330, "05:30"],
                  [450, "07:30"],
                  [720, "12:00"],
                  [1050, "17:30"],
                  [1380, "23:00"],
                ].map(([minute, label]) => (
                  <button
                    type="button"
                    key={minute}
                    onClick={() =>
                      mutate((engine) => engine.setServiceClockMinutes(Number(minute)))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="route-operations-table">
                <div className="route-operations-header">
                  <span>Route</span>
                  <span>Plan</span>
                  <span>Actual avg</span>
                  <span>Line</span>
                  <span>Depot</span>
                  <span>Depart</span>
                  <span>Demand</span>
                </div>
                {snapshot.routeOperations.map((route) => (
                  <div
                    className="route-operations-row"
                    style={{ "--route-color": route.color } as CSSProperties}
                    key={route.routeId}
                  >
                    <strong>{route.shortName}</strong>
                    <span>{formatHeadway(route.plannedHeadwayMinutes)}</span>
                    <span
                      title={route.actualHeadwayMeasured
                        ? "Measured from actual terminal departures"
                        : "Estimated from current spacing and average speed until two terminal departures are recorded"}
                    >
                      {formatHeadway(route.actualHeadwayMinutes)}{route.actualHeadwayMeasured ? " ✓" : " ~"}
                    </span>
                    <b>{route.onRoute}</b>
                    <b>{route.inDepot}</b>
                    <b
                      title={route.scheduledDepartures > 0
                        ? `${route.scheduledDepartures} timed departures · mean absolute deviation ${route.meanDepartureDeviationSeconds?.toFixed(0) ?? "—"}s`
                        : "No terminal/depot departure recorded yet"}
                    >
                      {route.departureAdherencePercent === null
                        ? "—"
                        : `${route.departureAdherencePercent.toFixed(0)}%`}
                    </b>
                    <b
                      className={
                        route.averageWaitSeconds > 240 ? "demand-hot" : ""
                      }
                      title={`${route.waitingPassengers} waiting · ~${formatWaitShort(route.averageWaitSeconds)} avg wait · ${route.onboardPassengers}/${route.onboardCapacity} aboard`}
                    >
                      {route.waitingPassengers}·{formatWaitShort(route.averageWaitSeconds)}
                    </b>
                  </div>
                ))}
              </div>
              <div className="depot-allocation-list">
                {snapshot.depots.map((depot) => (
                  <div key={depot.id} className={depot.kind === "turnback" ? "depot-row-turnback" : ""}>
                    <span>
                      <b>{depot.shortName}</b>
                      {depot.kind === "turnback" ? " · siding" : ""}
                      {depot.note}
                    </span>
                    <strong>
                      {depot.storedTrams}{depot.capacity ? `/${depot.capacity}` : ""} stored
                      {depot.inboundTrams > 0 ? ` · ${depot.inboundTrams} in` : ""}
                      {depot.outboundTrams > 0 ? ` · ${depot.outboundTrams} out` : ""}
                    </strong>
                  </div>
                ))}
              </div>
              {(() => {
                const dispatcherEvents = snapshot.events
                  .filter((entry) => /extra tram|released to depot|short turn|turned back/i.test(entry.message))
                  .slice(0, 4);
                return dispatcherEvents.length > 0 ? (
                  <div className="dispatcher-log" aria-label="Recent dispatcher decisions">
                    <span className="dispatcher-log-heading">Dispatcher actions</span>
                    {dispatcherEvents.map((entry) => (
                      <div className={`dispatcher-log-row tone-${entry.tone}`} key={entry.id}>
                        <time>{entry.time}</time>
                        <p>{entry.message}</p>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
              <small>
                Automatic dispatch gradually releases or withdraws one tram per route every 20 simulated seconds, and reacts to passenger demand: extra trams above ~4 min average wait, early depot returns below ~30s, and an early-withdrawal &quot;short turn&quot; for trams delayed past 7 min.
              </small>
            </section>
          )}

          {selectedStopBoard && (
            <section
              className="stop-board-panel"
              aria-label="Live stop arrival board"
            >
              <div className="stop-board-heading">
                <div>
                  <span>Live arrivals</span>
                  <strong>Stop departure board</strong>
                </div>
                <b>{selectedStopBoard.stationNumber ?? "•"}</b>
              </div>
              <label className="stop-board-select">
                <span>Monitored stop</span>
                <select
                  className="select-control compact"
                  aria-label="Stop arrival board"
                  value={selectedStopBoard.id}
                  onChange={(event) =>
                    mutate((engine) => engine.selectStop(event.target.value))
                  }
                >
                  {snapshot.stopBoards.map((board) => (
                    <option value={board.id} key={board.id}>
                      {board.stationNumber
                        ? `${String(board.stationNumber).padStart(2, "0")} · `
                        : ""}
                      {board.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="stop-board-screen">
                <header>
                  <strong>{selectedStopBoard.label}</strong>
                  <time>{snapshot.clock}</time>
                </header>
                <div className="stop-direction-grid">
                  {selectedStopBoard.directions.map((direction) => (
                    <article
                      key={direction.id}
                      style={
                        {
                          "--arrival-line": direction.color,
                        } as CSSProperties
                      }
                    >
                      <header>
                        <span>
                          <i aria-hidden="true" />
                          <b>{direction.shortName}</b>
                          {direction.label}
                        </span>
                        <small>next 3</small>
                      </header>
                      {direction.platformLabel !== selectedStopBoard.label && (
                        <p className="stop-platform-name">{direction.platformLabel}</p>
                      )}
                      <p
                        className={`stop-direction-demand ${direction.overcrowded ? "demand-overcrowded" : ""}`}
                        title="Passengers waiting · estimated average wait"
                      >
                        <span aria-hidden="true">👤</span>
                        {direction.waitingPassengers} waiting · ~{formatWaitShort(direction.averageWaitSeconds)} avg
                        {direction.overcrowded ? " · full trams" : ""}
                      </p>
                      <ol>
                        {direction.arrivals.length > 0 ? (
                          direction.arrivals.map((arrival) => (
                            <li
                              className={`arrival-${arrival.status}`}
                              key={arrival.tramId}
                            >
                              <i
                                aria-hidden="true"
                                style={{ background: arrival.color }}
                              />
                              <span>
                                <b>{arrival.tramLabel}</b>
                                <small>{arrival.statusLabel}</small>
                              </span>
                              <strong>{formatStopEta(arrival.etaSeconds)}</strong>
                            </li>
                          ))
                        ) : (
                          <li className="arrival-empty">No tram assigned</li>
                        )}
                      </ol>
                    </article>
                  ))}
                </div>
              </div>
              <small>
                Click any numbered stop on the map. ETA uses a rolling 90-second
                service-speed average, with live signals, regulation and obstacles.
              </small>
            </section>
          )}

          {showNizhnyInfrastructure &&
            snapshot.switches.length > 0 && (
              <section className="turnout-panel" aria-label="Network turnouts">
                <div className="turnout-panel-heading">
                  <div>
                    <span>Real infrastructure</span>
                    <strong>
                      {snapshot.scenarioName} turnout complexes
                    </strong>
                  </div>
                  <b>{snapshot.switches.length}</b>
                </div>
                <div className="turnout-grid">
                  {snapshot.switches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.state === "branch" ? "branch" : ""}
                      title={`${item.label} · click to toggle`}
                      onClick={() =>
                        mutate((engine) => engine.toggleSwitch(item.id))
                      }
                    >
                      <span>{item.id}</span>
                      <small>{item.label}</small>
                      <b>{item.state === "main" ? "MAIN" : "BRANCH"}</b>
                    </button>
                  ))}
                </div>
                <small>
                  Click a turnout on the map or here. BRANCH diverts the next
                  approaching tram, then resets to MAIN.
                </small>
              </section>
            )}

          {showNizhnyInfrastructure &&
            snapshot.trafficControllers.length > 0 && (
              <section
                className="intersection-panel"
                aria-label="Network tram signals"
              >
                <div className="intersection-panel-heading">
                  <div>
                    <span>Street signals</span>
                    <strong>Every controlled tram signal</strong>
                  </div>
                  <b>{activeScenario.signals.length}</b>
                </div>
                <div className="intersection-list">
                  {activeScenario.signals.map((signal) => {
                    const controller = snapshot.trafficControllers.find(
                      (item) =>
                        item.id === (signal.controllerId ?? signal.id),
                    );
                    const hasGreen =
                      controller?.phase === "tram-green" &&
                      controller.activeSignalId === signal.id;
                    const isClearing =
                      (controller?.phase === "amber-to-tram" ||
                        controller?.phase === "amber-to-road") &&
                      controller.activeSignalId === signal.id;
                    const phaseLabel = hasGreen
                      ? "TRAM GO"
                      : isClearing
                        ? "CLEARANCE"
                        : "TRAM STOP";
                    const phaseClass = hasGreen
                      ? "tram-green"
                      : isClearing
                        ? controller!.phase
                        : "road-green";
                    const manualForThisSignal =
                      controller?.manualMode === "tram-green" &&
                      controller.manualSignalId === signal.id;
                    return (
                      <div className="intersection-control" key={signal.id}>
                        <div className="intersection-status">
                          <i
                            className={`junction-phase phase-${phaseClass}`}
                            aria-hidden="true"
                          />
                          <span>{signal.id} · {signal.label}</span>
                          <b>
                            {controller?.manualReleasePending
                              ? "CLEARING"
                              : controller?.manualMode !== "auto"
                                ? `MANUAL · ${phaseLabel}`
                                : phaseLabel}
                          </b>
                        </div>
                        <div className="intersection-actions" aria-label={`${signal.id} manual controls`}>
                          <button
                            type="button"
                            className={controller?.manualMode === "auto" ? "active" : ""}
                            onClick={() => mutate((engine) => engine.setTrafficSignalMode(signal.id, "auto"))}
                          >
                            AUTO
                          </button>
                          <button
                            type="button"
                            className={manualForThisSignal ? "active tram" : ""}
                            onClick={() => mutate((engine) => engine.setTrafficSignalMode(signal.id, "tram-green"))}
                          >
                            TRAM GO
                          </button>
                          <button
                            type="button"
                            className={controller?.manualMode === "road-green" ? "active road" : ""}
                            onClick={() => mutate((engine) => engine.setTrafficSignalMode(signal.id, "road-green"))}
                          >
                            ROAD GO
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <small>
                  Manual TRAM GO stops road cars for the selected approach. ROAD
                  GO is deferred until an occupying tram has fully cleared. AUTO
                  restores detector control. Rail headway protection stays active.
                </small>
              </section>
            )}

          <div className="system-cards">
            <article>
              <span>Network</span>
              <StatusLed>Online</StatusLed>
              <div className="network-glyph" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
            </article>
            <article>
              <span>Switches</span>
              <StatusLed tone={snapshot.switches.some((item) => item.lockedBy) ? "warning" : "ok"}>
                {snapshot.switches.length === 0
                  ? "No turnouts"
                  : snapshot.switches.some((item) => item.lockedBy)
                    ? "Locked"
                    : `${snapshot.switches.length} aligned`}
              </StatusLed>
              <button
                className="inline-action"
                type="button"
                disabled={snapshot.switches.length === 0}
                onClick={() => mutate((engine) => engine.toggleSwitch())}
              >
                {snapshot.switches.length === 0 ? "Ring" : "Toggle"}
              </button>
            </article>
            <article>
              <span>Signals</span>
              <StatusLed tone={signalTone}>{signalLabel}</StatusLed>
              <div className={`mini-signal ${signalTone}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </article>
          </div>

          <div className="control-row">
            <div>
              <span className="field-label">Speed limit</span>
              <small>Calibrated PWM 55 cruise</small>
            </div>
            <div className="stepper">
              <button
                type="button"
                onClick={() =>
                  mutate((engine) =>
                    engine.setSpeedLimit(snapshot.options.speedLimit - 5),
                  )
                }
                aria-label="Decrease speed limit"
              >
                −
              </button>
              <strong>{snapshot.options.speedLimit}</strong>
              <span>km/h</span>
              <button
                type="button"
                onClick={() =>
                  mutate((engine) =>
                    engine.setSpeedLimit(snapshot.options.speedLimit + 5),
                  )
                }
                aria-label="Increase speed limit"
              >
                +
              </button>
            </div>
          </div>

          <div className="control-row control-row-stack">
            <span className="field-label">Simulation rate</span>
            <div className="segmented">
              {[0.5, 1, 2, 5].map((rate) => (
                <button
                  type="button"
                  className={snapshot.options.simulationRate === rate ? "selected" : ""}
                  onClick={() =>
                    mutate((engine) => engine.setSimulationRate(rate))
                  }
                  key={rate}
                >
                  {rate}×
                </button>
              ))}
            </div>
          </div>

          <div className="control-row">
            <div>
              <span className="field-label">Auto dispatch</span>
              <small>
                {activeScenario.serviceSchedule
                  ? "Follows daily plan · releases and withdraws depot fleet"
                  : activeScenario.predeployedFleet
                  ? `${activeScenario.studyBaseline?.headwayMinutes ?? 3} min study headway · fleet pre-positioned`
                  : `${activeScenario.dispatchIntervalSeconds ?? 12}s nominal separation`}
              </small>
            </div>
            <Toggle
              label="Toggle automatic dispatch"
              checked={snapshot.options.autoDispatch}
              onChange={(checked) =>
                mutate((engine) => engine.setAutoDispatch(checked))
              }
            />
          </div>

          {activeScenario.tractionPowerSystem && (
            <div className="control-row">
              <div>
                <span className="field-label">Energy-optimal dispatch</span>
                <small>Forecast flywheel SOC · regenerative matching · section peak smoothing</small>
              </div>
              <Toggle
                label="Toggle energy-optimal dispatch"
                checked={snapshot.options.energyStrategy === "network-optimal"}
                onChange={(checked) =>
                  mutate((engine) =>
                    engine.setEnergyStrategy(checked ? "network-optimal" : "baseline"),
                  )
                }
              />
            </div>
          )}

          {flywheelModules > 0 && (
            <button
              type="button"
              className="flywheel-overview"
              onClick={() => setEnergyWindowOpen(true)}
              aria-label="Open VYCON flywheel energy statistics"
            >
              <span className="flywheel-rotor" aria-hidden="true"><i /><i /><i /></span>
              <span>
                <small>WAYSIDE STORAGE · LIVE</small>
                <strong>VYCON REGEN · {flywheelModules} modules</strong>
                <em>{formatPower(flywheelModules * 125)} · {snapshot.energyStatistics.powerSystem.flywheelCapacityKWh.toFixed(2)} kWh · 15% reserve</em>
              </span>
              <b>{flywheelSoc.toFixed(0)}%<small>SOC</small></b>
            </button>
          )}

          <div className="control-row">
            <div>
              <span className="field-label">Active interval control</span>
              <small>Restores planned spacing · 30m safety floor</small>
            </div>
            <Toggle
              label="Toggle active interval control"
              checked={snapshot.options.collisionAvoidance}
              onChange={(checked) =>
                mutate((engine) => engine.setCollisionAvoidance(checked))
              }
            />
          </div>

          <div
            className={`control-grid ${
              supportsFirmwareComparison ? "" : "priority-only"
            }`}
          >
            {supportsFirmwareComparison && (
              <label>
                <span className="field-label">Control logic</span>
                <select
                  className="select-control compact"
                  value={snapshot.options.controlMode}
                  onChange={(event) =>
                    mutate((engine) =>
                      engine.setControlMode(
                        event.target.value as "firmware" | "cooperative",
                      ),
                    )
                  }
                >
                  <option value="cooperative">Cooperative twin</option>
                  <option value="firmware">2021 firmware</option>
                </select>
                <small className="control-help">
                  Locked multi-tram routing or direct UID → servo control.
                </small>
              </label>
            )}
            <label>
              <span className="field-label">Junction queue</span>
              <select
                className="select-control compact"
                value={snapshot.options.priorityPolicy}
                onChange={(event) =>
                  mutate((engine) =>
                    engine.setPriorityPolicy(
                      event.target.value as "fifo" | "schedule" | "fleet",
                    ),
                  )
                }
              >
                <option value="fifo">First request (FIFO)</option>
                <option value="schedule">Most delayed tram</option>
                <option value="fleet">Fixed tram rank</option>
              </select>
              <small className="control-help">
                {snapshot.options.priorityPolicy === "schedule"
                  ? "When requests conflict, the tram with the greatest accumulated delay goes next."
                  : snapshot.options.priorityPolicy === "fleet"
                    ? "When requests conflict, the lowest fleet rank shown below goes next."
                    : "When requests conflict, the tram that called the junction first goes next."}
              </small>
            </label>
          </div>

          {snapshot.fleetGroups.length > 0 ? (
            <div className="control-row control-row-stack fleet-composition">
              <div className="fleet-composition-heading">
                <span className="field-label">Trams by route and direction</span>
                <strong>
                  {snapshot.trams.length} / {snapshot.fleetCapacity}
                </strong>
              </div>
              <div className="fleet-group-list">
                {snapshot.fleetGroups.map((group) => {
                  const route = activeScenario.routes.find(
                    (item) => item.id === group.routeId,
                  );
                  return (
                    <div
                      className="fleet-group-row"
                      style={
                        {
                          "--route-color": route?.color ?? "#59d8e8",
                        } as CSSProperties
                      }
                      key={group.id}
                    >
                      <span className="fleet-group-name">
                        <i aria-hidden="true" />
                        {group.shortName}
                      </span>
                      <div className="fleet-counter">
                        <button
                          type="button"
                          aria-label={`Remove one tram from ${group.label}`}
                          disabled={
                            group.count === 0 ||
                            (snapshot.trams.length === 1 && group.count === 1)
                          }
                          onClick={() =>
                            mutate((engine) =>
                              engine.setFleetGroupCount(group.id, group.count - 1),
                            )
                          }
                        >
                          −
                        </button>
                        <strong aria-label={`${group.count} trams`}>{group.count}</strong>
                        <button
                          type="button"
                          aria-label={`Add one tram to ${group.label}`}
                          disabled={
                            group.count >= group.maxCount ||
                            snapshot.trams.length >= snapshot.fleetCapacity
                          }
                          onClick={() =>
                            mutate((engine) =>
                              engine.setFleetGroupCount(group.id, group.count + 1),
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <small className="control-help">
                The network restarts after a fleet change and automatically spaces new trams along the selected direction.
              </small>
            </div>
          ) : (
            <div className="control-row control-row-stack">
              <span className="field-label">Fleet size</span>
              <div className="segmented">
                {fleetOptions.map((count) => (
                  <button
                    type="button"
                    className={snapshot.trams.length === count ? "selected" : ""}
                    onClick={() => mutate((engine) => engine.setTramCount(count))}
                    key={count}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fleet-table" aria-label="Tram priority and status">
            <div className="fleet-header">
              <span>#</span>
              <span>Tram / RFID</span>
              <span>Route</span>
              <span>Status</span>
              <span>Pax</span>
            </div>
            {snapshot.trams.map((tram) => {
              const fleetGroup = snapshot.fleetGroups.find(
                (group) => group.id === tram.fleetGroupId,
              );
              const loadRatio = tram.onboardPassengers / Math.max(1, tram.passengerCapacity);
              return (
              <button
                type="button"
                className={selectedTram?.id === tram.id ? "fleet-row selected-row" : "fleet-row"}
                onClick={() => mutate((engine) => engine.selectTram(tram.id))}
                key={tram.id}
              >
                <span>{tram.linePriority}</span>
                <span>
                  <strong style={{ color: tram.color }}>{tram.label}</strong>
                  <small>{tram.uid}</small>
                </span>
                <span
                  className={`fleet-route ${tram.serviceState !== "in-service" ? "depot-route" : ""}`}
                  style={
                    {
                      "--route-color": routeForIntent(tram.routeIntent).color,
                    } as CSSProperties
                  }
                  title={tram.directionLabel ?? routeForIntent(tram.routeIntent).name}
                >
                  {tram.serviceState !== "in-service"
                    ? tram.serviceLabel
                    : fleetGroup
                    ? fleetGroup.shortName
                    : routeForIntent(tram.routeIntent).shortName}
                </span>
                <span className={`tram-state tone-${tram.statusTone}`}>
                  {tram.status}
                </span>
                <span
                  className={`fleet-pax ${loadRatio >= 0.95 ? "fleet-pax-full" : loadRatio >= 0.7 ? "fleet-pax-busy" : ""}`}
                  title={`${tram.onboardPassengers} of ${tram.passengerCapacity} aboard`}
                >
                  {tram.serviceState === "in-service" ? `${tram.onboardPassengers}/${tram.passengerCapacity}` : "—"}
                </span>
              </button>
              );
            })}
          </div>

          {selectedTram && (
            <section
              className={`manual-control-panel ${
                selectedTram.canReverseToRoute ? "recovery-ready" : ""
              }`}
              aria-label={`Manual control for ${selectedTram.label}`}
            >
              <div className="manual-control-heading">
                <div>
                  <span>Selected tram</span>
                  <strong style={{ color: selectedTram.color }}>
                    {selectedTram.label}
                  </strong>
                </div>
                <b className={selectedTram.manualMode ? "manual-badge" : "auto-badge"}>
                  {selectedTram.manualMode ? "MANUAL" : "AUTO"}
                </b>
              </div>

              {snapshot.depots.length > 0 && (
                <button
                  type="button"
                  className="depot-action-button"
                  disabled={
                    selectedTram.serviceState === "depot-ingress" ||
                    selectedTram.serviceState === "depot-egress"
                  }
                  onClick={() =>
                    mutate((engine) => {
                      engine.toggleSelectedTramDepot();
                      if (!snapshot.running) engine.setRunning(true);
                    })
                  }
                >
                  {selectedTram.serviceState === "in-depot"
                    ? "Release from depot to line"
                    : selectedTram.serviceState === "to-depot"
                      ? "Cancel depot run"
                      : selectedTram.serviceState === "in-service"
                        ? "Withdraw to depot"
                        : "Depot movement in progress"}
                </button>
              )}

              <div className="manual-mode-selector" aria-label="Tram control mode">
                <button
                  type="button"
                  className={!selectedTram.manualMode ? "active" : ""}
                  disabled={
                    selectedTram.canReverseToRoute ||
                    (selectedTram.serviceState !== "in-service" &&
                      selectedTram.serviceState !== "to-depot")
                  }
                  title={
                    selectedTram.canReverseToRoute
                      ? "Return to Route 2 before restoring automatic control"
                      : "Restore automatic control"
                  }
                  onClick={() =>
                    mutate((engine) => engine.setSelectedTramManual(false))
                  }
                >
                  AUTO
                </button>
                <button
                  type="button"
                  className={selectedTram.manualMode ? "active manual" : ""}
                  disabled={
                    selectedTram.serviceState !== "in-service" &&
                    selectedTram.serviceState !== "to-depot"
                  }
                  onClick={() =>
                    mutate((engine) => engine.setSelectedTramManual(true))
                  }
                >
                  MANUAL
                </button>
              </div>

              <div className="manual-command-grid">
                <button
                  type="button"
                  className={
                    selectedTram.manualCommand === "forward" &&
                    selectedTram.manualMode
                      ? "active"
                      : ""
                  }
                  disabled={
                    !selectedTram.manualMode ||
                    (selectedTram.serviceState !== "in-service" &&
                      selectedTram.serviceState !== "to-depot")
                  }
                  onClick={() =>
                    mutate((engine) => {
                      engine.setSelectedTramCommand("forward");
                      if (!snapshot.running) engine.setRunning(true);
                    })
                  }
                >
                  <span aria-hidden="true">↑</span>
                  Forward
                  <small>20 km/h</small>
                </button>
                <button
                  type="button"
                  className={
                    selectedTram.manualCommand === "stop" &&
                    selectedTram.manualMode
                      ? "active stop"
                      : ""
                  }
                  disabled={
                    !selectedTram.manualMode ||
                    (selectedTram.serviceState !== "in-service" &&
                      selectedTram.serviceState !== "to-depot")
                  }
                  onClick={() =>
                    mutate((engine) => engine.setSelectedTramCommand("stop"))
                  }
                >
                  <span aria-hidden="true">■</span>
                  Hold
                  <small>PWM 0</small>
                </button>
                <button
                  type="button"
                  className={
                    selectedTram.manualCommand === "reverse" ? "active return" : "return"
                  }
                  disabled={!selectedTram.canReverseToRoute}
                  onClick={() =>
                    mutate((engine) => {
                      engine.setSelectedTramCommand("reverse");
                      if (!snapshot.running) engine.setRunning(true);
                    })
                  }
                >
                  <span aria-hidden="true">↶</span>
                  Return to route
                  <small>
                    {selectedTram.branchReturnSwitchId
                      ? `via ${selectedTram.branchReturnSwitchId} · 10 km/h`
                      : "Available on an external branch"}
                  </small>
                </button>
              </div>

              <p>
                {selectedTram.serviceState === "in-depot"
                  ? "The tram is stored and excluded from passenger arrivals and line headway calculations."
                  : selectedTram.serviceState === "to-depot"
                    ? `Not boarding passengers. Stop boards show service only to ${selectedTram.lastPassengerStop ?? "the depot turnout"}.`
                    : selectedTram.serviceState === "depot-ingress" ||
                        selectedTram.serviceState === "depot-egress"
                      ? "The tram is on the non-passenger depot connection. Line entry waits until the merge is clear."
                      : selectedTram.canReverseToRoute
                  ? `Recovery path saved. ${selectedTram.branchReturnSwitchId} will merge the tram back onto its original Route 2 track when clear.`
                  : selectedTram.manualMode
                    ? "Manual forward bypasses interval regulation, while signals, junction interlocking, obstacle detection and the 7m no-passing lock remain active. Reverse is reserved for branch recovery."
                    : "Select MANUAL to command this tram. Movement commands resume the simulation automatically."}
              </p>
            </section>
          )}

          <div className="obstacle-actions">
            <button
              className={obstacleMode ? "apply-button warning-button" : "apply-button"}
              type="button"
              onClick={() => setObstacleMode((current) => !current)}
            >
              {obstacleMode ? "Finish obstacle placement" : "+ Place obstacle"}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={snapshot.obstacles.length === 0}
              onClick={() => mutate((engine) => engine.clearObstacles())}
            >
              Clear all
            </button>
          </div>

          <details className="firmware-map">
            <summary>Original firmware mapping</summary>
            <dl>
              <div>
                <dt>VL53L0X</dt>
                <dd>70mm → {snapshot.options.sensorRangeMeters}m virtual envelope</dd>
              </div>
              <div>
                <dt>Autopilot</dt>
                <dd>PWM 55 cruise · PWM 0 emergency</dd>
              </div>
              <div>
                <dt>Reed stop</dt>
                <dd>PWM 20 / 2s · dwell 12s · doors open</dd>
              </div>
              <div>
                <dt>RFID turnout</dt>
                <dd>Servo 57° branch · 127° main</dd>
              </div>
            </dl>
          </details>
        </aside>
      </section>

      <section className="telemetry-strip" aria-label="Live telemetry">
        {selectedTram && (
          <SpeedGauge
            label={selectedTram.label}
            speed={selectedTram.speedKmh}
            limit={snapshot.options.speedLimit}
            color={selectedTram.color}
          />
        )}
        {secondTram && (
          <SpeedGauge
            label={secondTram.label}
            speed={secondTram.speedKmh}
            limit={snapshot.options.speedLimit}
            color={secondTram.color}
          />
        )}
        <article
          className="metric-card route-card"
          style={
            {
              "--route-color": selectedRoute?.color ?? "#25d4e8",
            } as CSSProperties
          }
        >
          <span className="metric-label">Selected tram</span>
          <strong>
            {selectedRoute
              ? `${selectedRoute.shortName} · ${selectedRoute.name}`
              : "No route"}
          </strong>
          <div className="route-line" aria-hidden="true">
            <span />
            <i />
          </div>
          <span className={`route-status tone-${selectedTram?.statusTone ?? "idle"}`}>
            {selectedTram?.status ?? "No tram"}
          </span>
          <small>
            {selectedTram?.manualMode ? "MANUAL" : "AUTO"} · PWM{" "}
            {selectedTram?.pwm ?? 0} · UID {selectedTram?.uid ?? "—"}
          </small>
          <small title="Longitudinal model: acceleration, traction and braking force">
            a {selectedTram?.accelerationMps2.toFixed(2) ?? "0.00"} m/s² ·{" "}
            {selectedTram?.dynamicsMode ?? "coast"} · Fₜ{" "}
            {selectedTram?.tractionForceKn.toFixed(1) ?? "0.0"} kN · Fᵦ{" "}
            {selectedTram?.brakeForceKn.toFixed(1) ?? "0.0"} kN
          </small>
          <small title="Passenger mass is included in the C++ longitudinal dynamics">
            Mass {selectedTram?.vehicleMassTonnes.toFixed(1) ?? "27.5"} t · load{" "}
            {selectedTram?.onboardPassengers ?? 0}/{selectedTram?.passengerCapacity ?? 110} · profile{" "}
            {selectedTram?.profileLimitKmh.toFixed(0) ?? "—"} km/h
            {selectedTram?.profileReason === "curve" && selectedTram.curveRadiusMeters
              ? ` · R ${selectedTram.curveRadiusMeters.toFixed(0)} m · aᵧ ${selectedTram.lateralAccelerationMps2.toFixed(2)} m/s²`
              : selectedTram?.profileReason === "turnout"
                ? " · turnout"
                : " · line"}
          </small>
          <small title="Speed eco-driving is withheld; energy dispatch remains active">
            Speed ECO disabled · SOC and peak dispatch only
          </small>
        </article>
        <article className="metric-card numeric-card">
          <span className="metric-label">Minimum interval</span>
          <strong>
            {snapshot.metrics.headwayMeters >= 1_000
              ? (snapshot.metrics.headwayMeters / 1_000).toFixed(1)
              : snapshot.metrics.headwayMeters.toFixed(0)}
          </strong>
          <span>{snapshot.metrics.headwayMeters >= 1_000 ? "km" : "m"}</span>
          <small>
            {snapshot.metrics.intervalRecoveryTrams > 0
              ? `${snapshot.metrics.intervalRecoveryTrams} tram${snapshot.metrics.intervalRecoveryTrams === 1 ? "" : "s"} restoring spacing`
              : `Planned ${formatDistanceLabel(snapshot.metrics.targetHeadwayMeters)}`}
          </small>
        </article>
        <article className="metric-card numeric-card time-card">
          <span className="metric-label">Simulation time</span>
          <strong>{snapshot.clock}</strong>
          <span>hh:mm:ss</span>
          <small>
            ×{snapshot.options.simulationRate} · {snapshot.running ? "running" : "paused"}
          </small>
        </article>
        <article className="event-card">
          <div className="event-heading">
            <span>Time</span>
            <span>Event</span>
          </div>
          <div className="event-list">
            {snapshot.events.slice(0, 6).map((entry) => (
              <div className="event-row" key={entry.id}>
                <time>{entry.time}</time>
                <span className={`event-dot event-${entry.tone}`} />
                <p>{entry.message}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <footer className="diagnostic-bar">
        <button type="button" className="energy-stat-button" onClick={() => setEnergyWindowOpen(true)}>
          <b>{flywheelModules > 0 ? `Flywheels ${flywheelModules}` : "Energy"}</b>{" "}
          {flywheelModules > 0 ? `${flywheelSoc.toFixed(0)}% SOC · ` : ""}
          {snapshot.metrics.energyWh.toFixed(1)} Wh used · {snapshot.metrics.recoveredWh.toFixed(1)} Wh recovered
          <i>Open statistics</i>
        </button>
        <span>
          <b>Timed departures</b>{" "}
          {snapshot.metrics.departureAdherencePercent === null
            ? "awaiting first terminal/depot departure"
            : `${snapshot.metrics.departureAdherencePercent.toFixed(0)}% · ${snapshot.metrics.scheduledDepartures} recorded · ${snapshot.metrics.meanDepartureDeviationSeconds?.toFixed(0) ?? "—"}s mean deviation`}
        </span>
        <span>
          <b>Laps</b> {snapshot.metrics.completedLaps}
        </span>
        <span>
          <b>Test focus</b> {activeScenario.useCase}
        </span>
      </footer>
      {energyWindowOpen && (
        <EnergyStatisticsWindow snapshot={snapshot} onClose={() => setEnergyWindowOpen(false)} />
      )}
    </main>
  );
}
