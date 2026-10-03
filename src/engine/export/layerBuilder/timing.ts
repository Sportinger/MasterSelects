import { createStoreSpeedSource, resolveClipSourceTime, videoFrameSourceTime } from '../../../services/timeline/retime/clipRetime';
import type { TimelineClip } from '../../../stores/timeline/types';
import { resolveTransitionSourceMapTime } from '../../../services/timeline/transitionSourceMap';
import type { FrameContextLike } from './contracts';

export function getMappedClipSourceTime(
  clip: TimelineClip,
  clipLocalTime: number,
): number | undefined {
  const sample = resolveTransitionSourceMapTime(clip.transitionSourceMap, clipLocalTime);
  return sample ? videoFrameSourceTime(sample) : undefined;
}

export function getClipSourceWindowTime(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx: FrameContextLike,
): number {
  const sample = resolveClipSourceTime(clip, clipLocalTime, createStoreSpeedSource(clip.id, ctx));
  return clip.source?.type === 'video' || (clip.isComposition && clip.source?.type !== 'audio')
    ? videoFrameSourceTime(sample) : sample.sourceTime;
}
