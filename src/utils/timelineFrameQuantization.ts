import type { TimelineSourceType } from '../types/timelineSource';
import { getClipSourceRate } from './clipPlaybackTiming';
import { canLoopExtendTimelineVectorClip, isInfiniteTimelineClipSource } from './clipSourceTiming';
import type { VectorAnimationClipSettings } from '../types/vectorAnimation';

export const DEFAULT_TIMELINE_FRAME_RATE = 30;

const FRAME_EPSILON = 0.000001;

interface FrameTimedClip {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed?: number;
  linkedClipId?: string;
  naturalDuration?: number;
  sourceType?: TimelineSourceType;
  modelSequence?: object | null;
  gaussianSplatSequence?: object | null;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  source?: {
    type?: TimelineSourceType;
    naturalDuration?: number;
    vectorAnimationSettings?: VectorAnimationClipSettings;
    modelSequence?: object | null;
    gaussianSplatSequence?: object | null;
  } | null;
}

export function sanitizeTimelineFrameRate(frameRate: number | null | undefined): number {
  return Number.isFinite(frameRate) && (frameRate ?? 0) > 0
    ? frameRate!
    : DEFAULT_TIMELINE_FRAME_RATE;
}

export function quantizeTimeToFrame(
  time: number,
  frameRate: number | null | undefined,
): number {
  if (!Number.isFinite(time)) return time;
  const fps = sanitizeTimelineFrameRate(frameRate);
  return Math.round(time * fps) / fps;
}

export function isFrameLockedClip(clip: Pick<
  FrameTimedClip,
  'linkedClipId' | 'source' | 'sourceType'
>): boolean {
  if (clip.linkedClipId) return true;
  const sourceType = clip.source?.type ?? clip.sourceType;
  return sourceType !== 'audio' && sourceType !== 'midi';
}

export function quantizeClipStartTime(
  clip: Pick<FrameTimedClip, 'linkedClipId' | 'source' | 'sourceType'>,
  startTime: number,
  frameRate: number | null | undefined,
): number {
  const clamped = Math.max(0, startTime);
  return isFrameLockedClip(clip) ? quantizeTimeToFrame(clamped, frameRate) : clamped;
}

/**
 * Migrates a persisted clip onto the composition frame grid. The source in
 * point and effective playback rate are preserved; only the source out point
 * is nudged to match the quantized timeline duration.
 */
export function quantizeFrameLockedClipTiming<T extends FrameTimedClip>(
  clip: T,
  frameRate: number | null | undefined,
): T {
  if (!isFrameLockedClip(clip) || !Number.isFinite(clip.duration) || clip.duration <= 0) {
    return clip;
  }

  const fps = sanitizeTimelineFrameRate(frameRate);
  const frameDuration = 1 / fps;
  const startTime = quantizeClipStartTime(clip, clip.startTime, fps);
  let duration = Math.max(frameDuration, quantizeTimeToFrame(clip.duration, fps));
  const sourceRate = getClipSourceRate(clip);
  const naturalDuration = clip.source?.naturalDuration ?? clip.naturalDuration;

  const canExtendSource = isInfiniteTimelineClipSource(clip)
    || canLoopExtendTimelineVectorClip(clip);
  if (!canExtendSource && Number.isFinite(naturalDuration) && naturalDuration !== undefined) {
    const availableTimelineDuration = Math.max(0, (naturalDuration - clip.inPoint) / sourceRate);
    const availableFrameDuration = Math.floor((availableTimelineDuration + FRAME_EPSILON) * fps) / fps;
    if (availableFrameDuration >= frameDuration) {
      duration = Math.min(duration, availableFrameDuration);
    }
  }

  const outPoint = clip.inPoint + duration * sourceRate;
  if (
    Math.abs(startTime - clip.startTime) <= FRAME_EPSILON &&
    Math.abs(duration - clip.duration) <= FRAME_EPSILON &&
    Math.abs(outPoint - clip.outPoint) <= FRAME_EPSILON
  ) {
    return clip;
  }

  return {
    ...clip,
    startTime,
    duration,
    outPoint,
  };
}

export function quantizeFrameLockedClipTimings<T extends FrameTimedClip>(
  clips: readonly T[],
  frameRate: number | null | undefined,
): T[] {
  return clips.map((clip) => quantizeFrameLockedClipTiming(clip, frameRate));
}

export function isTimeOnFrameGrid(
  time: number,
  frameRate: number | null | undefined,
): boolean {
  const fps = sanitizeTimelineFrameRate(frameRate);
  return Number.isFinite(time) && Math.abs(time * fps - Math.round(time * fps)) <= FRAME_EPSILON;
}
