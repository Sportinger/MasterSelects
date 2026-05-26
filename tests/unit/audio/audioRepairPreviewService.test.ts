import { describe, expect, it, vi } from 'vitest';
import { AudioRepairPreviewService } from '../../../src/services/audio/AudioRepairPreviewService';
import type { TimelineClip } from '../../../src/types';
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

describe('AudioRepairPreviewService', () => {
  it('renders a bounded preview clip with the same repair operation metadata used by apply', async () => {
    let renderedClip: TimelineClip | null = null;
    const sourceBuffer = createMockAudioBuffer(30);
    const renderedBuffer = createMockAudioBuffer(3);
    const audioContext = createAudioContextMock();
    const service = new AudioRepairPreviewService({
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
      id: 'audio-clip',
      startTime: 10,
      duration: 20,
      inPoint: 2,
      outPoint: 22,
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 30, mediaFileId: 'media-a' },
      audioState: {
        editStack: [
          {
            id: 'existing-edit',
            type: 'invert-polarity',
            enabled: true,
            params: {},
            timeRange: { start: 4, end: 5 },
            createdAt: 1,
          },
        ],
      },
    });

    await service.preview({
      clip,
      timelineTime: 15,
      maxDurationSeconds: 5,
      suggestion: {
        id: 'audio-repair:hum-notch',
        kind: 'hum-notch',
        label: '50 Hz hum notch',
        severity: 'warning',
        confidence: 0.84,
        reason: '50 Hz carries concentrated low-frequency energy.',
        operation: {
          editType: 'repair',
          params: {
            repairType: 'hum-notch',
            baseFrequencyHz: 50,
          },
        },
        evidence: {
          energyShare: 0.24,
        },
      },
      onStatus: status => statuses.push(status.phase),
    });

    expect(renderedClip).toMatchObject({
      id: 'audio-clip',
      startTime: 0,
      duration: 5,
      inPoint: 7,
      outPoint: 12,
    });
    expect(renderedClip?.audioState?.editStack).toEqual([
      expect.objectContaining({ id: 'existing-edit' }),
      expect.objectContaining({
        id: 'repair-preview:audio-repair:hum-notch',
        type: 'repair',
        timeRange: { start: 2, end: 22 },
        params: expect.objectContaining({
          repairSuggestionId: 'audio-repair:hum-notch',
          repairSuggestionKind: 'hum-notch',
          repairSuggestionEvidence: JSON.stringify({ energyShare: 0.24 }),
        }),
      }),
    ]);
    expect(audioContext.source.start).toHaveBeenCalledWith(0, 0, 3);
    expect(audioContext.context.close).toHaveBeenCalled();
    expect(statuses).toContain('rendering');
    expect(statuses).toContain('playing');
    expect(statuses).toContain('stopped');
  });
});
