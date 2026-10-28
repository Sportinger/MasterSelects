import { describe, expect, it, vi } from 'vitest';
import {
  hasExpectedBufferedFrame,
  isExpectedFrameInFlight,
  storeDecodedFrame,
  type ClipDecoder,
} from '../../src/engine/parallelDecode/clipDecoderState';
import { isConstantMappingBackward } from '../../src/engine/parallelDecode/clipWindow';
import {
  IN_FLIGHT_STALL_MS,
  prefetchFramesForTime,
  type ParallelDecodePrefetchDeps,
} from '../../src/engine/parallelDecode/prefetchCoordinator';
import { getNormalizedSampleTimestampMicroseconds } from '../../src/engine/parallelDecode/sampleTiming';
import { ParallelDecodeManager } from '../../src/engine/ParallelDecodeManager';

const FPS = 30;
/** 4 s at 30 fps, timescale 15360, presentation order, keyframe every 30 frames. */
const samples = Array.from({ length: 120 }, (_, index) => ({ cts: index * 512, timescale: 15_360, is_sync: index % 30 === 0 }));
const frameUs = (index: number) => getNormalizedSampleTimestampMicroseconds(samples[index], 0);

interface FakeDecoder { state: string; decodeQueueSize: number; flush: ReturnType<typeof vi.fn> }

function clipDecoder(buffered: number[], overrides: Partial<ClipDecoder> = {}): ClipDecoder {
  const decoder = {
    clipId: 'clip', clipName: 'Clip',
    clipInfo: { clipId: 'clip', clipName: 'Clip', startTime: 0, duration: 4, inPoint: 0, outPoint: 4, speed: 1, reversed: false },
    samples, presentationOffsetSeconds: 0, sampleIndex: 0,
    frameBuffer: new Map(), sortedTimestamps: [] as number[],
    oldestTimestamp: Infinity, newestTimestamp: -Infinity, lastDecodedTimestamp: 0,
    isDecoding: false, pendingDecode: null, decoder: null, needsKeyframe: false,
    ...overrides,
  } as unknown as ClipDecoder;
  for (const index of buffered) output(decoder, index);
  return decoder;
}

function output(decoder: ClipDecoder, index: number): void {
  const timestamp = frameUs(index);
  storeDecodedFrame(decoder, { timestamp, close: vi.fn() } as unknown as VideoFrame, timestamp, timestamp / 1e6);
}

function fakeDecoder(decodeQueueSize: number): FakeDecoder {
  return { state: 'configured', decodeQueueSize, flush: vi.fn(async () => {}) };
}

function deps(decoder: ClipDecoder, decodeAhead: ParallelDecodePrefetchDeps['decodeAhead']): ParallelDecodePrefetchDeps {
  return {
    isActive: () => true,
    clipDecoders: new Map([['clip', decoder]]),
    frameToleranceUs: 50_000,
    ensureDecoder: async () => decoder.decoder as VideoDecoder,
    decodeAhead,
  };
}

describe('FAST prefetch with the target still in the decoder (decode-bound export)', () => {
  it('detects a target that was submitted but not output yet, and nothing else', () => {
    const live = fakeDecoder(40) as unknown as VideoDecoder;
    // Submitted up to sample 99, output up to frame 59: frame 60 is in flight.
    expect(isExpectedFrameInFlight(clipDecoder([57, 58, 59], { sampleIndex: 100, decoder: live }), 60 / FPS, 60)).toBe(true);
    // Not submitted yet.
    expect(isExpectedFrameInFlight(clipDecoder([57, 58, 59], { sampleIndex: 60, decoder: live }), 60 / FPS, 60)).toBe(false);
    // Output already passed it (presentation order): pruned or dropped, really missing.
    expect(isExpectedFrameInFlight(clipDecoder([70], { sampleIndex: 100, decoder: live }), 60 / FPS, 60)).toBe(false);
    // After a flush/reset the decoder holds nothing.
    expect(isExpectedFrameInFlight(clipDecoder([59], { sampleIndex: 100, decoder: live, needsKeyframe: true }), 60 / FPS, 60)).toBe(false);
    // Dormant decoder (pool-recycled).
    expect(isExpectedFrameInFlight(clipDecoder([59], { sampleIndex: 100 }), 60 / FPS, 60)).toBe(false);
  });

  it('waits for the queued target instead of seeking (reset) or flushing', async () => {
    const live = fakeDecoder(40);
    const decoder = clipDecoder([57, 58, 59], { sampleIndex: 100, decoder: live as unknown as VideoDecoder });
    const decodeAhead = vi.fn(async () => {});
    // The decoder delivers frame 60 a little later, as a busy software decoder does.
    setTimeout(() => { live.decodeQueueSize = 30; output(decoder, 60); }, 40);

    await prefetchFramesForTime(deps(decoder, decodeAhead), 60 / FPS);

    expect(hasExpectedBufferedFrame(decoder, 60 / FPS)).toBe(true);
    // No forced (seeking) decode and no flush while the frame was on its way.
    expect(decodeAhead.mock.calls.filter(call => call[2] === true)).toEqual([]);
    expect(live.flush).not.toHaveBeenCalled();
  });

  it('escalates to a flush once the queued target stops making progress', async () => {
    const live = fakeDecoder(40);
    const decoder = clipDecoder([57, 58, 59], { sampleIndex: 100, decoder: live as unknown as VideoDecoder });
    live.flush.mockImplementation(async () => { live.decodeQueueSize = 0; output(decoder, 60); });
    const started = performance.now();

    await prefetchFramesForTime(deps(decoder, vi.fn(async () => {})), 60 / FPS);

    expect(performance.now() - started).toBeGreaterThanOrEqual(IN_FLIGHT_STALL_MS - 20);
    expect(live.flush).toHaveBeenCalledOnce();
    expect(hasExpectedBufferedFrame(decoder, 60 / FPS)).toBe(true);
  });

  it('still seeks when the target is really missing behind the output edge', async () => {
    const live = fakeDecoder(0);
    const decoder = clipDecoder([70], { sampleIndex: 100, decoder: live as unknown as VideoDecoder });
    const decodeAhead = vi.fn(async () => { output(decoder, 60); });

    await prefetchFramesForTime(deps(decoder, decodeAhead), 60 / FPS);

    expect(decodeAhead).toHaveBeenCalledWith(decoder, 120, true, 0, 60);
  });
});

describe('reversed clip first advance', () => {
  function managerWith(decoder: ClipDecoder): ParallelDecodeManager {
    const manager = new ParallelDecodeManager();
    (manager as unknown as { clipDecoders: Map<string, ClipDecoder> }).clipDecoders.set('clip', decoder);
    return manager;
  }

  it('seeds the source direction from a constant mapping', () => {
    const base = { startTime: 0, duration: 4, inPoint: 0, outPoint: 4 };
    expect(isConstantMappingBackward({ ...base, reversed: true, speed: 1 })).toBe(true);
    expect(isConstantMappingBackward({ ...base, reversed: false, speed: -1 })).toBe(true);
    expect(isConstantMappingBackward({ ...base, reversed: true, speed: -1 })).toBeUndefined();
    expect(isConstantMappingBackward({ ...base, reversed: false, speed: 1 })).toBeUndefined();
    expect(isConstantMappingBackward({ ...base, reversed: true, speed: 1, timeRemap: { kind: 'loop' } as never })).toBeUndefined();
  });

  it('does not prune the frames below the first target while the direction is unknown', () => {
    const decoder = clipDecoder(Array.from({ length: 91 }, (_, index) => index));
    managerWith(decoder).advanceToTime(1, new Map([['clip', 3]]));
    // Frames from the keyframe up to 3 s are what a backward walk needs next.
    expect(decoder.frameBuffer.size).toBe(91);
    expect(hasExpectedBufferedFrame(decoder, 0)).toBe(true);
  });

  it('prunes only the side a seeded reversed clip has passed', () => {
    const decoder = clipDecoder(Array.from({ length: 120 }, (_, index) => index), { advancingBackward: true });
    managerWith(decoder).advanceToTime(1, new Map([['clip', 3]]));
    expect(hasExpectedBufferedFrame(decoder, 0)).toBe(true);
    expect(hasExpectedBufferedFrame(decoder, 3)).toBe(true);
    expect(hasExpectedBufferedFrame(decoder, 3.3)).toBe(false);
  });

  it('learns the forward direction on the second advance and prunes the passed frames', () => {
    const decoder = clipDecoder(Array.from({ length: 91 }, (_, index) => index));
    const manager = managerWith(decoder);
    manager.advanceToTime(1, new Map([['clip', 2.9]]));
    manager.advanceToTime(1.1, new Map([['clip', 3]]));
    expect(decoder.advancingBackward).toBe(false);
    expect(hasExpectedBufferedFrame(decoder, 0)).toBe(false);
    expect(hasExpectedBufferedFrame(decoder, 3)).toBe(true);
  });
});
