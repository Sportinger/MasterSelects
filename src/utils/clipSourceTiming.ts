import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
  type VectorAnimationClipSettings,
} from '../types/vectorAnimation';

const MIN_SOURCE_DURATION = 0.04;

export interface TimelineClipSourceTimingLike {
  duration: number;
  inPoint?: number;
  outPoint?: number;
  sourceType?: string | null;
  modelSequence?: object | null;
  gaussianSplatSequence?: object | null;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  source?: {
    type?: string | null;
    naturalDuration?: number;
    modelSequence?: object | null;
    gaussianSplatSequence?: object | null;
    vectorAnimationSettings?: VectorAnimationClipSettings;
  } | null;
}

export function isInfiniteTimelineSourceType(sourceType: string | null | undefined): boolean {
  return sourceType === 'text' ||
    sourceType === 'image' ||
    sourceType === 'solid' ||
    sourceType === 'camera' ||
    sourceType === 'light' ||
    sourceType === 'gaussian-avatar' ||
    sourceType === 'splat-effector' ||
    sourceType === 'math-scene' ||
    sourceType === 'transition-overlay' ||
    sourceType === 'storyboard' ||
    sourceType === 'midi' ||
    // Flock clips simulate in source time; extending continues the simulation.
    sourceType === 'flock' ||
    // Motion clips are procedural: there is no recorded source to run out of,
    // so both edges may extend freely (their naturalDuration is only the
    // creation-time default).
    sourceType === 'motion-shape' ||
    sourceType === 'motion-null' ||
    sourceType === 'motion-adjustment';
}

type ClipSourceTiming = Pick<TimelineClipSourceTimingLike,
  'source' | 'sourceType' | 'modelSequence' | 'gaussianSplatSequence' | 'vectorAnimationSettings'>;

/** Static 3D assets have no source end; recorded frame sequences still do. */
export function isInfiniteTimelineClipSource(clip: ClipSourceTiming): boolean {
  const type = clip.source?.type ?? clip.sourceType;
  return isInfiniteTimelineSourceType(type)
    || (type === 'model' && !(clip.source?.modelSequence ?? clip.modelSequence))
    || (type === 'gaussian-splat' && !(clip.source?.gaussianSplatSequence ?? clip.gaussianSplatSequence));
}

export function canLoopExtendTimelineVectorClip(clip: ClipSourceTiming): boolean {
  return isVectorAnimationSourceType(clip.source?.type ?? clip.sourceType) &&
    shouldLoopVectorAnimation(clip.source?.vectorAnimationSettings ?? clip.vectorAnimationSettings);
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
