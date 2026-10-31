import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import {
  resetTimelineAudioArtifactGenerationWarmupForTest,
  scheduleTimelineProcessedWaveformDerivation,
  scheduleTimelineSpectrogramTileGeneration,
  type TimelineAudioArtifactGenerationDeps,
} from '../../src/services/timeline/timelineAudioArtifactGenerationWarmup';
import { clipRequiresProcessedWaveformPyramid } from '../../src/services/audio/processedWaveformEligibility';
import { canDeriveProcessedWaveformPyramid } from '../../src/services/audio/DerivedWaveformPyramidService';

vi.mock('../../src/services/audio/processedWaveformEligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/audio/processedWaveformEligibility')>();
  return {
    ...actual,
    clipRequiresProcessedWaveformPyramid: vi.fn(() => true),
  };
});

vi.mock('../../src/services/audio/DerivedWaveformPyramidService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/audio/DerivedWaveformPyramidService')>();
  return {
    ...actual,
    canDeriveProcessedWaveformPyramid: vi.fn(() => true),
  };
});

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-a',
    trackId: 'track-a',
    name: 'Audio A',
    file: new File(['audio'], 'audio.wav'),
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'audio', naturalDuration: 4 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    audioState: {
      sourceAnalysisRefs: {
        waveformPyramidId: 'source-waveform-ref',
      },
    },
    ...overrides,
  };
}

function createDeps(overrides: Partial<ReturnType<TimelineAudioArtifactGenerationDeps['getState']>> = {}): TimelineAudioArtifactGenerationDeps {
  return {
    getState: () => ({
      clips: [createClip()],
      clipKeyframes: new Map(),
      isPlaying: false,
      clipDragPreview: null,
      generateProcessedWaveformForClip: vi.fn().mockResolvedValue(undefined),
      generateSpectrogramForClip: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }),
    setTimeout,
    clearTimeout,
  };
}

describe('timeline audio artifact generation warmup', () => {
  afterEach(() => {
    resetTimelineAudioArtifactGenerationWarmupForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(clipRequiresProcessedWaveformPyramid).mockReturnValue(true);
    vi.mocked(canDeriveProcessedWaveformPyramid).mockReturnValue(true);
  });

  it('schedules processed waveform derivation and coalesces duplicate request keys', () => {
    vi.useFakeTimers();
    const generateProcessedWaveformForClip = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ generateProcessedWaveformForClip });
    const request = { clipId: 'clip-a', requestKey: 'processed:clip-a' };

    scheduleTimelineProcessedWaveformDerivation(request, { deps, delayMs: 50 });
    scheduleTimelineProcessedWaveformDerivation(request, { deps, delayMs: 50 });
    vi.advanceTimersByTime(60);

    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(1);
    expect(generateProcessedWaveformForClip).toHaveBeenCalledWith('clip-a', { derivedOnly: true });
  });

  it('cancels scheduled processed waveform derivation before it starts', () => {
    vi.useFakeTimers();
    const generateProcessedWaveformForClip = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ generateProcessedWaveformForClip });
    const cancel = scheduleTimelineProcessedWaveformDerivation(
      { clipId: 'clip-a', requestKey: 'processed:clip-a' },
      { deps, delayMs: 50 },
    );

    cancel();
    vi.advanceTimersByTime(60);

    expect(generateProcessedWaveformForClip).not.toHaveBeenCalled();
  });

  it('blocks processed waveform derivation while playback is active', () => {
    vi.useFakeTimers();
    const generateProcessedWaveformForClip = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({
      isPlaying: true,
      generateProcessedWaveformForClip,
    });

    scheduleTimelineProcessedWaveformDerivation(
      { clipId: 'clip-a', requestKey: 'processed:clip-a' },
      { deps, delayMs: 50 },
    );
    vi.advanceTimersByTime(60);

    expect(generateProcessedWaveformForClip).not.toHaveBeenCalled();
  });

  it('schedules spectrogram generation when no required tile set ref exists', () => {
    vi.useFakeTimers();
    const generateSpectrogramForClip = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ generateSpectrogramForClip });

    scheduleTimelineSpectrogramTileGeneration(
      { clipId: 'clip-a', requestKey: 'spectrogram:clip-a' },
      { deps, delayMs: 50 },
    );
    vi.advanceTimersByTime(60);

    expect(generateSpectrogramForClip).toHaveBeenCalledTimes(1);
    expect(generateSpectrogramForClip).toHaveBeenCalledWith('clip-a');
  });

  it('skips spectrogram generation when the required ref already exists', () => {
    vi.useFakeTimers();
    const generateSpectrogramForClip = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({
      clips: [
        createClip({
          audioState: {
            processedAnalysisRefs: {
              spectrogramTileSetIds: ['processed-spectrogram-ref'],
            },
          },
        }),
      ],
      generateSpectrogramForClip,
    });

    scheduleTimelineSpectrogramTileGeneration(
      { clipId: 'clip-a', requestKey: 'spectrogram:clip-a' },
      { deps, delayMs: 50 },
    );
    vi.advanceTimersByTime(60);

    expect(generateSpectrogramForClip).not.toHaveBeenCalled();
  });

  it('spaces attempts for the same clip audio instead of restarting a failed one on every clip update', async () => {
    vi.useFakeTimers();
    let now = 0;
    const generateProcessedWaveformForClip = vi.fn().mockResolvedValue(undefined);
    const deps = { ...createDeps({ generateProcessedWaveformForClip }), now: () => now };
    const request = { clipId: 'clip-a', requestKey: 'processed:clip-a' };
    const scheduleAt = async (time: number) => {
      now = time;
      scheduleTimelineProcessedWaveformDerivation(request, { deps, delayMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
    };

    await scheduleAt(0);
    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(1);
    // The attempt ended without a processed waveform ref: clip updates within 15 s start nothing.
    await scheduleAt(1_000);
    await scheduleAt(14_000);
    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(1);
    await scheduleAt(16_000);
    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(2);
    // The second failure doubles the pause to 30 s.
    await scheduleAt(40_000);
    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(2);
    await scheduleAt(46_001);
    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(3);
  });

  it('starts a new attempt at once when the clip audio changed', async () => {
    vi.useFakeTimers();
    const generateProcessedWaveformForClip = vi.fn().mockResolvedValue(undefined);
    let clip = createClip();
    const base = createDeps({ generateProcessedWaveformForClip });
    const deps: TimelineAudioArtifactGenerationDeps = {
      ...base,
      now: () => 1_000,
      getState: () => ({ ...base.getState(), clips: [clip], generateProcessedWaveformForClip }),
    };
    const request = { clipId: 'clip-a', requestKey: 'processed:clip-a' };

    scheduleTimelineProcessedWaveformDerivation(request, { deps, delayMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    clip = createClip({ speed: 2 });
    scheduleTimelineProcessedWaveformDerivation(request, { deps, delayMs: 50 });
    await vi.advanceTimersByTimeAsync(60);

    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(2);
  });

  it('clears the pause once the artifact exists', async () => {
    vi.useFakeTimers();
    let clip = createClip();
    const generateProcessedWaveformForClip = vi.fn(async () => {
      clip = createClip({
        audioState: {
          sourceAnalysisRefs: { waveformPyramidId: 'source-waveform-ref' },
          processedAnalysisRefs: { processedWaveformPyramidId: 'processed-ref' },
        },
      });
    });
    const base = createDeps({ generateProcessedWaveformForClip });
    const deps: TimelineAudioArtifactGenerationDeps = {
      ...base,
      now: () => 1_000,
      getState: () => ({ ...base.getState(), clips: [clip], generateProcessedWaveformForClip }),
    };
    const request = { clipId: 'clip-a', requestKey: 'processed:clip-a' };
    const schedule = async () => {
      scheduleTimelineProcessedWaveformDerivation(request, { deps, delayMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
    };

    await schedule();
    await schedule(); // sees the created ref
    clip = createClip(); // the ref is dropped later (e.g. cache invalidation)
    await schedule();

    expect(generateProcessedWaveformForClip).toHaveBeenCalledTimes(2);
  });
});
