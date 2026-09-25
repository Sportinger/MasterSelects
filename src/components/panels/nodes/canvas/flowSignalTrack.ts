import type { NodeGraphPoint } from './canvasGeometry';
import type { Rect } from './rendering/nodeCanvasTypes';
import { pointBehindGroup } from './edgeGroupOcclusion';
import type { NodeCableStyle } from '../../../../types/nodeGraph';
import { cableRoute, cableRouteBounds, sampleCableRoute } from './cableRoute';

/** Sample the same route as the cable into transform-only animation keyframes. */
export function flowSignalTrack(from: NodeGraphPoint, to: NodeGraphPoint, zoom: number, occlusions: Rect[] = [], style: NodeCableStyle = 'curved') {
  const route = cableRoute(from, to, style), bounds = cableRouteBounds(route);
  const left = bounds.x, top = bounds.y, width = bounds.width, height = Math.max(1, bounds.height);
  const points = sampleCableRoute(route, route.segments.length === 1 ? 48 : 16);
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
      offset: length > 0 ? distances[i] / length : i / (points.length - 1),
    })),
  };
}
