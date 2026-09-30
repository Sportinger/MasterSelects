import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodecFrameProviderBase,
  type CodecFrameProviderBaseOptions,
  type CodecPacket,
  type CodecPacketReader,
} from '../../src/services/mediaRuntime/codec/CodecFrameProviderBase';

function packet(timeSeconds: number): CodecPacket {
  return {
    data: new Uint8Array(), timestamp: timeSeconds, duration: 1 / 25,
    microsecondTimestamp: Math.round(timeSeconds * 1e6), microsecondDuration: 40_000,
  };
}

function frame(timeSeconds: number) {
  return { timestamp: Math.round(timeSeconds * 1e6), close: vi.fn() } as unknown as VideoFrame;
}

/** A decoder whose completions are controlled independently of playback ticks. */
class DelayedFrameProvider extends CodecFrameProviderBase<CodecPacket, CodecFrameProviderBaseOptions> {
  readonly backend = 'mxf-avc' as const;
  protected readonly label = 'Test codec';
  protected readonly packetLabel = 'packet';
  readonly requests: { packet: CodecPacket; resolve(frame: VideoFrame): void; result?: VideoFrame }[] = [];
  readonly onFrame = vi.fn();

  constructor() {
    const onFrame = vi.fn();
    super({ sourceId: 'camera', file: new File(['mxf'], 'camera.mxf'), onFrame });
    this.onFrame = onFrame;
  }

  protected async initializeResources(): Promise<CodecPacketReader> {
    return {
      metadata: { duration: 30, width: 4, height: 4, codedWidth: 4, codedHeight: 4, rotation: 0, fps: 25 },
      getPacketAt: async (time) => packet(time),
      dispose() {},
    };
  }
  protected hasDecoder() { return true; }
  protected decodePacketToFrame(packet: CodecPacket): Promise<VideoFrame> {
    return new Promise((resolve) => this.requests.push({ packet, resolve }));
  }
  protected async releaseDecoderResources() {}
  protected getBackendDebugInfo() { return { codec: 'test', hwAccel: 'test', decodeQueueSize: 0 }; }

  finish(index: number): VideoFrame {
    const request = this.requests[index];
    const result = request.result ?? frame(request.packet.timestamp);
    request.result = result;
    request.resolve(result);
    return result;
  }
}

const providers: DelayedFrameProvider[] = [];
async function createProvider() {
  const provider = new DelayedFrameProvider();
  providers.push(provider);
  await provider.load();
  return provider;
}

async function waitForRequest(provider: DelayedFrameProvider, count: number) {
  await vi.waitFor(() => expect(provider.requests).toHaveLength(count));
}

afterEach(async () => {
  for (const provider of providers.splice(0)) {
    const closing = provider.destroyAsync();
    provider.requests.forEach((_request, index) => provider.finish(index));
    await closing;
  }
});

describe('codec forward playback progress under concurrent decoder load', () => {
  it('publishes completed frames while newer forward targets keep arriving', async () => {
    const provider = await createProvider();
    provider.advanceToTime(0);
    await waitForRequest(provider, 1);
    provider.advanceToTime(0.04);
    const first = provider.finish(0);
    await waitForRequest(provider, 2);

    expect(provider.getCurrentFrame()).toBe(first);
    expect(provider.currentTime).toBe(0.04);
    expect(provider.getPendingSeekTime()).toBe(0.04);
    expect(provider.isSeeking()).toBe(true);
    expect(provider.onFrame).toHaveBeenCalledOnce();

    provider.advanceToTime(0.08);
    const second = provider.finish(1);
    await waitForRequest(provider, 3);
    expect(provider.getCurrentFrame()).toBe(second);
    expect(first.close).toHaveBeenCalledOnce();
    expect(provider.currentTime).toBe(0.08);
    expect(provider.getPendingSeekTime()).toBe(0.08);
    expect(provider.onFrame).toHaveBeenCalledTimes(2);

    const third = provider.finish(2);
    await vi.waitFor(() => expect(provider.isDecodePending()).toBe(false));
    expect(provider.getCurrentFrame()).toBe(third);
    expect(second.close).toHaveBeenCalledOnce();
    expect(provider.getDebugInfo()).toMatchObject({ decodedFrameCount: 3, discardedFrameCount: 0 });
    expect(provider.onFrame).toHaveBeenCalledTimes(3);
  });

  it('keeps a recent playback frame within the collector window, but hides large jumps', async () => {
    const provider = await createProvider();
    const initial = provider.seekExact(0);
    await waitForRequest(provider, 1);
    const first = provider.finish(0);
    await initial;
    provider.advanceToTime(0.24);
    await waitForRequest(provider, 2);
    expect(provider.getCurrentFrame()).toBe(first);
    provider.advanceToTime(0.36);
    expect(provider.getCurrentFrame()).toBeNull();
  });

  it('does not accept an old forward completion after an exact seek supersedes it', async () => {
    const provider = await createProvider();
    provider.advanceToTime(1);
    await waitForRequest(provider, 1);
    const exact = provider.seekExact(5);
    const old = provider.finish(0);
    await waitForRequest(provider, 2);
    expect(old.close).toHaveBeenCalledOnce();
    expect(provider.getCurrentFrame()).toBeNull();
    expect(provider.onFrame).not.toHaveBeenCalled();
    const target = provider.finish(1);
    await exact;
    expect(provider.getCurrentFrame()).toBe(target);
    expect(provider.currentTime).toBe(5);
    expect(provider.onFrame).toHaveBeenCalledOnce();
  });

  it('keeps exact seeks stricter than the forward playback window', async () => {
    const provider = await createProvider();
    const initial = provider.seekExact(0);
    await waitForRequest(provider, 1);
    provider.finish(0);
    await initial;
    provider.seek(0.24);
    await waitForRequest(provider, 2);
    expect(provider.getCurrentFrame()).toBeNull();
  });

  it('discards forward work when the next advance jumps backwards', async () => {
    const provider = await createProvider();
    provider.advanceToTime(2);
    await waitForRequest(provider, 1);
    provider.advanceToTime(1);
    const old = provider.finish(0);
    await waitForRequest(provider, 2);
    expect(old.close).toHaveBeenCalledOnce();
    expect(provider.onFrame).not.toHaveBeenCalled();
    const target = provider.finish(1);
    await vi.waitFor(() => expect(provider.isDecodePending()).toBe(false));
    expect(provider.getCurrentFrame()).toBe(target);
  });

  it('never publishes forward work from a cancelled epoch after pause/resume', async () => {
    const provider = await createProvider();
    provider.advanceToTime(1);
    await waitForRequest(provider, 1);
    provider.pause();
    provider.advanceToTime(1.04);
    const old = provider.finish(0);
    await waitForRequest(provider, 2);
    expect(old.close).toHaveBeenCalledOnce();
    expect(provider.onFrame).not.toHaveBeenCalled();
    const target = provider.finish(1);
    await vi.waitFor(() => expect(provider.isDecodePending()).toBe(false));
    expect(provider.getCurrentFrame()).toBe(target);
  });
});
