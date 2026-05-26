import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  ProcessedWaveformPyramidService,
  clipRequiresProcessedWaveformPyramid,
  collectProcessedAnalysisClipAudioEffectInstances,
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
    const volumeOnly = createMockClip({
      effects: [{ id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.75 } }],
    });
    const defaultEq = createMockClip({
      effects: [{ id: 'eq-default', name: 'EQ', type: 'audio-eq', enabled: true, params: {} }],
    });
    const defaultFilter = createMockClip({
      audioState: {
        effectStack: [
          { id: 'hp-default', descriptorId: 'audio-high-pass', enabled: true, params: {} },
          { id: 'pan-default', descriptorId: 'audio-pan', enabled: true, params: {} },
          { id: 'expander-default', descriptorId: 'audio-expander', enabled: true, params: {} },
          { id: 'noise-reduction-default', descriptorId: 'audio-noise-reduction', enabled: true, params: {} },
          { id: 'spectral-gate-default', descriptorId: 'audio-spectral-gate', enabled: true, params: {} },
        ],
      },
    });
    const audioEffect = createMockClip({
      effects: [{ id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } }],
    });
    const professionalAudioEffect = createMockClip({
      audioState: {
        effectStack: [
          { id: 'pan', descriptorId: 'audio-pan', enabled: true, params: { pan: 0.5 } },
          { id: 'expander', descriptorId: 'audio-expander', enabled: true, params: { thresholdDb: -35, ratio: 2, rangeDb: 18 } },
          { id: 'noise-reduction', descriptorId: 'audio-noise-reduction', enabled: true, params: { thresholdDb: -58, reductionDb: 18, mix: 0.7 } },
          { id: 'spectral-gate', descriptorId: 'audio-spectral-gate', enabled: true, params: { thresholdDb: -54, reductionDb: 24, mix: 0.6 } },
          { id: 'compressor', descriptorId: 'audio-compressor', enabled: true, params: { thresholdDb: -18, ratio: 3 } },
        ],
      },
    });
    const defaultAudibleUtilityEffect = createMockClip({
      audioState: {
        effectStack: [
          { id: 'mono-sum', descriptorId: 'audio-mono-sum', enabled: true, params: {} },
          { id: 'stereo-split', descriptorId: 'audio-stereo-split', enabled: true, params: {} },
        ],
      },
    });
    const defaultAudibleNormalizeEffect = createMockClip({
      audioState: {
        effectStack: [
          { id: 'normalize', descriptorId: 'audio-normalize', enabled: true, params: {} },
        ],
      },
    });
    const defaultAudibleRepairEffect = createMockClip({
      audioState: {
        effectStack: [
          { id: 'hum-notch', descriptorId: 'audio-hum-notch', enabled: true, params: {} },
          { id: 'de-click', descriptorId: 'audio-de-click', enabled: true, params: {} },
        ],
      },
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
    expect(clipRequiresProcessedWaveformPyramid(volumeOnly)).toBe(false);
    expect(clipRequiresProcessedWaveformPyramid(defaultEq)).toBe(false);
    expect(clipRequiresProcessedWaveformPyramid(defaultFilter)).toBe(false);
    expect(clipRequiresProcessedWaveformPyramid(audioEffect)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(professionalAudioEffect)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(defaultAudibleNormalizeEffect)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(defaultAudibleUtilityEffect)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(defaultAudibleRepairEffect)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(audioEdit)).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(createMockClip({ speed: 0.5 }))).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(createMockClip({ reversed: true }))).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(createMockClip(), [
      { id: 'speed-kf', clipId: 'clip_1', property: 'speed', time: 0, value: 1.25, easing: 'linear' },
    ])).toBe(true);
    expect(clipRequiresProcessedWaveformPyramid(volumeOnly, [
      { id: 'volume-kf', clipId: 'clip_1', property: 'effect.gain.volume', time: 0, value: 0.25, easing: 'linear' },
    ])).toBe(false);
  });

  it('collects only renderable enabled audio edit operations for processed waveforms', () => {
    const clip = createMockClip({
      audioState: {
        editStack: [
          { id: 'copy', type: 'copy', enabled: true, params: {}, timeRange: { start: 0, end: 1 }, createdAt: 1 },
          { id: 'bypassed', type: 'reverse', enabled: false, params: {}, timeRange: { start: 0, end: 1 }, createdAt: 2 },
          { id: 'invert', type: 'invert-polarity', enabled: true, params: {}, timeRange: { start: 0, end: 1 }, channelMask: [0], createdAt: 3 },
          { id: 'room-tone', type: 'room-tone-fill', enabled: true, params: {}, timeRange: { start: 1, end: 2 }, createdAt: 4 },
        ],
      },
    });

    expect(collectRenderableClipAudioEditOperations(clip)).toEqual([
      expect.objectContaining({ id: 'invert', type: 'invert-polarity', channelMask: [0] }),
      expect.objectContaining({ id: 'room-tone', type: 'room-tone-fill' }),
    ]);
  });

  it('keeps static volume out of processed analysis effects while preserving output render effects', () => {
    const clip = createMockClip({
      effects: [
        { id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.5 } },
        { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
      ] satisfies Effect[],
    });

    expect(collectRenderableClipAudioEffectInstances(clip).map(effect => effect.id)).toEqual(['gain', 'eq']);
    expect(collectProcessedAnalysisClipAudioEffectInstances(clip).map(effect => effect.id)).toEqual(['eq']);
  });

  it('keeps static volume changes out of processed analysis identity', () => {
    const baseline = createMockClip({
      effects: [
        { id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 1 } },
        { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
      ] satisfies Effect[],
    });
    const quieter = createMockClip({
      ...baseline,
      effects: [
        { id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.35 } },
        { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
      ] satisfies Effect[],
    });

    expect(createProcessedClipAudioStateHash(quieter)).toBe(createProcessedClipAudioStateHash(baseline));
  });

  it('keeps volume automation out of processed analysis identity', () => {
    const clip = createMockClip({
      effects: [
        { id: 'gain', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 1 } },
        { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
      ] satisfies Effect[],
    });
    const eqKeyframes = [
      { id: 'eq-kf', clipId: clip.id, property: 'effect.eq.band1k', time: 0, value: 3, easing: 'linear' },
    ] as const;
    const eqAndVolumeKeyframes = [
      ...eqKeyframes,
      { id: 'volume-kf', clipId: clip.id, property: 'effect.gain.volume', time: 0.25, value: 0.5, easing: 'linear' },
    ] as const;

    expect(createProcessedClipAudioStateHash(clip, { keyframes: eqAndVolumeKeyframes }))
      .toBe(createProcessedClipAudioStateHash(clip, { keyframes: eqKeyframes }));
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
        { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
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
      [expect.objectContaining({ id: 'eq', descriptorId: 'audio-eq' })],
      [],
      0.5,
      expect.any(Function),
    );
    expect(result.clipAudioStateHash).toBe(createProcessedClipAudioStateHash(clip, { keyframes: [] }));
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
