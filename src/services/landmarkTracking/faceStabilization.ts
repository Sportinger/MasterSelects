import type { ClipTransform } from '../../types/timelineCore';
import type { LandmarkPoint } from './types';
import { trackingPreviewTransform } from '../planarTracking/trackingPreviewTransform';

export type FaceStabilizationTarget = 'face' | 'lips';
export interface FaceStabilizationPose { rotation: number; x: number; y: number }

/** Fit an in-plane rotation only: expressions and out-of-plane head turns remain intact. */
export function solveFaceStabilization(
  face: readonly LandmarkPoint[], target: FaceStabilizationTarget, base: ClipTransform,
  source: { width: number; height: number }, output: { width: number; height: number },
  lockCenter: boolean, previousAngle?: number,
): FaceStabilizationPose | null {
  const left = face[target === 'face' ? 33 : 61];
  const right = face[target === 'face' ? 263 : 291];
  const center = target === 'face' ? face[1]
    : left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : undefined;
  if (!left || !right || !center) return null;
  const neutral = { ...base, position: { ...base.position, x: 0, y: 0 }, rotation: { ...base.rotation, z: 0 } };
  const unrotated = trackingPreviewTransform(neutral, source, output);
  const a = unrotated.toComposition(left), b = unrotated.toComposition(right);
  const dx = (b.x - a.x) * output.width, dy = (b.y - a.y) * output.height;
  if (![dx, dy, center.x, center.y].every(Number.isFinite) || Math.hypot(dx, dy) < 8) return null;
  let rotation = Math.atan2(dy, dx) * 180 / Math.PI;
  if (previousAngle !== undefined) {
    rotation += 360 * Math.round((previousAngle - rotation) / 360);
    // Reject one-frame detector flips rather than rotate the whole image through them.
    if (Math.abs(rotation - previousAngle) > 45) return null;
  }
  const rotated = trackingPreviewTransform({ ...neutral, rotation: { ...neutral.rotation, z: rotation } }, source, output).toComposition(center);
  const destination = lockCenter ? { x: 0.5, y: 0.5 }
    : trackingPreviewTransform(base, source, output).toComposition(center);
  return { rotation, x: (destination.x - rotated.x) * 2, y: (destination.y - rotated.y) * 2 };
}
