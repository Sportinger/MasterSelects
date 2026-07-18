import { describe, expect, it, vi } from 'vitest';
import { CaptureMuxer } from '../recording/captureMuxer';
import { CaptureVideoEncoder } from '../recording/captureVideoEncoder';

describe('CaptureMuxer', () => {
  it('adds packets incrementally and tracks queued bytes under backpressure', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const writer = {
      start: vi.fn(async () => undefined),
      addVideo: vi.fn().mockImplementationOnce(() => blocked).mockResolvedValue(undefined),
      addAudio: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      getBuffer: () => new ArrayBuffer(4),
    };
    const muxer = new CaptureMuxer({ fps: 30, writer, toPacket: (_chunk, sequence) => sequence });
    const first = muxer.addVideoChunk({ timestamp: 0, byteLength: 3 } as EncodedVideoChunk);
    const second = muxer.addVideoChunk({ timestamp: 1, byteLength: 4 } as EncodedVideoChunk);
    await Promise.resolve();
    expect(muxer.getStats()).toMatchObject({ queuedPacketBytes: 7, maxQueuedPacketBytes: 7 });
    release();
    await Promise.all([first, second]);
    expect(writer.addVideo).toHaveBeenCalledTimes(2);
    expect(muxer.getStats().queuedPacketBytes).toBe(0);
  });

  it('uses time-based keyframes and drops frames when the encoder queue is full', async () => {
    const encoded: Array<{ timestamp: number; keyFrame?: boolean }> = [];
    const canAcceptVideoFrame = vi.fn(() => true);
    class FakeEncoder {
      static async isConfigSupported(config: VideoEncoderConfig) { return { supported: true, config }; }
      encodeQueueSize = 0;
      constructor(_init: VideoEncoderInit) {}
      configure() {}
      encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions) { encoded.push({ timestamp: frame.timestamp, keyFrame: options?.keyFrame }); }
      async flush() {}
      close() {}
    }
    const encoder = new CaptureVideoEncoder({
      width: 1280, height: 720, fps: 30, bitrate: 4_000_000,
      muxer: { addVideoChunk: async () => undefined, canAcceptVideoFrame },
      Encoder: FakeEncoder,
      maxEncodeQueueSize: 4,
    });
    await encoder.initialize();
    expect(encoder.encode({ timestamp: 0 } as VideoFrame)).toBe(true);
    expect(encoder.encode({ timestamp: 500_000 } as VideoFrame)).toBe(true);
    expect(encoder.encode({ timestamp: 1_000_000 } as VideoFrame)).toBe(true);
    expect(encoded.map(item => item.keyFrame)).toEqual([true, false, true]);

    (encoder as unknown as { encoder: { encodeQueueSize: number } }).encoder.encodeQueueSize = 4;
    expect(encoder.encode({ timestamp: 1_500_000 } as VideoFrame)).toBe(false);
    expect(encoder.getStats().droppedFrames).toBe(1);
    (encoder as unknown as { encoder: { encodeQueueSize: number } }).encoder.encodeQueueSize = 0;
    canAcceptVideoFrame.mockReturnValue(false);
    expect(encoder.encode({ timestamp: 2_000_000 } as VideoFrame)).toBe(false);
    expect(encoder.getStats().droppedFrames).toBe(2);
  });

  it('signals pressure before encoding and fails cleanly if a packet reaches the hard limit', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const writer = {
      start: vi.fn(async () => undefined),
      addVideo: vi.fn(() => blocked),
      addAudio: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      getBuffer: () => null,
    };
    const muxer = new CaptureMuxer({
      fps: 30,
      writer,
      maxQueuedPacketBytes: 8,
      toPacket: (_chunk, sequence) => sequence,
    });
    const first = muxer.addVideoChunk({ timestamp: 0, byteLength: 6 } as EncodedVideoChunk);
    await Promise.resolve();
    expect(muxer.canAcceptVideoFrame()).toBe(false);
    await expect(muxer.addVideoChunk({ timestamp: 1, byteLength: 2 } as EncodedVideoChunk))
      .rejects.toThrow('safety limit');

    expect(muxer.getStats()).toMatchObject({ queuedPacketBytes: 6 });
    expect(writer.addVideo).toHaveBeenCalledOnce();
    release();
    await first;
  });

  it('reports an asynchronous mux rejection immediately to the backend owner', async () => {
    let init!: VideoEncoderInit;
    class FakeEncoder {
      static async isConfigSupported(config: VideoEncoderConfig) { return { supported: true, config }; }
      encodeQueueSize = 0;
      constructor(next: VideoEncoderInit) { init = next; }
      configure() {}
      encode() { init.output({ timestamp: 0 } as EncodedVideoChunk, {}); }
      async flush() {}
      close() {}
    }
    const onError = vi.fn();
    const encoder = new CaptureVideoEncoder({
      width: 640,
      height: 360,
      fps: 30,
      bitrate: 1_000_000,
      muxer: { addVideoChunk: async () => { throw new Error('queue full'); } },
      Encoder: FakeEncoder,
      onError,
    });
    await encoder.initialize();
    encoder.encode({ timestamp: 0 } as VideoFrame);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'queue full' }));
  });
});
