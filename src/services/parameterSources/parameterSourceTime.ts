import type { Keyframe } from '../../types/keyframes';
import type { ParameterSourceClip } from './parameterSourceTargets';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';

/** A generated transition clip retains the authored owner's clock, not media/retime time. */
export function parameterSourceTime(clip: ParameterSourceClip, keys: readonly Keyframe[], localTime: number, timelineTime = clip.startTime + localTime) {
  const map = clip.transitionSourceMap;
  if (map?.version !== 2) return { localTime, timelineTime, keys };
  const mapped = resolveTransitionSourceMapTime(map, localTime)?.animationTime;
  if (mapped === undefined) return { localTime, timelineTime, keys };
  return { localTime: mapped, timelineTime: (map.parent.animation.parameterTimelineStart ?? clip.startTime) + mapped,
    keys: map.parent.animation.keyframes };
}
