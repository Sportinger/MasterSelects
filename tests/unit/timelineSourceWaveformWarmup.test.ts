import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectVisibleTimelineSourceWaveformGenerationRequests,
  createTimelineSourceWaveformGenerationRequest,
  resetTimelineSourceWaveformWarmupForTest,
  scheduleVisibleTimelineSourceWaveformGeneration,
  warmTimelineSourceWaveformGeneration,
  type TimelineSourceWaveformWarmupDeps,
} from '../../src/services/timeline/timelineSourceWaveformWarmup';

function createDeps(overrides: Partial<ReturnType<TimelineSourceWaveformWarmupDeps['getState']>> = {}): TimelineSourceWaveformWarmupDeps {
  const generateWaveformForClip = vi.fn<(clipId: string) => Promise<void>>()
    .mockResolvedValue(undefined);

  return {
    getState: () => ({
      clips: [
        {
          id: 'clip-a',
          name: 'Audio A',
          startTime: 0,
          duration: 4,
          source: { type: 'audio', mediaFileId: 'media-a' },
        },
      ],
      isPlaying: false,
      clipDragPreview: null,
      generateWaveformForClip,
      ...overrides,
    }),
    setTimeout,
    clearTimeout,
  };
}

describe('timeline source waveform warmup', () => {
  afterEach(() => {
    resetTimelineSourceWaveformWarmupForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('collects only visible audio clips that still need source waveform generation', () => {
    const requests = collectVisibleTimelineSourceWaveformGenerationRequests({
      clips: [
        {
          id: 'visible-audio',
          name: 'Visible',
          startTime: 0,
          duration: 2,
          source: { type: 'audio', mediaFileId: 'audio-a' },
        },
        {
          id: 'offscreen-audio',
          name: 'Offscreen',
          startTime: 99,
          duration: 2,
          source: { type: 'audio', mediaFileId: 'audio-b' },
        },
        {
          id: 'ready-audio',
          name: 'Ready',
          startTime: 1,
          duration: 2,
          source: { type: 'audio', mediaFileId: 'audio-c' },
          audioState: { sourceAnalysisRefs: { waveformPyramidId: 'waveform-ref' } },
        },
        {
          id: 'generating-audio',
          name: 'Generating',
          startTime: 1,
          duration: 2,
          source: { type: 'audio', mediaFileId: 'audio-d' },
          waveformGenerating: true,
        },
        {
          id: 'video',
          name: 'Video',
          startTime: 1,
          duration: 2,
          source: { type: 'video', mediaFileId: 'video-a' },
        },
      ],
      scrollX: 0,
      viewportWidth: 500,
      overscanPx: 0,
      timeToPixel: (time) => time * 100,
      mode: 'compact',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      clipId: 'visible-audio',
      mode: 'compact',
    });
  });

  it('blocks generation while playback or drag preview is active', async () => {
    const request = createTimelineSourceWaveformGenerationRequest({
      id: 'clip-a',
      name: 'Audio A',
      source: { type: 'audio', mediaFileId: 'media-a' },
    });
    expect(request).toBeTruthy();

    const deps = createDeps({ isPlaying: true });

    await expect(warmTimelineSourceWaveformGeneration(request!, { deps }))
      .resolves.toEqual({ clipId: 'clip-a', status: 'blocked' });
    expect(deps.getState().generateWaveformForClip).not.toHaveBeenCalled();
  });

  it('coalesces overlapping source waveform generation requests', async () => {
    let resolveGeneration: (() => void) | undefined;
    const generateWaveformForClip = vi.fn<(clipId: string) => Promise<void>>()
      .mockReturnValue(new Promise<void>((resolve) => {
        resolveGeneration = resolve;
      }));
    const deps = createDeps({ generateWaveformForClip });
    const request = createTimelineSourceWaveformGenerationRequest({
      id: 'clip-a',
      name: 'Audio A',
      source: { type: 'audio', mediaFileId: 'media-a' },
    });

    const first = warmTimelineSourceWaveformGeneration(request!, { deps });
    const second = warmTimelineSourceWaveformGeneration(request!, { deps });

    expect(generateWaveformForClip).toHaveBeenCalledTimes(1);
    resolveGeneration?.();

    await expect(first).resolves.toEqual({ clipId: 'clip-a', status: 'generated' });
    await expect(second).resolves.toEqual({ clipId: 'clip-a', status: 'generated' });
  });

  it('can cancel scheduled visible waveform generation before work starts', () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const request = createTimelineSourceWaveformGenerationRequest({
      id: 'clip-a',
      name: 'Audio A',
      source: { type: 'audio', mediaFileId: 'media-a' },
    });

    const cancel = scheduleVisibleTimelineSourceWaveformGeneration([request!], {
      deps,
      delayMs: 50,
    });

    cancel();
    vi.advanceTimersByTime(60);

    expect(deps.getState().generateWaveformForClip).not.toHaveBeenCalled();
  });

  it('deduplicates duplicate scheduled visible waveform generation requests', () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const request = createTimelineSourceWaveformGenerationRequest({
      id: 'clip-a',
      name: 'Audio A',
      source: { type: 'audio', mediaFileId: 'media-a' },
    });

    scheduleVisibleTimelineSourceWaveformGeneration([request!, request!], {
      deps,
      delayMs: 50,
    });
    vi.advanceTimersByTime(60);

    expect(deps.getState().generateWaveformForClip).toHaveBeenCalledTimes(1);
  });
});
