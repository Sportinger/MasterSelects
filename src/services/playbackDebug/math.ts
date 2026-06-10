export function round(value: number, precision = 1): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function max(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values);
}

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function getNumericDetail(
  detail: Record<string, number | string> | undefined,
  key: string
): number | undefined {
  const value = detail?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function incrementCount(counts: Record<string, number>, key: string | undefined): void {
  const safeKey = key && key.trim().length > 0 ? key : 'unknown';
  counts[safeKey] = (counts[safeKey] ?? 0) + 1;
}

export function filterEventsInRange<T extends { t: number }>(
  events: T[],
  startMs: number,
  endMs: number
): T[] {
  return events.filter((event) => event.t >= startMs && event.t <= endMs);
}
