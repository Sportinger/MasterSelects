/**
 * FAST export neighbour window (x frame tolerance): the per-frame layer lookup, the
 * prefetch wait and the first-frame check all accept a counted neighbour within it.
 */
export const FAST_EXPORT_NEIGHBOUR_TOLERANCE_MULTIPLIER = 3;

export interface ParallelDecodeFrameLookupOptions {
  /** Widens the neighbour-frame window (only used with allowNeighbourFallback). */
  toleranceMultiplier?: number;
  /**
   * When the frame shown at the requested time is not buffered, return the nearest
   * buffered frame within the tolerance instead of null. Every such substitution is
   * reported through onNeighbourFallback (export diagnostics count it as a
   * previous-frame fallback); without this flag the lookup is exact.
   */
  allowNeighbourFallback?: boolean;
  /**
   * Availability check only (export start verification): a neighbour substitution
   * is neither logged nor reported here, because the render lookup that actually
   * uses the frame reports it. Counting it twice would inflate the diagnostics.
   */
  probeOnly?: boolean;
}

/** A buffered neighbour stood in for the frame that should show at the target. */
export interface ParallelDecodeNeighbourFallback {
  clipId: string;
  clipName: string;
  sourceTime: number;
  expectedFrameTime: number | null;
  usedFrameTime: number;
}

export type ParallelDecodeFrameLookupResult =
  | { kind: 'empty' }
  | { kind: 'before-oldest'; timestamp: number }
  | { kind: 'after-newest'; timestamp: number }
  | { kind: 'candidate'; timestamp: number; diff: number };

export function getFrameLookupResult(params: {
  timestamps: readonly number[];
  oldestTimestamp: number;
  newestTimestamp: number;
  targetTimestamp: number;
  tolerance: number;
}): ParallelDecodeFrameLookupResult {
  const { timestamps, oldestTimestamp, newestTimestamp, targetTimestamp, tolerance } = params;

  if (timestamps.length === 0) {
    return { kind: 'empty' };
  }

  if (targetTimestamp > newestTimestamp + tolerance) {
    return { kind: 'after-newest', timestamp: timestamps[timestamps.length - 1] };
  }

  if (targetTimestamp < oldestTimestamp - tolerance) {
    return { kind: 'before-oldest', timestamp: timestamps[0] };
  }

  let left = 0;
  let right = timestamps.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (timestamps[mid] < targetTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  let closestIdx = left;
  if (left > 0) {
    const diffLeft = Math.abs(timestamps[left] - targetTimestamp);
    const diffPrev = Math.abs(timestamps[left - 1] - targetTimestamp);
    if (diffPrev < diffLeft) {
      closestIdx = left - 1;
    }
  }

  const timestamp = timestamps[closestIdx];
  return { kind: 'candidate', timestamp, diff: Math.abs(timestamp - targetTimestamp) };
}
