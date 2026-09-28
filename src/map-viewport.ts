import type { Point } from "./simulation-core/index.ts";

/**
 * Keep map dragging finite while still allowing every world edge and corner
 * to be brought to the centre of the viewport at any zoom level.
 */
export function clampMapPan(
  next: Point,
  zoom: number,
  worldWidth: number,
  worldHeight: number,
): Point {
  const normalizedZoom = Math.max(0.01, zoom);
  const margin = 40;
  const maxX = (worldWidth * normalizedZoom) / 2 + margin;
  const maxY = (worldHeight * normalizedZoom) / 2 + margin;
  return {
    x: Math.max(-maxX, Math.min(maxX, next.x)),
    y: Math.max(-maxY, Math.min(maxY, next.y)),
  };
}
