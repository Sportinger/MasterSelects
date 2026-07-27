import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../src/artifacts';
import { validateAgentTimelineEvent } from '../../src/services/agentTimeline/manifest/validation';
import { AgentTimelineArtifactStorage } from '../../src/services/agentTimeline/storage/AgentTimelineArtifactStorage';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AgentTimelineManifest,
} from '../../src/types/agentTimeline/manifest';
import { SOURCE_IDENTITY_SCHEMA_VERSION } from '../../src/types/agentTimeline/sourceIdentity';
import type {
  AgentTimelineManifestPointer,
  AgentTimelineManifestPointerStore,
  AgentTimelineStorageWrite,
} from '../../src/types/agentTimeline/storage';
import type { AgentTimelineArtifactStore } from '../../src/services/agentTimeline/storage/artifactStoreBoundary';

const CHANNELS = ['cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker', 'camera-motion', 'audio', 'quality', 'text', 'duplicates'] as const;
const identity = {
  type: 'source-identity' as const, version: SOURCE_IDENTITY_SCHEMA_VERSION,
  strategy: 'sampled-chunks' as const, hashAlgorithm: 'sha-256' as const,
  hash: 'cd'.repeat(32), metadata: { size: 100, mediaType: 'video/mp4' },
};

class Pointers implements AgentTimelineManifestPointerStore {
  readonly values = new Map<string, AgentTimelineManifestPointer>();
  async get(key: string): Promise<AgentTimelineManifestPointer | null> { return this.values.get(key) ?? null; }
  async set(key: string, value: AgentTimelineManifestPointer): Promise<void> { this.values.set(key, value); }
}

function manifest(): AgentTimelineManifest {
  return {
    schemaVersion: AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION, mediaFileId: 'integrity-media', sourceIdentity: identity,
    durationSeconds: 10, generatedAt: '2026-07-27T12:00:00.000Z', profile: 'balanced',
    channels: Object.fromEntries(CHANNELS.map(channel => [channel, { status: 'missing', artifacts: [] }])) as AgentTimelineManifest['channels'],
  };
}

function cut(id: string, time: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION, id, type: 'cut', confidence: 0.9,
    time: { temporalKind: 'point', timeDomain: 'source', time },
    provenance: [{ kind: 'analyzer', analyzerId: 'cut-detector', analyzerVersion: '1' }],
    data: { score: 0.9, transition: 'hard' },
  };
}

function write(): AgentTimelineStorageWrite {
  return {
    manifest: manifest(),
    shards: [0, 5].map((start) => ({
      descriptor: {
        sourceIdentityHash: identity.hash, channel: 'cuts' as const, analyzerId: 'cut-detector', analyzerVersion: '1',
        artifactSchemaVersion: 'cuts/v1', profile: 'balanced' as const, sourceRange: { start, end: start + 5 },
        createdAt: '2026-07-27T12:00:00.000Z', timeDomain: 'source' as const,
      },
      events: [cut(`cut-${start}`, start + 1)],
    })),
  };
}

function storage(artifacts: AgentTimelineArtifactStore, pointers = new Pointers()): AgentTimelineArtifactStorage {
  return new AgentTimelineArtifactStorage({ artifacts, pointers, now: () => '2026-07-27T12:01:00.000Z' });
}

describe('Agent Timeline storage integrity boundary', () => {
  it('opens the manifest without loading an unrelated corrupt shard', async () => {
    const base = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const pointers = new Pointers();
    const saved = await storage(base, pointers).write(write());
    const corruptRef = saved.shards[1].artifactRef;
    const reads: string[] = [];
    const guarded: AgentTimelineArtifactStore = {
      putArtifact: base.putArtifact.bind(base),
      async getArtifact(ref) {
        reads.push(ref);
        if (ref === corruptRef) throw new Error('unrelated shard must remain lazy');
        return base.getArtifact(ref);
      },
    };

    await expect(storage(guarded, pointers).read({ mediaFileId: 'integrity-media', sourceIdentity: identity }))
      .resolves.toMatchObject({ status: 'ready' });
    expect(reads).not.toContain(corruptRef);
  });

  it('rejects unknown types, invalid domains and malformed discriminated payloads', () => {
    expect(validateAgentTimelineEvent({ ...cut('wrong-type', 1), type: 'unknown' } as unknown as AgentTimelineEvent))
      .toContain('unsupported event type');
    expect(validateAgentTimelineEvent({ ...cut('wrong-domain', 1), time: { temporalKind: 'point', timeDomain: 'wall-clock', time: 1 } } as unknown as AgentTimelineEvent))
      .toContain('event time requires a supported timeDomain');
    expect(validateAgentTimelineEvent({ ...cut('wrong-data', 1), data: { score: 'loud', transition: 'hard' } } as unknown as AgentTimelineEvent))
      .toContain('cut data is invalid');
  });

  it('rejects source shards and events outside the manifest duration', async () => {
    const base = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const shardOutsideDuration = write();
    shardOutsideDuration.shards[0] = {
      ...shardOutsideDuration.shards[0],
      descriptor: { ...shardOutsideDuration.shards[0].descriptor, sourceRange: { start: 5, end: 11 } },
      events: [cut('too-late', 10)],
    };
    await expect(storage(base).write(shardOutsideDuration)).rejects.toThrow('manifest duration');
  });
});
