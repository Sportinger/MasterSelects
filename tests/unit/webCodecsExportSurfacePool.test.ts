import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebCodecsExportMode, type ExportModePlayer } from '../../src/engine/WebCodecsExportMode';
import type { Sample } from '../../src/engine/webCodecsTypes';
import { missingFrameRestartReason } from '../../src/engine/webCodecsExport/exportSamplePlanning';
import { ExportSurfaceBudget } from '../../src/engine/webCodecsExport/exportSurfaceBudget';
import { exportDiagnostics } from '../../src/services/export/exportDiagnostics';

class MockEncodedVideoChunk {
  readonly timestamp: number;
  constructor(init: EncodedVideoChunkInit) {
    // Chrome stores chunk and frame timestamps as whole microseconds; 1/30 s is 33333.33 us.
    this.timestamp = Math.trunc(init.timestamp);
  }
}

function createSamples(count: number, keyframeInterval = 30): Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    number: index,
    track_id: 1,
    data: new Uint8Array([index % 255]).buffer,
    size: 1,
    cts: index,
    dts: index,
    duration: 1,
    is_sync: index % keyframeInterval === 0,
    timescale: 30,
  }));
}

/**
 * A decoder like Android's MediaCodec behind Chrome's VideoDecoder: it owns `poolSize` output
 * surfaces and decodes the next queued chunk only while one of them is free. A VideoFrame the page
 * still holds keeps its surface; close() returns it.
 */
class SurfacePoolDecoder extends EventTarget {
  state: CodecState = 'configured';
  private queue: number[] = [];
  private open = 0;
  private scheduled = false;
  maxOpen = 0;
  decoded = 0;

  constructor(
    private readonly poolSize: number,
    private readonly onOutput: (frame: VideoFrame) => void,
    private readonly firstOutputDelayMs = 1,
  ) {
    super();
  }

  get decodeQueueSize(): number {
    return this.queue.length;
  }

  configure = vi.fn(() => { this.state = 'configured'; });
  reset = vi.fn(() => { this.queue = []; });
  flush = vi.fn(async () => {
    while (this.queue.length > 0 && this.state !== 'closed') await new Promise(resolve => setTimeout(resolve, 2));
  });
  decode = vi.fn((chunk: MockEncodedVideoChunk) => {
    this.queue.push(chunk.timestamp);
    this.pump();
  });

  private pump(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      if (this.queue.length === 0 || this.open >= this.poolSize || this.state === 'closed') return;
      const timestamp = this.queue.shift()!;
      this.open += 1;
      this.maxOpen = Math.max(this.maxOpen, this.open);
      this.decoded += 1;
      const frame = {
        timestamp,
        closed: false,
        close: () => {
          if (frame.closed) return;
          frame.closed = true;
          this.open -= 1;
          this.pump();
        },
      };
      this.dispatchEvent(new Event('dequeue'));
      this.onOutput(frame as unknown as VideoFrame);
      this.pump();
    }, this.decoded === 0 ? this.firstOutputDelayMs : 1);
  }
}

function createPlayer(samples: Sample[], decoder: () => SurfacePoolDecoder) {
  let currentFrame: VideoFrame | null = null;
  const player: ExportModePlayer = {
    getDecoder: () => decoder() as unknown as VideoDecoder,
    getSamples: () => samples,
    getSampleIndex: () => 0,
    setSampleIndex: vi.fn(),
    getVideoTrackTimescale: () => 30,
    getCodecConfig: () => ({ codec: 'avc1.test' }),
    getFrameRate: () => 30,
    getCurrentFrame: () => currentFrame,
    setCurrentFrame: frame => { currentFrame = frame; },
    isSimpleMode: () => false,
    seekAsync: vi.fn(),
  };
  return { player, current: () => currentFrame };
}

interface DecoderSummary {
  outputWaitTimeouts: number;
  surfaceStalls: number;
  surfaceBudget: number | null;
  restarts: number;
}

/** Exports the given source frames in order; between seeks the shown frame is "rendered" for a moment. */
async function exportFrames(poolSize: number, frameList: readonly number[], sampleCount = 120, firstOutputDelayMs = 1) {
  const samples = createSamples(sampleCount);
  // Outputs only arrive after the first decode call, when `mode` exists.
  const decoder = new SurfacePoolDecoder(poolSize, frame => mode.handleDecoderOutput(frame), firstOutputDelayMs);
  const { player, current } = createPlayer(samples, () => decoder);
  const mode = new WebCodecsExportMode(player);
  const shown: number[] = [];
  const closedWhileShown: number[] = [];

  exportDiagnostics.start({});
  const started = performance.now();
  try {
    await mode.prepareForSequentialExport(0);
    for (const frame of frameList) {
      await mode.seekDuringExport(frame / 30);
      const shownFrame = current() as (VideoFrame & { closed?: boolean }) | null;
      shown.push(Math.round((shownFrame?.timestamp ?? -1e9) * 30 / 1e6));
      // Rendering takes a moment; background decode-ahead must not close the frame meanwhile.
      await new Promise(resolve => setTimeout(resolve, 2));
      if (shownFrame?.closed) closedWhileShown.push(frame);
    }
  } finally {
    mode.endSequentialExport();
    exportDiagnostics.finish('success');
  }
  const decoderStats = (exportDiagnostics.snapshot().last as { decoder: DecoderSummary }).decoder;
  return { elapsedMs: performance.now() - started, shown, closedWhileShown, decoderStats, maxOpen: decoder.maxOpen };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);

function exportSequential(poolSize: number, frames: number, sampleCount = 120, firstOutputDelayMs = 1) {
  return exportFrames(poolSize, range(0, frames), sampleCount, firstOutputDelayMs);
}

describe('FAST export on a decoder with a small output surface pool', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).EncodedVideoChunk = MockEncodedVideoChunk;
  });

  // Before the surface budget, 3 surfaces took 239 s for these 45 frames (seeks up to 14 s) and
  // 4 surfaces did not finish within two minutes: every wait ran into its time limit.
  it.each([2, 3, 4, 5])('learns a %i-surface pool from one stall and keeps every frame exact', async (poolSize) => {
    const run = await exportSequential(poolSize, 45);

    expect(run.shown).toEqual(Array.from({ length: 45 }, (_, frame) => frame));
    expect(run.closedWhileShown).toEqual([]);
    expect(run.maxOpen).toBeLessThanOrEqual(poolSize);
    expect(run.decoderStats.surfaceBudget).toBe(poolSize);
    expect(run.decoderStats.surfaceStalls).toBeLessThanOrEqual(2);
    expect(run.decoderStats.outputWaitTimeouts).toBe(0);
    expect(run.decoderStats.restarts).toBe(0);
    // Generous bound: tens of milliseconds per frame on a slow CI host, never the old seconds.
    expect(run.elapsedMs).toBeLessThan(5_000);
  }, 20_000);

  // The last window flushes the decoder; flush() cannot finish while the export holds every
  // surface, so it waited 4 s plus a 2 s queue drain before the last frames came out.
  it.each([2, 3, 4])('exports through the end of the source with %i surfaces without a flush stall', async (poolSize) => {
    const run = await exportSequential(poolSize, 40, 40);

    expect(run.shown).toEqual(Array.from({ length: 40 }, (_, frame) => frame));
    expect(run.closedWhileShown).toEqual([]);
    expect(run.decoderStats.outputWaitTimeouts).toBe(0);
    expect(run.elapsedMs).toBeLessThan(3_000);
  }, 20_000);

  // A slow first output makes the preparation queue up to 32 samples before the first frame
  // appears, so the pool is full and the decoder holds a long queue from the first seek on.
  it.each([2, 3, 4])('keeps every frame exact with %i surfaces when the first output is slow', async (poolSize) => {
    const run = await exportSequential(poolSize, 45, 120, 80);

    expect(run.shown).toEqual(Array.from({ length: 45 }, (_, frame) => frame));
    expect(run.closedWhileShown).toEqual([]);
    expect(run.decoderStats.outputWaitTimeouts).toBe(0);
  }, 20_000);

  // A cut that jumps over a keyframe restarts the decoder there. With a small budget no frame is
  // kept behind, and the restart discarded outputs before the request: whole-microsecond frame
  // timestamps put the requested frame itself just below it (Pixel 10 Pro, frame 276 of D6).
  it.each([2, 3, 4])('keeps the first frame after a keyframe restart with %i surfaces', async (poolSize) => {
    // Keyframes every 30 samples: the jump from 14 to 75 crosses the one at 60.
    const frames = [...range(0, 15), ...range(75, 90)];
    const run = await exportFrames(poolSize, frames);

    expect(run.shown).toEqual(frames);
    expect(run.closedWhileShown).toEqual([]);
    expect(run.decoderStats.restarts).toBe(1);
    expect(run.decoderStats.outputWaitTimeouts).toBe(0);
  }, 20_000);

  it('leaves a decoder with a large pool alone (no stall, no budget)', async () => {
    const run = await exportSequential(8, 45);

    expect(run.shown).toEqual(Array.from({ length: 45 }, (_, frame) => frame));
    expect(run.decoderStats.surfaceBudget).toBeNull();
    expect(run.decoderStats.surfaceStalls).toBe(0);
  }, 20_000);
});

describe('ExportSurfaceBudget', () => {
  it('keeps the default window until a stall is learnt', () => {
    const budget = new ExportSurfaceBudget();
    expect(budget.keepBehind(1)).toBe(1);
    expect(budget.aheadLimit(4, 1)).toBe(4);
    expect(budget.hasFreeSurface(100)).toBe(true);
  });

  it('fits the shown frame, one frame ahead and (when room is left) one behind into the pool', () => {
    const budget = new ExportSurfaceBudget();
    expect(budget.learn(4)).toBe(true);
    expect([budget.keepBehind(1), budget.aheadLimit(4, 1)]).toEqual([1, 2]);
    expect(budget.learn(2)).toBe(true);
    expect([budget.keepBehind(1), budget.aheadLimit(4, 1)]).toEqual([0, 1]);
    // Never below two: a one-surface stall is still released frame by frame.
    expect(budget.learn(1)).toBe(false);
    expect(budget.value).toBe(2);
    expect(budget.hasFreeSurface(1)).toBe(true);
    expect(budget.hasFreeSurface(2)).toBe(false);
  });

  it('only ever shrinks', () => {
    const budget = new ExportSurfaceBudget();
    budget.learn(3);
    expect(budget.learn(5)).toBe(false);
    expect(budget.value).toBe(3);
    budget.reset();
    expect(budget.value).toBeNull();
  });
});

describe('missingFrameRestartReason', () => {
  const base = {
    decoderClosed: false, targetSampleIndex: 2, targetCtsUs: 66_667, decodeCursorIndex: 12, minBufferedCtsUs: 0,
    bufferedFrames: 0, newestOutputCtsUs: 33_333, keyframeIndex: 0, skippedTarget: false, maxContinuousForwardGap: 16,
  };

  it('keeps decoding when a surface stall emptied the buffer but the target is still queued in the decoder', () => {
    expect(missingFrameRestartReason(base)).toBeNull();
  });

  it('restarts when the decoder already put the target out and it is gone', () => {
    expect(missingFrameRestartReason({ ...base, newestOutputCtsUs: 100_000 })).toBe('backward source jump');
    expect(missingFrameRestartReason({ ...base, bufferedFrames: 2, minBufferedCtsUs: 133_333 })).toBe('backward source jump');
  });

  it('restarts for a closed decoder and for a forward jump over a keyframe', () => {
    expect(missingFrameRestartReason({ ...base, decoderClosed: true })).toBe('decoder closed — recovering');
    expect(missingFrameRestartReason({ ...base, targetSampleIndex: 45, targetCtsUs: 1_500_000, keyframeIndex: 30 }))
      .toBe('forward source jump of 33 samples');
    expect(missingFrameRestartReason({ ...base, targetSampleIndex: 25, targetCtsUs: 833_333, keyframeIndex: 0 })).toBeNull();
  });
});
