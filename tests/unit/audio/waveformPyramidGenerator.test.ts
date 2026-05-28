import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import { createAudioAnalysisRefsManifest } from '../../../src/services/audio/audioAnalysisManifestKeys';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  WaveformPyramidGenerator,
  WAVEFORM_PACKED_PAYLOAD_MIME_TYPE,
  createWaveformPyramidAnalyzerVersion,
  type WaveformPyramidGenerationProgress,
} from '../../../src/services/audio/WaveformPyramidGenerator';
import { readTimelineWaveformPyramid } from '../../../src/services/audio/timelineWaveformPyramidCache';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createMockAudioBuffer(channels: number[][], sampleRate = 8): AudioBuffer {
  const channelData = channels.map((samples) => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;

  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function expectFloatArrayClose(actual: Float32Array, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 6);
  });
}

describe('WaveformPyramidGenerator', () => {
  it('generates sorted multi-channel waveform levels and stores a packed Float32 payload', async () => {
    const store = createStore();
    const generator = new WaveformPyramidGenerator({
      artifactStore: store,
      bucketSizes: [4, 2],
      now: () => FIXED_TIME,
      createJobId: () => 'waveform-job-1',
    });
    const buffer = createMockAudioBuffer([
      [0, 1, -1, 0.5, 0.25],
      [0.5, -0.5, 0.25, -0.25, 1],
    ]);

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer,
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 8,
      duration: 0.625,
      channelLayout: { kind: 'stereo', channelCount: 2, labels: ['L', 'R'] },
      levels: [
        {
          samplesPerBucket: 2,
          bucketDuration: 0.25,
          bucketCount: 3,
          channels: [{ channelIndex: 0 }, { channelIndex: 1 }],
        },
        {
          samplesPerBucket: 4,
          bucketDuration: 0.5,
          bucketCount: 2,
          channels: [{ channelIndex: 0 }, { channelIndex: 1 }],
        },
      ],
    });
    expect(result.manifest.payloadLayout).toBe('packed-pyramid');
    expect(result.manifest.packedPayload?.artifactId).toBe(result.payloadRefs[0]?.artifactId);
    expect(result.payloadRefs).toHaveLength(1);
    expect(result.payloadRefs[0]?.mimeType).toBe(WAVEFORM_PACKED_PAYLOAD_MIME_TYPE);

    const pyramid = await readTimelineWaveformPyramid(result.manifest, store);
    const firstLevelLeft = pyramid.levels[0].channels[0];

    expectFloatArrayClose(firstLevelLeft.min, [0, -1, 0.25]);
    expectFloatArrayClose(firstLevelLeft.max, [1, 0.5, 0.25]);
    expectFloatArrayClose(firstLevelLeft.rms, [Math.sqrt(0.5), Math.sqrt(0.625), 0.25]);
    expectFloatArrayClose(firstLevelLeft.peak, [1, 1, 0.25]);
  });

  it('emits deterministic cache keys, compact refs, and manifests without raw payload values', async () => {
    const firstStore = createStore();
    const firstGenerator = new WaveformPyramidGenerator({
      artifactStore: firstStore,
      bucketSizes: [512, 128],
      now: () => FIXED_TIME,
      createJobId: () => 'waveform-job-deterministic-a',
    });
    const secondStore = createStore();
    const secondGenerator = new WaveformPyramidGenerator({
      artifactStore: secondStore,
      bucketSizes: [128, 512],
      now: () => FIXED_TIME,
      createJobId: () => 'waveform-job-deterministic-b',
    });
    const buffer = createMockAudioBuffer([[0, 0.5, -0.5, 1]], 48_000);
    const request = {
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer,
      clipAudioStateHash: 'clip-state-a',
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    };

    const first = await firstGenerator.generate(request);
    const second = await secondGenerator.generate(request);

    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.artifact.id).toBe(second.artifact.id);
    expect(first.manifest.levels.map((level) => level.samplesPerBucket)).toEqual([128, 512]);
    expect(first.analysisRef).toMatchObject({
      schemaVersion: 1,
      kind: 'waveform-pyramid',
      artifactId: first.artifact.id,
      cacheKey: first.cacheKey,
    });
    expect(first.artifact.analyzerVersion).toBe(createWaveformPyramidAnalyzerVersion([512, 128]));
    expect(first.artifact.metadata?.waveformManifest).toMatchObject({
      schemaVersion: 1,
      levels: [
        { samplesPerBucket: 128, channels: [{ channelIndex: 0 }] },
        { samplesPerBucket: 512, channels: [{ channelIndex: 0 }] },
      ],
    });

    const projectRefsJson = JSON.stringify(createAudioAnalysisRefsManifest([first.analysisRef]));
    expect(projectRefsJson).toContain(first.artifact.id);
    expect(projectRefsJson).toContain('cacheKey');
    expect(projectRefsJson).not.toContain(first.payloadRefs[0].artifactId);
    expect(projectRefsJson).not.toContain('waveformManifest');

    const manifestJson = JSON.stringify(first.manifest);
    expect(manifestJson).not.toContain('"values"');
    expect(manifestJson).not.toContain('0.707106');
  });

  it('stores processed waveform pyramids with processed artifact identity', async () => {
    const store = createStore();
    const generator = new WaveformPyramidGenerator({
      artifactStore: store,
      bucketSizes: [2],
      now: () => FIXED_TIME,
      createJobId: () => 'waveform-job-processed',
    });
    const buffer = createMockAudioBuffer([[0, 0.25, -0.75, 1]], 8);

    const result = await generator.generate({
      kind: 'processed-waveform-pyramid',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      clipAudioStateHash: 'audio-state:v1:processed:123',
      buffer,
      decoderId: 'processed-graph',
      decoderVersion: '1.0.0',
    });

    expect(result.cacheKey).toContain('processed-waveform-pyramid');
    expect(result.artifact).toMatchObject({
      kind: 'processed-waveform-pyramid',
      clipAudioStateHash: 'audio-state:v1:processed:123',
      decoderId: 'processed-graph',
    });
    expect(result.artifact.id).toContain('audio:processed-waveform-pyramid:');
    expect(result.analysisRef).toMatchObject({
      kind: 'processed-waveform-pyramid',
      artifactId: result.artifact.id,
      cacheKey: result.cacheKey,
    });
    expect(result.payloadRefs).toHaveLength(1);
    expect(result.payloadRefs[0]).toMatchObject({
      mimeType: WAVEFORM_PACKED_PAYLOAD_MIME_TYPE,
      metadata: {
        cacheKey: result.cacheKey,
        payloadLayout: 'packed-pyramid',
      },
    });
  });

  it('derives divisible pyramid levels from the finest PCM pass', async () => {
    const store = createStore();
    const generator = new WaveformPyramidGenerator({
      artifactStore: store,
      bucketSizes: [2, 4, 8],
      now: () => FIXED_TIME,
      createJobId: () => 'waveform-job-derived-levels',
    });
    const buffer = createMockAudioBuffer([[0, 1, -1, 0.5, 0.25, -0.25, 0.75, -0.5]], 8);

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer,
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(buffer.getChannelData).toHaveBeenCalledTimes(1);
    expect(result.manifest.levels.map(level => level.samplesPerBucket)).toEqual([2, 4, 8]);

    const pyramid = await readTimelineWaveformPyramid(result.manifest, store);
    const secondLevel = pyramid.levels[1].channels[0];
    const thirdLevel = pyramid.levels[2].channels[0];
    expectFloatArrayClose(secondLevel.min, [-1, -0.5]);
    expectFloatArrayClose(secondLevel.max, [1, 0.75]);
    expectFloatArrayClose(secondLevel.peak, [1, 0.75]);
    expectFloatArrayClose(thirdLevel.min, [-1]);
    expectFloatArrayClose(thirdLevel.max, [1]);
    expectFloatArrayClose(thirdLevel.peak, [1]);
  });

  it('supports progress hooks and cancellation before payload storage', async () => {
    const store = createStore();
    const generator = new WaveformPyramidGenerator({
      artifactStore: store,
      bucketSizes: [2, 4],
      now: () => FIXED_TIME,
      createJobId: () => 'waveform-job-cancel',
    });
    const buffer = createMockAudioBuffer([[0, 1, -1, 0.5]]);
    const controller = new AbortController();
    const events: WaveformPyramidGenerationProgress[] = [];

    await expect(generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer,
    }, {
      signal: controller.signal,
      onProgress: (progress) => {
        events.push(progress);
        if (progress.phase === 'analyzing') {
          controller.abort('user cancelled');
        }
      },
    })).rejects.toMatchObject({
      name: 'WaveformPyramidGenerationCancelledError',
      code: 'cancelled',
      jobId: 'waveform-job-cancel',
    });

    expect(events.map((event) => event.phase)).toEqual(['queued', 'analyzing', 'cancelled']);
    expect(events[1]).toMatchObject({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      samplesPerBucket: 2,
      channelIndex: 0,
    });
    expect(events[2].message).toContain('user cancelled');
    expect(events.some((event) => event.phase === 'storing-payloads')).toBe(false);
  });
});
