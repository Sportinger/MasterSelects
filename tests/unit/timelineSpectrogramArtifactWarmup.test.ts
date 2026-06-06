import { describe, expect, it, vi } from 'vitest';
import {
  collectTimelineSpectrogramArtifactRefs,
  getCachedTimelineSpectrogramArtifact,
  warmTimelineSpectrogramArtifacts,
} from '../../src/services/timeline/timelineSpectrogramArtifactWarmup';
import type { TimelineSpectrogramTileSet } from '../../src/services/audio/timelineSpectrogramCache';

const tileSet: TimelineSpectrogramTileSet = {
  sampleRate: 48000,
  duration: 1,
  fftSize: 1024,
  hopSize: 256,
  minDb: -80,
  maxDb: 0,
  frameCount: 0,
  frequencyBinCount: 0,
  channels: [],
};

describe('timeline spectrogram artifact warmup', () => {
  it('collects unique preferred spectrogram artifact refs from visible clips', () => {
    const refs = collectTimelineSpectrogramArtifactRefs([
      {
        audioState: {
          sourceAnalysisRefs: { spectrogramTileSetIds: ['source-ref'] },
        },
      },
      {
        audioState: {
          processedAnalysisRefs: { spectrogramTileSetIds: ['processed-ref'] },
          sourceAnalysisRefs: { spectrogramTileSetIds: ['source-ref'] },
        },
      },
      {
        audioState: {
          processedAnalysisRefs: { spectrogramTileSetIds: ['processed-source-ref'] },
        },
      },
      {
        audioState: {
          sourceAnalysisRefs: { spectrogramTileSetIds: ['source-ref'] },
        },
      },
    ]);

    expect(refs).toEqual(['processed-ref', 'processed-source-ref', 'source-ref']);
  });

  it('returns cached artifacts without loading from persistent storage', async () => {
    const getCachedTileSet = vi.fn<(refId: string | undefined) => TimelineSpectrogramTileSet | null>()
      .mockReturnValue(tileSet);
    const loadTileSet = vi.fn<(refId: string | undefined) => Promise<TimelineSpectrogramTileSet | null>>();

    expect(getCachedTimelineSpectrogramArtifact('spectrogram-ref', {
      getCachedTileSet,
      loadTileSet,
    })).toBe(tileSet);

    const results = await warmTimelineSpectrogramArtifacts(['spectrogram-ref'], {
      deps: { getCachedTileSet, loadTileSet },
    });

    expect(results).toEqual([{ refId: 'spectrogram-ref', tileSet, status: 'ready' }]);
    expect(loadTileSet).not.toHaveBeenCalled();
  });

  it('coalesces overlapping artifact loads by spectrogram ref id', async () => {
    let resolveLoad: ((value: TimelineSpectrogramTileSet) => void) | undefined;
    const loadPromise = new Promise<TimelineSpectrogramTileSet>((resolve) => {
      resolveLoad = resolve;
    });
    const getCachedTileSet = vi.fn<(refId: string | undefined) => TimelineSpectrogramTileSet | null>()
      .mockReturnValue(null);
    const loadTileSet = vi.fn<(refId: string | undefined) => Promise<TimelineSpectrogramTileSet | null>>()
      .mockReturnValue(loadPromise);

    const first = warmTimelineSpectrogramArtifacts(['shared-spectrogram-ref'], {
      deps: { getCachedTileSet, loadTileSet },
    });
    const second = warmTimelineSpectrogramArtifacts(['shared-spectrogram-ref'], {
      deps: { getCachedTileSet, loadTileSet },
    });

    expect(loadTileSet).toHaveBeenCalledTimes(1);
    resolveLoad?.(tileSet);

    await expect(first).resolves.toEqual([
      { refId: 'shared-spectrogram-ref', tileSet, status: 'ready' },
    ]);
    await expect(second).resolves.toEqual([
      { refId: 'shared-spectrogram-ref', tileSet, status: 'ready' },
    ]);
  });

  it('publishes missing artifacts without retrying duplicate refs in one request', async () => {
    const getCachedTileSet = vi.fn<(refId: string | undefined) => TimelineSpectrogramTileSet | null>()
      .mockReturnValue(null);
    const loadTileSet = vi.fn<(refId: string | undefined) => Promise<TimelineSpectrogramTileSet | null>>()
      .mockResolvedValue(null);
    const onResult = vi.fn();

    const results = await warmTimelineSpectrogramArtifacts([
      'missing-ref',
      'missing-ref',
    ], {
      deps: { getCachedTileSet, loadTileSet },
      onResult,
    });

    expect(results).toEqual([{ refId: 'missing-ref', tileSet: null, status: 'missing' }]);
    expect(loadTileSet).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ refId: 'missing-ref', tileSet: null, status: 'missing' });
  });
});
