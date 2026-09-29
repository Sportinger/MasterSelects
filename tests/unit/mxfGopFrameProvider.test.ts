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

/**
 * Synthetic long-GOP source: GOP of 12, stored order I P B B P B B … (display
 * order reorders each B pair after its anchor), 25 fps.
 */
function createSyntheticSource(frameCount: number) {
  const storedToDisplay: number[] = [];
  for (let gop = 0; gop < frameCount; gop += 12) {
    const size = Math.min(12, frameCount - gop);
    storedToDisplay.push(gop);
    for (let i = 1; i < size; i += 3) {
      const anchor = Math.min(gop + i + 2, gop + size - 1);
      storedToDisplay.push(anchor);
      for (let b = gop + i; b < anchor; b += 1) storedToDisplay.push(b);
    }
  }
  const displayToStored = new Array<number>(frameCount);
  storedToDisplay.forEach((display, stored) => { displayToStored[display] = stored; });
  const packet = (stored: number): MxfPacket => {
    const display = storedToDisplay[stored]!;
    return {
      data: new Uint8Array(1),
      timestamp: display / FPS,
      duration: 1 / FPS,
      microsecondTimestamp: Math.round((display / FPS) * 1e6),
      microsecondDuration: Math.round(1e6 / FPS),
      isKeyframe: stored % 12 === 0,
      storedIndex: stored,
      displayIndex: display,
    };
  };
  return {
    metadata: { codecId: 'mxf:avc-lgop', duration: frameCount / FPS, width: 64, height: 64, codedWidth: 64, codedHeight: 64, rotation: 0, fps: FPS },
    frameCount,
    mxf: {},
    getPacketAt: async (t: number) => packet(displayToStored[Math.min(frameCount - 1, Math.floor(t * FPS + 1e-6))]!),
    getNextPacket: async (p: MxfPacket) => (p.displayIndex + 1 < frameCount ? packet(displayToStored[p.displayIndex + 1]!) : null),
    getPacketByStoredIndex: async (stored: number) => packet(stored),
    keyframeStoredIndexFor: (display: number) => Math.floor(displayToStored[display]! / 12) * 12,
    storedToDisplayIndex: (stored: number) => storedToDisplay[stored]!,
    dispose: () => undefined,
  } as unknown as MxfPacketSource;
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

  it('keeps decoding through key frames during forward playback that falls behind', async () => {
    TestGopProvider.surfaces = 4;
    const provider = new TestGopProvider({
      sourceId: 'synthetic',
      file: new File([], 'x.mxf'),
      codecId: 'mxf:avc-lgop',
      packetSourceFactory: async () => createSyntheticSource(120),
    });
    await provider.load();
    // Playback that lags: every request lags half a second and crosses several GOP boundaries.
    for (let index = 1; index < 110; index += 13) {
      await provider.seekExact(index / FPS + 0.001);
      expect(frameIndex(provider)).toBe(index);
    }
    expect(provider.getDebugInfo().decoderResets).toBe(1);
    await provider.destroyAsync();
    expect(liveFrames).toBe(0);
  });

  it('snaps thumbnail times to the key frame so a thumbnail costs one decode', async () => {
    const provider = createProvider(4);
    await provider.load();
    // The 4-frame fixture has one GOP whose I frame is displayed first.
    expect(provider.getThumbnailSeekTime(0.1)).toBeCloseTo(0.5 / FPS, 9);
    await provider.seekExact(provider.getThumbnailSeekTime(0.1));
    expect(frameIndex(provider)).toBe(0);
    await provider.destroyAsync();
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
