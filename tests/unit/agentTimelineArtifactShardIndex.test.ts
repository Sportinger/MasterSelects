import { describe, expect, it } from 'vitest';
import { createArtifactShardDescriptor } from '../../src/services/agentTimeline/artifacts/artifactShardDescriptor';
import {
  createArtifactShardIntervalIndex,
  queryArtifactShardIndex,
  writeArtifactShards,
} from '../../src/services/agentTimeline/artifacts/artifactShardIndex';
import type {
  AgentTimelineAnalysisProfile,
  ArtifactShardDescriptor,
  ArtifactShardDescriptorInput,
  ArtifactShardQuery,
  SourceTimeRange,
} from '../../src/types/agentTimeline/artifactShard';

let artifactCounter = 0;

function shard(
  range: SourceTimeRange,
  createdAt: string,
  overrides: Partial<ArtifactShardDescriptorInput> = {},
): ArtifactShardDescriptor {
  artifactCounter += 1;
  return createArtifactShardDescriptor({
    sourceIdentityHash: 'source-a',
    channel: 'focus',
    analyzerId: 'focus-analyzer',
    analyzerVersion: '2',
    artifactSchemaVersion: 'focus/v1',
    profile: 'balanced',
    sourceRange: range,
    artifactRef: `focus/${artifactCounter}.json`,
    sizeBytes: 100,
    createdAt,
    timeDomain: 'source',
    ...overrides,
  });
}

function query(
  range: SourceTimeRange,
  overrides: Partial<ArtifactShardQuery> = {},
): ArtifactShardQuery {
  return {
    sourceIdentityHash: 'source-a',
    channel: 'focus',
    sourceRange: range,
    analyzerId: 'focus-analyzer',
    analyzerVersion: '2',
    profile: 'balanced',
    timeDomain: 'source',
    ...overrides,
  };
}

describe('artifact shard interval index', () => {
  it('uses exact half-open overlap boundaries', () => {
    const before = shard({ start: 0, end: 10 }, '2026-07-26T10:00:00.000Z');
    const inside = shard({ start: 10, end: 20 }, '2026-07-26T10:01:00.000Z');
    const after = shard({ start: 20, end: 30 }, '2026-07-26T10:02:00.000Z');
    const result = queryArtifactShardIndex(
      createArtifactShardIntervalIndex([after, before, inside]),
      query({ start: 10, end: 20 }),
    );

    expect(result.selections.map((selection) => selection.shard.shardId)).toEqual([inside.shardId]);
    expect(result.coverage).toEqual([{ start: 10, end: 20 }]);
    expect(result.holes).toEqual([]);
  });

  it('selects exact analyzer/profile first, newest compatible next, and uses fallbacks only for holes', () => {
    const compatibleProfile = shard(
      { start: 0, end: 30 },
      '2026-07-26T12:00:00.000Z',
      { analyzerId: 'legacy-focus', analyzerVersion: '1', profile: 'deep' },
    );
    const olderExact = shard({ start: 5, end: 15 }, '2026-07-26T10:00:00.000Z');
    const newerExact = shard({ start: 5, end: 15 }, '2026-07-26T11:00:00.000Z');
    const result = queryArtifactShardIndex(
      createArtifactShardIntervalIndex([compatibleProfile, olderExact, newerExact]),
      query({ start: 0, end: 20 }, {
        compatibleAnalyzerIds: ['legacy-focus'],
        compatibleAnalyzerVersions: ['1'],
        compatibleProfiles: ['deep'],
      }),
    );

    expect(result.selections).toEqual([
      { shard: newerExact, selectedRanges: [{ start: 5, end: 15 }] },
      {
        shard: compatibleProfile,
        selectedRanges: [{ start: 0, end: 5 }, { start: 15, end: 20 }],
      },
    ]);
    expect(result.coverage).toEqual([{ start: 0, end: 20 }]);
    expect(result.coveredDuration).toBe(20);
  });

  it('filters source, channel, analyzer/version/profile, model, domain, and state compatibility', () => {
    const exact = shard({ start: 0, end: 10 }, '2026-07-26T10:00:00.000Z');
    const incompatible = [
      shard({ start: 0, end: 10 }, '2026-07-26T10:01:00.000Z', { sourceIdentityHash: 'source-b' }),
      shard({ start: 0, end: 10 }, '2026-07-26T10:02:00.000Z', { channel: 'motion' }),
      shard({ start: 0, end: 10 }, '2026-07-26T10:03:00.000Z', { analyzerVersion: '1' }),
      shard({ start: 0, end: 10 }, '2026-07-26T10:04:00.000Z', { profile: 'quick' }),
      shard({ start: 0, end: 10 }, '2026-07-26T10:05:00.000Z', {
        timeDomain: 'composition-rendered',
        stateHash: 'composition-state-a',
      }),
    ];
    const result = queryArtifactShardIndex(
      createArtifactShardIntervalIndex([...incompatible, exact]),
      query({ start: 0, end: 10 }),
    );

    expect(result.selections.map((selection) => selection.shard)).toEqual([exact]);
  });

  it('returns explicit partial coverage and holes without treating them as no events', () => {
    const result = queryArtifactShardIndex(
      createArtifactShardIntervalIndex([
        shard({ start: 0, end: 3 }, '2026-07-26T10:00:00.000Z'),
        shard({ start: 5, end: 8 }, '2026-07-26T10:01:00.000Z'),
        shard({ start: 8, end: 9 }, '2026-07-26T10:02:00.000Z'),
      ]),
      query({ start: 1, end: 10 }),
    );

    expect(result.coverage).toEqual([{ start: 1, end: 3 }, { start: 5, end: 9 }]);
    expect(result.holes).toEqual([{ start: 3, end: 5 }, { start: 9, end: 10 }]);
    expect(result.coveredDuration).toBe(6);
  });

  it('is deterministic for all input orders and tie-breaks equal timestamps by stable ID', () => {
    const first = shard({ start: 0, end: 10 }, '2026-07-26T10:00:00.000Z');
    const second = shard({ start: 0, end: 10 }, '2026-07-26T10:00:00.000Z');
    const selectedIds = [
      [first, second],
      [second, first],
    ].map((items) => queryArtifactShardIndex(
      createArtifactShardIntervalIndex(items),
      query({ start: 0, end: 10 }),
    ).selections.map((selection) => selection.shard.shardId));

    expect(selectedIds[0]).toEqual(selectedIds[1]);
    expect(selectedIds[0]).toEqual([[first.shardId, second.shardId].toSorted()[0]]);
  });
});

describe('artifact shard writes', () => {
  it('appends idempotently and lets the same stable shard refresh storage metadata', () => {
    const original = shard({ start: 0, end: 10 }, '2026-07-26T10:00:00.000Z');
    const refreshed = createArtifactShardDescriptor({
      ...original,
      sizeBytes: 200,
      createdAt: '2026-07-26T11:00:00.000Z',
    });
    const result = writeArtifactShards(
      createArtifactShardIntervalIndex([original]),
      [refreshed],
      'append',
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].shard).toEqual(refreshed);
  });

  it('replace-overlap invalidates only overlapping shards in the exact generation scope', () => {
    const overlap = shard({ start: 0, end: 10 }, '2026-07-26T10:00:00.000Z');
    const adjacent = shard({ start: 12, end: 20 }, '2026-07-26T10:01:00.000Z');
    const otherVersion = shard(
      { start: 0, end: 10 },
      '2026-07-26T10:02:00.000Z',
      { analyzerVersion: '1' },
    );
    const replacement = shard({ start: 5, end: 12 }, '2026-07-26T11:00:00.000Z');
    const result = writeArtifactShards(
      createArtifactShardIntervalIndex([overlap, adjacent, otherVersion]),
      [replacement],
      'replace-overlap',
    );
    const retainedIds = result.entries.map((entry) => entry.shard.shardId);

    expect(retainedIds).not.toContain(overlap.shardId);
    expect(retainedIds).toContain(adjacent.shardId);
    expect(retainedIds).toContain(otherVersion.shardId);
    expect(retainedIds).toContain(replacement.shardId);
  });

  it('keeps rendered artifacts with a different state hash during range replacement', () => {
    const oldState = shard(
      { start: 0, end: 10 },
      '2026-07-26T10:00:00.000Z',
      { timeDomain: 'clip-rendered', stateHash: 'clip-state-old' },
    );
    const currentState = shard(
      { start: 0, end: 10 },
      '2026-07-26T10:01:00.000Z',
      { timeDomain: 'clip-rendered', stateHash: 'clip-state-current' },
    );
    const replacement = shard(
      { start: 5, end: 10 },
      '2026-07-26T11:00:00.000Z',
      { timeDomain: 'clip-rendered', stateHash: 'clip-state-current' },
    );
    const result = writeArtifactShards(
      createArtifactShardIntervalIndex([oldState, currentState]),
      [replacement],
      'replace-overlap',
    );
    const retainedIds = result.entries.map((entry) => entry.shard.shardId);

    expect(retainedIds).toContain(oldState.shardId);
    expect(retainedIds).not.toContain(currentState.shardId);
    expect(retainedIds).toContain(replacement.shardId);
  });

  it.each<AgentTimelineAnalysisProfile>(['quick', 'balanced', 'deep', 'custom'])(
    'keeps profile %s in a distinct invalidation scope',
    (profile) => {
      const existing = shard(
        { start: 0, end: 10 },
        '2026-07-26T10:00:00.000Z',
        { profile },
      );
      const replacement = shard(
        { start: 0, end: 10 },
        '2026-07-26T11:00:00.000Z',
        { profile: profile === 'quick' ? 'deep' : 'quick' },
      );
      const result = writeArtifactShards(
        createArtifactShardIntervalIndex([existing]),
        [replacement],
        'replace-overlap',
      );

      expect(result.entries.map((entry) => entry.shard.shardId)).toContain(existing.shardId);
    },
  );
});
