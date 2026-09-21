import type { NodeGraphPoint } from './canvasGeometry';
import type { Rect } from './rendering/nodeCanvasTypes';
import { pointBehindGroup } from './edgeGroupOcclusion';

/** Sample the same cubic as the cable into transform-only animation keyframes. */
export function flowSignalTrack(from: NodeGraphPoint, to: NodeGraphPoint, zoom: number, occlusions: Rect[] = []) {
  const handle = Math.max(72, Math.abs(to.x - from.x) * 0.42);
  const left = Math.min(from.x, to.x - handle);
  const top = Math.min(from.y, to.y);
  const width = Math.max(from.x + handle, to.x) - left;
  const height = Math.max(1, Math.abs(to.y - from.y));
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = i / 48, u = 1 - t;
    return {
      x: u ** 3 * from.x + 3 * u * u * t * (from.x + handle) + 3 * u * t * t * (to.x - handle) + t ** 3 * to.x,
      y: u ** 3 * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t ** 3 * to.y,
    };
  });
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1]
    + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = distances.at(-1)!;
  return {
    left, top, width, height,
    duration: Math.max(1300, Math.min(3600, length * zoom / 140 * 1000)),
    keyframes: points.map((p, i) => ({
      transform: `translate3d(${p.x - left}px, ${p.y - top}px, 0)`,
      opacity: pointBehindGroup(p, occlusions) ? .3 : 1,
      offset: length > 0 ? distances[i] / length : i / 48,
    })),
  };
}
