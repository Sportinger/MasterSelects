import { expect, it, vi } from 'vitest';
import { prefetchFramesForTime, type ParallelDecodePrefetchDeps } from '../../src/engine/parallelDecode/prefetchCoordinator';
import type { ClipDecoder } from '../../src/engine/parallelDecode/clipDecoderState';

it('decodes a speed-mapped source once at the requested source time', async () => {
  const sourceTime = 7;
  const clipDecoder = {
    clipId: 'speed-ramp',
    clipName: 'Speed ramp',
    clipInfo: {
      clipId: 'speed-ramp', clipName: 'Speed ramp', startTime: 0, duration: 20,
      inPoint: 0, outPoint: 20, speed: 1, reversed: false,
    },
    samples: Array.from({ length: 100 }, (_, index) => ({ cts: index, timescale: 1 })),
    presentationOffsetSeconds: 0,
    sampleIndex: 0,
    frameBuffer: new Map(),
    sortedTimestamps: [] as number[],
    oldestTimestamp: Infinity,
    newestTimestamp: -Infinity,
    isDecoding: false,
    pendingDecode: null,
    decoder: null,
  } as unknown as ClipDecoder;
  const decodeAhead: ParallelDecodePrefetchDeps['decodeAhead'] = vi.fn(async () => {
    const timestamp = sourceTime * 1_000_000;
    clipDecoder.frameBuffer.set(timestamp, { timestamp, frame: { close: vi.fn() } } as never);
    clipDecoder.sortedTimestamps.push(timestamp);
    clipDecoder.oldestTimestamp = timestamp;
    clipDecoder.newestTimestamp = timestamp;
  });
  const deps: ParallelDecodePrefetchDeps = {
    isActive: () => true,
    clipDecoders: new Map([[clipDecoder.clipId, clipDecoder]]),
    frameToleranceUs: 50_000,
    ensureDecoder: async () => { throw new Error('unexpected decoder flush'); },
    decodeAhead,
  };

  await prefetchFramesForTime(deps, 4, new Map([[clipDecoder.clipId, sourceTime]]));

  expect(decodeAhead).toHaveBeenCalledOnce();
  expect(decodeAhead).toHaveBeenCalledWith(clipDecoder, 67, false, 0, 7);
});
