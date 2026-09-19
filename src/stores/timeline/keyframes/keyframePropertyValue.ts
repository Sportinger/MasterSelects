export function normalizeTimelinePropertyValue(property: string, value: number): number {
  if (property === 'opacity') {
    return Math.max(0, Math.min(1, value));
  }
  return value;
}
