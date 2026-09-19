import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  close: vi.fn(async () => undefined),
  decode: vi.fn(async (_packet: Uint8Array, frame: Record<string, unknown>) => Object.assign(frame, {
    frameData: new Uint8Array(24),
    codedWidth: 4,
    codedHeight: 4,
    visibleWidth: 4,
    visibleHeight: 4,
    pixelFormat: 'I420',
    originalPixelFormat: 'I422P10',
    pixelAspectRatio: { num: 1, den: 1 },
    colorPrimariesString: 'bt709',
    colorTransferString: 'bt709',
    colorMatrixString: 'bt709',
    colorRangeFull: false,
    scanType: 'progressive',
  })),
  decoderCreate: vi.fn(),
  videoFrameClose: vi.fn(),
}));

vi.mock('turbores', () => {
  class Frame {
    isLocked = false;
    clear = mocks.clear;
  }
  class Decoder {
    static canUseSharedMemory = () => true;
    static create = mocks.decoderCreate;
  }
  return { Decoder, Frame };
});

import { probeTurboResPacketToVideoFrame } from '../../src/services/mediaRuntime/prores/turboResConformanceProbe';

describe('TurboRes conformance probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('constructs and closes a VideoFrame and releases TurboRes resources', async () => {
    mocks.decoderCreate.mockResolvedValue({
      decode: mocks.decode,
      close: mocks.close,
    });
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(
        public data: BufferSource,
        public init: VideoFrameBufferInit,
      ) {}
      close = mocks.videoFrameClose;
    });

    const result = await probeTurboResPacketToVideoFrame({
      fourCC: 'apch',
      packetData: new Uint8Array([1, 2, 3]),
      timestampMicroseconds: 1_000_000,
      durationMicroseconds: 41_708,
      concurrency: 2,
    });

    expect(result).toMatchObject({
      supported: true,
      fourCC: 'apch',
      useSharedMemory: true,
      concurrency: 2,
      pixelFormat: 'I420',
      originalPixelFormat: 'I422P10',
      scanType: 'progressive',
    });
    expect(mocks.decoderCreate).toHaveBeenCalledWith(expect.objectContaining({
      proresFourCc: 'apch',
      useSharedMemory: true,
      concurrency: 2,
      allowedOutputFormats: ['I420'],
    }));
    expect(mocks.videoFrameClose).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
