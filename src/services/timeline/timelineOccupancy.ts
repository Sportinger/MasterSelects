import { getTrackOverlapPolicy } from '../../stores/timeline/helpers/overlapPolicy';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';

const EPSILON = 1e-6;

interface ClipInterval {
  clip: TimelineClip;
  startSeconds: number;
  endSeconds: number;
}

interface TimeRange {
  startSeconds: number;
  endSeconds: number;
}

export interface TrackOccupancy {
  trackId: string;
  occupied: {
    startSeconds: number;
    endSeconds: number;
    spanSeconds: number;
  } | null;
  clipCount: number;
  gaps: Array<{ startSeconds: number; endSeconds: number }>;
  overlaps: Array<{ startSeconds: number; endSeconds: number }>;
}

export interface TimelineOccupancySnapshot {
  occupied: {
    startSeconds: number;
    endSeconds: number;
    spanSeconds: number;
  } | null;
  clipDurationSumSeconds: number;
  perTrack: TrackOccupancy[];
  gaps: Array<{ startSeconds: number; endSeconds: number }>;
  overlaps: Array<{ startSeconds: number; endSeconds: number }>;
  clipCount: number;
}

function sortIntervals(intervals: ClipInterval[]): ClipInterval[] {
  return intervals.toSorted((left, right) =>
    left.startSeconds - right.startSeconds
    || left.endSeconds - right.endSeconds
    || left.clip.id.localeCompare(right.clip.id));
}

function computeGaps(intervals: ClipInterval[]): TimeRange[] {
  if (intervals.length < 2) return [];

  const sorted = sortIntervals(intervals);
  const gaps: TimeRange[] = [];
  let previousEnd = sorted[0].endSeconds;

  for (const interval of sorted.slice(1)) {
    if (interval.startSeconds > previousEnd + EPSILON) {
      gaps.push({
        startSeconds: previousEnd,
        endSeconds: interval.startSeconds,
      });
    }
    previousEnd = Math.max(previousEnd, interval.endSeconds);
  }

  return gaps;
}

function computeOverlaps(intervals: ClipInterval[]): TimeRange[] {
  if (intervals.length < 2) return [];

  const sorted = sortIntervals(intervals);
  const overlaps: TimeRange[] = [];
  let previousEnd = sorted[0].endSeconds;

  for (const interval of sorted.slice(1)) {
    if (interval.startSeconds < previousEnd - EPSILON) {
      const overlapEnd = Math.min(previousEnd, interval.endSeconds);
      if (overlapEnd > interval.startSeconds + EPSILON) {
        overlaps.push({
          startSeconds: interval.startSeconds,
          endSeconds: overlapEnd,
        });
      }
    }
    previousEnd = Math.max(previousEnd, interval.endSeconds);
  }

  return overlaps;
}

function unionRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];

  const sorted = ranges.toSorted((left, right) =>
    left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
  const union: TimeRange[] = [{ ...sorted[0] }];

  for (const range of sorted.slice(1)) {
    const previous = union[union.length - 1];
    if (range.startSeconds <= previous.endSeconds + EPSILON) {
      previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds);
    } else {
      union.push({ ...range });
    }
  }

  return union;
}

function computeTrackOccupancy(
  trackId: string,
  intervals: ClipInterval[],
  track: TimelineTrack | undefined,
): TrackOccupancy {
  if (intervals.length === 0) {
    return {
      trackId,
      occupied: null,
      clipCount: 0,
      gaps: [],
      overlaps: [],
    };
  }

  const sorted = sortIntervals(intervals);
  const startSeconds = sorted[0].startSeconds;
  const endSeconds = sorted.reduce(
    (latestEnd, interval) => Math.max(latestEnd, interval.endSeconds),
    sorted[0].endSeconds,
  );

  return {
    trackId,
    occupied: {
      startSeconds,
      endSeconds,
      spanSeconds: endSeconds - startSeconds,
    },
    clipCount: sorted.length,
    gaps: computeGaps(sorted),
    overlaps: getTrackOverlapPolicy(track) === 'stack' ? [] : computeOverlaps(sorted),
  };
}

/**
 * Canonical timeline occupancy and state-semantics computation for agent-kernel
 * WP2. The occupied span measures the outer timeline bounds, while
 * clipDurationSumSeconds adds every positive clip duration; overlaps and gaps
 * mean these are intentionally different numbers. All interval comparisons use
 * a tolerance of 1e-6 seconds.
 */
export function computeTimelineOccupancy(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): TimelineOccupancySnapshot {
  const intervals = clips
    .filter((clip) => clip.duration > 0)
    .map((clip) => ({
      clip,
      startSeconds: clip.startTime,
      endSeconds: clip.startTime + clip.duration,
    }));
  const knownTrackIds = new Set(tracks.map((track) => track.id));
  const intervalsByTrack = new Map<string, ClipInterval[]>();
  const unassignedIntervals: ClipInterval[] = [];

  for (const interval of intervals) {
    if (!knownTrackIds.has(interval.clip.trackId)) {
      unassignedIntervals.push(interval);
      continue;
    }
    const trackIntervals = intervalsByTrack.get(interval.clip.trackId) ?? [];
    trackIntervals.push(interval);
    intervalsByTrack.set(interval.clip.trackId, trackIntervals);
  }

  const perTrack = tracks.map((track) =>
    computeTrackOccupancy(track.id, intervalsByTrack.get(track.id) ?? [], track));
  if (unassignedIntervals.length > 0) {
    perTrack.push(computeTrackOccupancy('unassigned', unassignedIntervals, undefined));
  }

  if (intervals.length === 0) {
    return {
      occupied: null,
      clipDurationSumSeconds: 0,
      perTrack,
      gaps: [],
      overlaps: [],
      clipCount: 0,
    };
  }

  const sorted = sortIntervals(intervals);
  const startSeconds = sorted[0].startSeconds;
  const endSeconds = sorted.reduce(
    (latestEnd, interval) => Math.max(latestEnd, interval.endSeconds),
    sorted[0].endSeconds,
  );

  return {
    occupied: {
      startSeconds,
      endSeconds,
      spanSeconds: endSeconds - startSeconds,
    },
    clipDurationSumSeconds: intervals.reduce(
      (durationSum, interval) => durationSum + interval.clip.duration,
      0,
    ),
    perTrack,
    gaps: computeGaps(sorted),
    overlaps: unionRanges(perTrack.flatMap((track) => track.overlaps)),
    clipCount: intervals.length,
  };
}

