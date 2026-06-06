import type { TimelineClip } from '../../../types';
import { isVectorAnimationSourceType, shouldLoopVectorAnimation } from '../../../types/vectorAnimation';
import { isInfiniteTrimSource } from './infiniteTrimSource';

const MIN_CLIP_DURATION = 0.1;
const EPSILON = 0.001;

export type TrimHandleEdge = 'left' | 'right';
export type TrimHandleArrowDirection = 'left' | 'right';

function canLoopExtendVectorClip(clip: TimelineClip): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
}

function getClipSourceDuration(clip: TimelineClip): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, MIN_CLIP_DURATION);
}

export function getTrimHandleArrowDirections(
  clip: TimelineClip,
  edge: TrimHandleEdge,
): TrimHandleArrowDirection[] {
  const canShorten = clip.duration > MIN_CLIP_DURATION + EPSILON;

  if (edge === 'left') {
    const canExtendLeft = isInfiniteTrimSource(clip)
      ? clip.startTime > EPSILON
      : clip.startTime > EPSILON && clip.inPoint > EPSILON;

    return [
      ...(canExtendLeft ? ['left' as const] : []),
      ...(canShorten ? ['right' as const] : []),
    ];
  }

  const sourceDuration = getClipSourceDuration(clip);
  const canExtendRight =
    isInfiniteTrimSource(clip) ||
    canLoopExtendVectorClip(clip) ||
    sourceDuration - clip.outPoint > EPSILON;

  return [
    ...(canShorten ? ['left' as const] : []),
    ...(canExtendRight ? ['right' as const] : []),
  ];
}
