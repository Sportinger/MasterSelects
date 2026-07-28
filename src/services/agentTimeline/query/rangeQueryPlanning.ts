import type {
  AgentTimelineArtifactChannel,
  ArtifactShardDescriptor,
  ArtifactShardIntervalIndex,
  SourceTimeRange,
} from '../../../types/agentTimeline/artifactShard';
import type {
  AgentTimelineArtifactRef,
  AgentTimelineChannel,
  AgentTimelineCoverageSummary,
  AgentTimelineEvent,
  AgentTimelineManifest,
} from '../../../types/agentTimeline/manifest';
import type { OccurrenceMappingIndex } from '../../../types/agentTimeline/occurrenceMapping';
import type {
  AgentTimelineRangeQuery,
  PlannedShardRead,
} from '../../../types/agentTimeline/query';
import {
  findCoverageHoles,
  mergeSourceTimeRanges,
  queryArtifactShardIndex,
} from '../artifacts/artifactShardIndex';
import { projectCompositionInterval } from '../mapping/occurrenceMappingQueries';

const CHANNEL_ARTIFACT: Record<AgentTimelineChannel, AgentTimelineArtifactChannel> = {
  cuts: 'cuts',
  shots: 'shots',
  scenes: 'scene-blocks',
  speech: 'transcript',
  people: 'faces',
  'active-speaker': 'active-speaker',
  'camera-motion': 'camera-motion',
  audio: 'audio',
  quality: 'quality',
  text: 'ocr',
  duplicates: 'redundancy',
};

const CHANNEL_EVENTS: Record<AgentTimelineChannel, readonly AgentTimelineEvent['type'][]> = {
  cuts: ['cut'],
  shots: ['shot'],
  scenes: ['scene-block'],
  speech: ['speech', 'speech-marker'],
  people: ['person-visible'],
  'active-speaker': ['active-speaker'],
  'camera-motion': ['camera-motion'],
  audio: ['audio-activity'],
  quality: ['quality-issue'],
  text: ['onscreen-text'],
  duplicates: ['duplicate-group'],
};

function isProfileUsable(
  artifact: AgentTimelineArtifactRef,
  requested: AgentTimelineManifest['profile'],
): boolean {
  const rank = { quick: 0, balanced: 1, deep: 2 } as const;
  if (artifact.profile === 'custom' || requested === 'custom') return artifact.profile === requested;
  return rank[artifact.profile] >= rank[requested];
}

function matchesScope(
  segment: OccurrenceMappingIndex['segments'][number],
  query: AgentTimelineRangeQuery,
  sourceId: string,
): boolean {
  if (segment.sourceId !== sourceId) return false;
  if (query.scope.clipId && segment.clipId !== query.scope.clipId) return false;
  if (query.scope.compositionPath) {
    const expected = query.scope.compositionPath;
    if (segment.compositionPath.length !== expected.length ||
        !segment.compositionPath.every((part, index) => part === expected[index])) return false;
  }
  if (query.scope.compositionId && !segment.compositionPath.includes(query.scope.compositionId)) return false;
  return true;
}

function tinyPointRange(time: number, duration: number): SourceTimeRange | undefined {
  const end = Math.min(duration, time + 1e-6);
  if (end > time) return { start: time, end };
  const start = Math.max(0, time - 1e-6);
  return time > start ? { start, end: time } : undefined;
}

function sourceRangesForCompositionWindow(
  mapping: OccurrenceMappingIndex,
  query: AgentTimelineRangeQuery,
  sourceId: string,
  duration: number,
): readonly SourceTimeRange[] {
  const paths = new Map<string, readonly string[]>();
  for (const segment of mapping.segments) {
    if (matchesScope(segment, query, sourceId)) {
      paths.set(JSON.stringify(segment.compositionPath), segment.compositionPath);
    }
  }
  const ranges: SourceTimeRange[] = [];
  for (const path of paths.values()) {
    const projected = projectCompositionInterval(mapping, {
      compositionPath: path,
      sourceId,
      compositionRange: { start: query.start, end: query.end },
    });
    for (const item of projected) {
      if (query.scope.clipId && item.clipId !== query.scope.clipId) continue;
      if (item.kind === 'hold') {
        const pointRange = tinyPointRange(item.sourceTime ?? item.sourceStart, duration);
        if (pointRange) ranges.push(pointRange);
      } else if (item.sourceRange && item.sourceRange.end > item.sourceRange.start) {
        ranges.push(item.sourceRange);
      }
    }
  }
  return mergeSourceTimeRanges(ranges);
}

function sourceRangesForClipLocalWindow(
  mapping: OccurrenceMappingIndex,
  query: AgentTimelineRangeQuery,
  sourceId: string,
  duration: number,
): readonly SourceTimeRange[] {
  const segments = mapping.segments.filter(segment => matchesScope(segment, query, sourceId));
  const byOccurrence = new Map<string, typeof segments>();
  for (const segment of segments) {
    const occurrenceSegments = byOccurrence.get(segment.occurrenceId) ?? [];
    byOccurrence.set(segment.occurrenceId, [...occurrenceSegments, segment]);
  }
  const ranges: SourceTimeRange[] = [];
  for (const occurrenceSegments of byOccurrence.values()) {
    const origin = Math.min(...occurrenceSegments.map(segment => segment.compositionRange.start));
    const path = occurrenceSegments[0].compositionPath;
    const projected = projectCompositionInterval(mapping, {
      compositionPath: path,
      sourceId,
      compositionRange: { start: origin + query.start, end: origin + query.end },
    }).filter(item => item.occurrenceId === occurrenceSegments[0].occurrenceId);
    for (const item of projected) {
      if (item.kind === 'hold') {
        const pointRange = tinyPointRange(item.sourceTime ?? item.sourceStart, duration);
        if (pointRange) ranges.push(pointRange);
      } else if (item.sourceRange && item.sourceRange.end > item.sourceRange.start) {
        ranges.push(item.sourceRange);
      }
    }
  }
  return mergeSourceTimeRanges(ranges);
}

export function planCanonicalSourceRanges(
  manifest: AgentTimelineManifest,
  query: AgentTimelineRangeQuery,
  mapping: OccurrenceMappingIndex | undefined,
  sourceId: string,
): readonly SourceTimeRange[] {
  if (query.timeDomain === 'source') return [{ start: query.start, end: query.end }];
  if (!mapping) return [];
  return query.timeDomain === 'composition'
    ? sourceRangesForCompositionWindow(mapping, query, sourceId, manifest.durationSeconds)
    : sourceRangesForClipLocalWindow(mapping, query, sourceId, manifest.durationSeconds);
}

function descriptorsForRefs(
  index: ArtifactShardIntervalIndex,
  artifactChannel: AgentTimelineArtifactChannel,
  artifactRefs: ReadonlySet<string>,
): ArtifactShardIntervalIndex {
  return {
    ...index,
    entries: index.entries.filter(entry =>
      entry.shard.channel === artifactChannel && artifactRefs.has(entry.shard.artifactRef)),
  };
}

function subtractRanges(
  ranges: readonly SourceTimeRange[],
  covered: readonly SourceTimeRange[],
): readonly SourceTimeRange[] {
  return ranges.flatMap(range => findCoverageHoles(range, covered));
}

interface ChannelPlan {
  reads: readonly PlannedShardRead[];
  coverage: AgentTimelineCoverageSummary;
}

export function planChannelShardReads(
  manifest: AgentTimelineManifest,
  index: ArtifactShardIntervalIndex,
  channel: AgentTimelineChannel,
  sourceRanges: readonly SourceTimeRange[],
): ChannelPlan {
  const channelManifest = manifest.channels[channel];
  const compatibleRefs = channelManifest.artifacts
    .filter(artifact => artifact.timeDomain === 'source' && isProfileUsable(artifact, manifest.profile))
    .toSorted((left, right) =>
      Number(right.profile === manifest.profile) - Number(left.profile === manifest.profile) ||
      left.artifactRef.localeCompare(right.artifactRef));
  const compatibleArtifactRefs = new Set(compatibleRefs.map(artifact => artifact.artifactRef));
  const filteredIndex = descriptorsForRefs(index, CHANNEL_ARTIFACT[channel], compatibleArtifactRefs);
  const readsByShard = new Map<string, { shard: ArtifactShardDescriptor; ranges: SourceTimeRange[] }>();
  let covered: SourceTimeRange[] = [];

  for (const artifact of compatibleRefs) {
    for (const requestedRange of subtractRanges(sourceRanges, covered)) {
      const result = queryArtifactShardIndex(filteredIndex, {
        sourceIdentityHash: manifest.sourceIdentity.hash,
        channel: CHANNEL_ARTIFACT[channel],
        sourceRange: requestedRange,
        analyzerId: artifact.analyzerId,
        analyzerVersion: artifact.analyzerVersion,
        modelId: artifact.modelId,
        modelVersion: artifact.modelVersion,
        profile: artifact.profile,
        timeDomain: 'source',
      });
      for (const selection of result.selections) {
        if (!compatibleArtifactRefs.has(selection.shard.artifactRef)) continue;
        const current = readsByShard.get(selection.shard.shardId);
        readsByShard.set(selection.shard.shardId, {
          shard: selection.shard,
          ranges: [...(current?.ranges ?? []), ...selection.selectedRanges],
        });
        covered = mergeSourceTimeRanges([...covered, ...selection.selectedRanges]);
      }
    }
  }

  const missing = sourceRanges.flatMap(range => findCoverageHoles(range, covered));
  const staleArtifactRefs = channelManifest.artifacts
    .filter(artifact => !compatibleArtifactRefs.has(artifact.artifactRef))
    .map(artifact => artifact.artifactRef)
    .toSorted();
  const status: AgentTimelineCoverageSummary['status'] =
    channelManifest.status === 'failed' && covered.length === 0 ? 'failed'
      : missing.length === 0 ? 'complete'
        : covered.length > 0 ? 'partial'
          : staleArtifactRefs.length > 0 || channelManifest.status === 'stale' ? 'stale'
            : 'missing';
  return {
    reads: Array.from(readsByShard.values())
      .map(({ shard, ranges }) => ({
        shard,
        sourceRanges: mergeSourceTimeRanges(ranges),
        eventTypes: CHANNEL_EVENTS[channel],
        channel,
      }))
      .toSorted((left, right) => left.shard.sourceRange.start - right.shard.sourceRange.start ||
        left.shard.shardId.localeCompare(right.shard.shardId)),
    coverage: {
      channel,
      status,
      covered,
      missing,
      artifactRefs: Array.from(readsByShard.values()).map(value => value.shard.artifactRef).toSorted(),
      staleArtifactRefs,
      error: status === 'failed' ? channelManifest.error : undefined,
    },
  };
}

export function eventTypesForChannels(
  channels: readonly AgentTimelineChannel[],
): ReadonlySet<AgentTimelineEvent['type']> {
  return new Set(channels.flatMap(channel => CHANNEL_EVENTS[channel]));
}
