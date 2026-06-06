import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCompositionAudioMixdownCache,
  getCompositionAudioMixdownCacheStats,
  getCompositionAudioMixdownKey,
  MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
  requestCompositionAudioMixdown,
} from '../../src/services/timeline/compositionAudioMixdownCache';
import type { TimelineClip } from '../../src/types';

const compositionAudioMixerMocks = vi.hoisted(() => ({
  mixdownComposition: vi.fn(),
  createAudioElement: vi.fn(),
}));

vi.mock('../../src/services/compositionAudioMixer', () => ({
  compositionAudioMixer: compositionAudioMixerMocks,
}));

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'comp-audio',
    trackId: 'audio-1',
    name: 'Comp Audio',
    file: new File([], 'comp-audio.wav'),
    startTime: 0,
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
    ...overrides,
  };
}

function audioBuffer(): AudioBuffer {
  return {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 48_000,
    duration: 1,
    getChannelData: () => new Float32Array(48_000),
  } as unknown as AudioBuffer;
}

describe('compositionAudioMixdownCache', () => {
  afterEach(() => {
    clearCompositionAudioMixdownCache();
    compositionAudioMixerMocks.mixdownComposition.mockReset();
    compositionAudioMixerMocks.createAudioElement.mockReset();
  });

  it('dedupes concurrent mixdown requests by composition id and content hash', async () => {
    const buffer = audioBuffer();
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue({
      buffer,
      waveform: [0, 0.5],
      duration: 1,
      hasAudio: true,
    });

    const first = requestCompositionAudioMixdown(clip());
    const second = requestCompositionAudioMixdown(clip());
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledOnce();
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledWith('comp-1');
    expect(firstResult).toBe(secondResult);
    expect(firstResult).toEqual(expect.objectContaining({
      key: 'comp-1:hash-a',
      buffer,
      waveform: [0, 0.5],
      hasAudio: true,
    }));
  });

  it('uses an existing clip mixdown buffer without calling the mixer', async () => {
    const buffer = audioBuffer();

    const result = await requestCompositionAudioMixdown(clip({
      mixdownBuffer: buffer,
      mixdownWaveform: [0.25],
    }));

    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      key: 'comp-1:hash-a',
      buffer,
      waveform: [0.25],
      hasAudio: true,
    }));
  });

  it('returns null when a clip has no composition id', async () => {
    expect(getCompositionAudioMixdownKey({ compositionId: undefined, nestedContentHash: 'hash-a' })).toBeNull();
    await expect(requestCompositionAudioMixdown(clip({ compositionId: undefined }))).resolves.toBeNull();
    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
  });

  it('bounds completed mixdown retention by least-recently-used content hash', async () => {
    compositionAudioMixerMocks.mixdownComposition.mockImplementation(async () => ({
      buffer: audioBuffer(),
      waveform: [0, 0.25],
      duration: 1,
      hasAudio: true,
    }));

    for (let index = 0; index < MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 2; index += 1) {
      await requestCompositionAudioMixdown(clip({ nestedContentHash: `hash-${index}` }));
    }

    expect(getCompositionAudioMixdownCacheStats()).toMatchObject({
      completedCount: MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
      maxCompletedCount: MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
    });
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 2);

    await requestCompositionAudioMixdown(clip({ nestedContentHash: 'hash-0' }));
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 3);

    await requestCompositionAudioMixdown(clip({ nestedContentHash: `hash-${MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 1}` }));
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 3);
  });
});
