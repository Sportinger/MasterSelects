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
    expect(bufferedFrames).toBeLessThanOrEqual(36);
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
    expect(decoder.decode).toHaveBeenCalledTimes(151);
    expect(bufferedFrames).toBeLessThanOrEqual(7);
    expect(emittedFrames.filter(frame => {
      const close = frame.close as ReturnType<typeof vi.fn>;
      return close.mock.calls.length > 0;
    }).length).toBeGreaterThan(140);
    expect(currentFrame?.timestamp).toBeCloseTo(15_000_000, -3);
  });
});
