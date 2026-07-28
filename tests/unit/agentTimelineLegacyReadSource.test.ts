import { describe, expect, it } from 'vitest';
import { buildOccurrenceMappingIndex } from '../../src/services/agentTimeline/mapping/occurrenceMappingIndex';
import { getAgentTimelineRange } from '../../src/services/agentTimeline/query/agentTimelineRangeQuery';
import { materializeLegacyAgentTimelineReadSource } from '../../src/services/agentTimeline/runtime/legacyReadSource/materializeLegacyReadSource';
import { LEGACY_EVENT_SHARD_MAX_SECONDS } from '../../src/services/agentTimeline/runtime/legacyReadSource/legacyViewMaterializer';
import { SOURCE_IDENTITY_SCHEMA_VERSION, type SourceIdentity } from '../../src/types/agentTimeline/sourceIdentity';
import type { AudioAnalysisArtifact } from '../../src/services/audio/audioArtifactTypes';
import type { LegacyReadSourceMaterializerInput } from '../../src/services/agentTimeline/runtime/legacyReadSource/materializeLegacyReadSource';

const SOURCE_HASH = 'ab'.repeat(32);
const GENERATED_AT = '2026-07-27T10:00:00.000Z';

function identity(): SourceIdentity {
  return {
    type: 'source-identity',
    version: SOURCE_IDENTITY_SCHEMA_VERSION,
    strategy: 'sampled-chunks',
    hashAlgorithm: 'sha-256',
    hash: SOURCE_HASH,
    metadata: { size: 1234, mediaType: 'video/mp4' },
  };
}

function audio(overrides: Partial<AudioAnalysisArtifact> = {}): AudioAnalysisArtifact {
  return {
    schemaVersion: 1,
    id: 'waveform-a',
    kind: 'waveform-pyramid',
    mediaFileId: 'media-a',
    sourceFingerprint: 'legacy-fingerprint',
    decoderId: 'webcodecs',
    decoderVersion: '1',
    analyzerVersion: '1',
    sampleRate: 48000,
    channelLayout: { kind: 'stereo', channelCount: 2 },
    duration: 10,
    payloadRefs: [],
    manifestRef: {
      artifactId: 'waveform-a-manifest',
      hash: 'cd'.repeat(32),
      size: 12,
      mimeType: 'application/json',
      encoding: 'json',
      storage: 'indexeddb',
      createdAt: GENERATED_AT,
    },
    createdAt: 1,
    stale: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<LegacyReadSourceMaterializerInput> = {}): LegacyReadSourceMaterializerInput {
  return {
    sourceIdentity: identity(),
    mediaFileId: 'media-a',
    durationSeconds: 10,
    generatedAt: GENERATED_AT,
    profile: 'balanced',
    ...overrides,
  };
}

function query(source: ReturnType<typeof materializeLegacyAgentTimelineReadSource>, channel: 'cuts' | 'audio') {
  return getAgentTimelineRange({
    manifest: source.manifest,
    shardIndex: source.shardIndex,
    shardReader: source.shardReader,
    query: {
      scope: { mediaFileId: 'media-a' },
      start: 0,
      end: 10,
      timeDomain: 'source',
      granularity: 'event',
      channels: [channel],
      includeFrames: false,
    },
  });
}

describe('materializeLegacyAgentTimelineReadSource', () => {
  it('creates deterministic event-only source shards with exact half-open cut reads', async () => {
    const input = baseInput({
      clipAnalysis: {
        value: {
          sampleInterval: 10_000,
          frames: [{ timestamp: 0, focus: .9, brightness: .5, motion: .1, globalMotion: .1, localMotion: 0, faceCount: 0 }],
        },
        coverage: [{ start: 0, end: 10 }],
      },
      sceneCuts: {
        value: {
          schemaVersion: 1,
          detectorVersion: 'content-adaptive-160x90-v2',
          analysisWidth: 160,
          analysisHeight: 90,
          sourceFrameCount: 100,
          expectedSourceFrameCount: 100,
          duration: 10,
          sourceFingerprint: { size: 1, lastModified: 0 },
          completedAt: 1,
          cuts: [{
            timestamp: 2,
            frameNumber: 50,
            score: .9,
            changedRatio: .8,
            meanPixelDifference: .8,
            histogramDifference: .8,
            edgeChangeRatio: .8,
            motionCompensatedDifference: .8,
            confidence: .9,
          }],
        },
        coverage: [{ start: 0, end: 10 }],
      },
    });
    const first = materializeLegacyAgentTimelineReadSource(input);
    const second = materializeLegacyAgentTimelineReadSource(input);

    expect(first.shardIndex.entries.map(entry => entry.shard)).toEqual(
      second.shardIndex.entries.map(entry => entry.shard),
    );
    expect(first.manifest.channels.quality).toMatchObject({ status: 'complete' });
    expect(first.manifest.channels['camera-motion']).toMatchObject({ status: 'complete' });
    expect(await first.shardReader.readEvents({
      shard: first.shardIndex.entries.find(entry => entry.shard.channel === 'quality')!.shard,
      sourceRanges: [{ start: 0, end: 10 }],
      eventTypes: ['quality-issue'],
      granularity: 'event',
      includeFrames: false,
    })).toEqual([]);
    expect(JSON.stringify(first)).not.toContain('focus-brightness-sample');

    const beforeCut = await getAgentTimelineRange({
      manifest: first.manifest,
      shardIndex: first.shardIndex,
      shardReader: first.shardReader,
      query: {
        scope: { mediaFileId: 'media-a' },
        start: 1,
        end: 2,
        timeDomain: 'source',
        granularity: 'event',
        channels: ['cuts'],
        includeFrames: false,
      },
    });
    const atCut = await getAgentTimelineRange({
      manifest: first.manifest,
      shardIndex: first.shardIndex,
      shardReader: first.shardReader,
      query: {
        scope: { mediaFileId: 'media-a' },
        start: 2,
        end: 3,
        timeDomain: 'source',
        granularity: 'event',
        channels: ['cuts'],
        includeFrames: false,
      },
    });
    expect(beforeCut.events).toEqual([]);
    expect(atCut.events.map(event => event.type)).toEqual(['cut']);
    input.sceneCuts!.value!.cuts[0].timestamp = 9;
    expect((await getAgentTimelineRange({
      manifest: first.manifest,
      shardIndex: first.shardIndex,
      shardReader: first.shardReader,
      query: {
        scope: { mediaFileId: 'media-a' },
        start: 2,
        end: 3,
        timeDomain: 'source',
        granularity: 'event',
        channels: ['cuts'],
        includeFrames: false,
      },
    })).events.map(event => event.type)).toEqual(['cut']);
  });

  it('does not promote rendered audio into source coverage and preserves stale source audio honestly', async () => {
    const rendered = materializeLegacyAgentTimelineReadSource(baseInput({
      audioArtifacts: {
        value: [audio({ clipAudioStateHash: 'render-state-a' })],
        coverage: [{ start: 0, end: 10 }],
      },
    }));
    expect(rendered.manifest.channels.audio.artifacts).toHaveLength(1);
    expect(rendered.manifest.channels.audio.artifacts[0]).toMatchObject({
      timeDomain: 'clip-rendered',
      stateHash: 'render-state-a',
    });
    expect((await query(rendered, 'audio')).coverage[0]).toMatchObject({
      status: 'stale',
      covered: [],
    });

    const stale = materializeLegacyAgentTimelineReadSource(baseInput({
      audioArtifacts: { value: [audio({ stale: true })] },
    }));
    expect(stale.manifest.channels.audio).toMatchObject({ status: 'stale', artifacts: [] });
    expect((await query(stale, 'audio')).coverage[0]).toMatchObject({ status: 'stale' });
  });

  it('splits a full-hour legacy transcript into deterministic bounded source shards', async () => {
    const durationSeconds = 60 * 60;
    const words = Array.from({ length: durationSeconds }, (_, second) => ({
      id: `word-${second}`,
      text: `word ${second}`,
      start: second,
      end: second + 0.5,
      confidence: 0.9,
    }));
    const source = materializeLegacyAgentTimelineReadSource(baseInput({
      durationSeconds,
      transcript: { value: words, coverage: [{ start: 0, end: durationSeconds }] },
    }));
    const shards = source.shardIndex.entries
      .map(entry => entry.shard)
      .filter(shard => shard.channel === 'transcript');

    expect(shards).toHaveLength(durationSeconds / LEGACY_EVENT_SHARD_MAX_SECONDS);
    expect(shards.every(shard => shard.sourceRange.end - shard.sourceRange.start <= LEGACY_EVENT_SHARD_MAX_SECONDS)).toBe(true);
    expect(shards.map(shard => shard.sourceRange)).toContainEqual({ start: 60, end: 120 });

    const boundary = await getAgentTimelineRange({
      manifest: source.manifest,
      shardIndex: source.shardIndex,
      shardReader: source.shardReader,
      query: {
        scope: { mediaFileId: 'media-a' }, start: 60, end: 61,
        timeDomain: 'source', granularity: 'event', channels: ['speech'], includeFrames: false,
      },
    });
    expect(boundary.events.map(event => event.id)).toEqual([
      expect.stringContaining('speech'),
    ]);
    expect(boundary.events[0]?.data).toMatchObject({ text: 'word 60' });
  });

  it('retains only the source-audio shards for source reads when source and rendered artifacts coexist', async () => {
    const source = materializeLegacyAgentTimelineReadSource(baseInput({
      audioArtifacts: {
        value: [audio(), audio({ id: 'rendered', clipAudioStateHash: 'render-state-b', createdAt: 2 })],
        coverage: [{ start: 0, end: 10 }],
      },
    }));
    const result = await query(source, 'audio');
    const sourceRefs = source.manifest.channels.audio.artifacts
      .filter(ref => ref.timeDomain === 'source')
      .map(ref => ref.artifactRef);
    expect(result.coverage[0]).toMatchObject({ status: 'complete', artifactRefs: sourceRefs });
    expect(source.manifest.channels.audio.artifacts.some(ref => ref.timeDomain === 'clip-rendered')).toBe(true);
  });

  it('clones occurrence mapping and durable manifest input rather than retaining caller objects', () => {
    const occurrenceMapping = buildOccurrenceMappingIndex({
      stateHash: 'timeline-state',
      occurrences: [{
        sourceId: 'mapped-media',
        clipId: 'clip-a',
        compositionPath: ['comp-a'],
        sourceRange: { start: 0, end: 10 },
        pieces: [{ compositionStart: 0, compositionEnd: 10, sourceStart: 0, sourceRateStart: 1 }],
      }],
    });
    const input = baseInput({ sourceIdentity: identity(), occurrenceMapping, mappingSourceId: 'mapped-media' });
    const result = materializeLegacyAgentTimelineReadSource(input);
    input.sourceIdentity.metadata.size = 999;
    occurrenceMapping.segments[0].compositionPath[0] = 'mutated';

    expect(result.manifest.sourceIdentity.metadata.size).toBe(1234);
    expect(result.occurrenceMapping?.segments[0].compositionPath).toEqual(['comp-a']);
    expect(result.mappingSourceId).toBe('mapped-media');
  });

  it('rejects invalid canonical timestamps, coverage, source identities, and rendered state hashes', () => {
    expect(() => materializeLegacyAgentTimelineReadSource(baseInput({ generatedAt: '2026-07-27' }))).toThrow(/canonical ISO/);
    expect(() => materializeLegacyAgentTimelineReadSource(baseInput({
      transcript: { value: [], coverage: [{ start: 0, end: 11 }] },
    }))).toThrow(/coverage/);
    expect(() => materializeLegacyAgentTimelineReadSource(baseInput({
      sourceIdentity: { ...identity(), hash: 'not-a-sha' },
    }))).toThrow(/SourceIdentity/);
    expect(() => materializeLegacyAgentTimelineReadSource(baseInput({
      audioArtifacts: { value: [audio({ clipAudioStateHash: ' ' })] },
    }))).toThrow(/statehash/i);
    expect(() => materializeLegacyAgentTimelineReadSource(baseInput({
      audioArtifacts: { value: [audio({ mediaFileId: 'different-media' })] },
    }))).toThrow(/belong to mediaFileId/);
  });
});
