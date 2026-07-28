import {
  LEGACY_ADAPTER_VIEW_SCHEMA_VERSION,
  type LegacyAdapterRecord,
  type LegacyArtifactShardView,
} from '../../../../types/agentTimeline/legacyAdapters';
import type {
  AgentTimelineArtifactChannel,
  ArtifactShardDescriptor,
  SourceTimeRange,
} from '../../../../types/agentTimeline/artifactShard';
import type {
  AgentTimelineArtifactRef,
  AgentTimelineChannel,
  AgentTimelineChannelManifest,
  AgentTimelineEvent,
  AgentTimelineProfile,
} from '../../../../types/agentTimeline/manifest';
import { createArtifactShardDescriptor } from '../../artifacts/artifactShardDescriptor';
import { mergeSourceTimeRanges } from '../../artifacts/artifactShardIndex';
import type { InMemoryLegacyShardPayload } from './inMemoryLegacyShardReader';

const CHANNEL_ARTIFACT: Partial<Record<AgentTimelineChannel, AgentTimelineArtifactChannel>> = {
  cuts: 'cuts',
  scenes: 'scene-blocks',
  speech: 'transcript',
  people: 'faces',
  'camera-motion': 'camera-motion',
  audio: 'audio',
  quality: 'quality',
};

const CHANNEL_EVENTS: Partial<Record<AgentTimelineChannel, AgentTimelineEvent['type'][]>> = {
  cuts: ['cut'],
  scenes: ['scene-block'],
  speech: ['speech', 'speech-marker'],
  people: ['person-visible'],
  'camera-motion': ['camera-motion'],
  audio: ['audio-activity'],
  quality: ['quality-issue'],
};

/**
 * Legacy artifacts can be monolithic. Persisted materializations are sliced
 * into fixed source-time windows so a narrow long-source query never needs to
 * deserialize an entire transcript or face payload.
 */
export const LEGACY_EVENT_SHARD_MAX_SECONDS = 60;

export interface NamedLegacyView {
  name: string;
  view: LegacyArtifactShardView<LegacyAdapterRecord>;
}

export interface MaterializedLegacyViews {
  descriptors: ArtifactShardDescriptor[];
  payloads: InMemoryLegacyShardPayload[];
  channels: Partial<Record<AgentTimelineChannel, AgentTimelineChannelManifest>>;
}

function stableArtifactRef(
  mediaFileId: string,
  named: NamedLegacyView,
  range: SourceTimeRange,
): string {
  const state = named.view.stateHash ?? 'source';
  return [
    'legacy-memory',
    encodeURIComponent(mediaFileId),
    encodeURIComponent(named.name),
    named.view.timeDomain,
    encodeURIComponent(state),
    `${range.start.toFixed(6)}-${range.end.toFixed(6)}`,
  ].join('/');
}

function splitRange(range: SourceTimeRange): SourceTimeRange[] {
  const shards: SourceTimeRange[] = [];
  for (let start = range.start; start < range.end;) {
    const end = Math.min(range.end, start + LEGACY_EVENT_SHARD_MAX_SECONDS);
    shards.push({ start, end });
    start = end;
  }
  return shards;
}

function eventStart(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.start;
}

function eventEnd(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.end;
}

/** Assign each event once, by its start, while retaining interval containment. */
function eventsForRange(
  events: readonly AgentTimelineEvent[],
  eventTypes: readonly AgentTimelineEvent['type'][],
  range: SourceTimeRange,
): AgentTimelineEvent[] {
  return events
    .filter(event => eventTypes.includes(event.type) && eventStart(event) >= range.start && eventStart(event) < range.end)
    .toSorted((left, right) => eventStart(left) - eventStart(right) || left.id.localeCompare(right.id));
}

function descriptorRange(range: SourceTimeRange, events: readonly AgentTimelineEvent[]): SourceTimeRange {
  return {
    start: Math.min(range.start, ...events.map(eventStart)),
    end: Math.max(range.end, ...events.map(eventEnd)),
  };
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function manifestRef(
  descriptor: ArtifactShardDescriptor,
  eventTypes: AgentTimelineEvent['type'][],
): AgentTimelineArtifactRef {
  return {
    artifactRef: descriptor.artifactRef,
    shardId: descriptor.shardId,
    schemaVersion: descriptor.artifactSchemaVersion,
    analyzerId: descriptor.analyzerId,
    analyzerVersion: descriptor.analyzerVersion,
    profile: descriptor.profile,
    timeDomain: descriptor.timeDomain,
    stateHash: descriptor.stateHash,
    eventTypes: [...eventTypes],
    coverage: [{ ...descriptor.sourceRange }],
    byteLength: descriptor.sizeBytes,
  };
}

function sourceStatus(
  views: readonly LegacyArtifactShardView<LegacyAdapterRecord>[],
  descriptors: readonly ArtifactShardDescriptor[],
  durationSeconds: number,
): AgentTimelineChannelManifest['status'] {
  const sourceViews = views.filter((view) => view.timeDomain === 'source');
  const sourceCoverage = mergeSourceTimeRanges(descriptors
    .filter((descriptor) => descriptor.timeDomain === 'source')
    .map((descriptor) => descriptor.sourceRange));
  if (sourceViews.some((view) => view.status === 'failed')) return 'failed';
  if (sourceViews.some((view) => view.status === 'partial')) return 'partial';
  if (sourceViews.some((view) => view.status === 'stale') && sourceCoverage.length === 0) return 'stale';
  const complete = sourceCoverage.length === 1
    && sourceCoverage[0].start === 0
    && sourceCoverage[0].end >= durationSeconds
    && sourceViews.length > 0
    && sourceViews.every((view) => view.status === 'complete');
  if (complete) return 'complete';
  if (sourceCoverage.length > 0) return 'partial';
  return sourceViews.some((view) => view.status === 'stale') ? 'stale' : 'missing';
}

export function materializeLegacyViews(
  sourceIdentityHash: string,
  mediaFileId: string,
  durationSeconds: number,
  generatedAt: string,
  profile: AgentTimelineProfile,
  namedViews: readonly NamedLegacyView[],
): MaterializedLegacyViews {
  const descriptors: ArtifactShardDescriptor[] = [];
  const payloads: InMemoryLegacyShardPayload[] = [];
  const viewsByChannel = new Map<AgentTimelineChannel, LegacyArtifactShardView<LegacyAdapterRecord>[]>();

  for (const named of namedViews) {
    const artifactChannel = CHANNEL_ARTIFACT[named.view.channel];
    const eventTypes = CHANNEL_EVENTS[named.view.channel];
    if (!artifactChannel || !eventTypes) continue;
    const channelViews = viewsByChannel.get(named.view.channel) ?? [];
    channelViews.push(named.view);
    viewsByChannel.set(named.view.channel, channelViews);
    for (const coverageRange of named.view.coverage) {
      for (const range of splitRange(coverageRange)) {
        const events = eventsForRange(named.view.events, eventTypes, range);
        const sourceRange = descriptorRange(range, events);
        const descriptorInput = {
          sourceIdentityHash,
          channel: artifactChannel,
          analyzerId: `legacy-read-source:${artifactChannel}`,
          analyzerVersion: LEGACY_ADAPTER_VIEW_SCHEMA_VERSION,
          artifactSchemaVersion: named.view.schemaVersion,
          profile,
          sourceRange,
          artifactRef: stableArtifactRef(mediaFileId, named, sourceRange),
          sizeBytes: bytes(events),
          createdAt: generatedAt,
        } as const;
        const descriptor = named.view.timeDomain === 'source'
          ? createArtifactShardDescriptor({
            ...descriptorInput,
            timeDomain: 'source',
          })
          : createArtifactShardDescriptor({
            ...descriptorInput,
            timeDomain: named.view.timeDomain,
            stateHash: named.view.stateHash
              ?? (() => { throw new TypeError('Rendered legacy views require stateHash'); })(),
          });
        descriptors.push(descriptor);
        payloads.push({ descriptor, events });
      }
    }
  }

  const channels: MaterializedLegacyViews['channels'] = {};
  for (const [channel, views] of viewsByChannel) {
    const channelDescriptors = descriptors.filter((descriptor) => descriptor.channel === CHANNEL_ARTIFACT[channel]);
    channels[channel] = {
      status: sourceStatus(views, channelDescriptors, durationSeconds),
      artifacts: channelDescriptors.map((descriptor) => manifestRef(descriptor, CHANNEL_EVENTS[channel] ?? []))
        .toSorted((left, right) => left.coverage[0].start - right.coverage[0].start || left.shardId.localeCompare(right.shardId)),
      error: views.find((view) => view.status === 'failed')?.limitations.join('; ') || undefined,
    };
  }
  return {
    descriptors: descriptors.toSorted((left, right) => left.sourceRange.start - right.sourceRange.start || left.shardId.localeCompare(right.shardId)),
    payloads,
    channels,
  };
}
