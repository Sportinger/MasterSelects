import type { TimelineClip } from '../../../stores/timeline/types';
import { resolveTransitionSourceMapTime } from '../../../services/timeline/transitionSourceMap';
import type { FrameContextLike } from './contracts';

export function getMappedClipSourceTime(
  clip: TimelineClip,
  clipLocalTime: number,
): number | undefined {
  return resolveTransitionSourceMapTime(clip.transitionSourceMap, clipLocalTime)?.sourceTime;
}

export function getClipSourceWindowTime(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx: FrameContextLike,
): number {
  const mappedSourceTime = getMappedClipSourceTime(clip, clipLocalTime);
  if (mappedSourceTime !== undefined) {
    return mappedSourceTime;
  }

  if (Number.isFinite(clip.transitionSourceTimeOverride)) {
    return clip.transitionSourceTimeOverride!;
  }

  const sourceTime = ctx.getSourceTimeForClip(clip.id, clipLocalTime);
  const initialSpeed = ctx.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}
