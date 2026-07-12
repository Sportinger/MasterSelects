import type { TimelineClip } from '../../types/timeline';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';

export type NestedClipSourceTiming = {
  sourceTime: number;
  sourceRate: number;
  isHold: boolean;
};

export function getNestedClipSourceTiming(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
): NestedClipSourceTiming {
  const mappedTime = resolveTransitionSourceMapTime(
    nestedClip.transitionSourceMap,
    nestedClipLocalTime,
  );
  if (mappedTime) {
    return {
      sourceTime: mappedTime.sourceTime,
      sourceRate: mappedTime.sourceRate,
      isHold: mappedTime.isHold || mappedTime.sourceRate === 0,
    };
  }
  const inPoint = nestedClip.inPoint ?? 0;
  const outPoint = nestedClip.outPoint ?? nestedClip.duration;
  const sourceOverride = nestedClip.transitionSourceTimeOverride;
  const isHold = nestedClip.transitionSourceHold === true;
  const sourceRate = isHold ? 0 : nestedClip.speed ?? (nestedClip.reversed ? -1 : 1);
  return {
    sourceTime: Number.isFinite(sourceOverride)
      ? sourceOverride!
      : isHold
        ? inPoint
        : nestedClip.reversed
          ? outPoint - nestedClipLocalTime
          : nestedClipLocalTime + inPoint,
    sourceRate,
    isHold,
  };
}

export function getNestedClipSourceTime(nestedClip: TimelineClip, nestedClipLocalTime: number): number {
  return getNestedClipSourceTiming(nestedClip, nestedClipLocalTime).sourceTime;
}
