import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TurboResFrameProvider,
  type TurboResFrameProviderOptions,
} from '../../src/services/mediaRuntime/prores/TurboResFrameProvider';
import type {
  TurboResPacket,
  TurboResPacketReader,
} from '../../src/services/mediaRuntime/prores/TurboResPacketSource';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function packet(timeSeconds: number): TurboResPacket {
  return {
    data: new Uint8Array([Math.round(timeSeconds)]),
    timestamp: timeSeconds,
    duration: 1 / 24,
    microsecondTimestamp: Math.round(timeSeconds * 1_000_000),
    microsecondDuration: Math.round(1_000_000 / 24),
  };
}

function decodedFrame() {
  return {
    frameData: new Uint8Array(24),
    codedWidth: 4,
    codedHeight: 4,
    visibleWidth: 4,
    visibleHeight: 4,
    pixelFormat: 'I420' as const,
    originalPixelFormat: 'I422P10' as const,
    colorPrimariesString: 'bt709',
    colorTransferString: 'bt709',
    colorMatrixString: 'bt709',
    colorRangeFull: false,
    scanType: 'progressive',
  };
}

function createHarness(overrides: Partial<TurboResFrameProviderOptions> = {}) {
  const sourceDispose = vi.fn();
  const source: TurboResPacketReader = {
    metadata: {
      fourCC: 'apch',
      duration: 10,
      width: 4,
      height: 4,
      codedWidth: 4,
      codedHeight: 4,
      rotation: 0,
      fps: 24,
    },
    getPacketAt: vi.fn(async (timeSeconds) => packet(timeSeconds)),
    getNextPacket: vi.fn(async (previousPacket) => (
      packet(previousPacket.timestamp + previousPacket.duration)
    )),
    dispose: sourceDispose,
  };
  const decoderClose = vi.fn(async () => undefined);
  const decoder = {
    useSharedMemory: true,
    concurrency: 2,
    decodeQueueSize: 0,
    decode: vi.fn(async () => decodedFrame()),
    close: decoderClose,
  };
  const frameClear = vi.fn();
  const frame = { isLocked: false, clear: frameClear };
  const onFrame = vi.fn();
  const onError = vi.fn();
  const provider = new TurboResFrameProvider({
    sourceId: 'source-1',
    file: new File(['mov'], 'clip.mov', { type: 'video/quicktime' }),
    fourCC: 'apch',
    allowedOutputFormats: ['I420'],
    packetSourceFactory: async () => source,
    moduleLoader: async () => ({
      Decoder: {
        canUseSharedMemory: () => true,
        create: vi.fn(async () => decoder),
      },
      Frame: class Frame {
        isLocked = frame.isLocked;
        clear = frame.clear;
      },
    }),
    onFrame,
    onError,
    ...overrides,
  });
  return {
    provider,
    source,
    sourceDispose,
    decoder,
    decoderClose,
    frameClear,
    onFrame,
    onError,
  };
}

describe('TurboResFrameProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('publishes the latest seek and discards an older in-flight result', async () => {
    const createdFrames: Array<{ timestamp: number; closed: boolean }> = [];
    vi.stubGlobal('VideoFrame', class VideoFrame {
      timestamp: number;
      closed = false;
      constructor(_data: BufferSource, init: VideoFrameBufferInit) {
        this.timestamp = init.timestamp;
        createdFrames.push(this);
      }
      close() { this.closed = true; }
    });

    const firstPacket = deferred<TurboResPacket | null>();
    const harness = createHarness();
    vi.mocked(harness.source.getPacketAt)
      .mockImplementationOnce(() => firstPacket.promise)
      .mockImplementationOnce(async (timeSeconds) => packet(timeSeconds));

    await harness.provider.load();
    harness.provider.seek(1);
    harness.provider.scrubSeek(2);
    firstPacket.resolve(packet(1));

    await vi.waitFor(() => {
      expect(harness.provider.isDecodePending()).toBe(false);
      expect(harness.provider.getCurrentFrame()).not.toBeNull();
    });

    expect(harness.onFrame).toHaveBeenCalledOnce();
    expect(createdFrames).toHaveLength(2);
    expect(createdFrames[0]).toMatchObject({ timestamp: 1_000_000, closed: true });
    expect(createdFrames[1]).toMatchObject({ timestamp: 2_000_000, closed: false });
    expect(harness.provider.currentTime).toBe(2);
    expect(harness.provider.getDebugInfo()).toMatchObject({
      codec: 'turbores:apch',
      decodedFrameCount: 2,
      discardedFrameCount: 1,
      emittedPixelFormat: 'I420',
      originalPixelFormat: 'I422P10',
    });

    await harness.provider.destroyAsync();
    expect(createdFrames[1].closed).toBe(true);
    expect(harness.frameClear).toHaveBeenCalledOnce();
    expect(harness.decoderClose).toHaveBeenCalledOnce();
    expect(harness.sourceDispose).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight decode before releasing resources on destroy', async () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(_data: BufferSource, _init: VideoFrameBufferInit) {}
      close() {}
    });
    const decodeResult = deferred<ReturnType<typeof decodedFrame>>();
    const harness = createHarness();
    harness.decoder.decode.mockImplementationOnce(() => decodeResult.promise);

    await harness.provider.load();
    harness.provider.seek(3);
    const destroyPromise = harness.provider.destroyAsync();
    expect(harness.decoderClose).not.toHaveBeenCalled();

    decodeResult.resolve(decodedFrame());
    await destroyPromise;

    expect(harness.onFrame).not.toHaveBeenCalled();
    expect(harness.decoderClose).toHaveBeenCalledOnce();
    expect(harness.frameClear).toHaveBeenCalledOnce();
    expect(harness.sourceDispose).toHaveBeenCalledOnce();
  });

  it('resolves exact seeks only after publishing the requested export frame', async () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(_data: BufferSource, _init: VideoFrameBufferInit) {}
      close() {}
    });
    const decodeResult = deferred<ReturnType<typeof decodedFrame>>();
    const harness = createHarness();
    harness.source.metadata.rotation = 90;
    harness.decoder.decode.mockImplementationOnce(() => decodeResult.promise);

    await harness.provider.load();
    let resolved = false;
    const exactSeek = harness.provider.seekExact(4).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    decodeResult.resolve(decodedFrame());
    await exactSeek;

    expect(harness.provider.currentTime).toBe(4);
    expect(harness.provider.getCurrentFrame()).not.toBeNull();
    expect(harness.provider.getSourceRotationDegrees()).toBe(90);
    await harness.provider.destroyAsync();
  });

  it('keeps the preceding 23.976 fps packet for a valid 24 fps export timestamp', async () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(_data: BufferSource, _init: VideoFrameBufferInit) {}
      close() {}
    });
    const sourceFrameDuration = 1001 / 24_000;
    const firstPacket = {
      ...packet(0),
      duration: sourceFrameDuration,
      microsecondDuration: Math.round(sourceFrameDuration * 1_000_000),
    };
    const harness = createHarness();
    harness.source.metadata.fps = 24_000 / 1001;
    vi.mocked(harness.source.getPacketAt).mockResolvedValue(firstPacket);

    await harness.provider.load();
    await harness.provider.seekExact(0);
    await expect(harness.provider.seekExact(1 / 24)).resolves.toBeUndefined();

    expect(harness.source.getPacketAt).toHaveBeenCalledOnce();
    expect(harness.decoder.decode).toHaveBeenCalledOnce();
    expect(harness.provider.currentTime).toBe(1 / 24);
    await harness.provider.destroyAsync();
  });

  it('reports and suppresses interlaced frames', async () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(_data: BufferSource, _init: VideoFrameBufferInit) {}
      close() {}
    });
    const harness = createHarness();
    harness.decoder.decode.mockResolvedValueOnce({
      ...decodedFrame(),
      scanType: 'interlaced-top-field-first',
    });

    await harness.provider.load();
    harness.provider.seek(0);
    await vi.waitFor(() => expect(harness.provider.isDecodePending()).toBe(false));

    expect(harness.provider.getCurrentFrame()).toBeNull();
    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Interlaced ProRes is not enabled'),
    }));
    await harness.provider.destroyAsync();
  });

  it('keeps one sequential frame prefetched and resets it when playback loops', async () => {
    const createdFrames: Array<{ timestamp: number; closed: boolean }> = [];
    vi.stubGlobal('VideoFrame', class VideoFrame {
      timestamp: number;
      closed = false;
      constructor(_data: BufferSource, init: VideoFrameBufferInit) {
        this.timestamp = init.timestamp;
        createdFrames.push(this);
      }
      close() { this.closed = true; }
    });
    const harness = createHarness();

    await harness.provider.load();
    harness.provider.advanceToTime(0);
    await vi.waitFor(() => expect(harness.provider.isDecodePending()).toBe(false));

    expect(harness.provider.hasBufferedFutureFrame()).toBe(true);
    expect(harness.provider.getDebugInfo()).toMatchObject({
      currentFrameTimestampSeconds: 0,
      decodedFrameCount: 2,
      prefetchedFrameCount: 1,
    });

    harness.provider.advanceToTime(1 / 24);
    await vi.waitFor(() => expect(harness.provider.isDecodePending()).toBe(false));
    expect(harness.provider.getDebugInfo()).toMatchObject({
      currentFrameTimestampSeconds: 1 / 24,
      prefetchedFrameCount: 2,
    });
    expect(harness.source.getPacketAt).toHaveBeenCalledTimes(1);

    harness.provider.advanceToTime(0);
    await vi.waitFor(() => expect(harness.provider.isDecodePending()).toBe(false));
    expect(harness.provider.getDebugInfo().currentFrameTimestampSeconds).toBe(0);
    expect(harness.source.getPacketAt).toHaveBeenCalledTimes(2);
    expect(createdFrames.some((frame) => frame.timestamp > 1_000_000 / 24 && frame.closed)).toBe(true);

    await harness.provider.destroyAsync();
    expect(createdFrames.every((frame) => frame.closed)).toBe(true);
  });

  it('keeps an in-flight prefetch when the next playback advance arrives', async () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      timestamp: number;
      constructor(_data: BufferSource, init: VideoFrameBufferInit) {
        this.timestamp = init.timestamp;
      }
      close() {}
    });
    const prefetchedDecode = deferred<ReturnType<typeof decodedFrame>>();
    const harness = createHarness();
    harness.decoder.decode
      .mockResolvedValueOnce(decodedFrame())
      .mockImplementationOnce(() => prefetchedDecode.promise)
      .mockResolvedValue(decodedFrame());

    await harness.provider.load();
    harness.provider.advanceToTime(0);
    await vi.waitFor(() => expect(harness.decoder.decode).toHaveBeenCalledTimes(2));

    harness.provider.advanceToTime(1 / 24);
    prefetchedDecode.resolve(decodedFrame());

    await vi.waitFor(() => expect(harness.provider.isDecodePending()).toBe(false));
    expect(harness.onFrame).toHaveBeenCalledTimes(2);
    expect(harness.source.getPacketAt).toHaveBeenCalledOnce();
    expect(harness.provider.getDebugInfo()).toMatchObject({
      currentFrameTimestampSeconds: 1 / 24,
      discardedFrameCount: 0,
    });

    await harness.provider.destroyAsync();
  });

  it('rejects an exact seek that a newer exact seek supersedes', async () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(_data: BufferSource, _init: VideoFrameBufferInit) {}
      close() {}
    });
    const firstPacket = deferred<TurboResPacket | null>();
    const harness = createHarness();
    vi.mocked(harness.source.getPacketAt)
      .mockImplementationOnce(() => firstPacket.promise)
      .mockImplementationOnce(async (timeSeconds) => packet(timeSeconds));

    await harness.provider.load();
    const firstResult = harness.provider.seekExact(1).then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    const secondSeek = harness.provider.seekExact(2);
    firstPacket.resolve(packet(1));

    await secondSeek;
    expect(await firstResult).toContain('superseded');
    expect(harness.provider.currentTime).toBe(2);
    await harness.provider.destroyAsync();
  });

  it('times out worker initialization and closes a decoder that resolves late', async () => {
    const sourceDispose = vi.fn();
    const lateDecoderClose = vi.fn(async () => undefined);
    const lateDecoder = {
      useSharedMemory: true,
      concurrency: 2,
      decodeQueueSize: 0,
      decode: vi.fn(async () => decodedFrame()),
      close: lateDecoderClose,
    };
    const decoderCreation = deferred<typeof lateDecoder | Error>();
    const provider = new TurboResFrameProvider({
      sourceId: 'late-worker',
      file: new File(['mov'], 'late.mov', { type: 'video/quicktime' }),
      fourCC: 'apch',
      allowedOutputFormats: ['I420'],
      loadTimeoutMs: 5,
      packetSourceFactory: async () => ({
        metadata: {
          fourCC: 'apch',
          duration: 1,
          width: 4,
          height: 4,
          codedWidth: 4,
          codedHeight: 4,
          rotation: 0,
          fps: 24,
        },
        getPacketAt: async () => packet(0),
        dispose: sourceDispose,
      }),
      moduleLoader: async () => ({
        Decoder: {
          canUseSharedMemory: () => true,
          create: () => decoderCreation.promise,
        },
        Frame: class Frame {
          isLocked = false;
          clear() {}
        },
      }),
    });

    await expect(provider.load()).rejects.toThrow(
      'TurboRes decoder worker initialization timed out after 5ms',
    );
    expect(sourceDispose).toHaveBeenCalledOnce();
    decoderCreation.resolve(lateDecoder);
    await vi.waitFor(() => expect(lateDecoderClose).toHaveBeenCalledOnce());
    await provider.destroyAsync();
  });
});
