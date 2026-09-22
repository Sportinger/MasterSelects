import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), cache: new Map(), publish: vi.fn(), retain: vi.fn(), release: vi.fn(), proxy: vi.fn() }));
vi.mock('../../src/services/proxyFrameCache', () => ({ proxyFrameCache: {
  getNearestCachedFrameEntry: () => null, getFrame: mocks.proxy,
} }));
vi.mock('../../src/services/mediaRuntime/registry', () => ({ mediaRuntimeRegistry: {
  retainRuntime: mocks.retain, releaseRuntime: mocks.release,
} }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameReader', () => ({ openSourceFrameReader: mocks.open }));
import { SourceFrameService } from '../../src/services/mediaRuntime/sourceFrames/SourceFrameService';
class Frame {
  codedWidth = 8; displayWidth = 8; displayHeight = 4; timestamp: number;
  close = vi.fn();
  constructor(time: number) { this.timestamp = time * 1_000_000; }
}
const asset = { id: 'video', url: 'blob:video' };
let service: SourceFrameService;
let reader: ReturnType<typeof fakeReader>;
function fakeReader() {
  const batches: number[][] = [], decoded: Frame[] = [];
  const gate = vi.fn(async (_time: number) => undefined);
  return { frames: Array.from({ length: 100 }, (_, time) => ({ time: time / 10, duration: 0.1 })),
    rotation: 0, width: 8, height: 4, close: vi.fn(), idle: vi.fn(async () => {}), batches, decoded, gate,
    async *read(times: number[]) {
      batches.push(times);
      for (const time of times) {
        await gate(time);
        const frame = new Frame(time); decoded.push(frame);
        try { yield { frame, time, duration: 0.1, rotation: 0, width: 8, height: 4 }; }
        finally { frame.close(); }
      }
    },
  };
}
beforeEach(() => {
  vi.stubGlobal('VideoFrame', Frame); reader = fakeReader();
  mocks.open.mockResolvedValue(reader);
  mocks.proxy.mockResolvedValue(null);
  mocks.retain.mockReturnValue({ sourceId: 'media:video', frameCache: mocks.cache, cacheFrame: mocks.publish });
  service = new SourceFrameService();
});
afterEach(() => { service.destroy(); vi.clearAllMocks(); mocks.cache.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('coalesces exact PTS from two consumers without pinning decoder surfaces in the raw cache', async () => {
  const a = service.acquire(asset), b = service.acquire(asset), first = vi.fn(), second = vi.fn();
  await Promise.all([
    a.request({ times: [1, 2], priority: 'required', onFrame: first }),
    b.request({ times: [1.01, 2], priority: 'required', onFrame: second }),
  ]);
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(reader.batches).toEqual([[1, 2]]);
  expect(first.mock.calls.map(call => call[0].frame)).toEqual(second.mock.calls.map(call => call[0].frame));
  expect(mocks.publish).not.toHaveBeenCalled();
  await vi.waitFor(() => reader.decoded.forEach(frame => expect(frame.close).toHaveBeenCalledOnce()));
  a.release(); b.release();
});

it('borrows only exact native cache frames and leaves their lifetime with the media runtime', async () => {
  const exact = new Frame(1), stale = new Frame(1.95), proxy = new Frame(3); proxy.displayWidth = 2;
  for (const frame of [exact, stale, proxy]) mocks.cache.set(frame.timestamp, { frame });
  const lease = service.acquire(asset), receive = vi.fn();
  await lease.request({ times: [1, 2, 3], priority: 'required', onFrame: receive });
  expect(reader.batches).toEqual([[2, 3]]);
  expect(receive.mock.calls[0][0].frame).toBe(exact);
  lease.release(); expect(exact.close).not.toHaveBeenCalled();
});

it('cancels a superseded seek before its frame callback and skips the obsolete remainder', async () => {
  let resume!: () => void;
  reader.gate.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  const lease = service.acquire(asset), stale = vi.fn(), fresh = vi.fn();
  const old = lease.request({ times: [1, 2, 3], priority: 'required', onFrame: stale }).catch(error => error);
  await vi.waitFor(() => expect(reader.gate).toHaveBeenCalled());
  const current = lease.request({ times: [8, 9], priority: 'required', onFrame: fresh });
  resume(); await current;
  expect((await old).name).toBe('AbortError'); expect(stale).not.toHaveBeenCalled();
  expect(reader.batches).toEqual([[1, 2, 3], [8, 9]]);
  expect(reader.decoded.map(frame => frame.timestamp)).toEqual([1e6, 8e6, 9e6]);
});

it('preempts prefetch with required work and resumes its remaining samples afterwards', async () => {
  let resume!: () => void;
  reader.gate.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  const a = service.acquire(asset), b = service.acquire(asset), seen: number[] = [];
  const prefetch = a.request({ times: [1, 2, 3], priority: 'prefetch', onFrame: frame => seen.push(frame.time) });
  await vi.waitFor(() => expect(reader.gate).toHaveBeenCalled());
  const required = b.request({ times: [8], priority: 'required', onFrame: frame => seen.push(frame.time) });
  resume(); await Promise.all([prefetch, required]);
  expect(seen).toEqual([1, 8, 2, 3]);
});

it('keeps the reader through a quality switch, then releases it after the last owner leaves', async () => {
  vi.useFakeTimers();
  const a = service.acquire(asset); await a.ready; a.release();
  const b = service.acquire(asset); await b.ready;
  await vi.advanceTimersByTimeAsync(3000);
  expect(mocks.open).toHaveBeenCalledTimes(1); expect(reader.close).not.toHaveBeenCalled();
  b.release(); await vi.advanceTimersByTimeAsync(2500);
  expect(reader.close).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
});

it('serves Low from the proxy cache while the same PTS still decodes native pixels for Full Res', async () => {
  const image = { complete: true, naturalWidth: 4, naturalHeight: 2 };
  mocks.proxy.mockResolvedValue(image);
  const low = service.acquire(asset), full = service.acquire(asset), lowFrame = vi.fn(), fullFrame = vi.fn();
  await Promise.all([
    low.request({ times: [1], proxyFps: 10, priority: 'required', onFrame: lowFrame }),
    full.request({ times: [1], priority: 'required', onFrame: fullFrame }),
  ]);
  expect(lowFrame.mock.calls[0][0].image).toBe(image);
  expect(fullFrame.mock.calls[0][0].frame).toBeInstanceOf(Frame);
  expect(reader.batches).toEqual([[1]]);
});

it('decodes only missing proxy frames through the original source fallback', async () => {
  mocks.proxy.mockImplementation(async (_id, time) => Math.floor(time * 10) === 10
    ? { complete: true, naturalWidth: 4, naturalHeight: 2 } : null);
  const lease = service.acquire(asset), seen = vi.fn();
  await lease.request({ times: [1, 2], proxyFps: 10, priority: 'required', onFrame: seen });
  expect(reader.batches).toEqual([[2]]);
  expect(seen.mock.calls.map(call => call[0].time)).toEqual([1, 2]);
});
