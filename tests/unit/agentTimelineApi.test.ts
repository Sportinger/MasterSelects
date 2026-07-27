import { describe, expect, it, vi } from 'vitest';
import { createAgentTimelineReadApi } from '../../src/services/agentTimeline/api/agentTimelineReadApi';
import { createArtifactShardDescriptor } from '../../src/services/agentTimeline/artifacts/artifactShardDescriptor';
import { createArtifactShardIntervalIndex } from '../../src/services/agentTimeline/artifacts/artifactShardIndex';
import { buildOccurrenceMappingIndex } from '../../src/services/agentTimeline/mapping/occurrenceMappingIndex';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineArtifactRef,
  type AgentTimelineChannel,
  type AgentTimelineEvent,
  type AgentTimelineManifest,
} from '../../src/types/agentTimeline/manifest';
import type {
  AgentTimelineReadSourceResolver,
  AgentTimelineSelectedRangeRequest,
  ResolvedAgentTimelineReadSource,
} from '../../src/types/agentTimeline/api';
import type {
  AgentTimelineShardReadRequest,
  AgentTimelineShardReader,
} from '../../src/types/agentTimeline/query';
import type {
  AgentTimelineArtifactChannel,
  ArtifactShardDescriptor,
  SourceTimeRange,
} from '../../src/types/agentTimeline/artifactShard';
import { SOURCE_IDENTITY_SCHEMA_VERSION } from '../../src/types/agentTimeline/sourceIdentity';

const SOURCE_HASH = 'cd'.repeat(32);
const CHANNELS: AgentTimelineChannel[] = [
  'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
  'camera-motion', 'audio', 'quality', 'text', 'duplicates',
];

function descriptor(
  channel: AgentTimelineArtifactChannel = 'cuts',
  artifactRef = 'cuts/main.json',
  sourceRange: SourceTimeRange = { start: 0, end: 30 },
): ArtifactShardDescriptor {
  return createArtifactShardDescriptor({
    sourceIdentityHash: SOURCE_HASH,
    channel,
    analyzerId: channel === 'transcript' ? 'transcriber' : 'cut-detector',
    analyzerVersion: '1',
    artifactSchemaVersion: `${channel}/v1`,
    profile: 'balanced',
    sourceRange,
    artifactRef,
    sizeBytes: 100,
    createdAt: '2026-07-26T20:00:00.000Z',
    timeDomain: 'source',
  });
}

function artifactReference(
  shard: ArtifactShardDescriptor,
  channel: AgentTimelineChannel,
): AgentTimelineArtifactRef {
  const eventType = channel === 'speech' ? 'speech' as const : 'cut' as const;
  return {
    artifactRef: shard.artifactRef,
    shardId: shard.shardId,
    schemaVersion: shard.artifactSchemaVersion,
    analyzerId: shard.analyzerId,
    analyzerVersion: shard.analyzerVersion,
    profile: shard.profile,
    timeDomain: 'source',
    eventTypes: [eventType],
    coverage: [shard.sourceRange],
    byteLength: shard.sizeBytes,
  };
}

function manifest(
  refs: Partial<Record<AgentTimelineChannel, readonly ArtifactShardDescriptor[]>>,
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
      metadata: { size: 1000, mediaType: 'video/mp4' },
    },
    durationSeconds: 30,
    generatedAt: '2026-07-26T20:00:00.000Z',
    profile: 'balanced',
    channels: Object.fromEntries(CHANNELS.map((channel) => {
      const shards = refs[channel] ?? [];
      return [channel, {
        status: shards.length > 0 ? 'complete' : 'missing',
        artifacts: shards.map((shard) => artifactReference(shard, channel)),
      }];
    })) as AgentTimelineManifest['channels'],
  };
}

function cut(id: string, time: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'cut',
    time: { temporalKind: 'point', timeDomain: 'source', time },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'cut-detector', analyzerVersion: '1' }],
    data: { score: 0.9, transition: 'hard' },
  };
}

function speech(id: string, time: number, text: string): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'speech',
    time: { temporalKind: 'interval', timeDomain: 'source', start: time, end: time + 0.5 },
    confidence: 0.8,
    provenance: [{ kind: 'analyzer', analyzerId: 'transcriber', analyzerVersion: '1' }],
    data: { speakerId: 'speaker-1', text, wordCount: 1 },
  };
}

class Reader implements AgentTimelineShardReader {
  readonly requests: AgentTimelineShardReadRequest[] = [];

  constructor(private readonly events: Readonly<Record<string, readonly AgentTimelineEvent[]>>) {}

  async readEvents(request: AgentTimelineShardReadRequest): Promise<readonly AgentTimelineEvent[]> {
    this.requests.push(request);
    return this.events[request.shard.shardId] ?? [];
  }
}

function resolverFor(source: ResolvedAgentTimelineReadSource): AgentTimelineReadSourceResolver & {
  resolve: ReturnType<typeof vi.fn<AgentTimelineReadSourceResolver['resolve']>>;
} {
  return {
    resolve: vi.fn<AgentTimelineReadSourceResolver['resolve']>().mockResolvedValue(source),
  };
}

function request(
  overrides: Partial<AgentTimelineSelectedRangeRequest> = {},
): AgentTimelineSelectedRangeRequest {
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

describe('Agent Timeline read API', () => {
  it('returns a bounded selected source range and never requests frame payloads', async () => {
    const shard = descriptor();
    const reader = new Reader({ [shard.shardId]: [cut('outside', 12), cut('inside', 3)] });
    const resolver = resolverFor({
      manifest: manifest({ cuts: [shard] }),
      shardIndex: createArtifactShardIntervalIndex([shard]),
      shardReader: reader,
    });
    const api = createAgentTimelineReadApi(resolver);

    const result = await api.getSelectedRange(request({
      channels: ['cuts', 'cuts'],
      page: { limit: 900 },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bounds).toEqual({ limit: 500, maxBytes: 256 * 1024 });
    expect(result.page.events.map((event) => event.id)).toEqual(['inside']);
    expect(result.page.query).toMatchObject({
      start: 0,
      end: 10,
      timeDomain: 'source',
      channels: ['cuts'],
      includeFrames: false,
    });
    expect(reader.requests).toHaveLength(1);
    expect(reader.requests[0]).toMatchObject({
      sourceRanges: [{ start: 0, end: 10 }],
      includeFrames: false,
    });
    expect(JSON.stringify(result)).not.toContain('screenshots');
  });

  it('paginates with an opaque cursor and preserves honest coverage on every page', async () => {
    const shard = descriptor();
    const reader = new Reader({
      [shard.shardId]: [cut('third', 3), cut('first', 1), cut('second', 2)],
    });
    const source = {
      manifest: manifest({ cuts: [shard] }),
      shardIndex: createArtifactShardIntervalIndex([shard]),
      shardReader: reader,
    };
    const api = createAgentTimelineReadApi(resolverFor(source));
    const first = await api.getSelectedRange(request({ page: { limit: 2 } }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await api.getSelectedRange(request({
      page: { limit: 2, cursor: first.page.nextCursor },
    }));

    expect(first.page.events.map((event) => event.id)).toEqual(['first', 'second']);
    expect(first.page.truncation).toMatchObject({ truncated: true, reason: 'event-limit' });
    expect(first.page.coverage[0]).toMatchObject({
      channel: 'cuts',
      status: 'complete',
      covered: [{ start: 0, end: 10 }],
      missing: [],
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.page.events.map((event) => event.id)).toEqual(['third']);
  });

  it('preserves repeated composition occurrences and the canonical source event', async () => {
    const shard = descriptor();
    const reader = new Reader({ [shard.shardId]: [cut('canonical-cut', 2)] });
    const mapping = buildOccurrenceMappingIndex({
      stateHash: 'timeline-state-a',
      occurrences: [
        {
          sourceId: 'media-a',
          clipId: 'clip-a',
          compositionPath: ['root'],
          sourceRange: { start: 0, end: 10 },
          pieces: [{ compositionStart: 0, compositionEnd: 10, sourceStart: 0, sourceRateStart: 1 }],
        },
        {
          sourceId: 'media-a',
          clipId: 'clip-b',
          compositionPath: ['root'],
          sourceRange: { start: 0, end: 10 },
          pieces: [{ compositionStart: 20, compositionEnd: 30, sourceStart: 10, sourceRateStart: -1 }],
        },
      ],
    });
    const api = createAgentTimelineReadApi(resolverFor({
      manifest: manifest({ cuts: [shard] }),
      shardIndex: createArtifactShardIntervalIndex([shard]),
      shardReader: reader,
      occurrenceMapping: mapping,
    }));

    const result = await api.getSelectedRange(request({
      scope: { mediaFileId: 'media-a', compositionPath: ['root'] },
      start: 0,
      end: 30,
      timeDomain: 'composition',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.occurrenceStateHash).toBe('timeline-state-a');
    expect(result.page.events.map((event) => event.id)).toEqual(['canonical-cut']);
    expect(result.page.occurrences.map((occurrence) => occurrence.occurrenceId)).toHaveLength(2);
    expect(result.page.coverageTimeDomain).toBe('source');
  });

  it('reports partial and missing channels without treating them as empty results', async () => {
    const shard = descriptor('cuts', 'cuts/partial.json', { start: 0, end: 4 });
    const partialManifest = manifest({ cuts: [shard] });
    const reader = new Reader({ [shard.shardId]: [cut('known', 2)] });
    const api = createAgentTimelineReadApi(resolverFor({
      manifest: partialManifest,
      shardIndex: createArtifactShardIntervalIndex([shard]),
      shardReader: reader,
    }));

    const result = await api.getSelectedRange(request({ channels: ['speech', 'cuts'] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.coverage).toEqual([
      expect.objectContaining({
        channel: 'cuts',
        status: 'partial',
        covered: [{ start: 0, end: 4 }],
        missing: [{ start: 4, end: 10 }],
      }),
      expect.objectContaining({
        channel: 'speech',
        status: 'missing',
        covered: [],
        missing: [{ start: 0, end: 10 }],
      }),
    ]);
    expect(result.page.missingChannels).toEqual(['cuts', 'speech']);
  });

  it('enforces the page byte budget and resumes without losing events', async () => {
    const shard = descriptor('transcript', 'transcript/main.json');
    const text = 'x'.repeat(1_600);
    const reader = new Reader({
      [shard.shardId]: [speech('speech-a', 1, text), speech('speech-b', 2, text)],
    });
    const api = createAgentTimelineReadApi(resolverFor({
      manifest: manifest({ speech: [shard] }),
      shardIndex: createArtifactShardIntervalIndex([shard]),
      shardReader: reader,
    }));

    const first = await api.getSelectedRange(request({
      channels: ['speech'],
      page: { maxBytes: 3_200 },
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await api.getSelectedRange(request({
      channels: ['speech'],
      page: { maxBytes: 3_200, cursor: first.page.nextCursor },
    }));

    expect(first.page.events.map((event) => event.id)).toEqual(['speech-a']);
    expect(first.page.truncation.reason).toBe('byte-limit');
    expect(new TextEncoder().encode(JSON.stringify(first.page)).byteLength).toBeLessThanOrEqual(3_200);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.page.events.map((event) => event.id)).toEqual(['speech-b']);
  });

  it('returns structured failures for forbidden frames, unresolved scopes, and bad cursors', async () => {
    const shard = descriptor();
    const source = {
      manifest: manifest({ cuts: [shard] }),
      shardIndex: createArtifactShardIntervalIndex([shard]),
      shardReader: new Reader({ [shard.shardId]: [cut('cut', 1), cut('cut-2', 2)] }),
    };
    const resolver = resolverFor(source);
    const api = createAgentTimelineReadApi(resolver);
    const forbidden = await api.getSelectedRange({
      ...request(),
      includeFrames: true,
    } as unknown as AgentTimelineSelectedRangeRequest);
    const missingApi = createAgentTimelineReadApi({ resolve: vi.fn().mockResolvedValue(null) });
    const missing = await missingApi.getSelectedRange(request());
    const first = await api.getSelectedRange(request({ page: { limit: 1 } }));
    const badCursor = await api.getSelectedRange(request({
      start: 1,
      page: { cursor: first.ok ? first.page.nextCursor : undefined },
    }));

    expect(forbidden).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(missing).toMatchObject({ ok: false, error: { code: 'scope-not-found' } });
    expect(badCursor).toMatchObject({ ok: false, error: { code: 'cursor-invalid' } });
  });
});
