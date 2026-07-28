import type {
  AgentTimelineChannel,
  AgentTimelineEvent,
} from '../../../types/agentTimeline/manifest';
import type {
  AgentTimelineRangeQuery,
  AgentTimelineRangeQueryInput,
  AgentTimelineRangeQueryResponse,
  PlannedShardRead,
  ProjectedAgentTimelineOccurrence,
} from '../../../types/agentTimeline/query';
import { eventMatchesHalfOpenRange } from '../manifest/eventSemantics';
import { buildRangeQueryPage } from './rangeQueryPagination';
import {
  eventTypesForChannels,
  planCanonicalSourceRanges,
  planChannelShardReads,
} from './rangeQueryPlanning';
import { projectEventOccurrences } from './rangeQueryProjection';

function assertQuery(input: AgentTimelineRangeQueryInput): void {
  const { query, manifest, occurrenceMapping } = input;
  if (!Number.isFinite(query.start) || !Number.isFinite(query.end) ||
      query.start < 0 || query.end <= query.start) {
    throw new RangeError('Agent Timeline query requires a non-negative, non-empty half-open range');
  }
  if (query.channels.length === 0) throw new TypeError('Agent Timeline query requires at least one channel');
  if (query.scope.mediaFileId && query.scope.mediaFileId !== manifest.mediaFileId) {
    throw new TypeError('Agent Timeline query mediaFileId does not match the manifest');
  }
  if (query.timeDomain !== 'source' && !occurrenceMapping) {
    throw new TypeError(`${query.timeDomain} queries require a prebuilt occurrence mapping index`);
  }
  if (query.timeDomain === 'composition' && !query.scope.compositionPath &&
      !query.scope.compositionId) {
    throw new TypeError('Composition queries require compositionPath or compositionId scope');
  }
}

function normalizedQuery(query: AgentTimelineRangeQuery): AgentTimelineRangeQuery {
  return {
    ...query,
    channels: [...new Set(query.channels)].toSorted(),
    includeFrames: query.includeFrames ?? false,
    limit: Math.min(500, Math.max(1, Math.trunc(query.limit ?? 200))),
  };
}

function queryKey(
  input: AgentTimelineRangeQueryInput,
  query: AgentTimelineRangeQuery,
  sourceId: string,
): string {
  return JSON.stringify([
    'agent-timeline-range-query/v1',
    input.manifest.mediaFileId,
    input.manifest.sourceIdentity.hash,
    input.manifest.profile,
    input.occurrenceMapping?.stateHash ?? null,
    sourceId,
    query.scope,
    query.start,
    query.end,
    query.timeDomain,
    query.granularity,
    query.channels,
    query.includeFrames,
  ]);
}

function readMatchesPlan(event: AgentTimelineEvent, plan: PlannedShardRead): boolean {
  return plan.eventTypes.includes(event.type) &&
    event.time.timeDomain === 'source' &&
    plan.sourceRanges.some(range => eventMatchesHalfOpenRange(event, range));
}

async function loadCanonicalEvents(
  input: AgentTimelineRangeQueryInput,
  plans: readonly PlannedShardRead[],
): Promise<readonly AgentTimelineEvent[]> {
  const batches = await Promise.all(plans.map(async plan => {
    const events = await input.shardReader.readEvents({
      shard: plan.shard,
      sourceRanges: plan.sourceRanges,
      eventTypes: plan.eventTypes,
      granularity: input.query.granularity,
      includeFrames: input.query.includeFrames ?? false,
    });
    return events.filter(event => readMatchesPlan(event, plan));
  }));
  const byId = new Map<string, AgentTimelineEvent>();
  for (const event of batches.flat()) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return Array.from(byId.values());
}

function selectedChannels(query: AgentTimelineRangeQuery): readonly AgentTimelineChannel[] {
  return [...new Set(query.channels)].toSorted();
}

/**
 * Executes a bounded range query. The only external read is the injected
 * range-aware shard reader; timeline stores and runtime media never enter.
 */
export async function getAgentTimelineRange(
  rawInput: AgentTimelineRangeQueryInput,
): Promise<AgentTimelineRangeQueryResponse> {
  assertQuery(rawInput);
  const query = normalizedQuery(rawInput.query);
  const input = { ...rawInput, query };
  const sourceId = input.mappingSourceId ?? input.manifest.mediaFileId;
  const sourceRanges = planCanonicalSourceRanges(
    input.manifest,
    query,
    input.occurrenceMapping,
    sourceId,
  );
  const channels = selectedChannels(query);
  const channelPlans = channels.map(channel =>
    planChannelShardReads(input.manifest, input.shardIndex, channel, sourceRanges));
  const plans = channelPlans.flatMap(plan => plan.reads);
  const requestedEventTypes = eventTypesForChannels(channels);
  const loaded = (await loadCanonicalEvents(input, plans))
    .filter(event => requestedEventTypes.has(event.type));
  const occurrencesByEventId = new Map<string, readonly ProjectedAgentTimelineOccurrence[]>();
  const events: AgentTimelineEvent[] = [];
  for (const event of loaded) {
    const occurrences = projectEventOccurrences(
      event,
      input.occurrenceMapping,
      query,
      sourceId,
    );
    if (query.timeDomain !== 'source' && occurrences.length === 0) continue;
    events.push(event);
    occurrencesByEventId.set(event.id, occurrences);
  }
  const coverage = channelPlans.map(plan => plan.coverage);
  const missingChannels = coverage
    .filter(summary => summary.status !== 'complete')
    .map(summary => summary.channel);

  return buildRangeQueryPage({
    queryKey: queryKey(input, query, sourceId),
    query,
    events,
    occurrencesByEventId,
    coverage,
    missingChannels,
    maxResponseBytes: input.maxResponseBytes,
  });
}
