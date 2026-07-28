import {
  LEGACY_ADAPTER_VIEW_SCHEMA_VERSION,
  type LegacyAdapterLimitation,
  type LegacyAdapterRangeCapability,
  type LegacyAdapterRecord,
  type LegacyArtifactShardView,
} from '../../../types/agentTimeline/legacyAdapters';
import type {
  AgentTimelineChannel,
  AgentTimelineChannelStatus,
  AgentTimelineEvent,
  AgentTimelineProfile,
  AgentTimelineProvenance,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
} from '../../../types/agentTimeline/manifest';

export interface LegacyAdapterRequest {
  queryRange: AgentTimelineRange;
  profile: AgentTimelineProfile;
  artifactCoverage?: readonly AgentTimelineRange[];
  artifactRef?: string;
}

export function assertLegacyQueryRange(range: AgentTimelineRange): void {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) {
    throw new RangeError('Legacy adapter query ranges must be finite, non-negative, and non-empty.');
  }
}

export function intervalOverlaps(range: AgentTimelineRange, query: AgentTimelineRange): boolean {
  return range.start < query.end && range.end > query.start;
}

export function pointInRange(time: number, query: AgentTimelineRange): boolean {
  return time >= query.start && time < query.end;
}

function intersectRange(
  range: AgentTimelineRange,
  query: AgentTimelineRange,
): AgentTimelineRange | null {
  const start = Math.max(range.start, query.start);
  const end = Math.min(range.end, query.end);
  return start < end ? { start, end } : null;
}

export function mergeLegacyCoverage(
  ranges: readonly AgentTimelineRange[],
  query: AgentTimelineRange,
): AgentTimelineRange[] {
  assertLegacyQueryRange(query);
  const ordered = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end > range.start)
    .map((range) => intersectRange(range, query))
    .filter((range): range is AgentTimelineRange => range !== null)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function legacyCoverageHoles(
  query: AgentTimelineRange,
  coverage: readonly AgentTimelineRange[],
): AgentTimelineRange[] {
  const holes: AgentTimelineRange[] = [];
  let cursor = query.start;
  for (const range of mergeLegacyCoverage(coverage, query)) {
    if (cursor < range.start) holes.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < query.end) holes.push({ start: cursor, end: query.end });
  return holes;
}

function eventStart(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.start;
}

function compareEvents(left: AgentTimelineEvent, right: AgentTimelineEvent): number {
  return eventStart(left) - eventStart(right)
    || (left.time.temporalKind === 'point' ? 0 : left.time.end)
      - (right.time.temporalKind === 'point' ? 0 : right.time.end)
    || (left.type < right.type ? -1 : left.type > right.type ? 1 : 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function stableLegacyId(type: string, parts: readonly (string | number)[]): string {
  const canonical = JSON.stringify([type, ...parts]);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `legacy-${type}-${hash.toString(16).padStart(16, '0')}`;
}

export function clampConfidence(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value ?? 0)) : 0;
}

interface CreateLegacyViewInput<TRecord extends LegacyAdapterRecord> {
  channel: AgentTimelineChannel;
  request: LegacyAdapterRequest;
  sourcePresent: boolean;
  coverage: readonly AgentTimelineRange[];
  provenance: readonly AgentTimelineProvenance[];
  events?: readonly AgentTimelineEvent[];
  records?: readonly TRecord[];
  artifactRefs?: readonly string[];
  timeDomain?: AgentTimelineTimeDomain;
  stateHash?: string;
  rangeCapability?: LegacyAdapterRangeCapability;
  limitations?: readonly LegacyAdapterLimitation[];
  forceStatus?: AgentTimelineChannelStatus;
}

export function createLegacyView<TRecord extends LegacyAdapterRecord = never>(
  input: CreateLegacyViewInput<TRecord>,
): LegacyArtifactShardView<TRecord> {
  assertLegacyQueryRange(input.request.queryRange);
  const coverage = mergeLegacyCoverage(input.coverage, input.request.queryRange);
  const missing = legacyCoverageHoles(input.request.queryRange, coverage);
  const status = input.forceStatus
    ?? (!input.sourcePresent ? 'missing' : missing.length === 0 ? 'complete' : 'partial');
  return {
    type: 'agent-timeline-legacy-shard-view',
    schemaVersion: LEGACY_ADAPTER_VIEW_SCHEMA_VERSION,
    channel: input.channel,
    profile: input.request.profile,
    timeDomain: input.timeDomain ?? 'source',
    stateHash: input.stateHash,
    requestedRange: { ...input.request.queryRange },
    status,
    coverage,
    missing,
    artifactRefs: [...new Set([
      ...(input.request.artifactRef ? [input.request.artifactRef] : []),
      ...(input.artifactRefs ?? []),
    ])].toSorted(),
    provenance: [...input.provenance],
    rangeCapability: input.rangeCapability ?? 'range-queryable',
    limitations: [...new Set(input.limitations ?? [])].toSorted(),
    events: [...(input.events ?? [])].toSorted(compareEvents),
    records: [...(input.records ?? [])],
  };
}

