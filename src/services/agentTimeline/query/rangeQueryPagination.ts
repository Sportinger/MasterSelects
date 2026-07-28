import type {
  AgentTimelineChannel,
  AgentTimelineCoverageSummary,
  AgentTimelineEvent,
  AgentTimelineTruncation,
} from '../../../types/agentTimeline/manifest';
import type {
  AgentTimelineRangeQuery,
  AgentTimelineRangeQueryResponse,
  ProjectedAgentTimelineOccurrence,
} from '../../../types/agentTimeline/query';
import {
  AGENT_TIMELINE_MAX_PAGE_BYTES,
  AGENT_TIMELINE_MAX_PAGE_EVENTS,
  encodeAgentTimelineCursor,
  paginateAgentTimelineEvents,
} from '../manifest/pagination';

interface BuildPageInput {
  queryKey: string;
  query: AgentTimelineRangeQuery;
  events: readonly AgentTimelineEvent[];
  occurrencesByEventId: ReadonlyMap<string, readonly ProjectedAgentTimelineOccurrence[]>;
  coverage: readonly AgentTimelineCoverageSummary[];
  missingChannels: readonly AgentTimelineChannel[];
  maxResponseBytes?: number;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function responseFor(
  input: BuildPageInput,
  events: readonly AgentTimelineEvent[],
  occurrences: readonly ProjectedAgentTimelineOccurrence[],
  nextCursor: string | undefined,
  truncation: AgentTimelineTruncation,
): AgentTimelineRangeQueryResponse {
  return {
    schemaVersion: 'agent-timeline-range-query/v1',
    query: {
      scope: input.query.scope,
      start: input.query.start,
      end: input.query.end,
      timeDomain: input.query.timeDomain,
      granularity: input.query.granularity,
      channels: [...new Set(input.query.channels)].toSorted(),
      includeFrames: input.query.includeFrames ?? false,
    },
    events,
    occurrences,
    coverageTimeDomain: 'source',
    coverage: input.coverage,
    missingChannels: input.missingChannels,
    nextCursor,
    truncation,
  };
}

export function buildRangeQueryPage(input: BuildPageInput): AgentTimelineRangeQueryResponse {
  const limit = Math.min(AGENT_TIMELINE_MAX_PAGE_EVENTS, Math.max(1, Math.trunc(input.query.limit ?? 200)));
  const maxBytes = Math.min(
    AGENT_TIMELINE_MAX_PAGE_BYTES,
    Math.max(1, Math.trunc(input.maxResponseBytes ?? AGENT_TIMELINE_MAX_PAGE_BYTES)),
  );
  const candidatePage = paginateAgentTimelineEvents([...input.events], {
    queryKey: input.queryKey,
    limit,
    cursor: input.query.cursor,
  });
  const candidates = candidatePage.events;
  const selectedEvents: AgentTimelineEvent[] = [];
  const selectedOccurrences: ProjectedAgentTimelineOccurrence[] = [];
  let stoppedForBytes = false;

  for (const event of candidates) {
    const nextEvents = [...selectedEvents, event];
    const nextOccurrences = [
      ...selectedOccurrences,
      ...(input.occurrencesByEventId.get(event.id) ?? []),
    ];
    const provisionalCursor = encodeAgentTimelineCursor(input.queryKey, event);
    const provisional = responseFor(input, nextEvents, nextOccurrences, provisionalCursor, {
      truncated: true,
      reason: 'byte-limit',
      returnedEvents: nextEvents.length,
      estimatedBytes: 0,
    });
    const bytes = byteLength(provisional);
    if (bytes > maxBytes) {
      if (selectedEvents.length === 0) {
        throw new RangeError(`Agent Timeline event ${event.id} and its occurrences exceed the response byte budget`);
      }
      stoppedForBytes = true;
      break;
    }
    selectedEvents.push(event);
    selectedOccurrences.push(...(input.occurrencesByEventId.get(event.id) ?? []));
  }

  const hasMore = stoppedForBytes ||
    selectedEvents.length < candidates.length ||
    candidatePage.truncation.truncated;
  const reason: AgentTimelineTruncation['reason'] | undefined = hasMore
    ? stoppedForBytes ? 'byte-limit' : 'event-limit'
    : undefined;
  const lastEvent = selectedEvents.at(-1);
  const nextCursor = hasMore && lastEvent
    ? encodeAgentTimelineCursor(input.queryKey, lastEvent)
    : undefined;
  let response = responseFor(input, selectedEvents, selectedOccurrences, nextCursor, {
    truncated: hasMore,
    reason,
    returnedEvents: selectedEvents.length,
    estimatedBytes: 0,
  });
  let estimatedBytes = byteLength(response);
  response = {
    ...response,
    truncation: { ...response.truncation, estimatedBytes },
  };
  estimatedBytes = byteLength(response);
  if (estimatedBytes > maxBytes) {
    // The digit width of estimatedBytes can grow after insertion. Conservatively
    // remove the last item and let the cursor resume from the previous event.
    if (selectedEvents.length <= 1) throw new RangeError('Agent Timeline response envelope exceeds the byte budget');
    const reducedEvents = selectedEvents.slice(0, -1);
    const reducedIds = new Set(reducedEvents.map(event => event.id));
    const reducedOccurrences = selectedOccurrences.filter(item => reducedIds.has(item.canonicalEventId));
    const reducedCursor = encodeAgentTimelineCursor(input.queryKey, reducedEvents.at(-1)!);
    response = responseFor(input, reducedEvents, reducedOccurrences, reducedCursor, {
      truncated: true,
      reason: 'byte-limit',
      returnedEvents: reducedEvents.length,
      estimatedBytes: 0,
    });
    response = {
      ...response,
      truncation: { ...response.truncation, estimatedBytes: byteLength(response) },
    };
  }
  return response;
}
