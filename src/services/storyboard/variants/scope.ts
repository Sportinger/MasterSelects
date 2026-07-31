import type { TimelineVariantScope } from '../contracts';

function finiteTime(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

export function normalizeTimelineVariantScope(
  input: TimelineVariantScope,
): TimelineVariantScope {
  const startTime = finiteTime(input.startTime, 'startTime');
  const endTime = finiteTime(input.endTime, 'endTime');
  if (endTime <= startTime) {
    throw new Error('endTime must be greater than startTime.');
  }
  if (typeof input.includeLinked !== 'boolean') {
    throw new Error('includeLinked must be a boolean.');
  }
  const trackIds = [...new Set(input.trackIds.map((trackId) => trackId.trim()))]
    .filter(Boolean)
    .sort();
  if (trackIds.length === 0) {
    throw new Error('Variant scope requires at least one track.');
  }
  return {
    startTime,
    endTime,
    trackIds,
    includeLinked: input.includeLinked,
  };
}

export function variantScopesEqual(
  left: TimelineVariantScope,
  right: TimelineVariantScope,
): boolean {
  const normalizedLeft = normalizeTimelineVariantScope(left);
  const normalizedRight = normalizeTimelineVariantScope(right);
  return normalizedLeft.startTime === normalizedRight.startTime
    && normalizedLeft.endTime === normalizedRight.endTime
    && normalizedLeft.includeLinked === normalizedRight.includeLinked
    && normalizedLeft.trackIds.length === normalizedRight.trackIds.length
    && normalizedLeft.trackIds.every((trackId, index) => (
      trackId === normalizedRight.trackIds[index]
    ));
}
