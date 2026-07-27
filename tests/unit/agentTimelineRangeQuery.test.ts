import { describe, expect, it } from 'vitest';
import { createArtifactShardDescriptor } from '../../src/services/agentTimeline/artifacts/artifactShardDescriptor';
import { createArtifactShardIntervalIndex } from '../../src/services/agentTimeline/artifacts/artifactShardIndex';
import { buildOccurrenceMappingIndex } from '../../src/services/agentTimeline/mapping/occurrenceMappingIndex';
import { getAgentTimelineRange } from '../../src/services/agentTimeline/query/agentTimelineRangeQuery';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineArtifactRef,
  type AgentTimelineChannel,
  type AgentTimelineEvent,
  type AgentTimelineManifest,
} from '../../src/types/agentTimeline/manifest';
import type {
  ArtifactShardDescriptor,
  ArtifactShardDescriptorInput,
  SourceTimeRange,
} from '../../src/types/agentTimeline/artifactShard';
import type {
  AgentTimelineRangeQuery,
  AgentTimelineShardReadRequest,
  AgentTimelineShardReader,
} from '../../src/types/agentTimeline/query';
import { SOURCE_IDENTITY_SCHEMA_VERSION } from '../../src/types/agentTimeline/sourceIdentity';

const SOURCE_HASH = 'ab'.repeat(32);
const ALL_CHANNELS: AgentTimelineChannel[] = [
  'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
  'camera-motion', 'audio', 'quality', 'text', 'duplicates',
];
let shardCounter = 0;

function shard(
  sourceRange: SourceTimeRange,
  overrides: Partial<ArtifactShardDescriptorInput> = {},
): ArtifactShardDescriptor {
  shardCounter += 1;
  return createArtifactShardDescriptor({
    sourceIdentityHash: SOURCE_HASH,
    channel: 'cuts',
    analyzerId: 'cut-detector',
    analyzerVersion: '2',
    artifactSchemaVersion: 'cuts/v1',
    profile: 'balanced',
    sourceRange,
    artifactRef: `cuts/${shardCounter}.json`,
    sizeBytes: 100,
    createdAt: `2026-07-26T20:${String(shardCounter).padStart(2, '0')}:00.000Z`,
    timeDomain: 'source',
    ...overrides,
  });
}

function artifactRef(descriptor: ArtifactShardDescriptor): AgentTimelineArtifactRef {
  return {
    artifactRef: descriptor.artifactRef,
    shardId: descriptor.shardId,
    schemaVersion: descriptor.artifactSchemaVersion,
    analyzerId: descriptor.analyzerId,
    analyzerVersion: descriptor.analyzerVersion,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    profile: descriptor.profile,
    timeDomain: descriptor.timeDomain,
    stateHash: descriptor.stateHash,
    eventTypes: ['cut'],
    coverage: [descriptor.sourceRange],
    byteLength: descriptor.sizeBytes,
  };
}

function manifest(
  descriptors: readonly ArtifactShardDescriptor[],
  channel = 'cuts' as AgentTimelineChannel,
): AgentTimelineManifest {
  return {
    schemaVersion: AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
    mediaFileId: 'media-a',
    sourceIdentity: {
      type: 'source-identity',
      version: SOURCE_IDENTITY_SCHEMA_VERSION,
      strategy: 'sampled-chunks',
      hashAlgorithm: 'sha-256',
      hash: SOURCE_HASH,
      metadata: { size: 100, mediaType: 'video/mp4' },
    },
    durationSeconds: 40,
    generatedAt: '2026-07-26T20:00:00.000Z',
    profile: 'balanced',
    channels: Object.fromEntries(ALL_CHANNELS.map(item => [item, {
      status: item === channel ? 'complete' : 'missing',
      artifacts: item === channel ? descriptors.map(artifactRef) : [],
    }])) as AgentTimelineManifest['channels'],
  };
}

function cut(id: string, time: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'cut',
    time: { temporalKind: 'point', timeDomain: 'source', time },
    confidence: .9,
    provenance: [{ kind: 'analyzer', analyzerId: 'cut-detector', analyzerVersion: '2' }],
    data: { score: .9, transition: 'hard' },
  };
}

function speech(id: string, time: number, text: string): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'speech',
    time: { temporalKind: 'interval', timeDomain: 'source', start: time, end: time + .5 },
    confidence: .9,
    provenance: [{ kind: 'analyzer', analyzerId: 'transcriber', analyzerVersion: '1' }],
    data: { speakerId: 'speaker', text, wordCount: 1 },
  };
}

class RecordingReader implements AgentTimelineShardReader {
  readonly requests: AgentTimelineShardReadRequest[] = [];

  constructor(private readonly eventsByShard: Readonly<Record<string, readonly AgentTimelineEvent[]>>) {}

  async readEvents(request: AgentTimelineShardReadRequest): Promise<readonly AgentTimelineEvent[]> {
    this.requests.push(request);
    return this.eventsByShard[request.shard.shardId] ?? [];
  }
}

function query(overrides: Partial<AgentTimelineRangeQuery> = {}): AgentTimelineRangeQuery {
  return {
    scope: { mediaFileId: 'media-a' },
    start: 0,
    end: 10,
    timeDomain: 'source',
    granularity: 'event',
    channels: ['cuts'],
    ...overrides,
  };
}

describe('Agent Timeline range query', () => {
  it('paginates deterministically and binds cursors to the exact query', async () => {
    const descriptor = shard({ start: 0, end: 10 });
    const reader = new RecordingReader({
      [descriptor.shardId]: [cut('c', 3), cut('a', 1), cut('b', 2)],
    });
    const base = {
      manifest: manifest([descriptor]),
      shardIndex: createArtifactShardIntervalIndex([descriptor]),
      shardReader: reader,
    };
    const first = await getAgentTimelineRange({ ...base, query: query({ limit: 2 }) });
    const second = await getAgentTimelineRange({
      ...base,
      query: query({ limit: 2, cursor: first.nextCursor }),
    });

    expect(first.events.map(event => event.id)).toEqual(['a', 'b']);
    expect(first.truncation).toMatchObject({ truncated: true, reason: 'event-limit' });
    expect(second.events.map(event => event.id)).toEqual(['c']);
    expect(second.nextCursor).toBeUndefined();
    await expect(getAgentTimelineRange({
      ...base,
      query: query({ start: 1, limit: 2, cursor: first.nextCursor }),
    })).rejects.toThrow('cursor does not match this query');
  });

  it('reports coverage holes and gives the reader only selected subranges', async () => {
    const first = shard({ start: 0, end: 3 });
    const second = shard({ start: 5, end: 8 });
    const reader = new RecordingReader({
      [first.shardId]: [cut('inside-first', 2), cut('boundary', 5)],
      [second.shardId]: [cut('boundary', 5), cut('inside-second', 7)],
    });
    const result = await getAgentTimelineRange({
      query: query({ start: 1, end: 10 }),
      manifest: manifest([first, second]),
      shardIndex: createArtifactShardIntervalIndex([second, first]),
      shardReader: reader,
    });

    expect(result.events.map(event => event.id)).toEqual(['inside-first', 'boundary', 'inside-second']);
    expect(result.coverage[0]).toMatchObject({
      status: 'partial',
      covered: [{ start: 1, end: 3 }, { start: 5, end: 8 }],
      missing: [{ start: 3, end: 5 }, { start: 8, end: 10 }],
    });
    expect(reader.requests.map(request => request.sourceRanges)).toEqual([
      [{ start: 1, end: 3 }],
      [{ start: 5, end: 8 }],
    ]);
    expect(reader.requests.every(request => request.includeFrames === false)).toBe(true);
  });

  it('keeps one canonical event and returns repeated forward/reverse occurrences', async () => {
    const descriptor = shard({ start: 0, end: 10 });
    const reader = new RecordingReader({ [descriptor.shardId]: [cut('shared-cut', 2)] });
    const occurrenceMapping = buildOccurrenceMappingIndex({
      stateHash: 'timeline-state',
      occurrences: [
        {
          sourceId: 'media-a', clipId: 'forward', compositionPath: ['root'],
          sourceRange: { start: 0, end: 10 },
          pieces: [{ compositionStart: 0, compositionEnd: 10, sourceStart: 0, sourceRateStart: 1 }],
        },
        {
          sourceId: 'media-a', clipId: 'reverse', compositionPath: ['root'],
          sourceRange: { start: 0, end: 10 },
          pieces: [{ compositionStart: 20, compositionEnd: 30, sourceStart: 10, sourceRateStart: -1 }],
        },
      ],
    });
    const result = await getAgentTimelineRange({
      query: query({
        scope: { mediaFileId: 'media-a', compositionPath: ['root'] },
        timeDomain: 'composition',
        start: 0,
        end: 30,
      }),
      manifest: manifest([descriptor]),
      shardIndex: createArtifactShardIntervalIndex([descriptor]),
      shardReader: reader,
      occurrenceMapping,
    });

    expect(result.events.map(event => event.id)).toEqual(['shared-cut']);
    expect(result.occurrences.map(item => ({
      direction: item.direction,
      time: item.compositionTime.temporalKind === 'point' ? item.compositionTime.time : null,
    }))).toEqual([
      { direction: 'forward', time: 2 },
      { direction: 'reverse', time: 28 },
    ]);
    expect(reader.requests).toHaveLength(1);
  });

  it('truncates the whole response by bytes and resumes without losing an event', async () => {
    const descriptor = shard(
      { start: 0, end: 10 },
      {
        channel: 'transcript',
        analyzerId: 'transcriber',
        analyzerVersion: '1',
        artifactSchemaVersion: 'transcript/v1',
      },
    );
    const longText = 'x'.repeat(1_600);
    const reader = new RecordingReader({
      [descriptor.shardId]: [speech('speech-a', 1, longText), speech('speech-b', 2, longText)],
    });
    const base = {
      manifest: manifest([descriptor], 'speech'),
      shardIndex: createArtifactShardIntervalIndex([descriptor]),
      shardReader: reader,
    };
    const first = await getAgentTimelineRange({
      ...base,
      query: query({ channels: ['speech'] }),
      maxResponseBytes: 3_200,
    });
    const second = await getAgentTimelineRange({
      ...base,
      query: query({ channels: ['speech'], cursor: first.nextCursor }),
      maxResponseBytes: 3_200,
    });

    expect(first.events.map(event => event.id)).toEqual(['speech-a']);
    expect(first.truncation.reason).toBe('byte-limit');
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(3_200);
    expect(second.events.map(event => event.id)).toEqual(['speech-b']);
  });

  it('does not read stale rendered shards and reports the channel as stale', async () => {
    const stale = shard(
      { start: 0, end: 10 },
      { timeDomain: 'composition-rendered', stateHash: 'old-state' },
    );
    const staleManifest = manifest([stale]);
    staleManifest.channels.cuts.status = 'stale';
    const reader = new RecordingReader({ [stale.shardId]: [cut('stale', 2)] });
    const result = await getAgentTimelineRange({
      query: query({ start: 2, end: 3 }),
      manifest: staleManifest,
      shardIndex: createArtifactShardIntervalIndex([stale]),
      shardReader: reader,
    });

    expect(result.events).toEqual([]);
    expect(result.coverage[0]).toMatchObject({
      status: 'stale',
      staleArtifactRefs: [stale.artifactRef],
    });
    expect(result.missingChannels).toEqual(['cuts']);
    expect(reader.requests).toEqual([]);
  });

  it('never asks the reader to scan a full shard for a narrow range', async () => {
    const descriptor = shard({ start: 0, end: 40 });
    const reader = new RecordingReader({ [descriptor.shardId]: [cut('in', 12), cut('out', 20)] });
    const result = await getAgentTimelineRange({
      query: query({ start: 11, end: 13 }),
      manifest: manifest([descriptor]),
      shardIndex: createArtifactShardIntervalIndex([descriptor]),
      shardReader: reader,
    });

    expect(reader.requests).toHaveLength(1);
    expect(reader.requests[0].sourceRanges).toEqual([{ start: 11, end: 13 }]);
    expect(result.events.map(event => event.id)).toEqual(['in']);
  });
});
