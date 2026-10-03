import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { getClipEdgeSourceRate, isClipSourceReversed, trimClipSourceEdge } from '../../../services/timeline/retime/clipEdgeRetime';
// Shared clip edge-trim timing math (issue #249).
//
// Extracted from useClipTrim so both the main-timeline trim handles and the
// piano-roll MIDI clip-resize handles compute identical timing — same
// infinite-source left clamp (`-startTime`), same MIN_CLIP_DURATION floor, same
// loop-extend handling — instead of each re-deriving (and drifting from) it.

// Import from the specific module, not the broad `../../../types` barrel, to
// keep the foundation type-barrel fan-in flat (foundationTypeBoundary guard).
import type { TimelineClip } from '../../../types/timeline';
import {
  canLoopExtendTimelineVectorClip,
  isInfiniteTimelineClipSource,
} from './clipSourceTiming';
import { MIN_CLIP_DURATION } from '../timelineRenderConstants';

export interface TrimOriginals {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

export interface TrimTimingResult {
  edge: 'start' | 'end';
  targetTime: number;
  newStartTime: number;
  newInPoint: number;
  newOutPoint: number;
  newDuration: number;
}

// Clamp a trim delta to a clip's own bounds and return the resulting timing.
// Works for any clip from its current state, so multi-select followers each clamp
// independently ("only as much as each clip can").
export function computeTrimTiming(
  clip: import('../../../utils/clipSourceTiming').TimelineClipSourceTimingLike &
    Partial<Pick<TimelineClip, 'timeRemap' | 'speed' | 'reversed' | 'effects' | 'videoInspectorSections'>>,
  edge: 'left' | 'right',
  orig: TrimOriginals,
  deltaTime: number,
): TrimTimingResult {
  if (clip.timeRemap?.kind === 'freeze' || clip.timeRemap?.kind === 'loop' || clip.timeRemap?.kind === 'warp') {
    const minimum = 1 / getActiveCompositionFrameRate();
    const delta = edge === 'left'
      ? Math.max(-orig.startTime, Math.min(orig.duration - minimum, deltaTime))
      : Math.max(minimum - orig.duration, deltaTime);
    const newStartTime = orig.startTime + (edge === 'left' ? delta : 0);
    const newDuration = orig.duration + (edge === 'left' ? -delta : delta);
    return { edge: edge === 'left' ? 'start' : 'end', newStartTime, newDuration,
      newInPoint: orig.inPoint, newOutPoint: orig.outPoint,
      targetTime: edge === 'left' ? newStartTime : newStartTime + newDuration };
  }
  const originalWindow = {
    duration: orig.duration,
    inPoint: orig.inPoint,
    outPoint: orig.outPoint,
    speed: clip.speed,
    reversed: clip.reversed,
    effects: clip.effects,
    videoInspectorSections: clip.videoInspectorSections,
  };
  const sourceRate = Math.max(0.0001, getClipEdgeSourceRate(originalWindow));
  const reverse = isClipSourceReversed(originalWindow);
  const maxDuration = isInfiniteTimelineClipSource(clip)
    ? Number.MAX_SAFE_INTEGER
    : (clip.source?.naturalDuration || Math.max(orig.outPoint, orig.inPoint));

  let newStartTime = orig.startTime;
  let newInPoint = orig.inPoint;
  let newOutPoint = orig.outPoint;
  let appliedTimelineDelta = deltaTime;

  if (edge === 'left') {
    const maxTrim = orig.duration - MIN_CLIP_DURATION;
    const minTrim = isInfiniteTimelineClipSource(clip)
      ? -orig.startTime
      : Math.max(-orig.startTime, -(reverse ? maxDuration - orig.outPoint : orig.inPoint) / sourceRate);
    const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
    appliedTimelineDelta = clampedDelta;
    newStartTime = orig.startTime + clampedDelta;
    const window = trimClipSourceEdge(originalWindow, 'start', clampedDelta);
    newInPoint = window.inPoint ?? orig.inPoint;
    newOutPoint = window.outPoint ?? orig.outPoint;
  } else {
    const maxExtend = canLoopExtendTimelineVectorClip(clip)
      ? Number.MAX_SAFE_INTEGER
      : (reverse ? orig.inPoint : maxDuration - orig.outPoint) / sourceRate;
    const minTrim = -(orig.duration - MIN_CLIP_DURATION);
    const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
    appliedTimelineDelta = clampedDelta;
    const window = trimClipSourceEdge(originalWindow, 'end', clampedDelta);
    newInPoint = window.inPoint ?? orig.inPoint;
    newOutPoint = window.outPoint ?? orig.outPoint;
  }

  const resultEdge: 'start' | 'end' = edge === 'left' ? 'start' : 'end';
  const newDuration = Math.max(
    MIN_CLIP_DURATION,
    edge === 'left'
      ? orig.duration - appliedTimelineDelta
      : orig.duration + appliedTimelineDelta,
  );
  const targetTime = resultEdge === 'start'
    ? Math.max(0, newStartTime)
    : orig.startTime + newDuration;

  return {
    edge: resultEdge,
    targetTime,
    newStartTime: Math.max(0, newStartTime),
    newInPoint,
    newOutPoint,
    newDuration,
  };
}

export function trimOriginalsFromClip(clip: TimelineClip): TrimOriginals {
  return {
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
  };
}

/** Selection/edge trim stops at the next occupied interval, never at its own
 * retained source window. Ripple/overwrite callers intentionally skip this cap.
 */
export function clampTrimExtensionToNextClip(
  clip: Pick<TimelineClip, 'id' | 'trackId' | 'startTime' | 'duration'>,
  clips: Iterable<Pick<TimelineClip, 'id' | 'trackId' | 'startTime'>>,
  delta: number,
): number {
  if (delta <= 0) return delta;
  const originalEnd = clip.startTime + clip.duration;
  let result = delta;
  for (const candidate of clips) {
    if (candidate.id !== clip.id && candidate.trackId === clip.trackId && candidate.startTime >= originalEnd - 1e-4) {
      result = Math.min(result, Math.max(0, candidate.startTime - originalEnd));
    }
  }
  return result;
}
