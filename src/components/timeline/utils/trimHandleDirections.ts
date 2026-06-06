import type { TimelineClip } from '../../../types';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
  isInfiniteTimelineSourceType,
} from './clipSourceTiming';

const MIN_CLIP_DURATION = 0.1;
const EPSILON = 0.001;

export type TrimHandleEdge = 'left' | 'right';
export type TrimHandleArrowDirection = 'left' | 'right';
type TrimHandleClip = Pick<
  TimelineClip,
  'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'source'
>;

export function getTrimHandleArrowDirections(
  clip: TrimHandleClip,
  edge: TrimHandleEdge,
): TrimHandleArrowDirection[] {
  const canShorten = clip.duration > MIN_CLIP_DURATION + EPSILON;

  if (edge === 'left') {
    const canExtendLeft = isInfiniteTimelineSourceType(clip.source?.type)
      ? clip.startTime > EPSILON
      : clip.startTime > EPSILON && clip.inPoint > EPSILON;

    return [
      ...(canExtendLeft ? ['left' as const] : []),
      ...(canShorten ? ['right' as const] : []),
    ];
  }

  const sourceDuration = getTimelineClipSourceDuration(clip);
  const canExtendRight =
    isInfiniteTimelineSourceType(clip.source?.type) ||
    canLoopExtendTimelineVectorClip(clip) ||
    sourceDuration - clip.outPoint > EPSILON;

  return [
    ...(canShorten ? ['left' as const] : []),
    ...(canExtendRight ? ['right' as const] : []),
  ];
}
