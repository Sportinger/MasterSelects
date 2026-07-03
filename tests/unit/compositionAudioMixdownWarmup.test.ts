import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectCompositionAudioMixdownWarmupRequests,
  resetCompositionAudioMixdownWarmupForTest,
  scheduleCompositionAudioMixdownWarmup,
} from '../../src/services/timeline/compositionAudioMixdownWarmup';
import type { CompositionAudioMixdownRequestResult } from '../../src/services/timeline/compositionAudioMixdownCache';
import type { TimelineClip } from '../../src/types';

function audioBuffer(duration = 1): AudioBuffer {
  return {
    duration,
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: Math.round(duration * 48_000),
    getChannelData: () => new Float32Array(Math.round(duration * 48_000)),
  } as unknown as AudioBuffer;
}

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'comp-audio',
    trackId: 'audio-1',
    name: 'Comp Audio',
    file: new File([], 'comp-audio.wav'),
    startTime: 2,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'audio', naturalDuration: 5 },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isComposition: true,
    compositionId: 'comp-1',
    nestedContentHash: 'hash-a',
    mixdownGenerating: false,
    hasMixdownAudio: false,
    ...overrides,
  };
}

describe('compositionAudioMixdownWarmup', () => {
  afterEach(() => {
    resetCompositionAudioMixdownWarmupForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('collects composition audio clips and only unlinked composition video mixdown fallbacks', () => {
    const requests = collectCompositionAudioMixdownWarmupRequests({
      timelineSessionId: 7,
      clips: [
        clip({ id: 'later', startTime: 10 }),
        clip({ id: 'normal-audio', isComposition: false }),
        clip({ id: 'already-ready', mixdownBuffer: audioBuffer() }),
        clip({ id: 'generating', mixdownGenerating: true }),
        clip({
          id: 'linked-video-comp',
          source: { type: 'video', naturalDuration: 5 },
          startTime: 0,
          linkedClipId: 'linked-audio-comp',
        }),
        clip({
          id: 'linked-audio-comp',
          source: { type: 'audio', naturalDuration: 5 },
          startTime: 0,
          linkedClipId: 'linked-video-comp',
        }),
        clip({ id: 'unlinked-video-comp', source: { type: 'video', naturalDuration: 5 }, startTime: 0.5 }),
        clip({ id: 'earlier', startTime: 1 }),
      ],
    });

    expect(requests.map((request) => request.clipId)).toEqual([
      'linked-audio-comp',
      'unlinked-video-comp',
      'earlier',
      'later',
    ]);
    expect(requests.every((request) => request.requestKey.startsWith('7:'))).toBe(true);
  });

  it('warms a scheduled composition audio mixdown and applies the buffer without creating audio elements', async () => {
    vi.useFakeTimers();
    let timelineSessionId = 11;
    let clips: TimelineClip[] = [clip()];
    const buffer = audioBuffer(3);
    const requestMixdown = vi.fn(async (): Promise<CompositionAudioMixdownRequestResult> => ({
      key: 'comp-1:hash-a',
      buffer,
      waveform: [0, 0.5, 0.25],
      duration: 3,
      hasAudio: true,
    }));

    const cancel = scheduleCompositionAudioMixdownWarmup({
      delayMs: 25,
      deps: {
        getWarmupState: () => ({ clips, timelineSessionId }),
        setClips: (updater) => {
          clips = updater(clips);
        },
        requestMixdown,
      },
    });

    expect(requestMixdown).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);

    expect(requestMixdown).toHaveBeenCalledOnce();
    expect(clips[0]).toEqual(expect.objectContaining({
      mixdownBuffer: buffer,
      mixdownWaveform: [0, 0.5, 0.25],
      waveform: [0, 0.5, 0.25],
      hasMixdownAudio: true,
      mixdownGenerating: false,
    }));
    expect(clips[0].source).toEqual({
      type: 'audio',
      naturalDuration: 3,
    });
    expect(clips[0].source?.audioElement).toBeUndefined();

    timelineSessionId = 12;
    cancel();
  });

  it('does not start stale scheduled warmups after the timeline session changes', async () => {
    vi.useFakeTimers();
    let timelineSessionId = 3;
    let clips: TimelineClip[] = [clip()];
    const requestMixdown = vi.fn();

    scheduleCompositionAudioMixdownWarmup({
      delayMs: 25,
      deps: {
        getWarmupState: () => ({ clips, timelineSessionId }),
        setClips: (updater) => {
          clips = updater(clips);
        },
        requestMixdown,
      },
    });

    timelineSessionId = 4;
    await vi.advanceTimersByTimeAsync(25);

    expect(requestMixdown).not.toHaveBeenCalled();
    expect(clips[0].mixdownGenerating).toBe(false);
    expect(clips[0].mixdownBuffer).toBeUndefined();
  });
});
