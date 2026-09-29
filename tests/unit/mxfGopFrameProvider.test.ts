import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryByteSource } from '../../src/services/mediaMetadata/mxf/mxfByteSource';
import {
  MxfGopFrameProvider,
  type GopDecoder,
  type GopDecoderCallbacks,
  type MxfGopFrameProviderOptions,
} from '../../src/services/mediaRuntime/mxf/MxfGopFrameProvider';
import { MxfPacketSource, type MxfPacket } from '../../src/services/mediaRuntime/mxf/MxfPacketSource';

const FPS = 25;
let liveFrames = 0;

class FakeVideoFrame {
  readonly timestamp: number;
  closed = false;
  constructor(timestamp: number) {
    this.timestamp = timestamp;
    liveFrames += 1;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    liveFrames -= 1;
  }
}

/**
 * Behaves like a reordering hardware decoder: frames come out in display order once
 * the stored-order stream has advanced far enough, output needs a free surface, and
 * input stalls while all surfaces are held by the client.
 */
class FakeHardwareDecoder implements GopDecoder {
  private readonly queue: MxfPacket[] = [];
  private readonly held = new Set<FakeVideoFrame>();
  private readonly waiters: (() => void)[] = [];
  private decoded: number[] = [];
  private nextDisplay = 0;
  private keySeen = false;
  constructor(private readonly callbacks: GopDecoderCallbacks, private readonly surfaces: number) {}

  get queueSize(): number {
    return this.queue.length;
  }

  decode(packet: MxfPacket): void {
    if (!this.keySeen && !packet.isKeyframe) {
      this.callbacks.error(new Error('decode must start at a key frame'));
      return;
    }
    this.keySeen = true;
    this.queue.push(packet);
    setTimeout(() => this.pump(), 0);
  }

  waitForCapacity(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async flush(): Promise<void> {
    this.pump();
    this.decoded.sort((a, b) => a - b);
    while (this.decoded.length > 0) this.emit(this.decoded.shift()!);
    this.keySeen = false;
  }

  reset(): void {
    this.queue.length = 0;
    this.decoded = [];
    this.keySeen = false;
    this.nextDisplay = 0;
  }

  close(): void {
    this.reset();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.liveHeld() < this.surfaces) {
      const packet = this.queue.shift()!;
      this.decoded.push(packet.displayIndex);
      this.waiters.shift()?.();
      this.decoded.sort((a, b) => a - b);
      if (this.nextDisplay === 0 || this.decoded[0]! < this.nextDisplay) this.nextDisplay = this.decoded[0]!;
      // Release a frame once its successor in display order has been decoded (B-frame reorder).
      while (this.decoded.length > 1 && this.decoded[0] === this.nextDisplay) {
        this.emit(this.decoded.shift()!);
        this.nextDisplay += 1;
      }
    }
    if (this.queue.length > 0) setTimeout(() => this.pump(), 5);
  }

  private liveHeld(): number {
    for (const frame of this.held) if (frame.closed) this.held.delete(frame);
    return this.held.size;
  }

  private emit(displayIndex: number): void {
    const frame = new FakeVideoFrame(Math.round((displayIndex / FPS) * 1e6));
    this.held.add(frame);
    this.callbacks.output(frame as unknown as VideoFrame);
  }
}

class TestGopProvider extends MxfGopFrameProvider<MxfGopFrameProviderOptions> {
  readonly backend = 'mxf-avc' as const;
  protected readonly label = 'Test GOP';
  protected readonly packetLabel = 'test packet';
  static surfaces = 4;
  protected async createGopDecoder(_source: MxfPacketSource, callbacks: GopDecoderCallbacks) {
    return new FakeHardwareDecoder(callbacks, TestGopProvider.surfaces);
  }
  protected describeDecoder() {
    return { codec: 'test', hwAccel: 'test' };
  }
}

function createProvider(surfaces: number) {
  TestGopProvider.surfaces = surfaces;
  const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/mxf/mpeg2_422_lgop.mxf')));
  return new TestGopProvider({
    sourceId: 'test',
    file: new File([], 'x.mxf'),
    codecId: 'mxf:mpeg2-lgop',
    packetSourceFactory: () => MxfPacketSource.createFromSource(createMemoryByteSource(bytes)),
  });
}

function frameIndex(provider: TestGopProvider): number {
  const frame = provider.getCurrentFrame() as unknown as FakeVideoFrame;
  return Math.round((frame.timestamp / 1e6) * FPS);
}

describe('MxfGopFrameProvider (long GOP reorder, key-frame restart)', () => {
  beforeEach(() => {
    liveFrames = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the exact display frame for forward and backward exact seeks', async () => {
    const provider = createProvider(4);
    await provider.load();
    for (const index of [0, 1, 2, 3, 2, 0, 3, 1]) {
      await provider.seekExact(index / FPS + 0.001);
      expect(frameIndex(provider)).toBe(index);
    }
    await provider.destroyAsync();
    expect(liveFrames).toBe(0);
  });

  it('does not deadlock when the decoder has only two output surfaces', async () => {
    const provider = createProvider(2);
    await provider.load();
    for (const index of [0, 1, 2, 3]) {
      await provider.seekExact(index / FPS + 0.001);
      expect(frameIndex(provider)).toBe(index);
    }
    await provider.destroyAsync();
    expect(liveFrames).toBe(0);
  });
});
