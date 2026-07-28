import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../src/artifacts';
import { AgentTimelineArtifactStorage } from '../../src/services/agentTimeline/storage/AgentTimelineArtifactStorage';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineManifest,
} from '../../src/types/agentTimeline/manifest';
import { SOURCE_IDENTITY_SCHEMA_VERSION } from '../../src/types/agentTimeline/sourceIdentity';
import type {
  AgentTimelineManifestPointer,
  AgentTimelineManifestPointerStore,
  AgentTimelineStorageWrite,
} from '../../src/types/agentTimeline/storage';
import type { AgentTimelineArtifactStore } from '../../src/services/agentTimeline/storage/artifactStoreBoundary';

const channels = ['cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker', 'camera-motion', 'audio', 'quality', 'text', 'duplicates'] as const;
const sourceIdentity = {
  type: 'source-identity' as const,
  version: SOURCE_IDENTITY_SCHEMA_VERSION,
  strategy: 'sampled-chunks' as const,
  hashAlgorithm: 'sha-256' as const,
  hash: 'ab'.repeat(32),
  metadata: { size: 42, mediaType: 'video/mp4' },
};

class MemoryPointers implements AgentTimelineManifestPointerStore {
  values = new Map<string, AgentTimelineManifestPointer>();
  operations: string[] = [];
  async get(key: string): Promise<AgentTimelineManifestPointer | null> { return this.values.get(key) ?? null; }
  async set(key: string, pointer: AgentTimelineManifestPointer): Promise<void> {
    this.operations.push('pointer');
    this.values.set(key, pointer);
  }
}

function manifest(): AgentTimelineManifest {
  return {
    schemaVersion: AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
    mediaFileId: 'media-1', sourceIdentity, durationSeconds: 10,
    generatedAt: '2026-07-27T12:00:00.000Z', profile: 'balanced',
    channels: Object.fromEntries(channels.map((channel) => [channel, { status: 'missing', artifacts: [] }])) as AgentTimelineManifest['channels'],
  };
}

function write(): AgentTimelineStorageWrite {
  return {
    manifest: manifest(),
    shards: [{
      descriptor: {
        sourceIdentityHash: sourceIdentity.hash, channel: 'cuts', analyzerId: 'cut', analyzerVersion: '1.0.0',
        artifactSchemaVersion: 'cut-events/v1', profile: 'balanced', sourceRange: { start: 0, end: 10 },
        createdAt: '2026-07-27T12:00:00.000Z', timeDomain: 'source',
      },
      events: [{
        schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION, id: 'cut-1', type: 'cut',
        time: { temporalKind: 'point', timeDomain: 'source', time: 1 }, confidence: 0.9,
        provenance: [{ kind: 'analyzer', analyzerId: 'cut', analyzerVersion: '1.0.0' }],
        data: { score: 0.9, transition: 'hard' },
      }],
    }],
  };
}

function createStorage(pointers = new MemoryPointers(), artifacts: AgentTimelineArtifactStore = new ArtifactStore(new MemoryArtifactStorageAdapter())) {
  return {
    pointers,
    storage: new AgentTimelineArtifactStorage({
      artifacts,
      pointers,
      now: () => '2026-07-27T12:00:01.000Z',
    }),
  };
}

describe('Agent Timeline artifact storage', () => {
  it('publishes shard and index artifacts before the manifest pointer, then round-trips validated data', async () => {
    const artifactStore = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const pointers = new MemoryPointers();
    const operations: string[] = [];
    const artifacts: AgentTimelineArtifactStore = {
      async putArtifact(input, options) {
        operations.push('artifact');
        return artifactStore.putArtifact(input, options);
      },
      getArtifact: (ref) => artifactStore.getArtifact(ref),
    };
    const { storage } = createStorage(pointers, artifacts);
    const saved = await storage.write(write());

    expect(operations).toEqual(['artifact', 'artifact', 'artifact']);
    expect(pointers.operations).toEqual(['pointer']);
    expect(saved.manifest.channels.cuts.status).toBe('complete');
    expect(saved.manifest.channels.cuts.artifacts[0].artifactRef).toMatch(/^sha256:/);

    const loaded = await storage.read({ mediaFileId: 'media-1', sourceIdentity });
    expect(loaded.status).toBe('ready');
    if (loaded.status === 'ready') {
      expect(loaded.analysis.shardIndex.entries).toHaveLength(1);
      expect(loaded.analysis.manifest.channels.cuts.artifacts[0].coverage).toEqual([{ start: 0, end: 10 }]);
    }
  });

  it('does not publish a pointer when an artifact write fails', async () => {
    const pointers = new MemoryPointers();
    const base = new ArtifactStore(new MemoryArtifactStorageAdapter());
    let puts = 0;
    const artifacts: AgentTimelineArtifactStore = {
      async putArtifact(input, options) {
        puts += 1;
        if (puts === 2) throw new Error('disk full');
        return base.putArtifact(input, options);
      },
      getArtifact: (ref) => base.getArtifact(ref),
    };
    const { storage } = createStorage(pointers, artifacts);
    await expect(storage.write(write())).rejects.toThrow('disk full');
    expect(pointers.values).toHaveLength(0);
  });

  it('reports identity changes as stale rather than empty or complete', async () => {
    const { storage } = createStorage();
    await storage.write(write());
    const stale = await storage.read({
      mediaFileId: 'media-1', sourceIdentity: { ...sourceIdentity, hash: 'cd'.repeat(32) },
    });
    expect(stale).toMatchObject({ status: 'stale' });
  });

  it('reports missing or corrupt data honestly and observes cancellation', async () => {
    const { storage, pointers } = createStorage();
    await expect(storage.read({ mediaFileId: 'media-1', sourceIdentity })).resolves.toMatchObject({ status: 'missing' });
    await storage.write(write());
    const key = [...pointers.values.keys()][0];
    pointers.values.set(key, { ...pointers.values.get(key)!, manifestRef: 'sha256:' + '00'.repeat(32) });
    await expect(storage.read({ mediaFileId: 'media-1', sourceIdentity })).resolves.toMatchObject({ status: 'corrupt' });
    const controller = new AbortController();
    controller.abort();
    await expect(storage.read({ mediaFileId: 'media-1', sourceIdentity, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('replaces changed automatic shards without publishing unreferenced index entries', async () => {
    const { storage } = createStorage();
    const first = await storage.write(write());
    const changed = write();
    changed.shards[0] = {
      ...changed.shards[0],
      events: [{
        ...changed.shards[0].events[0],
        id: 'cut-2',
        time: { temporalKind: 'point', timeDomain: 'source', time: 2 },
      }],
    };

    const second = await storage.write({ ...changed, existingShardIndex: first.shardIndex });
    expect(second.shardIndex.entries).toHaveLength(1);
    await expect(storage.read({ mediaFileId: 'media-1', sourceIdentity }))
      .resolves.toMatchObject({ status: 'ready' });
  });

  it('retains explicitly referenced non-legacy shards while replacing automatic snapshots', async () => {
    const { storage } = createStorage();
    const retained = await storage.write(write());
    const next = write();
    next.manifest.channels.cuts = {
      status: 'complete',
      artifacts: retained.manifest.channels.cuts.artifacts,
    };
    next.shards[0] = {
      ...next.shards[0],
      events: [{
        ...next.shards[0].events[0],
        id: 'cut-new',
        time: { temporalKind: 'point', timeDomain: 'source', time: 3 },
      }],
    };

    const saved = await storage.write({ ...next, existingShardIndex: retained.shardIndex });
    expect(saved.shardIndex.entries).toHaveLength(2);
    await expect(storage.read({ mediaFileId: 'media-1', sourceIdentity }))
      .resolves.toMatchObject({ status: 'ready' });
  });

  it('normalizes MIME-less source identities at the storage boundary without changing their hash', async () => {
    const emptyMimeIdentity = {
      ...sourceIdentity,
      metadata: { ...sourceIdentity.metadata, mediaType: '' },
    };
    const input = write();
    input.manifest = { ...input.manifest, sourceIdentity: emptyMimeIdentity };
    const { storage } = createStorage();

    const saved = await storage.write(input);
    expect(saved.manifest.sourceIdentity).toMatchObject({
      hash: sourceIdentity.hash,
      metadata: { mediaType: 'application/octet-stream' },
    });
    await expect(storage.read({ mediaFileId: 'media-1', sourceIdentity: emptyMimeIdentity }))
      .resolves.toMatchObject({ status: 'ready' });
  });
});
