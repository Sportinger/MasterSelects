import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  ProcessedWaveformPyramidService,
  clipRequiresProcessedWaveformPyramid,
  collectRenderableClipAudioEditOperations,
  collectRenderableClipAudioEffectInstances,
  createProcessedClipAudioStateHash,
} from '../../../src/services/audio/ProcessedWaveformPyramidService';
import { WaveformPyramidGenerator } from '../../../src/services/audio/WaveformPyramidGenerator';
import { getCachedTimelineWaveformPyramid } from '../../../src/services/audio/timelineWaveformPyramidCache';
import type { Effect, TimelineClip } from '../../../src/types';
import { createMockClip } from '../../helpers/mockData';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createMockAudioBuffer(channels: number[][], sampleRate = 8): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;

  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function createService(
  store: AudioArtifactStore,
  overrides: Partial<ConstructorParameters<typeof ProcessedWaveformPyramidService>[0]> = {},
): ProcessedWaveformPyramidService {
  return new ProcessedWaveformPyramidService({
    artifactStore: store,
    waveformGenerator: new WaveformPyramidGenerator({
      artifactStore: store,
      bucketSizes: [2],
      now: () => FIXED_TIME,
      createJobId: () => 'processed-waveform-job',
    }),
    extractor: {
      trimBuffer: vi.fn((buffer: AudioBuffer) => buffer),
    },
    ...overrides,
  });
}

describe('ProcessedWaveformPyramidService', () => {
  it('collects renderable audioState and legacy audio effects without visual effects', () => {
    const clip = createMockClip({
      effects: [
        { id: 'visual', name: 'blur', type: 'blur', enabled: true, params: { radius: 5 } },
        { id: 'legacy-volume', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.5 } },
      ],
      audioState: {
        effectStack: [
          { id: 'stack-eq', descriptorId: 'audio-eq', enabled: true, params: { band1k: 3 } },
          { id: 'disabled-volume', descriptorId: 'audio-volume', enabled: false, params: { volume: 0.2 } },
        ],
      },
    });

    expect(collectRenderableClipAudioEffectInstances(clip).map(effect => effect.id)).toEqual([
      'stack-eq',
      'legacy-volume',
    ]);
  });

  it('detects when a processed waveform artifact is required', () => {
    const plain = createMockClip({ effects: [] });
    const visualOnly = createMockClip({
      effects: [{ id: 'blur', name: 'blur', type: 'blur', enabled: true, params: {} }],
    });
    const audioEffect = createMockClip({
      effects: [{ id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.75 } }],
    });
    const audioEdit = createMockClip({
      audioState: {
        editStack: [
          {
            id: 'silence-region',
            type: 'silence',
            enabled: true,
            params: {},
            timeRange: { start: 1, end: 2 },
            createdAt: 1,
          },
        ],
      },
    });

    expect(clipRequiresProcessedWaveformPyramid(plain)).toBe(false);
    expect(clipRequiresProcessedWaveformPyramid(visualOnly)).toBe(false);
    expect(clipRequiresProcessedWaveformPyramid(audioEffect)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(audioEdit)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(createMockClip({ speed: 0.5 }))).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(createMockClip({ reversed: true }))).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(createMockClip(), [
      { id: 'speed-kf', clipId: 'clip_1', property: 'speed', time: 0, value: 1.25, easing: 'linear' },
    ])).toBe(true);
  });

  it('collects only renderable enabled audio edit operations for processed waveforms', () => {
    const clip = createMockClip({
      audioState: {
        editStack: [
          { id: 'copy', type: 'copy', enabled: true, params: {}, timeRange: { start: 0, end: 1 }, createdAt: 1 },
          { id: 'bypassed', type: 'reverse', enabled: false, params: {}, timeRange: { start: 0, end: 1 }, createdAt: 2 },
          { id: 'invert', type: 'invert-polarity', enabled: true, params: {}, timeRange: { start: 0, end: 1 }, channelMask: [0], createdAt: 3 },
        ],
      },
    });

    expect(collectRenderableClipAudioEditOperations(clip)).toEqual([
      expect.objectContaining({ id: 'invert', type: 'invert-polarity', channelMask: [0] }),
    ]);
  });

  it('renders clip audio effects, stores a processed waveform pyramid, and primes timeline cache', async () => {
    const store = createStore();
    const sourceBuffer = createMockAudioBuffer([[0, 0.25, -0.75, 1]], 8);
    const effectedBuffer = createMockAudioBuffer([[0, 0.5, -1, 1]], 8);
    const effectRenderer = {
      renderEffectInstances: vi.fn(async () => effectedBuffer),
    };
    const service = createService(store, { effectRenderer });
    const clip = createMockClip({
      id: 'clip-audio',
      name: 'Dialog.wav',
      source: { type: 'audio', naturalDuration: 0.5, mediaFileId: 'media-a' },
      duration: 0.5,
      outPoint: 0.5,
      effects: [
        { id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.5 } },
      ] satisfies Effect[],
    });

    const result = await service.generate({
      clip,
      sourceBuffer,
      sourceFingerprint: 'sha256:source-a',
      keyframes: [],
    });

    expect(effectRenderer.renderEffectInstances).toHaveBeenCalledWith(
      sourceBuffer,
      [expect.objectContaining({ id: 'gain', descriptorId: 'audio-volume' })],
      [],
      0.5,
      expect.any(Function),
    );
    expect(result.clipAudioStateHash).toBe(createProcessedClipAudioStateHash(clip));
    expect(result.audioAnalysisRefs.processedWaveformPyramidId).toBe(result.artifact.manifestRef.artifactId);
    expect(result.artifact).toMatchObject({
      kind: 'processed-waveform-pyramid',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      clipAudioStateHash: result.clipAudioStateHash,
      decoderId: 'masterselects.processed-audio-graph',
    });
    expect(result.generated.analysisRef.kind).toBe('processed-waveform-pyramid');
    expect(getCachedTimelineWaveformPyramid(result.artifact.manifestRef.artifactId)).toBe(result.pyramid);
  });

  it('applies speed processing before processed waveform storage', async () => {
    const store = createStore();
    const sourceBuffer = createMockAudioBuffer([[0, 1, 0, -1]], 8);
    const speedBuffer = createMockAudioBuffer([[0, 1]], 8);
    const timeStretchProcessor = {
      processConstantSpeed: vi.fn(async () => speedBuffer),
      processWithKeyframes: vi.fn(),
    };
    const service = createService(store, {
      timeStretchProcessor,
      effectRenderer: {
        renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer),
      },
    });
    const clip = createMockClip({
      id: 'clip-speed',
      source: { type: 'audio', naturalDuration: 0.5, mediaFileId: 'media-speed' },
      duration: 0.25,
      outPoint: 0.5,
      speed: 2,
    }) as TimelineClip;

    const result = await service.generate({
      clip,
      sourceBuffer,
      sourceFingerprint: 'sha256:speed-source',
    });

    expect(timeStretchProcessor.processConstantSpeed).toHaveBeenCalledWith(sourceBuffer, 2, true);
    expect(result.artifact.duration).toBe(0.25);
    expect(result.generated.manifest.duration).toBe(0.25);
  });
});
