import type {
  CompositionIntervalProjectionQuery,
  CompositionPointProjectionQuery,
  HalfOpenTimeRange,
  OccurrenceMappingIndex,
  OccurrenceMappingSegment,
  OccurrenceProjectionReference,
  ProjectedCompositionInterval,
  ProjectedCompositionPoint,
  ProjectedSourceInterval,
  ProjectedSourcePoint,
  SourceIntervalProjectionQuery,
  SourcePointProjectionQuery,
} from '../../../types/agentTimeline/occurrenceMapping';
import {
  MAPPING_EPSILON,
  intervalIntersections,
  isFiniteRange,
  localTimesForSource,
  pathKey,
  rateAtCompositionTime,
  samePath,
  sourceAtCompositionTime,
} from './occurrenceMappingMath';

function reference(segment: OccurrenceMappingSegment): OccurrenceProjectionReference {
  return {
    occurrenceId: segment.occurrenceId,
    mappingSegmentId: segment.mappingSegmentId,
    sourceId: segment.sourceId,
    clipId: segment.clipId,
    compositionPath: segment.compositionPath,
    direction: segment.direction,
  };
}

function indexedSegments(index: OccurrenceMappingIndex, ids: readonly string[] | undefined): readonly OccurrenceMappingSegment[] {
  if (!ids) return [];
  return ids.flatMap(id => index.segmentsById[id] ? [index.segmentsById[id]] : []);
}

function sourceSegments(
  index: OccurrenceMappingIndex,
  sourceId: string,
  compositionPath?: readonly string[],
): readonly OccurrenceMappingSegment[] {
  return indexedSegments(index, index.segmentIdsBySource[sourceId])
    .filter(segment => !compositionPath || samePath(segment.compositionPath, compositionPath));
}

function compositionSegments(
  index: OccurrenceMappingIndex,
  compositionPath: readonly string[],
  sourceId?: string,
): readonly OccurrenceMappingSegment[] {
  return indexedSegments(index, index.segmentIdsByCompositionPath[pathKey(compositionPath)])
    .filter(segment => !sourceId || segment.sourceId === sourceId);
}

function occurrenceSourceContains(
  index: OccurrenceMappingIndex,
  occurrenceId: string,
  sourceTime: number,
): boolean {
  const occurrence = index.occurrences.find(candidate => candidate.occurrenceId === occurrenceId);
  return Boolean(occurrence &&
    sourceTime >= occurrence.sourceRange.start &&
    sourceTime < occurrence.sourceRange.end);
}

/** Projects a canonical source point. Holds return their full visible range. */
export function projectSourcePoint(
  index: OccurrenceMappingIndex,
  query: SourcePointProjectionQuery,
): readonly ProjectedSourcePoint[] {
  if (!Number.isFinite(query.sourceTime)) return [];
  const result: ProjectedSourcePoint[] = [];
  for (const segment of sourceSegments(index, query.sourceId, query.compositionPath)) {
    if (!occurrenceSourceContains(index, segment.occurrenceId, query.sourceTime)) continue;
    if (segment.direction === 'hold') {
      if (Math.abs(query.sourceTime - segment.sourceStart) <= MAPPING_EPSILON) {
        result.push({
          ...reference(segment),
          kind: 'hold',
          sourceTime: query.sourceTime,
          localSpeed: 0,
          compositionRange: segment.compositionRange,
        });
      }
      continue;
    }
    const duration = segment.compositionRange.end - segment.compositionRange.start;
    for (const localTime of localTimesForSource(
      segment.sourceStart,
      segment.sourceRateStart,
      segment.sourceRateEnd,
      duration,
      query.sourceTime,
    )) {
      // Half-open composition ranges assign exact joins to the next segment.
      if (localTime >= duration - MAPPING_EPSILON) continue;
      const compositionTime = segment.compositionRange.start + localTime;
      result.push({
        ...reference(segment),
        kind: 'point',
        sourceTime: query.sourceTime,
        compositionTime,
        localSpeed: rateAtCompositionTime(segment, compositionTime),
      });
    }
  }
  return result.toSorted((left, right) =>
    (left.compositionTime ?? left.compositionRange?.start ?? 0) -
    (right.compositionTime ?? right.compositionRange?.start ?? 0) ||
    left.occurrenceId.localeCompare(right.occurrenceId));
}

/** Projects a half-open canonical source interval and splits at every mapping segment. */
export function projectSourceInterval(
  index: OccurrenceMappingIndex,
  query: SourceIntervalProjectionQuery,
): readonly ProjectedSourceInterval[] {
  if (!isFiniteRange(query.sourceRange)) return [];
  const result: ProjectedSourceInterval[] = [];
  for (const segment of sourceSegments(index, query.sourceId, query.compositionPath)) {
    for (const compositionRange of intervalIntersections(segment, query.sourceRange)) {
      const sourceStart = sourceAtCompositionTime(segment, compositionRange.start);
      const sourceEnd = sourceAtCompositionTime(segment, compositionRange.end);
      if (segment.direction === 'hold') {
        result.push({
          ...reference(segment),
          kind: 'hold',
          compositionRange,
          sourceTime: segment.sourceStart,
          sourceRateStart: 0,
          sourceRateEnd: 0,
        });
      } else {
        result.push({
          ...reference(segment),
          kind: 'interval',
          compositionRange,
          sourceRange: {
            start: Math.max(query.sourceRange.start, Math.min(sourceStart, sourceEnd)),
            end: Math.min(query.sourceRange.end, Math.max(sourceStart, sourceEnd)),
          },
          sourceRateStart: rateAtCompositionTime(segment, compositionRange.start),
          sourceRateEnd: rateAtCompositionTime(segment, compositionRange.end),
        });
      }
    }
  }
  return result.toSorted((left, right) =>
    left.compositionRange.start - right.compositionRange.start ||
    left.occurrenceId.localeCompare(right.occurrenceId));
}

/** Maps one composition point through all visible occurrences on an exact nested path. */
export function projectCompositionPoint(
  index: OccurrenceMappingIndex,
  query: CompositionPointProjectionQuery,
): readonly ProjectedCompositionPoint[] {
  if (!Number.isFinite(query.compositionTime)) return [];
  return compositionSegments(index, query.compositionPath, query.sourceId)
    .filter(segment => query.compositionTime >= segment.compositionRange.start &&
      query.compositionTime < segment.compositionRange.end)
    .map(segment => ({
      ...reference(segment),
      compositionTime: query.compositionTime,
      sourceTime: sourceAtCompositionTime(segment, query.compositionTime),
      localSpeed: rateAtCompositionTime(segment, query.compositionTime),
      isHold: segment.direction === 'hold',
    }))
    .toSorted((left, right) => left.occurrenceId.localeCompare(right.occurrenceId));
}

/** Maps a half-open composition range; pre-split speed pieces remain separate. */
export function projectCompositionInterval(
  index: OccurrenceMappingIndex,
  query: CompositionIntervalProjectionQuery,
): readonly ProjectedCompositionInterval[] {
  if (!isFiniteRange(query.compositionRange)) return [];
  return compositionSegments(index, query.compositionPath, query.sourceId).flatMap(segment => {
    const compositionRange: HalfOpenTimeRange = {
      start: Math.max(query.compositionRange.start, segment.compositionRange.start),
      end: Math.min(query.compositionRange.end, segment.compositionRange.end),
    };
    if (!isFiniteRange(compositionRange)) return [];
    const sourceStart = sourceAtCompositionTime(segment, compositionRange.start);
    const sourceEnd = sourceAtCompositionTime(segment, compositionRange.end);
    return [{
      ...reference(segment),
      kind: segment.direction === 'hold' ? 'hold' as const : 'interval' as const,
      compositionRange,
      ...(segment.direction === 'hold'
        ? { sourceTime: sourceStart }
        : { sourceRange: { start: Math.min(sourceStart, sourceEnd), end: Math.max(sourceStart, sourceEnd) } }),
      sourceStart,
      sourceEnd,
      sourceRateStart: rateAtCompositionTime(segment, compositionRange.start),
      sourceRateEnd: rateAtCompositionTime(segment, compositionRange.end),
    }];
  }).toSorted((left, right) =>
    left.compositionRange.start - right.compositionRange.start ||
    left.occurrenceId.localeCompare(right.occurrenceId));
}
