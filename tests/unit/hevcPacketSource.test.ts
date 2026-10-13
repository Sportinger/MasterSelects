import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ packets: [] as any[], disposed: vi.fn() }));
vi.mock('mediabunny', () => ({
  MP4: {}, QTFF: {}, BlobSource: class {},
  Input: class {
    dispose = state.disposed;
    async getPrimaryVideoTrack() { return {
      codec: 'hevc', displayWidth: 1080, displayHeight: 1920, codedWidth: 1920, codedHeight: 1080, rotation: 90,
      getDecoderConfig: async () => ({ codec: 'hvc1.1.6.L120.B0', description: new Uint8Array([1, 2]) }),
      computeDuration: async () => 0.2,
    }; }
  },
  EncodedPacketSink: class {
    async *packets() { yield* state.packets; }
    async getFirstPacket() { return state.packets[0]; }
    async getNextPacket(packet: any) { return state.packets[packet.index + 1] ?? null; }
  },
}));
import { HevcPacketSource } from '../../src/services/mediaRuntime/hevc/HevcPacketSource';
function setPackets(times: number[]) {
  state.packets = times.map((timestamp, index) => ({ index, timestamp, duration: 0.03,
    microsecondTimestamp: Math.round(timestamp * 1e6), type: index === 0 ? 'key' : 'delta', data: new Uint8Array([index]),
  }));
}
afterEach(() => vi.clearAllMocks());
describe('HEVC MP4 packet identity', () => {
  it('keeps variable presentation times separate from decode order and preserves rotation', async () => {
    setPackets([0, 0.11, 0.03, 0.07, 0.15]);
    const source = await HevcPacketSource.create(new File(['mp4'], 'phone.mp4'));
    const target = await source.getPacketAt(0.06);
    expect(target).toMatchObject({ timestamp: 0.03, storedIndex: 2, displayIndex: 1 });
    expect(target?.duration).toBeCloseTo(0.04, 10);
    expect(source.timestampToDisplayIndex(110000)).toBe(3);
    expect((await source.getNextPacket(target!))?.timestamp).toBe(0.07);
    expect((await source.getPacketByStoredIndex(2))?.data).toEqual(new Uint8Array([2]));
    expect(source.keyframeStoredIndexFor(3)).toBe(0);
    expect(source.metadata.rotation).toBe(90);
    source.dispose();
    expect(state.disposed).toHaveBeenCalledOnce();
  });
  it('selects the last same-PTS packet and skips zero-duration display intervals', async () => {
    setPackets([0, 0.03, 0.03, 0.11]);
    const source = await HevcPacketSource.create(new File(['mp4'], 'phone.mp4'));
    expect(await source.getPacketAt(0.03)).toMatchObject({ storedIndex: 2, duration: 0.08 });
    expect(source.timestampToDisplayIndex(30000)).toBe(2);
    const first = await source.getPacketAt(0);
    // The iterator must select the visible representative of a duplicate PTS.
    expect(await source.getNextPacket(first!)).toMatchObject({ timestamp: 0.03, storedIndex: 2 });
    source.dispose();
    expect(await source.getPacketAt(0)).toBeNull();
  });
});
