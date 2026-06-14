import type { TimelineClip } from '../../../stores/timeline/types';
import type { FrameContextLike } from './contracts';

export function getClipSourceWindowTime(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx: FrameContextLike,
): number {
  if (Number.isFinite(clip.transitionSourceTimeOverride)) {
    return clip.transitionSourceTimeOverride!;
  }

  const sourceTime = ctx.getSourceTimeForClip(clip.id, clipLocalTime);
  const initialSpeed = ctx.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}
