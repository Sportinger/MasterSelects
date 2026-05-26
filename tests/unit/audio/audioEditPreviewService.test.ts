import { describe, expect, it, vi } from 'vitest';
import { AudioEditPreviewService } from '../../../src/services/audio/AudioEditPreviewService';
import type { ClipAudioEditOperation, TimelineClip } from '../../../src/types';
import { createMockClip } from '../../helpers/mockData';

function createMockAudioBuffer(duration = 3, sampleRate = 10): AudioBuffer {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const data = new Float32Array(length);
  return {
    numberOfChannels: 1,
    sampleRate,
    length,
    duration,
    getChannelData: vi.fn(() => data),
  } as unknown as AudioBuffer;
}

function createAudioContextMock() {
  const context = {
    state: 'running' as AudioContextState,
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createBufferSource: vi.fn(),
  };
  const source = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(() => {
      queueMicrotask(() => source.onended?.());
    }),
    stop: vi.fn(() => {
      queueMicrotask(() => source.onended?.());
    }),
  };
  context.createBufferSource.mockReturnValue(source);
  return {
    context: context as unknown as AudioContext,
    source,
  };
}

function createOperation(patch: Partial<ClipAudioEditOperation> = {}): ClipAudioEditOperation {
  return {
    id: 'edit-a',
    type: 'invert-polarity',
    enabled: true,
    params: {},
    timeRange: { start: 8, end: 10 },
    createdAt: 1,
    ...patch,
  };
}

describe('AudioEditPreviewService', () => {
  it('renders active edit stack operations in a bake-like bounded preview clip', async () => {
    let renderedClip: TimelineClip | null = null;
    const sourceBuffer = createMockAudioBuffer(30);
    const renderedBuffer = createMockAudioBuffer(4);
    const audioContext = createAudioContextMock();
    const activeOperation = createOperation();
    const disabledOperation = createOperation({
      id: 'disabled-edit',
      enabled: false,
      timeRange: { start: 12, end: 13 },
    });
    const service = new AudioEditPreviewService({
      extractor: {
        extractAudio: vi.fn(async () => sourceBuffer),
      },
      clipAudioRenderer: {
        render: vi.fn(async (request) => {
          renderedClip = request.clip;
          return { buffer: renderedBuffer };
        }),
      },
      createAudioContext: () => audioContext.context,
    });
    const statuses: string[] = [];
    const clip = createMockClip({
      id: 'clip-edit-preview',
      startTime: 10,
      duration: 20,
      inPoint: 2,
      outPoint: 22,
      speed: 2,
      reversed: true,
      preservesPitch: false,
      effects: [
        { id: 'legacy-volume', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 0.5 } },
      ],
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 30, mediaFileId: 'media-a' },
      audioState: {
        muted: true,
        editStack: [activeOperation, disabledOperation],
        effectStack: [
          { id: 'track-eq', descriptorId: 'audio-eq', enabled: true, params: { band1k: 2 } },
        ],
        spectralLayers: [
          {
            id: 'image-layer',
            imageMediaFileId: 'img-a',
            timeStart: 8,
            duration: 2,
            frequencyMin: 200,
            frequencyMax: 2000,
            opacity: 0.8,
            blendMode: 'attenuate',
            gainDb: -12,
            featherTime: 0.05,
            featherFrequency: 120,
            keyframes: [{ id: 'kf-a', time: 0.5, opacity: 0.6 }],
          },
        ],
      },
    });

    await service.preview({
      clip,
      operations: [activeOperation, disabledOperation],
      mode: 'stack',
      previewId: 'stack',
      timelineTime: 15,
      maxDurationSeconds: 5,
      onStatus: status => statuses.push(status.phase),
    });

    expect(renderedClip).toMatchObject({
      id: 'clip-edit-preview',
      startTime: 0,
      duration: 5,
      inPoint: 7,
      outPoint: 12,
      speed: 1,
      reversed: false,
      preservesPitch: true,
      effects: [],
    });
    expect(renderedClip?.audioState?.muted).toBe(false);
    expect(renderedClip?.audioState?.effectStack).toEqual([]);
    expect(renderedClip?.audioState?.editStack).toEqual([activeOperation]);
    expect(renderedClip?.audioState?.spectralLayers).toEqual(clip.audioState?.spectralLayers);
    expect(audioContext.source.start).toHaveBeenCalledWith(0, 0, 4);
    expect(statuses).toContain('rendering');
    expect(statuses).toContain('playing');
    expect(statuses).toContain('stopped');
  });

  it('previews a selected operation without carrying unrelated spectral layers', async () => {
    let renderedClip: TimelineClip | null = null;
    const audioContext = createAudioContextMock();
    const operation = createOperation({
      id: 'mono-range',
      type: 'mono-sum',
      timeRange: { start: 2, end: 3 },
    });
    const service = new AudioEditPreviewService({
      extractor: {
        extractAudio: vi.fn(async () => createMockAudioBuffer(10)),
      },
      clipAudioRenderer: {
        render: vi.fn(async (request) => {
          renderedClip = request.clip;
          return { buffer: createMockAudioBuffer(2) };
        }),
      },
      createAudioContext: () => audioContext.context,
    });
    const clip = createMockClip({
      id: 'clip-operation-preview',
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-a' },
      audioState: {
        spectralLayers: [
          {
            id: 'image-layer',
            imageMediaFileId: 'img-a',
            timeStart: 2,
            duration: 2,
            frequencyMin: 200,
            frequencyMax: 2000,
            opacity: 0.8,
            blendMode: 'boost',
            gainDb: 6,
            featherTime: 0.05,
            featherFrequency: 120,
          },
        ],
      },
    });

    await service.preview({
      clip,
      operations: [operation],
      mode: 'operation',
      previewId: 'operation:mono-range',
      maxDurationSeconds: 5,
      includeSpectralLayers: false,
    });

    expect(renderedClip?.audioState?.editStack).toEqual([operation]);
    expect(renderedClip?.audioState?.spectralLayers).toEqual([]);
    expect(renderedClip?.inPoint).toBe(1);
    expect(renderedClip?.outPoint).toBe(6);
  });

  it('renders a source-only preview for A/B comparison without edit operations', async () => {
    let renderedClip: TimelineClip | null = null;
    const audioContext = createAudioContextMock();
    const service = new AudioEditPreviewService({
      extractor: {
        extractAudio: vi.fn(async () => createMockAudioBuffer(20)),
      },
      clipAudioRenderer: {
        render: vi.fn(async (request) => {
          renderedClip = request.clip;
          return { buffer: createMockAudioBuffer(3) };
        }),
      },
      createAudioContext: () => audioContext.context,
    });
    const clip = createMockClip({
      id: 'clip-source-preview',
      startTime: 5,
      duration: 10,
      inPoint: 2,
      outPoint: 12,
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 20, mediaFileId: 'media-a' },
      audioState: {
        muted: true,
        editStack: [
          createOperation({ id: 'existing-edit', timeRange: { start: 3, end: 4 } }),
        ],
        effectStack: [
          { id: 'eq', descriptorId: 'audio-eq', enabled: true, params: { band1k: 4 } },
        ],
      },
    });

    await service.preview({
      clip,
      operations: [],
      mode: 'source',
      previewId: 'source',
      timelineTime: 9,
      maxDurationSeconds: 4,
    });

    expect(renderedClip).toMatchObject({
      id: 'clip-source-preview',
      startTime: 0,
      duration: 4,
      inPoint: 6,
      outPoint: 10,
      speed: 1,
      reversed: false,
      effects: [],
    });
    expect(renderedClip?.audioState?.muted).toBe(false);
    expect(renderedClip?.audioState?.editStack).toEqual([]);
    expect(renderedClip?.audioState?.effectStack).toEqual([]);
  });

  it('rejects empty previews before extracting source audio', async () => {
    const extractAudio = vi.fn();
    const service = new AudioEditPreviewService({
      extractor: { extractAudio },
      clipAudioRenderer: { render: vi.fn() },
      createAudioContext: () => createAudioContextMock().context,
    });

    await expect(service.preview({
      clip: createMockClip({
        id: 'empty-preview',
        file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      }),
      operations: [createOperation({ enabled: false })],
      mode: 'stack',
    })).rejects.toThrow('Cannot preview an empty audio edit stack.');
    expect(extractAudio).not.toHaveBeenCalled();
  });
});
