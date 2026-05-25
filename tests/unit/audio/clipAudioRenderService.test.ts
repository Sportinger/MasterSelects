import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipAudioRenderService } from '../../../src/services/audio/ClipAudioRenderService';
import type { Effect, Keyframe } from '../../../src/types';
import { createMockClip } from '../../helpers/mockData';

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

function installAudioContextMock(): void {
  class AudioContextMock {
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
      return createMockAudioBuffer(
        Array.from({ length: numberOfChannels }, () => Array.from({ length }, () => 0)),
        sampleRate,
      );
    }

    close(): void {}
  }

  vi.stubGlobal('AudioContext', AudioContextMock);
}

function sineWave(length: number, sampleRate: number, frequencyHz: number): number[] {
  return Array.from({ length }, (_, index) => Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate));
}

function rms(values: ArrayLike<number>, start = 0, end = values.length): number {
  let sum = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const value = values[index] ?? 0;
    sum += value * value;
    count += 1;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

describe('ClipAudioRenderService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders trim, speed, and audio effects through a single clip graph path', async () => {
    const sourceBuffer = createMockAudioBuffer([[0, 0.1, 0.2, 0.3, 0.4, 0.5]], 6);
    const trimmedBuffer = createMockAudioBuffer([[0.2, 0.3, 0.4, 0.5]], 6);
    const speedBuffer = createMockAudioBuffer([[0.2, 0.4]], 6);
    const effectedBuffer = createMockAudioBuffer([[0.1, 0.2]], 6);
    const extractor = {
      trimBuffer: vi.fn(() => trimmedBuffer),
    };
    const timeStretchProcessor = {
      processConstantSpeed: vi.fn(async () => speedBuffer),
      processWithKeyframes: vi.fn(),
    };
    const effectRenderer = {
      renderEffectInstances: vi.fn(async () => effectedBuffer),
    };
    const service = new ClipAudioRenderService({
      extractor,
      timeStretchProcessor,
      effectRenderer,
    });
    const keyframes: Keyframe[] = [
      { id: 'gain-kf', clipId: 'clip-a', property: 'effect.legacy-volume.volume', time: 0, value: 0.7, easing: 'linear' },
    ];
    const clip = createMockClip({
      id: 'clip-a',
      duration: 0.5,
      inPoint: 0.2,
      outPoint: 0.9,
      speed: 2,
      preservesPitch: true,
      audioState: {
        effectStack: [
          { id: 'stack-eq', descriptorId: 'audio-eq', enabled: true, params: { band1k: 2 } },
        ],
      },
      effects: [
        { id: 'legacy-volume', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.7 } },
      ] satisfies Effect[],
    });

    const result = await service.render({
      clip,
      sourceBuffer,
      keyframes,
    });

    expect(result.buffer).toBe(effectedBuffer);
    expect(extractor.trimBuffer).toHaveBeenCalledWith(sourceBuffer, 0.2, 0.9);
    expect(timeStretchProcessor.processConstantSpeed).toHaveBeenCalledWith(trimmedBuffer, 2, true);
    expect(effectRenderer.renderEffectInstances).toHaveBeenCalledWith(
      speedBuffer,
      [
        expect.objectContaining({ id: 'stack-eq', descriptorId: 'audio-eq' }),
        expect.objectContaining({ id: 'legacy-volume', descriptorId: 'audio-volume' }),
      ],
      keyframes,
      0.5,
      expect.any(Function),
    );
  });

  it('renders muted clips after speed processing and skips effects', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([[1, -1, 0.5, -0.5]], 8);
    const speedBuffer = createMockAudioBuffer([[0.6, -0.6]], 8);
    const timeStretchProcessor = {
      processConstantSpeed: vi.fn(async () => speedBuffer),
      processWithKeyframes: vi.fn(),
    };
    const effectRenderer = {
      renderEffectInstances: vi.fn(),
    };
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor,
      effectRenderer,
    });
    const clip = createMockClip({
      id: 'muted-clip',
      duration: 0.25,
      outPoint: 0.5,
      speed: 2,
      audioState: { muted: true },
      effects: [
        { id: 'legacy-volume', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.2 } },
      ] satisfies Effect[],
    });

    const result = await service.render({ clip, sourceBuffer });

    expect(timeStretchProcessor.processConstantSpeed).toHaveBeenCalledWith(sourceBuffer, 2, true);
    expect(effectRenderer.renderEffectInstances).not.toHaveBeenCalled();
    expect(result.buffer.length).toBe(speedBuffer.length);
    expect(Array.from(result.buffer.getChannelData(0))).toEqual([0, 0]);
  });

  it('normalizes speed keyframes before variable-speed rendering', async () => {
    const sourceBuffer = createMockAudioBuffer([[0, 1, 0, -1]], 8);
    const renderedBuffer = createMockAudioBuffer([[0, 1]], 8);
    const timeStretchProcessor = {
      processConstantSpeed: vi.fn(),
      processWithKeyframes: vi.fn(async () => renderedBuffer),
    };
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor,
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const keyframes: Keyframe[] = [
      { id: 'speed-a', clipId: 'clip-speed', property: 'speed', time: 0, value: -1.25, easing: 'linear' },
      { id: 'speed-b', clipId: 'clip-speed', property: 'speed', time: 0.5, value: 0, easing: 'linear' },
    ];
    const clip = createMockClip({
      id: 'clip-speed',
      duration: 0.5,
      outPoint: 0.5,
      speed: -1,
    });

    await service.render({ clip, sourceBuffer, keyframes });

    expect(timeStretchProcessor.processWithKeyframes).toHaveBeenCalledWith(
      sourceBuffer,
      [
        expect.objectContaining({ id: 'speed-a', value: 1.25 }),
        expect.objectContaining({ id: 'speed-b', value: 0.01 }),
      ],
      1,
      0.5,
      true,
      expect.any(Function),
    );
  });

  it('renders region edit stack operations before clip reverse, speed, and effects', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([
      [0, 1, 2, 3, 4, 5],
      [10, 11, 12, 13, 14, 15],
    ], 2);
    const effectRenderer = {
      renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer),
    };
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer,
    });
    const clip = createMockClip({
      id: 'clip-edit-stack',
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      audioState: {
        editStack: [
          {
            id: 'reverse-region',
            type: 'reverse',
            enabled: true,
            params: {},
            timeRange: { start: 0.5, end: 2 },
            channelMask: [0],
            createdAt: 1,
          },
          {
            id: 'invert-region',
            type: 'invert-polarity',
            enabled: true,
            params: {},
            timeRange: { start: 1, end: 2.5 },
            createdAt: 2,
          },
          {
            id: 'disabled-silence',
            type: 'silence',
            enabled: false,
            params: {},
            timeRange: { start: 0, end: 3 },
            createdAt: 3,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });

    expect(result.buffer).not.toBe(sourceBuffer);
    expect(Array.from(result.buffer.getChannelData(0))).toEqual([0, 3, -2, -1, -4, 5]);
    expect(Array.from(result.buffer.getChannelData(1))).toEqual([10, 11, -12, -13, -14, 15]);
    expect(effectRenderer.renderEffectInstances).not.toHaveBeenCalled();
  });

  it('keeps insert and delete silence operations clip-duration preserving', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([[1, 2, 3, 4, 5, 6]], 2);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-duration-preserve',
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      audioState: {
        editStack: [
          {
            id: 'insert',
            type: 'insert-silence',
            enabled: true,
            params: { durationSeconds: 1 },
            timeRange: { start: 0.5, end: 0.5 },
            createdAt: 1,
          },
          {
            id: 'delete',
            type: 'delete-silence',
            enabled: true,
            params: {},
            timeRange: { start: 2, end: 2.5 },
            createdAt: 2,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });

    expect(result.buffer.length).toBe(sourceBuffer.length);
    expect(Array.from(result.buffer.getChannelData(0))).toEqual([1, 0, 0, 2, 4, 0]);
  });

  it('renders paste operations from copied source ranges inside the current clip source', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([[1, 2, 3, 4, 5, 6]], 1);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-paste',
      duration: 6,
      inPoint: 0,
      outPoint: 6,
      audioState: {
        editStack: [
          {
            id: 'paste-region',
            type: 'paste',
            enabled: true,
            params: {
              sourceInPoint: 0,
              sourceOutPoint: 2,
              replaceSelection: true,
            },
            timeRange: { start: 3, end: 5 },
            createdAt: 1,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });

    expect(Array.from(result.buffer.getChannelData(0))).toEqual([1, 2, 3, 1, 2, 6]);
  });

  it('renders repair edit operations as non-destructive region processors', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([[0, 0, 1, 0, 0, 0.2, 0.2, 0.2, 0.2, 0.2]], 10);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-repair-stack',
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      audioState: {
        editStack: [
          {
            id: 'click-repair',
            type: 'repair',
            enabled: true,
            params: { repairType: 'de-click', threshold: 0.35, ratio: 2 },
            timeRange: { start: 0, end: 0.5 },
            createdAt: 1,
          },
          {
            id: 'loudness-repair',
            type: 'repair',
            enabled: true,
            params: { repairType: 'loudness-match', targetDb: -6, featherTime: 0 },
            timeRange: { start: 0.5, end: 1 },
            createdAt: 2,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });
    const rendered = result.buffer.getChannelData(0);

    expect(rendered[2]).toBe(0);
    expect(rms(rendered, 5, 10)).toBeCloseTo(0.501, 3);
  });

  it('attenuates hum repair notch frequencies inside the selected range', async () => {
    installAudioContextMock();
    const sampleRate = 1000;
    const sourceBuffer = createMockAudioBuffer([sineWave(sampleRate, sampleRate, 50).map(value => value * 0.5)], sampleRate);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-hum-repair',
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      audioState: {
        editStack: [
          {
            id: 'hum-repair',
            type: 'repair',
            enabled: true,
            params: { repairType: 'hum-notch', baseFrequencyHz: 50, harmonicCount: 1, q: 20, featherTime: 0 },
            timeRange: { start: 0, end: 1 },
            createdAt: 1,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });

    expect(rms(result.buffer.getChannelData(0))).toBeLessThan(rms(sourceBuffer.getChannelData(0)) * 0.65);
  });

  it('renders spectral mask edit operations as deterministic band attenuation', async () => {
    installAudioContextMock();
    const sampleRate = 1024;
    const samples = sineWave(sampleRate * 2, sampleRate, 128);
    const sourceBuffer = createMockAudioBuffer([samples], sampleRate);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-spectral-mask',
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      audioState: {
        editStack: [
          {
            id: 'spectral-mask',
            type: 'spectral-mask',
            enabled: true,
            params: {
              frequencyMinHz: 96,
              frequencyMaxHz: 172,
              gainDb: -48,
              featherTime: 0,
            },
            timeRange: { start: 0, end: 2 },
            createdAt: 1,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });
    const rendered = result.buffer.getChannelData(0);

    expect(rms(rendered, 512, 1536)).toBeLessThan(rms(samples, 512, 1536) * 0.55);
  });

  it('renders spectral image layers as deterministic image-driven band operations', async () => {
    installAudioContextMock();
    const sampleRate = 1024;
    const samples = sineWave(sampleRate * 2, sampleRate, 128);
    const sourceBuffer = createMockAudioBuffer([samples], sampleRate);
    const spectralImageLayerMaskProvider = vi.fn(async () => ({
      width: 2,
      height: 2,
      luminance: Float32Array.from([1, 1, 1, 1]),
      alpha: Float32Array.from([1, 1, 1, 1]),
    }));
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
      spectralImageLayerMaskProvider,
    });
    const clip = createMockClip({
      id: 'clip-spectral-image',
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      audioState: {
        spectralLayers: [
          {
            id: 'image-layer',
            imageMediaFileId: 'image-1',
            timeStart: 0,
            duration: 2,
            frequencyMin: 96,
            frequencyMax: 172,
            opacity: 1,
            blendMode: 'attenuate',
            gainDb: -48,
            featherTime: 0,
            featherFrequency: 0,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });
    const rendered = result.buffer.getChannelData(0);

    expect(spectralImageLayerMaskProvider).toHaveBeenCalledOnce();
    expect(rms(rendered, 512, 1536)).toBeLessThan(rms(samples, 512, 1536) * 0.6);
  });

  it('renders spectral image layer keyframes as time-varying band operations', async () => {
    installAudioContextMock();
    const sampleRate = 1024;
    const samples = sineWave(sampleRate * 2, sampleRate, 128);
    const sourceBuffer = createMockAudioBuffer([samples], sampleRate);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
      spectralImageLayerMaskProvider: vi.fn(async () => ({
        width: 2,
        height: 2,
        luminance: Float32Array.from([1, 1, 1, 1]),
        alpha: Float32Array.from([1, 1, 1, 1]),
      })),
    });
    const clip = createMockClip({
      id: 'clip-spectral-image-keyframes',
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      audioState: {
        spectralLayers: [
          {
            id: 'image-layer',
            imageMediaFileId: 'image-1',
            timeStart: 0,
            duration: 2,
            frequencyMin: 96,
            frequencyMax: 172,
            opacity: 1,
            blendMode: 'attenuate',
            gainDb: 0,
            featherTime: 0,
            featherFrequency: 0,
            keyframes: [
              { id: 'gain-a', time: 0, gainDb: 0 },
              { id: 'gain-b', time: 0.95, gainDb: 0 },
              { id: 'gain-c', time: 1.05, gainDb: -48 },
              { id: 'gain-d', time: 2, gainDb: -48 },
            ],
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });
    const rendered = result.buffer.getChannelData(0);

    expect(rms(rendered, 256, 768)).toBeGreaterThan(rms(samples, 256, 768) * 0.9);
    expect(rms(rendered, 1280, 1792)).toBeLessThan(rms(samples, 1280, 1792) * 0.6);
  });

  it('compacts buffers for timeline delete-silence operations when requested', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([[1, 2, 3, 4, 5, 6]], 2);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-compact-silence',
      duration: 2,
      inPoint: 0,
      outPoint: 3,
      audioState: {
        editStack: [
          {
            id: 'delete-silence-a',
            type: 'delete-silence',
            enabled: true,
            params: {
              compactTimeline: true,
              preserveClipDuration: false,
            },
            timeRange: { start: 1, end: 2 },
            createdAt: 1,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });
    const rendered = Array.from(result.buffer.getChannelData(0)).map(value => Number(value.toFixed(4)));

    expect(result.buffer.length).toBe(4);
    expect(result.buffer.duration).toBe(2);
    expect(rendered).toEqual([1, 2, 5, 6]);
  });

  it('fills a target range by looping captured room tone source ranges', async () => {
    installAudioContextMock();
    const sourceBuffer = createMockAudioBuffer([[0.2, -0.2, 0.9, 0.9, 0.5, 0.5]], 2);
    const service = new ClipAudioRenderService({
      extractor: { trimBuffer: vi.fn((buffer: AudioBuffer) => buffer) },
      timeStretchProcessor: {
        processConstantSpeed: vi.fn(),
        processWithKeyframes: vi.fn(),
      },
      effectRenderer: { renderEffectInstances: vi.fn(async (buffer: AudioBuffer) => buffer) },
    });
    const clip = createMockClip({
      id: 'clip-room-tone-fill',
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      audioState: {
        editStack: [
          {
            id: 'room-tone-a',
            type: 'room-tone-fill',
            enabled: true,
            params: {
              roomToneSourceRanges: JSON.stringify([{ start: 0, end: 1 }]),
              roomToneGainDb: 0,
              crossfadeSeconds: 0,
            },
            timeRange: { start: 1, end: 2 },
            createdAt: 1,
          },
        ],
      },
    });

    const result = await service.render({ clip, sourceBuffer });
    const rendered = Array.from(result.buffer.getChannelData(0)).map(value => Number(value.toFixed(4)));

    expect(rendered).toEqual([0.2, -0.2, 0.2, -0.2, 0.5, 0.5]);
  });
});
