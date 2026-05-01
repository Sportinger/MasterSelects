interface ExportRangeInput {
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
}

export interface ResolvedExportRange {
  startTime: number;
  endTime: number;
}

function sanitizeFiniteTime(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveExportRange(
  { duration, inPoint, outPoint }: ExportRangeInput,
  useInOut: boolean,
): ResolvedExportRange {
  const safeDuration = Math.max(0, sanitizeFiniteTime(duration, 0));

  if (!useInOut) {
    return {
      startTime: 0,
      endTime: safeDuration,
    };
  }

  const requestedStart = sanitizeFiniteTime(inPoint, 0);
  const startTime = Math.max(0, Math.min(requestedStart, safeDuration));
  const requestedEnd = sanitizeFiniteTime(outPoint, safeDuration);
  const endTime = Math.max(startTime, Math.min(requestedEnd, safeDuration));

  return {
    startTime,
    endTime,
  };
}
