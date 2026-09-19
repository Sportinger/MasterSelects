import type { AnimatableProperty } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import { isFlockProperty } from '../../types/flock';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { readFlockParamForProperty } from './flockPropertyValues';
import { getFlockClipTimeMap, type SourceOffsetResolver } from './time/flockKeyframeTime';

/**
 * Current numeric value of a flock property at a clip-local playhead
 * position: the static node value when unkeyed, otherwise the source-time
 * interpolation of its keyframes.
 */
export function readAnimatedFlockParam(
  clip: TimelineClip,
  keyframes: readonly Keyframe[] | undefined,
  property: string,
  clipLocalTime: number,
  resolveSourceOffset?: SourceOffsetResolver,
): number | undefined {
  if (!clip.flock || !isFlockProperty(property)) return undefined;
  const base = readFlockParamForProperty(clip.flock, property);
  if (base === undefined) return undefined;
  const propertyKeyframes = keyframes?.filter((keyframe) => keyframe.property === property);
  if (!propertyKeyframes || propertyKeyframes.length === 0) return base;
  const sourceTime = getFlockClipTimeMap(clip, resolveSourceOffset).toSourceTime(clipLocalTime);
  return interpolateKeyframes(propertyKeyframes, property as AnimatableProperty, sourceTime, base);
}

export function hasFlockPropertyKeyframes(keyframes: readonly Keyframe[] | undefined, property: string): boolean {
  return !!keyframes?.some((keyframe) => keyframe.property === property);
}
