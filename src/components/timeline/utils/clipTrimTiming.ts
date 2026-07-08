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
  isInfiniteTimelineSourceType,
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
  clip: TimelineClip,
  edge: 'left' | 'right',
  orig: TrimOriginals,
  deltaTime: number,
): TrimTimingResult {
  const maxDuration = isInfiniteTimelineSourceType(clip.source?.type)
    ? Number.MAX_SAFE_INTEGER
    : (clip.source?.naturalDuration || orig.duration);

  let newStartTime = orig.startTime;
  let newInPoint = orig.inPoint;
  let newOutPoint = orig.outPoint;

  if (edge === 'left') {
    const maxTrim = orig.duration - MIN_CLIP_DURATION;
    const minTrim = isInfiniteTimelineSourceType(clip.source?.type)
      ? -orig.startTime
      : -orig.inPoint;
    const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
    newStartTime = orig.startTime + clampedDelta;
    newInPoint = orig.inPoint + clampedDelta;
  } else {
    const maxExtend = canLoopExtendTimelineVectorClip(clip)
      ? Number.MAX_SAFE_INTEGER
      : maxDuration - orig.outPoint;
    const minTrim = -(orig.duration - MIN_CLIP_DURATION);
    const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
    newOutPoint = orig.outPoint + clampedDelta;
  }

  const resultEdge: 'start' | 'end' = edge === 'left' ? 'start' : 'end';
  const targetTime = resultEdge === 'start'
    ? Math.max(0, newStartTime)
    : clip.startTime + (newOutPoint - clip.inPoint);

  return {
    edge: resultEdge,
    targetTime,
    newStartTime: Math.max(0, newStartTime),
    newInPoint,
    newOutPoint,
    newDuration: Math.max(MIN_CLIP_DURATION, newOutPoint - newInPoint),
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
