import type { EasingType } from '../../../types';
import type { Keyframe } from '../../../types/keyframes';
import { segmentHandlesForCurve, type CubicBezierPoints } from '../../../utils/easingPresets';

/**
 * Applies an easing to the segments that start at the target keyframes.
 *
 * With a curve, the segment becomes a bezier segment: the target key gets the
 * outgoing handle and the next key of the same property gets the incoming one.
 * With `null`, the preset easing is stored and both segment handles are
 * cleared, because any stored handle forces bezier interpolation.
 */
export function applyEasingCurveToKeyframes(
  keyframes: readonly Keyframe[],
  targetIds: ReadonlySet<string>,
  curve: CubicBezierPoints | null,
  easing: EasingType = 'bezier',
): Keyframe[] {
  const next = keyframes.map(key => ({ ...key }));
  const byProperty = new Map<string, Keyframe[]>();
  for (const key of next) {
    const list = byProperty.get(key.property);
    if (list) list.push(key); else byProperty.set(key.property, [key]);
  }
  for (const list of byProperty.values()) {
    list.sort((a, b) => a.time - b.time);
    for (let index = 0; index < list.length; index++) {
      const key = list[index]!;
      if (!targetIds.has(key.id)) continue;
      const following = list[index + 1];
      if (!curve) {
        key.easing = easing === 'bezier' ? 'linear' : easing;
        delete key.handleOut;
        if (following) delete following.handleIn;
        continue;
      }
      key.easing = 'bezier';
      if (!following) continue;
      const handles = segmentHandlesForCurve(curve, key, following);
      key.handleOut = handles.handleOut;
      following.handleIn = handles.handleIn;
    }
  }
  return next;
}
