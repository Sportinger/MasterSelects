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
});
