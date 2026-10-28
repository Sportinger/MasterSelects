import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParallelDecodeFrameLookupOptions } from '../../src/engine/parallelDecode/frameLookup';

/**
 * The first presented sample never comes out of the decoder (leading open-GOP
 * B-frame or corrupt first frame): only a neighbour within the FAST export window
 * is buffered. The per-frame export accepts and counts that neighbour, so the
 * export-start verification must not fail on it.
 */
const lookups: ParallelDecodeFrameLookupOptions[] = [];
const cleanup = vi.fn();

vi.mock('../../src/engine/ParallelDecodeManager', () => ({
  ParallelDecodeManager: class {
    initialize = vi.fn(async () => {});
    prefetchFramesForTime = vi.fn(async () => {});
    cleanup = cleanup;
    getFrameForClip(_clipId: string, _time: number, options: ParallelDecodeFrameLookupOptions = {}) {
      lookups.push(options);
      return options.allowNeighbourFallback ? ({ id: 'neighbour' } as unknown as VideoFrame) : null;
    }
  },
}));
vi.mock('../../src/engine/export/clipPreparation/sourceResolution', () => ({
  loadClipFileData: vi.fn(async () => new ArrayBuffer(8)),
}));

const { initializeParallelDecoding } = await import('../../src/engine/export/clipPreparation/parallelMode');

describe('FAST export first-frame verification', () => {
  beforeEach(() => { lookups.length = 0; cleanup.mockClear(); });

  it('accepts the neighbour the per-frame export would use, without reporting it twice', async () => {
    vi.useFakeTimers();
    try {
      const clip = { id: 'clip', name: 'Phone clip', startTime: 0, duration: 4, inPoint: 0, outPoint: 4, source: { type: 'video' } };
      const pending = initializeParallelDecoding(
        [clip as never], [], 0, 4, [], new Map(), 30, undefined, () => {}, new Map() as never,
      );
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.useParallelDecode).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(cleanup).not.toHaveBeenCalled();
    expect(lookups[0]).toEqual({ toleranceMultiplier: 3, allowNeighbourFallback: true, probeOnly: true });
  });
});

describe('probe-only buffered-frame lookup', () => {
  it('returns the neighbour without reporting a fallback; the render lookup reports it', async () => {
    const { getBufferedFrameForClipSourceTime } = await import('../../src/engine/parallelDecode/frameAccess');
    const samples = Array.from({ length: 10 }, (_, index) => ({ cts: index * 512, timescale: 15_360, is_sync: index === 0 }));
    const timestamp = Math.round(1e6 / 30);
    const decoder = {
      clipId: 'clip', clipName: 'Clip', samples, presentationOffsetSeconds: 0,
      frameBuffer: new Map([[timestamp, { timestamp, sourceTime: timestamp / 1e6, frame: { id: 1 } }]]),
      sortedTimestamps: [timestamp], oldestTimestamp: timestamp, newestTimestamp: timestamp,
    } as never;
    const onFallback = vi.fn();
    const options = { toleranceMultiplier: 3, allowNeighbourFallback: true };
    expect(getBufferedFrameForClipSourceTime(decoder, 0, 50_000, { ...options, probeOnly: true }, onFallback)).toEqual({ id: 1 });
    expect(onFallback).not.toHaveBeenCalled();
    expect(getBufferedFrameForClipSourceTime(decoder, 0, 50_000, options, onFallback)).toEqual({ id: 1 });
    expect(onFallback).toHaveBeenCalledOnce();
  });
});
