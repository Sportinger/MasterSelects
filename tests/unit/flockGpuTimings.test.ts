import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlockGpuTimings } from '../../src/engine/flock/gpu/FlockGpuTimings';

function fixture(supported = true) {
  vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  const times = new BigUint64Array(512);
  times.set([1000000n, 4000000n, 5000000n, 7000000n]);
  const device = {
    features: new Set(supported ? ['timestamp-query'] : []),
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn(() => ({
      mapAsync: vi.fn(async () => {}), getMappedRange: () => times.buffer,
      unmap: vi.fn(), destroy: vi.fn(),
    })),
  } as unknown as GPUDevice;
  const encoder = () => ({ resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() }) as unknown as GPUCommandEncoder;
  return { device, encoder, owner: new FlockGpuTimings(device) };
}

afterEach(() => vi.unstubAllGlobals());

describe('Flock GPU pass timings', () => {
  it('aggregates nanosecond query differences and records the number of steps', async () => {
    const { owner, encoder } = fixture();
    const enc = encoder();
    expect(owner.writes(enc, 'pressure')?.beginningOfPassWriteIndex).toBe(0);
    expect(owner.writes(enc, 'pressure')?.endOfPassWriteIndex).toBe(3);
    const read = owner.resolve(enc, 'simulation');
    expect(owner.snapshot().samples).toEqual({});
    read();
    await vi.waitFor(() => expect(owner.snapshot().samples.simulation).toMatchObject({
      milliseconds: { pressure: 5 }, passes: { pressure: 2 }, truncated: false,
    }));
  });

  it('skips queries on devices without the optional feature', () => {
    const { owner, device, encoder } = fixture(false);
    const enc = encoder();
    expect(owner.writes(enc, 'simulate')).toBeUndefined();
    owner.resolve(enc, 'simulation')();
    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(owner.snapshot().supported).toBe(false);
  });

  it('bounds outstanding readbacks and releases abandoned encoder slots', () => {
    const { owner, device, encoder } = fixture();
    const active = [encoder(), encoder(), encoder()];
    active.forEach(enc => expect(owner.writes(enc, 'simulate')).toBeDefined());
    expect(owner.writes(encoder(), 'simulate')).toBeUndefined();
    expect(device.createQuerySet).toHaveBeenCalledTimes(3);
    owner.cancel(active[0]);
    expect(owner.writes(encoder(), 'simulate')).toBeDefined();
    expect(device.createQuerySet).toHaveBeenCalledTimes(3);
    owner.dispose();
    expect(owner.writes(encoder(), 'simulate')).toBeUndefined();
  });

  it('marks a measurement as partial when its timestamp capacity is exhausted', async () => {
    const { owner, encoder } = fixture();
    const enc = encoder();
    for (let i = 0; i < 256; i++) expect(owner.writes(enc, 'cache')).toBeDefined();
    expect(owner.writes(enc, 'cache')).toBeUndefined();
    owner.resolve(enc, 'render')();
    await vi.waitFor(() => expect(owner.snapshot().samples.render.truncated).toBe(true));
  });
});
