import {
  OCCURRENCE_MAPPING_SCHEMA_VERSION,
  type BuildOccurrenceMappingIndexInput,
  type HalfOpenTimeRange,
  type OccurrenceMappingIndex,
  type OccurrenceMappingPieceInput,
  type OccurrenceMappingSegment,
  type SourceOccurrenceMapping,
  type SourceOccurrenceMappingInput,
} from '../../../types/agentTimeline/occurrenceMapping';
import {
  MAPPING_EPSILON,
  directionFor,
  isFiniteRange,
  localTimesForSource,
  pathKey,
  rateAtLocalTime,
  sourceAtLocalTime,
  zeroRateLocalTime,
} from './occurrenceMappingMath';

function stableNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(15) : 'invalid';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function pieceKey(piece: OccurrenceMappingPieceInput): string {
  return [
    stableNumber(piece.compositionStart),
    stableNumber(piece.compositionEnd),
    stableNumber(piece.sourceStart),
    stableNumber(piece.sourceRateStart),
    stableNumber(piece.sourceRateEnd ?? piece.sourceRateStart),
  ].join(',');
}

function occurrenceKey(input: SourceOccurrenceMappingInput): string {
  return [
    input.sourceId,
    input.clipId,
    JSON.stringify(input.compositionPath),
    stableNumber(input.sourceRange.start),
    stableNumber(input.sourceRange.end),
    input.occurrenceKey ?? '',
    input.pieces.map(pieceKey).toSorted().join(';'),
  ].join('|');
}

function validPiece(piece: OccurrenceMappingPieceInput): boolean {
  return Number.isFinite(piece.compositionStart) &&
    Number.isFinite(piece.compositionEnd) &&
    piece.compositionEnd > piece.compositionStart &&
    Number.isFinite(piece.sourceStart) &&
    Number.isFinite(piece.sourceRateStart) &&
    Number.isFinite(piece.sourceRateEnd ?? piece.sourceRateStart);
}

function uniqueSorted(values: readonly number[], maximum: number): readonly number[] {
  const result: number[] = [];
  for (const value of values
    .filter(candidate => Number.isFinite(candidate) && candidate >= -MAPPING_EPSILON && candidate <= maximum + MAPPING_EPSILON)
    .map(candidate => Math.min(maximum, Math.max(0, candidate)))
    .toSorted((left, right) => left - right)) {
    if (result.length === 0 || Math.abs(value - result[result.length - 1]) > MAPPING_EPSILON) result.push(value);
  }
  return result;
}

function splitPieceAtTrimAndDirection(
  piece: OccurrenceMappingPieceInput,
  sourceRange: HalfOpenTimeRange,
): readonly Omit<OccurrenceMappingSegment, 'mappingSegmentId' | 'occurrenceId' | 'sourceId' | 'clipId' | 'compositionPath'>[] {
  if (!validPiece(piece) || !isFiniteRange(sourceRange)) return [];
  const duration = piece.compositionEnd - piece.compositionStart;
  const rateEnd = piece.sourceRateEnd ?? piece.sourceRateStart;
  const zeroRate = zeroRateLocalTime(piece);
  const candidates = uniqueSorted([
    0,
    duration,
    ...(zeroRate === undefined ? [] : [zeroRate]),
    ...localTimesForSource(piece.sourceStart, piece.sourceRateStart, rateEnd, duration, sourceRange.start),
    ...localTimesForSource(piece.sourceStart, piece.sourceRateStart, rateEnd, duration, sourceRange.end),
  ], duration);
  const segments: Omit<OccurrenceMappingSegment, 'mappingSegmentId' | 'occurrenceId' | 'sourceId' | 'clipId' | 'compositionPath'>[] = [];

  for (let index = 0; index < candidates.length - 1; index += 1) {
    const localStart = candidates[index];
    const localEnd = candidates[index + 1];
    if (localEnd - localStart <= MAPPING_EPSILON) continue;
    const middleSource = sourceAtLocalTime(
      piece.sourceStart,
      piece.sourceRateStart,
      rateEnd,
      duration,
      (localStart + localEnd) / 2,
    );
    if (middleSource < sourceRange.start || middleSource >= sourceRange.end) continue;

    const sourceStart = sourceAtLocalTime(piece.sourceStart, piece.sourceRateStart, rateEnd, duration, localStart);
    const sourceEnd = sourceAtLocalTime(piece.sourceStart, piece.sourceRateStart, rateEnd, duration, localEnd);
    const sourceRateStart = rateAtLocalTime(piece.sourceRateStart, rateEnd, duration, localStart);
    const sourceRateEnd = rateAtLocalTime(piece.sourceRateStart, rateEnd, duration, localEnd);
    segments.push({
      compositionRange: {
        start: piece.compositionStart + localStart,
        end: piece.compositionStart + localEnd,
      },
      sourceRange: {
        start: Math.max(sourceRange.start, Math.min(sourceStart, sourceEnd)),
        end: Math.min(sourceRange.end, Math.max(sourceStart, sourceEnd)),
      },
      sourceStart,
      sourceEnd,
      sourceRateStart,
      sourceRateEnd,
      direction: directionFor(sourceStart, sourceEnd, sourceRateStart, sourceRateEnd),
    });
  }
  return segments;
}

function segmentKey(segment: Omit<OccurrenceMappingSegment, 'mappingSegmentId'>): string {
  return [
    segment.occurrenceId,
    stableNumber(segment.compositionRange.start),
    stableNumber(segment.compositionRange.end),
    stableNumber(segment.sourceStart),
    stableNumber(segment.sourceEnd),
    stableNumber(segment.sourceRateStart),
    stableNumber(segment.sourceRateEnd),
  ].join('|');
}

function appendIndex(map: Record<string, string[]>, key: string, segmentId: string): void {
  (map[key] ??= []).push(segmentId);
}

/**
 * Builds the one authoritative, serializable mapping artifact for a timeline
 * state hash. Inputs may be in any order; IDs and index order remain stable.
 */
export function buildOccurrenceMappingIndex(input: BuildOccurrenceMappingIndexInput): OccurrenceMappingIndex {
  const prepared = input.occurrences
    .filter(occurrence => occurrence.sourceId.length > 0 &&
      occurrence.clipId.length > 0 &&
      occurrence.compositionPath.length > 0 &&
      isFiniteRange(occurrence.sourceRange))
    .map(occurrence => ({ input: occurrence, canonicalKey: occurrenceKey(occurrence) }))
    .toSorted((left, right) => left.canonicalKey.localeCompare(right.canonicalKey));

  const occurrences: SourceOccurrenceMapping[] = [];
  const segments: OccurrenceMappingSegment[] = [];
  for (const item of prepared) {
    const occurrenceId = `occ-${stableHash(item.canonicalKey)}`;
    const partialSegments = item.input.pieces
      .toSorted((left, right) => left.compositionStart - right.compositionStart || pieceKey(left).localeCompare(pieceKey(right)))
      .flatMap(piece => splitPieceAtTrimAndDirection(piece, item.input.sourceRange));
    const occurrenceSegments = partialSegments.map(partial => {
      const withoutId = {
        ...partial,
        occurrenceId,
        sourceId: item.input.sourceId,
        clipId: item.input.clipId,
        compositionPath: [...item.input.compositionPath],
      };
      return {
        ...withoutId,
        mappingSegmentId: `map-${stableHash(segmentKey(withoutId))}`,
      };
    });
    if (occurrenceSegments.length === 0) continue;
    occurrences.push({
      occurrenceId,
      sourceId: item.input.sourceId,
      clipId: item.input.clipId,
      compositionPath: [...item.input.compositionPath],
      sourceRange: { ...item.input.sourceRange },
      mappingSegmentIds: occurrenceSegments.map(segment => segment.mappingSegmentId),
    });
    segments.push(...occurrenceSegments);
  }

  const orderedSegments = segments.toSorted((left, right) =>
    left.compositionRange.start - right.compositionRange.start ||
    pathKey(left.compositionPath).localeCompare(pathKey(right.compositionPath)) ||
    left.mappingSegmentId.localeCompare(right.mappingSegmentId));
  const segmentsById: Record<string, OccurrenceMappingSegment> = {};
  const segmentIdsBySource: Record<string, string[]> = {};
  const segmentIdsByCompositionPath: Record<string, string[]> = {};
  for (const segment of orderedSegments) {
    segmentsById[segment.mappingSegmentId] = segment;
    appendIndex(segmentIdsBySource, segment.sourceId, segment.mappingSegmentId);
    appendIndex(segmentIdsByCompositionPath, pathKey(segment.compositionPath), segment.mappingSegmentId);
  }

  return {
    schemaVersion: OCCURRENCE_MAPPING_SCHEMA_VERSION,
    stateHash: input.stateHash,
    occurrences: occurrences.toSorted((left, right) => left.occurrenceId.localeCompare(right.occurrenceId)),
    segments: orderedSegments,
    segmentsById,
    segmentIdsBySource,
    segmentIdsByCompositionPath,
  };
}
