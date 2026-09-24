import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), seed: vi.fn(), prepare: vi.fn() }));
vi.mock('../../src/services/planarTracking/surfaceFrameReader', () => ({ openSurfaceFrames: mocks.open, surfaceFrameIndex: () => 0 }));
vi.mock('../../src/services/roto/rotoRuntime', () => ({ rotoRuntime: { prepare: mocks.prepare, seed: mocks.seed } }));
import { RotoSessions } from '../../src/services/roto/rotoSessions';
const source = { key: 'clip', scope: 'project', url: 'test.mp4', from: 0, to: 1 };
const points = [{ x: .5, y: .5, label: 1 as const }];
const frame = { time: .2, duration: .04, pixels: { width: 2, height: 2 } as ImageData };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockImplementation(async () => ({ frames: [frame], read: vi.fn().mockResolvedValue(frame), close: vi.fn() }));
  mocks.seed.mockResolvedValue({ mask: Uint8Array.of(0, 255, 255, 0) });
});
async function select(session: ReturnType<RotoSessions['acquire']>['session']) {
  await session.show(.2);
  await session.select(points, new AbortController().signal, () => {});
}
describe('Roto sessions across panel and clip changes', () => {
  it('retains masks, anchors, frame time and edges but releases the decoder on close', async () => {
    const pool = new RotoSessions(), lease = pool.acquire(source);
    await select(lease.session);
    const decoder = await mocks.open.mock.results[0].value;
    lease.session.edges = { offset: -1, softness: 2 };
    lease.release(); lease.release();
    expect(decoder.close).toHaveBeenCalledTimes(1);
    expect(lease.session.current).toBeUndefined();
    const reopened = pool.acquire(source);
    expect(reopened.session).toBe(lease.session);
    expect(reopened.session.masks.size).toBe(1);
    expect(reopened.session.anchors.get(.2)).toEqual(points);
    expect(reopened.session.lastTime).toBe(.2);
    expect(reopened.session.edges).toEqual({ offset: -1, softness: 2 });
    await reopened.session.show(.2);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    reopened.release();
  });
  it('isolates clips and invalidates a replaced source without changing another clip', async () => {
    const pool = new RotoSessions(), first = pool.acquire(source);
    await select(first.session); first.release();
    const other = pool.acquire({ ...source, key: 'other' });
    expect(other.session.masks.size).toBe(0); other.release();
    const replacement = pool.acquire({ ...source, url: 'replacement.mp4' });
    expect(replacement.session).not.toBe(first.session);
    expect(replacement.session.masks.size).toBe(0); replacement.release();
  });
  it('refuses a second panel owner and can reacquire after release', () => {
    const pool = new RotoSessions(), lease = pool.acquire(source);
    expect(() => pool.acquire(source)).toThrow('another Roto panel');
    lease.release(); expect(() => pool.acquire(source)).not.toThrow();
  });
  it('enforces a shared byte budget without evicting previous work, and clears it explicitly', async () => {
    const pool = new RotoSessions(4), first = pool.acquire(source);
    await select(first.session); first.release();
    const other = pool.acquire({ ...source, key: 'other' });
    await expect(select(other.session)).rejects.toThrow('memory is full');
    expect(other.session.anchors.size).toBe(0);
    expect(first.session.masks.size).toBe(1);
    first.session.clearMasks();
    await expect(select(other.session)).resolves.toBeUndefined();
    expect(pool.memoryBytes).toBe(4); other.release();
  });
  it('releases previous-project masks when entering another project', async () => {
    const pool = new RotoSessions(4), first = pool.acquire(source);
    await select(first.session); first.release();
    const next = pool.acquire({ ...source, scope: 'new project' });
    expect(first.session.masks.size).toBe(0);
    expect(pool.memoryBytes).toBe(0); next.release();
  });
});
