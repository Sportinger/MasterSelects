import { describe, expect, it } from 'vitest';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineArtifactRef,
  type AgentTimelineChannel,
  type AgentTimelineEvent,
  type AgentTimelineManifest,
} from '../../src/types/agentTimeline/manifest';
import { SOURCE_IDENTITY_SCHEMA_VERSION } from '../../src/types/agentTimeline/sourceIdentity';
import {
  eventMatchesHalfOpenRange,
} from '../../src/services/agentTimeline/manifest/eventSemantics';
import {
  findMissingCoverage,
  isArtifactCompatible,
  isProfileCompatible,
  summarizeChannelCoverage,
} from '../../src/services/agentTimeline/manifest/coverage';
import {
  paginateAgentTimelineEvents,
} from '../../src/services/agentTimeline/manifest/pagination';
import {
  isEventTypeAllowedForChannel,
  serializeAgentTimelineManifest,
  validateAgentTimelineEvent,
  validateAgentTimelineManifest,
} from '../../src/services/agentTimeline/manifest/validation';

const CHANNELS: AgentTimelineChannel[] = [
  'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
  'camera-motion', 'audio', 'quality', 'text', 'duplicates',
];

function sourceArtifact(overrides: Partial<AgentTimelineArtifactRef> = {}): AgentTimelineArtifactRef {
  return {
    artifactRef: 'artifacts/cuts/000.json',
    shardId: 'cuts-000',
    schemaVersion: 'cuts/v1',
    analyzerId: 'cut-detector',
    analyzerVersion: '2.0.0',
    profile: 'balanced',
    timeDomain: 'source',
    eventTypes: ['cut'],
    coverage: [{ start: 0, end: 10 }],
    byteLength: 240,
    ...overrides,
  };
}

function manifest(): AgentTimelineManifest {
  return {
    schemaVersion: AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
    mediaFileId: 'media-1',
    sourceIdentity: {
      type: 'source-identity',
      version: SOURCE_IDENTITY_SCHEMA_VERSION,
      strategy: 'sampled-chunks',
      hashAlgorithm: 'sha-256',
      hash: 'aa'.repeat(32),
      metadata: { size: 1000, mediaType: 'video/mp4' },
    },
    durationSeconds: 20,
    generatedAt: '2026-07-26T20:00:00.000Z',
    profile: 'balanced',
    channels: Object.fromEntries(CHANNELS.map((channel) => [channel, {
      status: channel === 'cuts' ? 'partial' : 'missing',
      artifacts: channel === 'cuts' ? [sourceArtifact()] : [],
    }])) as AgentTimelineManifest['channels'],
  };
}

function cut(id: string, time: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'cut',
    time: { temporalKind: 'point', timeDomain: 'source', time },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'cut-detector', analyzerVersion: '2.0.0' }],
    data: { score: 0.9, transition: 'hard' },
  };
}

describe('Agent Timeline manifest contract', () => {
  it('serializes a versioned manifest without losing durable fields', () => {
    const value = manifest();
    expect(validateAgentTimelineManifest(value)).toEqual([]);
    expect(JSON.parse(serializeAgentTimelineManifest(value))).toEqual(value);
  });

  it('rejects rendered artifacts without a state hash and runtime objects', () => {
    const value = manifest();
    value.channels.cuts.artifacts[0] = sourceArtifact({ timeDomain: 'clip-rendered' });
    expect(validateAgentTimelineManifest(value)).toContain('cuts: rendered artifacts require stateHash');

    const withRuntime = manifest() as AgentTimelineManifest & { runtime: Blob };
    withRuntime.runtime = new Blob(['not durable']);
    expect(validateAgentTimelineManifest(withRuntime)).toContain('root.runtime contains a runtime object');
  });

  it('uses half-open point and interval semantics at both boundaries', () => {
    expect(eventMatchesHalfOpenRange(cut('at-start', 10), { start: 10, end: 20 })).toBe(true);
    expect(eventMatchesHalfOpenRange(cut('at-end', 20), { start: 10, end: 20 })).toBe(false);
    const interval: AgentTimelineEvent = {
      ...cut('interval', 0),
      type: 'shot',
      time: { temporalKind: 'interval', timeDomain: 'source', start: 0, end: 10 },
      data: { shotId: 'shot-1' },
    };
    expect(eventMatchesHalfOpenRange(interval, { start: 10, end: 20 })).toBe(false);
    expect(eventMatchesHalfOpenRange(interval, { start: 9.999, end: 20 })).toBe(true);
    expect(validateAgentTimelineEvent(interval)).toEqual([]);
  });

  it('selects only compatible versions, profiles, domains and state hashes', () => {
    expect(isProfileCompatible('deep', 'balanced')).toBe(true);
    expect(isProfileCompatible('quick', 'balanced')).toBe(false);
    expect(isProfileCompatible('custom', 'custom')).toBe(true);
    expect(isProfileCompatible('deep', 'custom')).toBe(false);
    const rendered = sourceArtifact({ timeDomain: 'composition-rendered', stateHash: 'state-a' });
    expect(isArtifactCompatible(rendered, {
      profile: 'quick', timeDomain: 'composition-rendered', stateHash: 'state-a', analyzerVersion: '2.0.0',
    })).toBe(true);
    expect(isArtifactCompatible(rendered, {
      profile: 'quick', timeDomain: 'composition-rendered', stateHash: 'state-b', analyzerVersion: '2.0.0',
    })).toBe(false);
  });

  it('reports complete, partial, stale and missing coverage explicitly', () => {
    expect(findMissingCoverage([{ start: 0, end: 4 }, { start: 6, end: 10 }], { start: 0, end: 10 })).toEqual([
      { start: 4, end: 6 },
    ]);
    const partial = summarizeChannelCoverage('cuts', {
      status: 'partial', artifacts: [sourceArtifact({ coverage: [{ start: 0, end: 4 }] })],
    }, { start: 0, end: 10 }, { profile: 'quick', timeDomain: 'source' });
    expect(partial.status).toBe('partial');
    expect(partial.missing).toEqual([{ start: 4, end: 10 }]);

    const stale = summarizeChannelCoverage('cuts', {
      status: 'complete', artifacts: [sourceArtifact({ profile: 'quick' })],
    }, { start: 0, end: 10 }, { profile: 'balanced', timeDomain: 'source' });
    expect(stale.status).toBe('stale');
    expect(stale.staleArtifactRefs).toEqual(['artifacts/cuts/000.json']);
  });

  it('paginates deterministically with a cursor bound to the query', () => {
    const events = [cut('c', 2), cut('a', 1), cut('b', 1), cut('d', 3)];
    const first = paginateAgentTimelineEvents(events, { queryKey: 'source:0:10:cuts', limit: 2 });
    expect(first.events.map((event) => event.id)).toEqual(['a', 'b']);
    expect(first.truncation).toMatchObject({ truncated: true, reason: 'event-limit', returnedEvents: 2 });
    const second = paginateAgentTimelineEvents(events.toReversed(), {
      queryKey: 'source:0:10:cuts', limit: 2, cursor: first.nextCursor,
    });
    expect(second.events.map((event) => event.id)).toEqual(['c', 'd']);
    expect(second.nextCursor).toBeUndefined();
    expect(() => paginateAgentTimelineEvents(events, {
      queryKey: 'different-query', cursor: first.nextCursor,
    })).toThrow('cursor does not match this query');
  });

  it('enforces the 500-event and 256-KiB page ceilings', () => {
    const manyEvents = Array.from({ length: 600 }, (_, index) => cut(`cut-${String(index).padStart(4, '0')}`, index));
    const page = paginateAgentTimelineEvents(manyEvents, { queryKey: 'many', limit: 900 });
    expect(page.events).toHaveLength(500);
    expect(page.truncation.reason).toBe('event-limit');

    const bytePage = paginateAgentTimelineEvents(manyEvents, { queryKey: 'bytes', maxBytes: 1_000 });
    expect(bytePage.truncation.reason).toBe('byte-limit');
    expect(bytePage.truncation.estimatedBytes).toBeLessThanOrEqual(1_000);
  });

  it('accepts speech-marker events in the speech channel and validates their data', () => {
    const marker: AgentTimelineEvent = {
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: 'marker-1',
      type: 'speech-marker',
      time: { temporalKind: 'interval', timeDomain: 'source', start: 1.2, end: 1.55 },
      confidence: 0.72,
      provenance: [{ kind: 'analyzer', analyzerId: 'speech-markers', analyzerVersion: '1.0.0' }],
      data: { marker: 'breath', intensity: 0.4 },
    };
    expect(validateAgentTimelineEvent(marker)).toEqual([]);
    expect(isEventTypeAllowedForChannel('speech', 'speech-marker')).toBe(true);
    expect(isEventTypeAllowedForChannel('audio', 'speech-marker')).toBe(false);

    const filler: AgentTimelineEvent = {
      ...marker,
      id: 'marker-2',
      data: { marker: 'filler', text: 'ähm', wordId: 'word-9', speakerId: 'speaker-1' },
    };
    expect(validateAgentTimelineEvent(filler)).toEqual([]);

    const invalidKind = { ...marker, data: { marker: 'cough' } } as unknown as AgentTimelineEvent;
    expect(validateAgentTimelineEvent(invalidKind)).toContain('speech-marker marker is invalid');
    const invalidIntensity = { ...marker, data: { marker: 'pause', intensity: 1.5 } } as AgentTimelineEvent;
    expect(validateAgentTimelineEvent(invalidIntensity)).toContain('speech-marker intensity must be within [0, 1]');
  });

  it('validates prosody fields on speech events', () => {
    const speech: AgentTimelineEvent = {
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: 'speech-1',
      type: 'speech',
      time: { temporalKind: 'interval', timeDomain: 'source', start: 0, end: 0.4 },
      confidence: 0.9,
      provenance: [{ kind: 'analyzer', analyzerId: 'transcript', analyzerVersion: '1.0.0' }],
      data: { speakerId: 'speaker-1', text: 'hallo', emphasis: 0.8, f0MeanHz: 121.5 },
    };
    expect(validateAgentTimelineEvent(speech)).toEqual([]);

    const badEmphasis = {
      ...speech,
      data: { speakerId: 'speaker-1', emphasis: 1.2 },
    } as AgentTimelineEvent;
    expect(validateAgentTimelineEvent(badEmphasis)).toContain('speech emphasis must be within [0, 1]');
    const badF0 = {
      ...speech,
      data: { speakerId: 'speaker-1', f0MeanHz: 0 },
    } as AgentTimelineEvent;
    expect(validateAgentTimelineEvent(badF0)).toContain('speech f0MeanHz must be positive');
  });
});
