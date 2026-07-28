import type {
  AgentTimelineEvent,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import type {
  OccurrenceMappingIndex,
  ProjectedSourceInterval,
  ProjectedSourcePoint,
} from '../../../types/agentTimeline/occurrenceMapping';
import type {
  AgentTimelineRangeQuery,
  ProjectedAgentTimelineOccurrence,
  ProjectedOccurrenceTime,
} from '../../../types/agentTimeline/query';
import {
  projectSourceInterval,
  projectSourcePoint,
} from '../mapping/occurrenceMappingQueries';

function matchesScope(
  projection: Pick<ProjectedSourcePoint, 'clipId' | 'compositionPath'>,
  query: AgentTimelineRangeQuery,
): boolean {
  if (query.scope.clipId && projection.clipId !== query.scope.clipId) return false;
  if (query.scope.compositionPath) {
    const path = query.scope.compositionPath;
    if (projection.compositionPath.length !== path.length ||
        !projection.compositionPath.every((part, index) => part === path[index])) return false;
  }
  return !query.scope.compositionId || projection.compositionPath.includes(query.scope.compositionId);
}

function compositionTimeForPoint(projection: ProjectedSourcePoint): ProjectedOccurrenceTime {
  return projection.kind === 'hold'
    ? {
        temporalKind: 'interval',
        start: projection.compositionRange!.start,
        end: projection.compositionRange!.end,
        isHold: true,
      }
    : { temporalKind: 'point', time: projection.compositionTime! };
}

function compositionTimeForInterval(projection: ProjectedSourceInterval): ProjectedOccurrenceTime {
  return {
    temporalKind: 'interval',
    start: projection.compositionRange.start,
    end: projection.compositionRange.end,
    isHold: projection.kind === 'hold' || undefined,
  };
}

function queryRangeMatches(
  time: ProjectedOccurrenceTime,
  range: AgentTimelineRange,
): boolean {
  return time.temporalKind === 'point'
    ? time.time >= range.start && time.time < range.end
    : time.start < range.end && time.end > range.start;
}

function occurrenceOrigin(
  mapping: OccurrenceMappingIndex,
  occurrenceId: string,
): number | undefined {
  const starts = mapping.segments
    .filter(segment => segment.occurrenceId === occurrenceId)
    .map(segment => segment.compositionRange.start);
  return starts.length > 0 ? Math.min(...starts) : undefined;
}

function matchesQueryDomain(
  projection: { occurrenceId: string },
  compositionTime: ProjectedOccurrenceTime,
  mapping: OccurrenceMappingIndex,
  query: AgentTimelineRangeQuery,
): boolean {
  if (query.timeDomain === 'source') return true;
  if (query.timeDomain === 'composition') {
    return queryRangeMatches(compositionTime, { start: query.start, end: query.end });
  }
  const origin = occurrenceOrigin(mapping, projection.occurrenceId);
  if (origin === undefined) return false;
  const localTime: ProjectedOccurrenceTime = compositionTime.temporalKind === 'point'
    ? { temporalKind: 'point', time: compositionTime.time - origin }
    : {
        temporalKind: 'interval',
        start: compositionTime.start - origin,
        end: compositionTime.end - origin,
        isHold: compositionTime.isHold,
      };
  return queryRangeMatches(localTime, { start: query.start, end: query.end });
}

function fromPoint(
  eventId: string,
  projection: ProjectedSourcePoint,
  mapping: OccurrenceMappingIndex,
  query: AgentTimelineRangeQuery,
): ProjectedAgentTimelineOccurrence | undefined {
  if (!matchesScope(projection, query)) return undefined;
  const compositionTime = compositionTimeForPoint(projection);
  if (!matchesQueryDomain(projection, compositionTime, mapping, query)) return undefined;
  return {
    canonicalEventId: eventId,
    occurrenceId: projection.occurrenceId,
    mappingSegmentId: projection.mappingSegmentId,
    sourceId: projection.sourceId,
    clipId: projection.clipId,
    compositionPath: projection.compositionPath,
    direction: projection.direction,
    localSpeedStart: projection.localSpeed,
    localSpeedEnd: projection.localSpeed,
    compositionTime,
  };
}

function fromInterval(
  eventId: string,
  projection: ProjectedSourceInterval,
  mapping: OccurrenceMappingIndex,
  query: AgentTimelineRangeQuery,
): ProjectedAgentTimelineOccurrence | undefined {
  if (!matchesScope(projection, query)) return undefined;
  const compositionTime = compositionTimeForInterval(projection);
  if (!matchesQueryDomain(projection, compositionTime, mapping, query)) return undefined;
  return {
    canonicalEventId: eventId,
    occurrenceId: projection.occurrenceId,
    mappingSegmentId: projection.mappingSegmentId,
    sourceId: projection.sourceId,
    clipId: projection.clipId,
    compositionPath: projection.compositionPath,
    direction: projection.direction,
    localSpeedStart: projection.sourceRateStart,
    localSpeedEnd: projection.sourceRateEnd,
    compositionTime,
  };
}

function occurrenceKey(occurrence: ProjectedAgentTimelineOccurrence): string {
  return [
    occurrence.canonicalEventId,
    occurrence.occurrenceId,
    occurrence.mappingSegmentId,
    occurrence.compositionTime.temporalKind,
    occurrence.compositionTime.temporalKind === 'point'
      ? occurrence.compositionTime.time
      : `${occurrence.compositionTime.start}:${occurrence.compositionTime.end}`,
  ].join('|');
}

export function projectEventOccurrences(
  event: AgentTimelineEvent,
  mapping: OccurrenceMappingIndex | undefined,
  query: AgentTimelineRangeQuery,
  sourceId: string,
): readonly ProjectedAgentTimelineOccurrence[] {
  if (!mapping || event.time.timeDomain !== 'source') return [];
  const projected = event.time.temporalKind === 'point'
    ? projectSourcePoint(mapping, { sourceId, sourceTime: event.time.time })
      .map(item => fromPoint(event.id, item, mapping, query))
    : projectSourceInterval(mapping, {
        sourceId,
        sourceRange: { start: event.time.start, end: event.time.end },
      }).map(item => fromInterval(event.id, item, mapping, query));
  const byKey = new Map<string, ProjectedAgentTimelineOccurrence>();
  for (const occurrence of projected) {
    if (occurrence) byKey.set(occurrenceKey(occurrence), occurrence);
  }
  return Array.from(byKey.values()).toSorted((left, right) => {
    const leftStart = left.compositionTime.temporalKind === 'point'
      ? left.compositionTime.time
      : left.compositionTime.start;
    const rightStart = right.compositionTime.temporalKind === 'point'
      ? right.compositionTime.time
      : right.compositionTime.start;
    return leftStart - rightStart ||
      left.occurrenceId.localeCompare(right.occurrenceId) ||
      left.mappingSegmentId.localeCompare(right.mappingSegmentId);
  });
}
