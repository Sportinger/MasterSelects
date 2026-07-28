import { describe, expect, it } from 'vitest';
import {
  createArtifactShardDescriptor,
  createArtifactShardId,
} from '../../src/services/agentTimeline/artifacts/artifactShardDescriptor';
import type { ArtifactShardDescriptorInput } from '../../src/types/agentTimeline/artifactShard';

function input(overrides: Partial<ArtifactShardDescriptorInput> = {}): ArtifactShardDescriptorInput {
  return {
    sourceIdentityHash: 'source-hash-a',
    channel: 'transcript',
    analyzerId: 'whisper',
    analyzerVersion: '3.0.0',
    artifactSchemaVersion: 'transcript/v2',
    modelId: 'whisper-large',
    modelVersion: '2026-07',
    profile: 'balanced',
    sourceRange: { start: 10, end: 20 },
    artifactRef: 'analysis/transcript/10-20.json',
    sizeBytes: 4096,
    createdAt: '2026-07-26T10:00:00.000Z',
    timeDomain: 'source',
    ...overrides,
  };
}

describe('artifact shard descriptors', () => {
  it('creates a versioned JSON-serializable descriptor with a stable semantic ID', () => {
    const first = createArtifactShardDescriptor(input());
    const retried = createArtifactShardDescriptor(input({
      sizeBytes: 8192,
      createdAt: '2026-07-26T11:00:00.000Z',
    }));

    expect(first).toMatchObject({
      type: 'agent-timeline-artifact-shard',
      schemaVersion: 'agent-timeline-artifact-shard/v1',
      sourceRange: { start: 10, end: 20 },
    });
    expect(retried.shardId).toBe(first.shardId);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('changes the ID when any compatibility or artifact-location key changes', () => {
    const baseId = createArtifactShardId(input());
    expect(createArtifactShardId(input({ profile: 'deep' }))).not.toBe(baseId);
    expect(createArtifactShardId(input({ analyzerVersion: '3.1.0' }))).not.toBe(baseId);
    expect(createArtifactShardId(input({ sourceRange: { start: 10, end: 21 } }))).not.toBe(baseId);
    expect(createArtifactShardId(input({ artifactRef: 'analysis/transcript/replacement.json' }))).not.toBe(baseId);
  });

  it('rejects empty, reversed, non-finite, or non-source-safe ranges', () => {
    expect(() => createArtifactShardDescriptor(input({ sourceRange: { start: 5, end: 5 } }))).toThrow(RangeError);
    expect(() => createArtifactShardDescriptor(input({ sourceRange: { start: 6, end: 5 } }))).toThrow(RangeError);
    expect(() => createArtifactShardDescriptor(input({ sourceRange: { start: -1, end: 5 } }))).toThrow(RangeError);
    expect(() => createArtifactShardDescriptor(input({ sourceRange: { start: 0, end: Number.NaN } }))).toThrow(RangeError);
  });

  it('requires canonical timestamps, paired model identity, and rendered state hashes', () => {
    expect(() => createArtifactShardDescriptor(input({ createdAt: 'July 26 2026' }))).toThrow(TypeError);
    expect(() => createArtifactShardDescriptor(input({ modelVersion: undefined }))).toThrow(TypeError);
    expect(() => createArtifactShardDescriptor({
      ...input(),
      timeDomain: 'clip-rendered',
      stateHash: '',
    })).toThrow(TypeError);
  });
});

