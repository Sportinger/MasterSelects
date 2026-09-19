function sanitizeTime(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface PlaybackRange {
  end: number;
  hasRange: boolean;
  start: number;
}

/** A collapsed in/out selection must not turn Play into an immediate stop. */
export function resolvePlaybackRange(
  inPoint: number | null,
  outPoint: number | null,
  duration: number,
): PlaybackRange {
  const safeDuration = Math.max(0, sanitizeTime(duration, 0));
  const selectedStart = Math.max(0, Math.min(inPoint ?? 0, safeDuration));
  const selectedEnd = Math.max(selectedStart, Math.min(outPoint ?? safeDuration, safeDuration));
  const hasRange = (inPoint !== null || outPoint !== null) && selectedEnd > selectedStart;

  return hasRange
    ? { start: selectedStart, end: selectedEnd, hasRange: true }
    : { start: 0, end: safeDuration, hasRange: false };
}

export function resolvePlaybackStartPosition(
  playheadPosition: number,
  inPoint: number | null,
  outPoint: number | null,
  duration: number,
  playbackSpeed: number,
): number {
  const range = resolvePlaybackRange(inPoint, outPoint, duration);
  const safeDuration = Math.max(0, sanitizeTime(duration, 0));
  const rangeStart = range.start;
  const rangeEnd = range.end;
  const clampedPlayhead = Math.max(0, Math.min(
    sanitizeTime(playheadPosition, rangeStart),
    safeDuration,
  ));

  if (!range.hasRange) {
    return clampedPlayhead;
  }

  if (playbackSpeed < 0) {
    return clampedPlayhead <= rangeStart || clampedPlayhead > rangeEnd
      ? rangeEnd
      : clampedPlayhead;
  }

  return clampedPlayhead < rangeStart || clampedPlayhead >= rangeEnd
    ? rangeStart
    : clampedPlayhead;
}

export function resolvePlaybackStopPosition(inPoint: number | null, duration: number): number {
  return resolvePlaybackRange(inPoint, null, duration).start;
}
