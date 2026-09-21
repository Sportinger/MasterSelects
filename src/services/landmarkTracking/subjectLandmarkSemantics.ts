import type { LandmarkFrame, LandmarkPoint } from './types';

export interface LandmarkPointStats {
  x: number;
  y: number;
  spread: number;
}

/** Subject tracking prefers pose detections and falls back to faces only when no pose exists. */
export function selectSubjectLandmarks(frame: Pick<LandmarkFrame, 'poses' | 'faces'>): LandmarkPoint[] {
  const poses = frame.poses.flat();
  return poses.length ? poses : frame.faces.flat();
}

/** Canonical center/spread values consumed by the legacy Subject uniform adapter. */
export function landmarkPointStats(points: readonly LandmarkPoint[]): LandmarkPointStats {
  if (!points.length) return { x: 0.5, y: 0.5, spread: 0.15 };
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const spread = points.reduce((sum, point) => sum + Math.hypot(point.x - x, point.y - y), 0) / points.length;
  return { x, y, spread };
}

/** Stable, evenly spaced selection used by the fixed 64-point GPU storage contract. */
export function evenlySampleLandmarks(points: LandmarkPoint[], maximum: number): LandmarkPoint[] {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => points[Math.floor(index * points.length / maximum)]);
}
