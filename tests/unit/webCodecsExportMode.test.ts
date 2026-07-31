import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WebCodecsExportMode,
  type ExportModePlayer,
} from '../../src/engine/WebCodecsExportMode';
import type { Sample } from '../../src/engine/webCodecsTypes';

class MockEncodedVideoChunk {
  readonly timestamp: number;

  constructor(init: EncodedVideoChunkInit) {
    this.timestamp = init.timestamp;
  }
}

interface MutableDecoder {
  configure: ReturnType<typeof vi.fn>;
  decode: ReturnType<typeof vi.fn>;
  decodeQueueSize: number;
  flush: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  state: CodecState;
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

function createDecoder(onOutput: (timestamp: number) => void): MutableDecoder {
  const decoder: MutableDecoder = {
    state: 'configured',
    decodeQueueSize: 0,
    configure: vi.fn(() => {
      decoder.state = 'configured';
    }),
    decode: vi.fn((chunk: MockEncodedVideoChunk) => {
      onOutput(chunk.timestamp);
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(() => {
      decoder.decodeQueueSize = 0;
    }),
  };
  return decoder;
}

describe('WebCodecsExportMode decoder recovery', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).EncodedVideoChunk = MockEncodedVideoChunk;
  });

  it('recreates a decoder that closes while warming the next export window', async () => {
    const samples = createSamples(300);
    let currentFrame: VideoFrame | null = null;
    let currentDecoder: MutableDecoder;
    const emitFrame = (timestamp: number) => {
      mode.handleDecoderOutput({
        timestamp,
        close: vi.fn(),
      } as unknown as VideoFrame);
    };
    currentDecoder = createDecoder(emitFrame);
    const recreateExportDecoder = vi.fn(() => {
      currentDecoder = createDecoder(emitFrame);
      return currentDecoder as unknown as VideoDecoder;
    });
    const player: ExportModePlayer = {
      getDecoder: () => currentDecoder as unknown as VideoDecoder,
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
      recreateExportDecoder,
    };
    const mode = new WebCodecsExportMode(player);

    await mode.prepareForSequentialExport(0);

    const decoderThatWillClose = currentDecoder;
    decoderThatWillClose.decode = vi.fn(() => {
      decoderThatWillClose.state = 'closed';
      throw new DOMException("Cannot call 'decode' on a closed codec.", 'InvalidStateError');
    });

    await expect(mode.seekDuringExport(5)).resolves.toBeUndefined();

    expect(recreateExportDecoder).toHaveBeenCalledOnce();
    expect(currentFrame?.timestamp).toBeCloseTo(5_000_000, -3);
  });

  it('keeps the initial decoded export window small', async () => {
    const samples = createSamples(300);
    let currentFrame: VideoFrame | null = null;
    const decoder = createDecoder(timestamp => {
      mode.handleDecoderOutput({
        timestamp,
        close: vi.fn(),
      } as unknown as VideoFrame);
    });
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 30,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: frame => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);

    await mode.prepareForSequentialExport(0);

    const bufferedFrames = (
      mode as unknown as { exportFrameBuffer: Map<number, VideoFrame> }
    ).exportFrameBuffer.size;
    expect(bufferedFrames).toBeLessThanOrEqual(8);
    expect(decoder.configure).toHaveBeenLastCalledWith(expect.objectContaining({
      hardwareAcceleration: 'prefer-hardware',
    }));
  });

  it('extends the startup window when reordered frames are initially withheld', async () => {
    const samples = createSamples(300);
    let currentFrame: VideoFrame | null = null;
    const pendingTimestamps: number[] = [];
    const decoder = createDecoder(timestamp => {
      pendingTimestamps.push(timestamp);
      if (pendingTimestamps.length < 6) {
        return;
      }
      for (const pendingTimestamp of pendingTimestamps.splice(0)) {
        mode.handleDecoderOutput({
          timestamp: pendingTimestamp,
          close: vi.fn(),
        } as unknown as VideoFrame);
      }
    });
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 30,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: frame => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);

    await expect(mode.prepareForSequentialExport(0)).resolves.toBeUndefined();

    expect(decoder.decode.mock.calls.length).toBeGreaterThan(4);
    expect(currentFrame?.timestamp).toBe(0);
  });

  it('restarts at a nearby keyframe and discards distant preroll on a large forward jump', async () => {
    const samples = createSamples(900, 300);
    let currentFrame: VideoFrame | null = null;
    const emittedFrames: VideoFrame[] = [];
    const decoder = createDecoder(timestamp => {
      const frame = {
        timestamp,
        close: vi.fn(),
      } as unknown as VideoFrame;
      emittedFrames.push(frame);
      mode.handleDecoderOutput(frame);
    });
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 30,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: frame => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);

    await mode.prepareForSequentialExport(0);
    decoder.decode.mockClear();
    decoder.reset.mockClear();
    emittedFrames.length = 0;

    await mode.seekDuringExport(15);

    const bufferedFrames = (
      mode as unknown as { exportFrameBuffer: Map<number, VideoFrame> }
    ).exportFrameBuffer.size;
    expect(decoder.reset).toHaveBeenCalledOnce();
    expect(decoder.decode).toHaveBeenCalledTimes(154);
    expect(bufferedFrames).toBeLessThanOrEqual(7);
    expect(emittedFrames.filter(frame => {
      const close = frame.close as ReturnType<typeof vi.fn>;
      return close.mock.calls.length > 0;
    }).length).toBeGreaterThan(140);
    expect(currentFrame?.timestamp).toBeCloseTo(15_000_000, -3);
  });

  it('uses the selected sample CTS when a VFR gap exceeds the frame tolerance', async () => {
    const samples: Sample[] = [
      {
        number: 0,
        track_id: 1,
        data: new Uint8Array([0]).buffer,
        size: 1,
        cts: 0,
        dts: 0,
        duration: 33_333,
        is_sync: true,
        timescale: 1_000_000,
      },
      {
        number: 1,
        track_id: 1,
        data: new Uint8Array([1]).buffer,
        size: 1,
        cts: 53_041_666,
        dts: 53_041_666,
        duration: 33_333,
        is_sync: true,
        timescale: 1_000_000,
      },
    ];
    let currentFrame: VideoFrame | null = null;
    let emitDecodedFrames = true;
    const decoder = createDecoder(timestamp => {
      if (!emitDecodedFrames) {
        return;
      }
      mode.handleDecoderOutput({
        timestamp,
        close: vi.fn(),
      } as unknown as VideoFrame);
    });
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 1_000_000,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: frame => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);

    await mode.prepareForSequentialExport(52.87233);
    decoder.reset.mockClear();
    emitDecodedFrames = false;

    await expect(mode.seekDuringExport(52.87233)).resolves.toBeUndefined();

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(currentFrame?.timestamp).toBe(53_041_666);
  });

  it('extends keyframe recovery when the target frame is still reordered', async () => {
    const samples = createSamples(40, 5);
    const targetSampleIndex = 5;
    const targetCts = (targetSampleIndex * 1_000_000) / 30;
    const initiallyBufferedCts = targetCts + 166_666;
    let currentFrame: VideoFrame | null = null;
    let decodeCount = 0;
    const decoder = createDecoder(() => {
      decodeCount += 1;
      if (decodeCount === 6) {
        mode.handleDecoderOutput({
          timestamp: targetCts,
          close: vi.fn(),
        } as unknown as VideoFrame);
      }
    });
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 30,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: frame => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);
    const initiallyBufferedFrame = {
      timestamp: initiallyBufferedCts,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const internals = mode as unknown as {
      isActive: boolean;
      presentationOffsetUs: number;
      exportFrameBuffer: Map<number, VideoFrame>;
      exportFramesCts: number[];
      decodeCursorIndex: number;
    };
    internals.isActive = true;
    internals.presentationOffsetUs = 0;
    internals.exportFrameBuffer.set(initiallyBufferedCts, initiallyBufferedFrame);
    internals.exportFramesCts = [initiallyBufferedCts];
    internals.decodeCursorIndex = targetSampleIndex;

    await expect(mode.seekDuringExport(targetSampleIndex / 30)).resolves.toBeUndefined();

    expect(decoder.decode).toHaveBeenCalledTimes(8);
    expect(currentFrame?.timestamp).toBeCloseTo(targetCts, -3);
  });
});
