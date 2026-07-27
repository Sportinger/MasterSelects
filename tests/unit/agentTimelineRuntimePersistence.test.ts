import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../src/artifacts';
import { AgentTimelineRuntimePersistence, type AgentTimelineRuntimePersistenceDependencies } from '../../src/services/agentTimeline/runtime/persistence/agentTimelineRuntimePersistence';
import { PersistentAgentTimelineShardReader } from '../../src/services/agentTimeline/runtime/persistence/persistentShardReader';
import { getAgentTimelineRange } from '../../src/services/agentTimeline/query/agentTimelineRangeQuery';
import { AgentTimelineArtifactStorage } from '../../src/services/agentTimeline/storage/AgentTimelineArtifactStorage';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types/timeline';
import { SOURCE_IDENTITY_SCHEMA_VERSION, type SourceIdentity } from '../../src/types/agentTimeline/sourceIdentity';
import type { AgentTimelineManifestPointer, AgentTimelineManifestPointerStore } from '../../src/types/agentTimeline/storage';

const SOURCE_HASH = 'ab'.repeat(32);
const NOW = '2026-07-27T12:00:00.000Z';

class Pointers implements AgentTimelineManifestPointerStore {
  private readonly values = new Map<string, AgentTimelineManifestPointer>();

  async get(key: string): Promise<AgentTimelineManifestPointer | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, pointer: AgentTimelineManifestPointer): Promise<void> {
    this.values.set(key, pointer);
  }
}

function identity(): SourceIdentity {
  return {
    type: 'source-identity', version: SOURCE_IDENTITY_SCHEMA_VERSION,
    strategy: 'sampled-chunks', hashAlgorithm: 'sha-256', hash: SOURCE_HASH,
    metadata: { size: 24, mediaType: 'video/mp4' },
  };
}

function sceneCutMedia(source: Blob): MediaFile {
  return {
    id: 'media-a', name: 'source.mp4', type: 'video', parentId: null, createdAt: 1, url: 'blob:source',
    file: source as File, duration: 10, sceneCutStatus: 'ready',
    sceneCutAnalysis: {
      schemaVersion: 1, detectorVersion: 'content-adaptive-160x90-v2', analysisWidth: 160, analysisHeight: 90,
      sourceFrameCount: 100, expectedSourceFrameCount: 100, duration: 10,
      sourceFingerprint: { size: 24, lastModified: 0 }, completedAt: 1,
      cuts: [{
        timestamp: 4, frameNumber: 40, score: .9, changedRatio: .9, meanPixelDifference: .9,
        histogramDifference: .9, edgeChangeRatio: .9, motionCompensatedDifference: .9, confidence: .9,
      }],
    },
  };
}

describe('AgentTimelineRuntimePersistence', () => {
  it('starts its browser subscriptions exactly once when bootstrap is evaluated repeatedly', () => {
    let subscriptions = 0;
    const publisher = new AgentTimelineRuntimePersistence({
      readSnapshot: () => ({ files: [], clips: [] }),
      subscribe: () => { subscriptions += 1; return () => undefined; },
      getSourceIdentity: async () => identity(),
      listAudioArtifacts: async () => [],
      createStorage: () => new AgentTimelineArtifactStorage({
        artifacts: new ArtifactStore(new MemoryArtifactStorageAdapter()),
        pointers: new Pointers(),
      }),
      now: () => NOW,
      debounceMs: 0,
    });

    publisher.start();
    publisher.start();

    expect(subscriptions).toBe(1);
    publisher.dispose();
  });

  it('writes completed local state as validated immutable shards without retaining its source Blob', async () => {
    const artifacts = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const storage = new AgentTimelineArtifactStorage({
      artifacts,
      pointers: new Pointers(),
      now: () => NOW,
    });
    const source = new Blob(['source bytes'], { type: 'video/mp4' });
    const snapshot = { files: [sceneCutMedia(source)], clips: [] as TimelineClip[] };
    let listener: (() => void) | undefined;
    const dependencies: AgentTimelineRuntimePersistenceDependencies = {
      readSnapshot: () => snapshot,
      subscribe: (next) => { listener = next; return () => { listener = undefined; }; },
      getSourceIdentity: async () => identity(),
      listAudioArtifacts: async () => [],
      createStorage: () => storage,
      now: () => NOW,
      debounceMs: 60_000,
    };
    const publisher = new AgentTimelineRuntimePersistence(dependencies);

    publisher.request('media-a');
    await publisher.publish('media-a', 1);
    const loaded = await storage.read({ mediaFileId: 'media-a', sourceIdentity: identity() });

    expect(loaded.status).toBe('ready');
    if (loaded.status !== 'ready') return;
    expect(JSON.stringify(loaded.analysis.manifest)).not.toContain('source bytes');
    const cutShard = loaded.analysis.shardIndex.entries.find(entry => entry.shard.channel === 'cuts')!.shard;
    const reader = new PersistentAgentTimelineShardReader(artifacts);
    expect(await reader.readEvents({
      shard: cutShard, sourceRanges: [{ start: 0, end: 10 }], eventTypes: ['cut'],
      granularity: 'event', includeFrames: false,
    })).toMatchObject([{ type: 'cut', time: { time: 4 } }]);

    listener?.();
    publisher.dispose();
  });

  it('drops a stale publish when the runtime source changes before identity resolution', async () => {
    const artifacts = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const storage = new AgentTimelineArtifactStorage({ artifacts, pointers: new Pointers(), now: () => NOW });
    const first = new Blob(['first'], { type: 'video/mp4' });
    const second = new Blob(['second'], { type: 'video/mp4' });
    let snapshot = { files: [sceneCutMedia(first)], clips: [] as TimelineClip[] };
    let resolveIdentity!: (value: SourceIdentity) => void;
    const pendingIdentity = new Promise<SourceIdentity>(resolve => { resolveIdentity = resolve; });
    const publisher = new AgentTimelineRuntimePersistence({
      readSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      getSourceIdentity: () => pendingIdentity,
      listAudioArtifacts: async () => [],
      createStorage: () => storage,
      now: () => NOW,
      debounceMs: 60_000,
    });

    publisher.request('media-a');
    const pending = publisher.publish('media-a', 1);
    await Promise.resolve();
    snapshot = { files: [sceneCutMedia(second)], clips: [] };
    publisher.request('media-a');
    resolveIdentity(identity());
    await pending;

    await expect(storage.read({ mediaFileId: 'media-a', sourceIdentity: identity() }))
      .resolves.toMatchObject({ status: 'missing' });
    publisher.dispose();
  });

  it('persists a full-hour transcript as bounded shards and opens only the selected shard', async () => {
    const artifacts = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const storage = new AgentTimelineArtifactStorage({ artifacts, pointers: new Pointers(), now: () => NOW });
    const source = new Blob(['source bytes'], { type: 'video/mp4' });
    const durationSeconds = 60 * 60;
    const media = {
      ...sceneCutMedia(source),
      duration: durationSeconds,
      transcriptStatus: 'ready' as const,
      transcript: Array.from({ length: durationSeconds }, (_, second) => ({
        id: `word-${second}`, text: `word ${second}`, start: second, end: second + 0.5, confidence: 0.9,
      })),
      transcribedRanges: [[0, durationSeconds]] as [number, number][],
    };
    const publisher = new AgentTimelineRuntimePersistence({
      readSnapshot: () => ({ files: [media], clips: [] }),
      subscribe: () => () => undefined,
      getSourceIdentity: async () => identity(),
      listAudioArtifacts: async () => [],
      createStorage: () => storage,
      now: () => NOW,
      debounceMs: 60_000,
    });

    publisher.request('media-a');
    await publisher.publish('media-a', 1);
    const loaded = await storage.read({ mediaFileId: 'media-a', sourceIdentity: identity() });
    expect(loaded.status).toBe('ready');
    if (loaded.status !== 'ready') return;
    const transcriptShards = loaded.analysis.shardIndex.entries
      .map(entry => entry.shard)
      .filter(shard => shard.channel === 'transcript');
    expect(transcriptShards).toHaveLength(60);
    expect(transcriptShards.every(shard => shard.sourceRange.end - shard.sourceRange.start <= 60)).toBe(true);

    const reads: string[] = [];
    const reader = new PersistentAgentTimelineShardReader({
      putArtifact: artifacts.putArtifact.bind(artifacts),
      async getArtifact(ref) {
        reads.push(ref);
        return artifacts.getArtifact(ref);
      },
    });
    const result = await getAgentTimelineRange({
      manifest: loaded.analysis.manifest,
      shardIndex: loaded.analysis.shardIndex,
      shardReader: reader,
      query: {
        scope: { mediaFileId: 'media-a' }, start: 120, end: 121,
        timeDomain: 'source', granularity: 'event', channels: ['speech'], includeFrames: false,
      },
    });
    expect(result.events[0]?.data).toMatchObject({ text: 'word 120' });
    expect(reads).toHaveLength(1);
    publisher.dispose();
  });
});
