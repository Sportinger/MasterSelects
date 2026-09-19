import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { isFlockProperty } from '../../../types/flock';
import { createFlockClipTimeMap, type FlockClipTimeMap } from './flockTimeMapper';

/**
 * Scoped property-time policy: flock graph parameters keep their keyframe
 * times in simulation source seconds so split, trim, slip and retime preserve
 * the full parameter history. Every other property stays clip-local.
 */

export type KeyframeTimeBasis = 'clip-local' | 'source';

export type SourceOffsetResolver = (clipId: string, clipLocalTime: number) => number;

export function getKeyframeTimeBasis(property: string): KeyframeTimeBasis {
  return isFlockProperty(property) ? 'source' : 'clip-local';
}

export function isSourceTimeKeyframe(keyframe: Pick<Keyframe, 'property'>): boolean {
  return getKeyframeTimeBasis(keyframe.property) === 'source';
}

export function getFlockClipTimeMap(
  clip: Pick<TimelineClip, 'id' | 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>,
  resolveSourceOffset?: SourceOffsetResolver,
): FlockClipTimeMap {
  return createFlockClipTimeMap(
    clip,
    resolveSourceOffset ? (clipLocalTime) => resolveSourceOffset(clip.id, clipLocalTime) : undefined,
  );
}

/** Stored keyframe time for a property authored at a clip-local position. */
export function clipLocalToKeyframeTime(
  clip: Pick<TimelineClip, 'id' | 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>,
  property: string,
  clipLocalTime: number,
  resolveSourceOffset?: SourceOffsetResolver,
): number {
  if (getKeyframeTimeBasis(property) === 'clip-local') return clipLocalTime;
  return Math.max(0, getFlockClipTimeMap(clip, resolveSourceOffset).toSourceTime(clipLocalTime));
}

/** Clip-local display position of a stored keyframe; null when unmappable. */
export function keyframeTimeToClipLocal(
  clip: Pick<TimelineClip, 'id' | 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>,
  keyframe: Pick<Keyframe, 'property' | 'time'>,
  resolveSourceOffset?: SourceOffsetResolver,
): number | null {
  if (!isSourceTimeKeyframe(keyframe)) return keyframe.time;
  return getFlockClipTimeMap(clip, resolveSourceOffset).toClipLocalTime(keyframe.time);
}

/** Keyframes re-expressed in clip-local time for UI surfaces; unmappable keys are omitted. */
export function toClipLocalKeyframes(
  clip: Pick<TimelineClip, 'id' | 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>,
  keyframes: readonly Keyframe[],
  resolveSourceOffset?: SourceOffsetResolver,
): Keyframe[] {
  if (!keyframes.some(isSourceTimeKeyframe)) return keyframes as Keyframe[];
  const map = getFlockClipTimeMap(clip, resolveSourceOffset);
  const result: Keyframe[] = [];
  for (const keyframe of keyframes) {
    if (!isSourceTimeKeyframe(keyframe)) {
      result.push(keyframe);
      continue;
    }
    const local = map.toClipLocalTime(keyframe.time);
    if (local !== null) result.push({ ...keyframe, time: local });
  }
  return result.toSorted((a, b) => a.time - b.time);
}
