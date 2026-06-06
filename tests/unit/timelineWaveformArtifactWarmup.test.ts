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
});
