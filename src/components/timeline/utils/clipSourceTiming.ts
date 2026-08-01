import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
  type VectorAnimationClipSettings,
} from '../../../types/vectorAnimation';

const MIN_SOURCE_DURATION = 0.04;

export interface TimelineClipSourceTimingLike {
  duration: number;
  inPoint?: number;
  outPoint?: number;
  source?: {
    type?: string | null;
    naturalDuration?: number;
    vectorAnimationSettings?: VectorAnimationClipSettings;
  } | null;
}

export function isInfiniteTimelineSourceType(sourceType: string | null | undefined): boolean {
  return sourceType === 'text' ||
    sourceType === 'image' ||
    sourceType === 'solid' ||
    sourceType === 'camera' ||
    sourceType === 'light' ||
    sourceType === 'splat-effector' ||
    sourceType === 'math-scene' ||
    sourceType === 'transition-overlay' ||
    sourceType === 'storyboard' ||
    sourceType === 'midi' ||
    // Motion clips are procedural: there is no recorded source to run out of,
    // so both edges may extend freely (their naturalDuration is only the
    // creation-time default).
    sourceType === 'motion-shape' ||
    sourceType === 'motion-null' ||
    sourceType === 'motion-adjustment';
}

export function canLoopExtendTimelineVectorClip(clip: Pick<TimelineClipSourceTimingLike, 'source'>): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source?.vectorAnimationSettings);
}

export function getTimelineClipSourceDuration(clip: TimelineClipSourceTimingLike): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }

  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? 0;
  return Math.max(outPoint, inPoint + clip.duration, clip.duration, MIN_SOURCE_DURATION);
}
