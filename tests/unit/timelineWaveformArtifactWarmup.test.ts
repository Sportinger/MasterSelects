import { describe, expect, it, vi } from 'vitest';
import {
  collectTimelineWaveformArtifactRefs,
  getCachedTimelineWaveformArtifact,
  warmTimelineWaveformArtifacts,
} from '../../src/services/timeline/timelineWaveformArtifactWarmup';
import type { TimelineWaveformPyramid } from '../../src/components/timeline/utils/waveformLod';

const pyramid: TimelineWaveformPyramid = {
  sampleRate: 48000,
  duration: 1,
  levels: [],
};

describe('timeline waveform artifact warmup', () => {
  it('collects unique preferred waveform artifact refs from visible clips', () => {
    const refs = collectTimelineWaveformArtifactRefs([
      {
        waveform: [0.1],
        audioState: {
          sourceAnalysisRefs: { waveformPyramidId: 'source-ref' },
        },
      },
      {
        audioState: {
          processedAnalysisRefs: { processedWaveformPyramidId: 'processed-ref' },
          sourceAnalysisRefs: { waveformPyramidId: 'source-ref' },
        },
      },
      {
        audioState: {
          processedAnalysisRefs: { waveformPyramidId: 'processed-source-ref' },
        },
      },
      {
        audioState: {
          sourceAnalysisRefs: { waveformPyramidId: 'source-ref' },
        },
      },
    ]);

    expect(refs).toEqual(['processed-ref', 'processed-source-ref', 'source-ref']);
  });

  it('returns cached artifacts without loading from persistent storage', async () => {
    const getCachedPyramid = vi.fn<(refId: string | undefined) => TimelineWaveformPyramid | null>()
      .mockReturnValue(pyramid);
    const loadPyramid = vi.fn<(refId: string | undefined) => Promise<TimelineWaveformPyramid | null>>();

    expect(getCachedTimelineWaveformArtifact('waveform-ref', {
      getCachedPyramid,
      loadPyramid,
    })).toBe(pyramid);

    const results = await warmTimelineWaveformArtifacts(['waveform-ref'], {
      deps: { getCachedPyramid, loadPyramid },
    });

    expect(results).toEqual([{ refId: 'waveform-ref', pyramid, status: 'ready' }]);
    expect(loadPyramid).not.toHaveBeenCalled();
  });

  it('coalesces overlapping artifact loads by waveform ref id', async () => {
    let resolveLoad: ((value: TimelineWaveformPyramid) => void) | undefined;
    const loadPromise = new Promise<TimelineWaveformPyramid>((resolve) => {
      resolveLoad = resolve;
    });
    const getCachedPyramid = vi.fn<(refId: string | undefined) => TimelineWaveformPyramid | null>()
      .mockReturnValue(null);
    const loadPyramid = vi.fn<(refId: string | undefined) => Promise<TimelineWaveformPyramid | null>>()
      .mockReturnValue(loadPromise);

    const first = warmTimelineWaveformArtifacts(['shared-waveform-ref'], {
      deps: { getCachedPyramid, loadPyramid },
    });
    const second = warmTimelineWaveformArtifacts(['shared-waveform-ref'], {
      deps: { getCachedPyramid, loadPyramid },
    });

    expect(loadPyramid).toHaveBeenCalledTimes(1);
    resolveLoad?.(pyramid);

    await expect(first).resolves.toEqual([
      { refId: 'shared-waveform-ref', pyramid, status: 'ready' },
    ]);
    await expect(second).resolves.toEqual([
      { refId: 'shared-waveform-ref', pyramid, status: 'ready' },
    ]);
  });

  it('publishes missing artifacts without retrying duplicate refs in one request', async () => {
    const getCachedPyramid = vi.fn<(refId: string | undefined) => TimelineWaveformPyramid | null>()
      .mockReturnValue(null);
    const loadPyramid = vi.fn<(refId: string | undefined) => Promise<TimelineWaveformPyramid | null>>()
      .mockResolvedValue(null);
    const onResult = vi.fn();

    const results = await warmTimelineWaveformArtifacts([
      'missing-ref',
      'missing-ref',
    ], {
      deps: { getCachedPyramid, loadPyramid },
      onResult,
    });

    expect(results).toEqual([{ refId: 'missing-ref', pyramid: null, status: 'missing' }]);
    expect(loadPyramid).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ refId: 'missing-ref', pyramid: null, status: 'missing' });
  });

  it('publishes a late ready artifact after a reload-timeout miss', async () => {
    vi.useFakeTimers();
    try {
      let resolveLoad: ((value: TimelineWaveformPyramid) => void) | undefined;
      const loadPromise = new Promise<TimelineWaveformPyramid>((resolve) => {
        resolveLoad = resolve;
      });
      const getCachedPyramid = vi.fn<(refId: string | undefined) => TimelineWaveformPyramid | null>()
        .mockReturnValue(null);
      const loadPyramid = vi.fn<(refId: string | undefined) => Promise<TimelineWaveformPyramid | null>>()
        .mockReturnValue(loadPromise);
      const onResult = vi.fn();

      const resultPromise = warmTimelineWaveformArtifacts(['slow-reload-ref'], {
        deps: { getCachedPyramid, loadPyramid },
        onResult,
      });

      await vi.advanceTimersByTimeAsync(4000);

      await expect(resultPromise).resolves.toEqual([
        { refId: 'slow-reload-ref', pyramid: null, status: 'missing' },
      ]);
      expect(onResult).toHaveBeenCalledWith({ refId: 'slow-reload-ref', pyramid: null, status: 'missing' });

      resolveLoad?.(pyramid);
      await vi.advanceTimersByTimeAsync(0);

      expect(onResult).toHaveBeenLastCalledWith({ refId: 'slow-reload-ref', pyramid, status: 'ready' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps stale timed-out loads from clearing newer in-flight retries', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst: ((value: TimelineWaveformPyramid) => void) | undefined;
      let resolveSecond: ((value: TimelineWaveformPyramid) => void) | undefined;
      const firstLoad = new Promise<TimelineWaveformPyramid>((resolve) => {
        resolveFirst = resolve;
      });
      const secondLoad = new Promise<TimelineWaveformPyramid>((resolve) => {
        resolveSecond = resolve;
      });
      const getCachedPyramid = vi.fn<(refId: string | undefined) => TimelineWaveformPyramid | null>()
        .mockReturnValue(null);
      const loadPyramid = vi.fn<(refId: string | undefined) => Promise<TimelineWaveformPyramid | null>>()
        .mockReturnValueOnce(firstLoad)
        .mockReturnValueOnce(secondLoad);

      const firstResult = warmTimelineWaveformArtifacts(['retry-ref'], {
        deps: { getCachedPyramid, loadPyramid },
      });

      await vi.advanceTimersByTimeAsync(4000);
      await expect(firstResult).resolves.toEqual([
        { refId: 'retry-ref', pyramid: null, status: 'missing' },
      ]);

      const secondResult = warmTimelineWaveformArtifacts(['retry-ref'], {
        deps: { getCachedPyramid, loadPyramid },
      });
      expect(loadPyramid).toHaveBeenCalledTimes(2);

      resolveFirst?.(pyramid);
      await vi.advanceTimersByTimeAsync(0);

      const thirdResult = warmTimelineWaveformArtifacts(['retry-ref'], {
        deps: { getCachedPyramid, loadPyramid },
      });
      expect(loadPyramid).toHaveBeenCalledTimes(2);

      resolveSecond?.(pyramid);
      await expect(secondResult).resolves.toEqual([
        { refId: 'retry-ref', pyramid, status: 'ready' },
      ]);
      await expect(thirdResult).resolves.toEqual([
        { refId: 'retry-ref', pyramid, status: 'ready' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
