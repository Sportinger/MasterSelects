import {
  ARTIFACT_SHARD_INDEX_SCHEMA_VERSION,
  type ArtifactShardDescriptor,
  type ArtifactShardIntervalIndex,
  type ArtifactShardQuery,
  type ArtifactShardQueryResult,
  type ArtifactShardSelection,
  type ArtifactShardWriteMode,
  type SourceTimeRange,
} from '../../../types/agentTimeline/artifactShard';
import {
  assertSourceTimeRange,
  hasValidArtifactShardId,
} from './artifactShardDescriptor';

function compareText(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left < right ? -1 : 1;
}

function compareShardIndexOrder(left: ArtifactShardDescriptor, right: ArtifactShardDescriptor): number {
  return left.sourceRange.start - right.sourceRange.start
    || left.sourceRange.end - right.sourceRange.end
    || compareText(left.sourceIdentityHash, right.sourceIdentityHash)
    || compareText(left.channel, right.channel)
    || compareText(left.analyzerId, right.analyzerId)
    || compareText(left.analyzerVersion, right.analyzerVersion)
    || compareText(left.profile, right.profile)
    || compareText(left.createdAt, right.createdAt)
    || compareText(left.shardId, right.shardId);
}

export function createArtifactShardIntervalIndex(
  shards: readonly ArtifactShardDescriptor[],
): ArtifactShardIntervalIndex {
  for (const shard of shards) {
    if (!hasValidArtifactShardId(shard)) {
      throw new TypeError(`Artifact shard has an invalid stable ID: ${shard.shardId}`);
    }
  }
  const ordered = shards.toSorted(compareShardIndexOrder);
  let maxEnd = 0;
  return {
    type: 'agent-timeline-artifact-shard-index',
    schemaVersion: ARTIFACT_SHARD_INDEX_SCHEMA_VERSION,
    entries: ordered.map((shard) => {
      maxEnd = Math.max(maxEnd, shard.sourceRange.end);
      return { shard, maxEndThroughEntry: maxEnd };
    }),
  };
}

function overlaps(left: SourceTimeRange, right: SourceTimeRange): boolean {
  return left.start < right.end && left.end > right.start;
}

function intersection(left: SourceTimeRange, right: SourceTimeRange): SourceTimeRange | null {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start < end ? { start, end } : null;
}

export function mergeSourceTimeRanges(ranges: readonly SourceTimeRange[]): SourceTimeRange[] {
  if (ranges.length === 0) return [];
  const ordered = ranges.toSorted((left, right) => left.start - right.start || left.end - right.end);
  const result: SourceTimeRange[] = [];
  for (const range of ordered) {
    assertSourceTimeRange(range);
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      result.push({ ...range });
    }
  }
  return result;
}

export function findCoverageHoles(
  queryRange: SourceTimeRange,
  coverage: readonly SourceTimeRange[],
): SourceTimeRange[] {
  assertSourceTimeRange(queryRange);
  const clipped = coverage
    .map((range) => intersection(range, queryRange))
    .filter((range): range is SourceTimeRange => range !== null);
  const merged = mergeSourceTimeRanges(clipped);
  const holes: SourceTimeRange[] = [];
  let cursor = queryRange.start;
  for (const range of merged) {
    if (cursor < range.start) holes.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < queryRange.end) holes.push({ start: cursor, end: queryRange.end });
  return holes;
}

function subtractCoverage(range: SourceTimeRange, coverage: readonly SourceTimeRange[]): SourceTimeRange[] {
  const uncovered: SourceTimeRange[] = [];
  let cursor = range.start;
  for (const covered of coverage) {
    if (covered.end <= cursor) continue;
    if (covered.start >= range.end) break;
    if (cursor < covered.start) uncovered.push({ start: cursor, end: Math.min(covered.start, range.end) });
    cursor = Math.max(cursor, covered.end);
    if (cursor >= range.end) break;
  }
  if (cursor < range.end) uncovered.push({ start: cursor, end: range.end });
  return uncovered;
}

function includes<T>(values: readonly T[] | undefined, value: T): boolean {
  return values?.includes(value) ?? false;
}

function isCompatible(shard: ArtifactShardDescriptor, query: ArtifactShardQuery): boolean {
  if (
    shard.sourceIdentityHash !== query.sourceIdentityHash
    || shard.channel !== query.channel
    || shard.timeDomain !== query.timeDomain
    || shard.stateHash !== query.stateHash
  ) return false;
  if (shard.analyzerId !== query.analyzerId && !includes(query.compatibleAnalyzerIds, shard.analyzerId)) {
    return false;
  }
  if (
    shard.analyzerVersion !== query.analyzerVersion
    && !includes(query.compatibleAnalyzerVersions, shard.analyzerVersion)
  ) return false;
  if (shard.profile !== query.profile && !includes(query.compatibleProfiles, shard.profile)) return false;
  if (shard.modelId !== query.modelId) return false;
  if (
    shard.modelVersion !== query.modelVersion
    && !includes(query.compatibleModelVersions, shard.modelVersion ?? '')
  ) return false;
  return true;
}

function comparePreference(
  query: ArtifactShardQuery,
  left: ArtifactShardDescriptor,
  right: ArtifactShardDescriptor,
): number {
  const leftAnalyzer = Number(left.analyzerId === query.analyzerId);
  const rightAnalyzer = Number(right.analyzerId === query.analyzerId);
  const leftVersion = Number(left.analyzerVersion === query.analyzerVersion);
  const rightVersion = Number(right.analyzerVersion === query.analyzerVersion);
  const leftProfile = Number(left.profile === query.profile);
  const rightProfile = Number(right.profile === query.profile);
  const leftModel = Number(left.modelVersion === query.modelVersion);
  const rightModel = Number(right.modelVersion === query.modelVersion);
  return rightAnalyzer - leftAnalyzer
    || rightVersion - leftVersion
    || rightProfile - leftProfile
    || rightModel - leftModel
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || compareText(left.shardId, right.shardId);
}

function findOverlappingCompatibleShards(
  index: ArtifactShardIntervalIndex,
  query: ArtifactShardQuery,
): ArtifactShardDescriptor[] {
  let low = 0;
  let high = index.entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.entries[middle].shard.sourceRange.start < query.sourceRange.end) low = middle + 1;
    else high = middle;
  }

  const matches: ArtifactShardDescriptor[] = [];
  for (let entryIndex = low - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = index.entries[entryIndex];
    if (entry.maxEndThroughEntry <= query.sourceRange.start) break;
    if (overlaps(entry.shard.sourceRange, query.sourceRange) && isCompatible(entry.shard, query)) {
      matches.push(entry.shard);
    }
  }
  return matches;
}

export function queryArtifactShardIndex(
  index: ArtifactShardIntervalIndex,
  query: ArtifactShardQuery,
): ArtifactShardQueryResult {
  assertSourceTimeRange(query.sourceRange);
  const candidates = findOverlappingCompatibleShards(index, query)
    .toSorted((left, right) => comparePreference(query, left, right));
  const selections: ArtifactShardSelection[] = [];
  let coverage: SourceTimeRange[] = [];

  for (const shard of candidates) {
    const clipped = intersection(shard.sourceRange, query.sourceRange);
    if (!clipped) continue;
    const selectedRanges = subtractCoverage(clipped, coverage);
    if (selectedRanges.length === 0) continue;
    selections.push({ shard, selectedRanges });
    coverage = mergeSourceTimeRanges([...coverage, ...selectedRanges]);
    if (coverage.length === 1
      && coverage[0].start === query.sourceRange.start
      && coverage[0].end === query.sourceRange.end) break;
  }

  return {
    queryRange: { ...query.sourceRange },
    selections,
    coverage,
    holes: findCoverageHoles(query.sourceRange, coverage),
    coveredDuration: coverage.reduce((total, range) => total + range.end - range.start, 0),
  };
}

function sameReplacementScope(
  left: ArtifactShardDescriptor,
  right: ArtifactShardDescriptor,
): boolean {
  return left.sourceIdentityHash === right.sourceIdentityHash
    && left.channel === right.channel
    && left.analyzerId === right.analyzerId
    && left.analyzerVersion === right.analyzerVersion
    && left.artifactSchemaVersion === right.artifactSchemaVersion
    && left.modelId === right.modelId
    && left.modelVersion === right.modelVersion
    && left.profile === right.profile
    && left.timeDomain === right.timeDomain
    && left.stateHash === right.stateHash;
}

export function writeArtifactShards(
  index: ArtifactShardIntervalIndex,
  incoming: readonly ArtifactShardDescriptor[],
  mode: ArtifactShardWriteMode,
): ArtifactShardIntervalIndex {
  const retained = mode === 'append'
    ? index.entries.map((entry) => entry.shard)
    : index.entries
      .map((entry) => entry.shard)
      .filter((existing) => !incoming.some((next) => (
        sameReplacementScope(existing, next) && overlaps(existing.sourceRange, next.sourceRange)
      )));
  const byId = new Map(retained.map((shard) => [shard.shardId, shard]));
  for (const shard of incoming) byId.set(shard.shardId, shard);
  return createArtifactShardIntervalIndex([...byId.values()]);
}

