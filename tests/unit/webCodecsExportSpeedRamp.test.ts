import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WebCodecsExportMode,
  type ExportModePlayer,
} from '../../src/engine/WebCodecsExportMode';
import { ExportSourceStride } from '../../src/engine/webCodecsExport/exportSourceStride';
import type { Sample } from '../../src/engine/webCodecsTypes';

class MockEncodedVideoChunk {
  readonly timestamp: number;

  constructor(init: EncodedVideoChunkInit) {
    this.timestamp = init.timestamp;
  }
}

function createSamples(count: number, keyframeInterval = 250): Sample[] {
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

const FRAME_US = 1_000_000 / 30;

describe('ExportSourceStride', () => {
  it('detects a sustained sped-up stride and plans the next window', () => {
    const stride = new ExportSourceStride();
    for (let frame = 0; frame < 4; frame++) {
      stride.observe(100 + frame * 7, (100 + frame * 7) * FRAME_US);
    }

    expect(stride.isStrided).toBe(true);
    const plan = stride.plan(121, 121 * FRAME_US, 122, 1000);
    expect(plan).not.toBeNull();
    expect(plan!.endIndexExclusive).toBe(121 + 7 + 4);
    expect(plan!.nextTargetCtsUs).toBeCloseTo(128 * FRAME_US);
  });

  it('keeps frames near predicted requests and remembers the ones it closed', () => {
    const stride = new ExportSourceStride();
    for (let frame = 0; frame < 4; frame++) {
      stride.observe(100 + frame * 7, (100 + frame * 7) * FRAME_US);
    }

    expect(stride.shouldRetain(128 * FRAME_US, FRAME_US)).toBe(true);
    expect(stride.shouldRetain(135 * FRAME_US, FRAME_US)).toBe(true);
    expect(stride.shouldRetain(124 * FRAME_US, FRAME_US)).toBe(false);
    stride.noteDiscarded(124 * FRAME_US);
    expect(stride.wasDiscarded(124 * FRAME_US)).toBe(true);
    expect(stride.wasDiscarded(125 * FRAME_US)).toBe(false);
  });

  it('stays strided when a variable-frame-rate source jitters the sample stride', () => {
    const stride = new ExportSourceStride();
    const indices = [2108, 2114, 2120, 2129, 2131, 2138];
    indices.forEach((index, frame) => stride.observe(index, (2108 * FRAME_US) + frame * 7 * FRAME_US));
    expect(stride.isStrided).toBe(true);
  });

  it('does not treat a single cut as a speed ramp', () => {
    const stride = new ExportSourceStride();
    stride.observe(10, 10 * FRAME_US);
    stride.observe(11, 11 * FRAME_US);
    stride.observe(40, 40 * FRAME_US);
    expect(stride.isStrided).toBe(false);
    stride.observe(41, 41 * FRAME_US);
    expect(stride.isStrided).toBe(false);
    expect(stride.plan(41, 41 * FRAME_US, 42, 1000)).toBeNull();
  });
});

describe('WebCodecsExportMode speed ramps', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).EncodedVideoChunk = MockEncodedVideoChunk;
  });

  it('keeps feeding a hardware decoder that holds samples until more input arrives', async () => {
    const samples = createSamples(1200);
    let currentFrame: VideoFrame | null = null;
    // Models a reordering hardware decoder: it keeps three samples queued and
    // only emits the oldest once another sample is submitted.
    const held: number[] = [];
    const decoder = {
      state: 'configured' as CodecState,
      decodeQueueSize: 0,
      configure: vi.fn(),
      reset: vi.fn(() => {
        held.length = 0;
        decoder.decodeQueueSize = 0;
      }),
      flush: vi.fn(async () => {
        while (held.length > 0) emit(held.shift()!);
        decoder.decodeQueueSize = 0;
      }),
      decode: vi.fn((chunk: MockEncodedVideoChunk) => {
        held.push(chunk.timestamp);
        if (held.length > 3) emit(held.shift()!);
        decoder.decodeQueueSize = held.length;
      }),
    };
    const emit = (timestamp: number) => {
      mode.handleDecoderOutput({ timestamp, close: vi.fn() } as unknown as VideoFrame);
    };
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 30,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: (frame) => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);

    await mode.prepareForSequentialExport(10);
    const started = performance.now();
    // Ramp from 1x to 7x source samples per output frame.
    let sampleIndex = 300;
    for (const step of [1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7]) {
      sampleIndex += step;
      await mode.seekDuringExport(sampleIndex / 30);
      expect(currentFrame?.timestamp).toBeCloseTo(sampleIndex * FRAME_US, -1);
    }

    // A stalled backpressure loop costs ~2s per seek; progress detection must
    // resume submission within a few milliseconds instead.
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
