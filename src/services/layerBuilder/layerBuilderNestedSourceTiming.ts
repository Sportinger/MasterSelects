import type { TimelineClip } from '../../types/timeline';
import { resolveClipSourceTime, videoFrameSourceTime } from '../timeline/retime/clipRetime';

export type NestedClipSourceTiming = {
  sourceTime: number;
  sourceRate: number;
  isHold: boolean;
};

export function getNestedClipSourceTiming(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
): NestedClipSourceTiming {
  const timing = resolveClipSourceTime(nestedClip, nestedClipLocalTime);
  return nestedClip.source?.type === 'video' || (nestedClip.isComposition && nestedClip.source?.type !== 'audio')
    ? { ...timing, sourceTime: videoFrameSourceTime(timing) } : timing;
}

export function getNestedClipSourceTime(nestedClip: TimelineClip, nestedClipLocalTime: number): number {
  return getNestedClipSourceTiming(nestedClip, nestedClipLocalTime).sourceTime;
}
