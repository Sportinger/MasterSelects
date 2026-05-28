import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import type { TimelineWaveformPyramid } from '../../../src/components/timeline/utils/waveformLod';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  DerivedProcessedWaveformPyramidService,
  canDeriveProcessedWaveformPyramid,
} from '../../../src/services/audio/DerivedWaveformPyramidService';
import { WaveformPyramidGenerator } from '../../../src/services/audio/WaveformPyramidGenerator';
import {
  getCachedTimelineWaveformPyramid,
  readTimelineWaveformPyramid,
} from '../../../src/services/audio/timelineWaveformPyramidCache';
import type { Effect } from '../../../src/types';
import { createMockClip } from '../../helpers/mockData';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createSourcePyramid(): TimelineWaveformPyramid {
  return {
    sampleRate: 4,
    duration: 4,
    levels: [
      {
        samplesPerBucket: 4,
        bucketDuration: 1,
        bucketCount: 4,
        channels: [
          {
            channelIndex: 0,
            min: Float32Array.from([-0.1, -0.2, -0.3, -0.4]),
            max: Float32Array.from([0.1, 0.2, 0.4, 0.8]),
            rms: Float32Array.from([0.1, 0.2, 0.35, 0.5]),
            peak: Float32Array.from([0.1, 0.2, 0.4, 0.8]),
          },
        ],
      },
      {
        samplesPerBucket: 8,
        bucketDuration: 2,
        bucketCount: 2,
        channels: [
          {
            channelIndex: 0,
            min: Float32Array.from([-0.2, -0.4]),
            max: Float32Array.from([0.2, 0.8]),
            rms: Float32Array.from([0.16, 0.43]),
            peak: Float32Array.from([0.2, 0.8]),
          },
        ],
      },
    ],
  };
}

function expectArrayClose(actual: ArrayLike<number>, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 6);
  });
}

describe('DerivedProcessedWaveformPyramidService', () => {
  it('derives simple edit-stack waveform changes from the source pyramid and stores a packed artifact', async () => {
    const store = createStore();
    const service = new DerivedProcessedWaveformPyramidService({
      artifactStore: store,
      waveformGenerator: new WaveformPyramidGenerator({
        artifactStore: store,
        now: () => FIXED_TIME,
        createJobId: () => 'derived-waveform-job',
      }),
    });
    const progress = vi.fn();
    const clip = createMockClip({
      id: 'clip-derived',
      name: 'Dialog.wav',
      source: { type: 'audio', naturalDuration: 4, mediaFileId: 'media-derived' },
      mediaFileId: 'media-derived',
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      audioState: {
        editStack: [
          {
            id: 'silence-second',
            type: 'silence',
            enabled: true,
            params: {},
            timeRange: { start: 1, end: 2 },
            createdAt: 1,
          },
          {
            id: 'invert-third',
            type: 'invert-polarity',
            enabled: true,
            params: {},
            timeRange: { start: 2, end: 3 },
            createdAt: 2,
          },
          {
            id: 'gain-fourth',
            type: 'gain',
            enabled: true,
            params: { gainDb: -6, fadeInSeconds: 0, fadeOutSeconds: 0 },
            timeRange: { start: 3, end: 4 },
            createdAt: 3,
          },
        ],
      },
    });

    const result = await service.generate({
      clip,
      sourcePyramid: createSourcePyramid(),
      sourceFingerprint: 'sha256:source-derived',
      onProgress: progress,
    });

    expect(result.audioAnalysisRefs.processedWaveformPyramidId).toBe(result.artifact.manifestRef.artifactId);
    expect(result.artifact).toMatchObject({
      kind: 'processed-waveform-pyramid',
      mediaFileId: 'media-derived',
      sourceFingerprint: 'sha256:source-derived',
      decoderId: 'masterselects.derived-waveform-pyramid',
    });
    expect(result.artifact.metadata).toMatchObject({
      derivedFromSourcePyramid: true,
      waveformManifest: {
        payloadLayout: 'packed-pyramid',
      },
    });
    expect(result.generated.payloadRefs).toHaveLength(1);

    const firstLevel = result.pyramid.levels[0].channels[0];
    const minusSixDb = 10 ** (-6 / 20);
    expectArrayClose(firstLevel.min, [-0.1, 0, -0.4, -0.4 * minusSixDb]);
    expectArrayClose(firstLevel.max, [0.1, 0, 0.3, 0.8 * minusSixDb]);
    expectArrayClose(firstLevel.rms, [0.1, 0, 0.35, 0.5 * minusSixDb]);
    expectArrayClose(firstLevel.peak, [0.1, 0, 0.4, 0.8 * minusSixDb]);

    const decoded = await readTimelineWaveformPyramid(result.generated.manifest, store);
    expectArrayClose(decoded.levels[0].channels[0].min, [-0.1, 0, -0.4, -0.4 * minusSixDb]);
    expect(getCachedTimelineWaveformPyramid(result.artifact.manifestRef.artifactId)).toBe(result.pyramid);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'complete', percent: 100 }));
  });

  it('only allows mathematically derivable edits', () => {
    const derivable = createMockClip({
      audioState: {
        editStack: [
          {
            id: 'invert',
            type: 'gain',
            enabled: true,
            params: { gainDb: -6, fadeInSeconds: 0.05, fadeOutSeconds: 0.05 },
            timeRange: { start: 0, end: 1 },
            createdAt: 1,
          },
        ],
      },
    });
    const repair = createMockClip({
      audioState: {
        editStack: [
          {
            id: 'repair',
            type: 'repair',
            enabled: true,
            params: {},
            timeRange: { start: 0, end: 1 },
            createdAt: 1,
          },
        ],
      },
    });
    const effect = createMockClip({
      effects: [
        { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
      ] satisfies Effect[],
    });
    const speed = createMockClip({ speed: 0.5 });
    const spectralLayer = createMockClip({
      audioState: {
        spectralLayers: [
          {
            id: 'spectral-layer',
            imageMediaFileId: 'image-a',
            timeStart: 0,
            duration: 1,
            frequencyMin: 100,
            frequencyMax: 1200,
            opacity: 1,
            enabled: true,
            blendMode: 'attenuate',
            gainDb: -12,
            featherTime: 0,
            featherFrequency: 0,
          },
        ],
      },
    });

    expect(canDeriveProcessedWaveformPyramid(derivable)).toBe(true);
    expect(canDeriveProcessedWaveformPyramid(repair)).toBe(false);
    expect(canDeriveProcessedWaveformPyramid(effect)).toBe(false);
    expect(canDeriveProcessedWaveformPyramid(speed)).toBe(false);
    expect(canDeriveProcessedWaveformPyramid(spectralLayer)).toBe(false);
  });
});
