function sanitizeTime(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolvePlaybackStartPosition(
  playheadPosition: number,
  inPoint: number | null,
  outPoint: number | null,
  duration: number,
  playbackSpeed: number,
): number {
  const safeDuration = Math.max(0, sanitizeTime(duration, 0));
  const rangeStart = Math.max(0, Math.min(inPoint ?? 0, safeDuration));
  const rangeEnd = Math.max(rangeStart, Math.min(outPoint ?? safeDuration, safeDuration));
  const clampedPlayhead = Math.max(0, Math.min(
    sanitizeTime(playheadPosition, rangeStart),
    safeDuration,
  ));
  const hasRange = inPoint !== null || outPoint !== null;

  if (!hasRange) {
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
