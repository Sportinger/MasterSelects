import type {
  HalfOpenTimeRange,
  OccurrenceMappingDirection,
  OccurrenceMappingPieceInput,
  OccurrenceMappingSegment,
} from '../../../types/agentTimeline/occurrenceMapping';

export const MAPPING_EPSILON = 1e-9;

export function isFiniteRange(range: HalfOpenTimeRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start;
}

export function sourceAtLocalTime(
  sourceStart: number,
  rateStart: number,
  rateEnd: number,
  duration: number,
  localTime: number,
): number {
  if (duration <= 0) return sourceStart;
  const acceleration = (rateEnd - rateStart) / duration;
  return sourceStart + rateStart * localTime + 0.5 * acceleration * localTime * localTime;
}

export function rateAtLocalTime(
  rateStart: number,
  rateEnd: number,
  duration: number,
  localTime: number,
): number {
  if (duration <= 0) return rateStart;
  return rateStart + ((rateEnd - rateStart) / duration) * localTime;
}

export function sourceAtCompositionTime(
  segment: OccurrenceMappingSegment,
  compositionTime: number,
): number {
  return sourceAtLocalTime(
    segment.sourceStart,
    segment.sourceRateStart,
    segment.sourceRateEnd,
    segment.compositionRange.end - segment.compositionRange.start,
    compositionTime - segment.compositionRange.start,
  );
}

export function rateAtCompositionTime(
  segment: OccurrenceMappingSegment,
  compositionTime: number,
): number {
  return rateAtLocalTime(
    segment.sourceRateStart,
    segment.sourceRateEnd,
    segment.compositionRange.end - segment.compositionRange.start,
    compositionTime - segment.compositionRange.start,
  );
}

export function directionFor(
  sourceStart: number,
  sourceEnd: number,
  rateStart: number,
  rateEnd: number,
): OccurrenceMappingDirection {
  if (Math.abs(sourceEnd - sourceStart) <= MAPPING_EPSILON &&
      Math.abs(rateStart) <= MAPPING_EPSILON &&
      Math.abs(rateEnd) <= MAPPING_EPSILON) {
    return 'hold';
  }
  return sourceEnd >= sourceStart ? 'forward' : 'reverse';
}

function uniqueSorted(values: readonly number[], minimum: number, maximum: number): readonly number[] {
  const sorted = values
    .filter(value => Number.isFinite(value) && value >= minimum - MAPPING_EPSILON && value <= maximum + MAPPING_EPSILON)
    .map(value => Math.min(maximum, Math.max(minimum, value)))
    .toSorted((left, right) => left - right);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || Math.abs(value - result[result.length - 1]) > MAPPING_EPSILON) result.push(value);
  }
  return result;
}

/** Exact roots of source(t)=target for a linear speed ramp. */
export function localTimesForSource(
  sourceStart: number,
  rateStart: number,
  rateEnd: number,
  duration: number,
  target: number,
): readonly number[] {
  if (!Number.isFinite(target) || duration <= 0) return [];
  const acceleration = (rateEnd - rateStart) / duration;
  const constant = sourceStart - target;

  if (Math.abs(acceleration) <= MAPPING_EPSILON) {
    if (Math.abs(rateStart) <= MAPPING_EPSILON) return [];
    const time = -constant / rateStart;
    return uniqueSorted([time], 0, duration);
  }

  const discriminant = rateStart * rateStart - 2 * acceleration * constant;
  if (discriminant < -MAPPING_EPSILON) return [];
  const squareRoot = Math.sqrt(Math.max(0, discriminant));
  return uniqueSorted([
    (-rateStart - squareRoot) / acceleration,
    (-rateStart + squareRoot) / acceleration,
  ], 0, duration);
}

export function zeroRateLocalTime(piece: OccurrenceMappingPieceInput): number | undefined {
  const endRate = piece.sourceRateEnd ?? piece.sourceRateStart;
  const duration = piece.compositionEnd - piece.compositionStart;
  const difference = endRate - piece.sourceRateStart;
  if (duration <= 0 || Math.abs(difference) <= MAPPING_EPSILON) return undefined;
  const time = (-piece.sourceRateStart * duration) / difference;
  return time > MAPPING_EPSILON && time < duration - MAPPING_EPSILON ? time : undefined;
}

export function intervalIntersections(
  segment: OccurrenceMappingSegment,
  range: HalfOpenTimeRange,
): readonly HalfOpenTimeRange[] {
  if (!isFiniteRange(range)) return [];
  const duration = segment.compositionRange.end - segment.compositionRange.start;
  if (segment.direction === 'hold') {
    return segment.sourceStart >= range.start && segment.sourceStart < range.end
      ? [segment.compositionRange]
      : [];
  }
  const candidates = uniqueSorted([
    0,
    duration,
    ...localTimesForSource(segment.sourceStart, segment.sourceRateStart, segment.sourceRateEnd, duration, range.start),
    ...localTimesForSource(segment.sourceStart, segment.sourceRateStart, segment.sourceRateEnd, duration, range.end),
  ], 0, duration);
  const result: HalfOpenTimeRange[] = [];
  for (let index = 0; index < candidates.length - 1; index += 1) {
    const start = candidates[index];
    const end = candidates[index + 1];
    if (end - start <= MAPPING_EPSILON) continue;
    const source = sourceAtLocalTime(
      segment.sourceStart,
      segment.sourceRateStart,
      segment.sourceRateEnd,
      duration,
      (start + end) / 2,
    );
    if (source >= range.start && source < range.end) {
      result.push({
        start: segment.compositionRange.start + start,
        end: segment.compositionRange.start + end,
      });
    }
  }
  return result;
}

export function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

export function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
