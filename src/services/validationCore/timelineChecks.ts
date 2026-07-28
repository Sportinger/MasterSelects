import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { computeTimelineOccupancy } from '../timeline/timelineOccupancy';

const TIMELINE_COMPARISON_TOLERANCE_SECONDS = 0.01;
const SOURCE_ORDER_EPSILON_SECONDS = 1e-6;

export type TimelineObjectKind = 'clip' | 'clips' | 'track' | 'tracks';

export interface TimelineValidationState {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
}

export type TimelineValidationCheckId =
  | 'objectCount'
  | 'noGaps'
  | 'noOverlaps'
  | 'sourceOrderMonotonic'
  | 'avLinkAlignment'
  | 'occupiedEnd';

export interface TimelineValidationResult {
  check: TimelineValidationCheckId;
  passed: boolean;
  expected?: boolean | number;
  actual?: boolean | number;
}

export function isWithinValidationTolerance(
  actual: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

export function checkObjectCount(
  state: TimelineValidationState,
  kind: TimelineObjectKind,
  expected: number,
): TimelineValidationResult {
  const actual = kind === 'clip' || kind === 'clips'
    ? state.clips.length
    : state.tracks.length;

  return {
    check: 'objectCount',
    passed: actual === expected,
    expected,
    actual,
  };
}

export function checkNoGaps(
  state: TimelineValidationState,
): TimelineValidationResult {
  const actual = computeTimelineOccupancy(state.clips, state.tracks).gaps.length;

  return {
    check: 'noGaps',
    passed: actual === 0,
    expected: 0,
    actual,
  };
}

export function checkNoOverlaps(
  state: TimelineValidationState,
): TimelineValidationResult {
  const actual = computeTimelineOccupancy(state.clips, state.tracks).overlaps.length;

  return {
    check: 'noOverlaps',
    passed: actual === 0,
    expected: 0,
    actual,
  };
}

export function checkSourceOrderMonotonic(
  state: TimelineValidationState,
  trackId?: string,
): TimelineValidationResult {
  const trackIds = trackId
    ? [trackId]
    : [...new Set(state.clips.map((clip) => clip.trackId))];
  const passed = trackIds.every((candidateTrackId) => {
    const clips = state.clips
      .filter((clip) => clip.trackId === candidateTrackId)
      .toSorted((left, right) =>
        left.startTime - right.startTime
        || left.inPoint - right.inPoint
        || left.id.localeCompare(right.id));

    return clips.every((clip, index) => (
      index === 0
      || clip.inPoint + SOURCE_ORDER_EPSILON_SECONDS >= clips[index - 1].inPoint
    ));
  });

  return {
    check: 'sourceOrderMonotonic',
    passed,
    expected: true,
    actual: passed,
  };
}

export function checkAvLinkAlignment(
  state: TimelineValidationState,
): TimelineValidationResult {
  const clipsById = new Map(state.clips.map((clip) => [clip.id, clip]));
  const visitedPairs = new Set<string>();
  let passed = true;

  for (const clip of state.clips) {
    if (!clip.linkedClipId) continue;

    const linkedClip = clipsById.get(clip.linkedClipId);
    if (!linkedClip) {
      passed = false;
      continue;
    }

    const pairId = [clip.id, linkedClip.id].toSorted().join('\u0000');
    if (visitedPairs.has(pairId)) continue;
    visitedPairs.add(pairId);

    const clipEnd = clip.startTime + clip.duration;
    const linkedClipEnd = linkedClip.startTime + linkedClip.duration;
    if (
      !isWithinValidationTolerance(
        clip.startTime,
        linkedClip.startTime,
        TIMELINE_COMPARISON_TOLERANCE_SECONDS,
      )
      || !isWithinValidationTolerance(
        clipEnd,
        linkedClipEnd,
        TIMELINE_COMPARISON_TOLERANCE_SECONDS,
      )
    ) {
      passed = false;
    }
  }

  return {
    check: 'avLinkAlignment',
    passed,
    expected: true,
    actual: passed,
  };
}

export function checkOccupiedEnd(
  state: TimelineValidationState,
  expected: number,
  tolerance = TIMELINE_COMPARISON_TOLERANCE_SECONDS,
): TimelineValidationResult {
  const actual = computeTimelineOccupancy(state.clips, state.tracks).occupied?.endSeconds ?? 0;

  return {
    check: 'occupiedEnd',
    passed: isWithinValidationTolerance(actual, expected, tolerance),
    expected,
    actual,
  };
}
