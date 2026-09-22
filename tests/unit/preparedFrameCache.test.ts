import { describe, expect, it, vi } from 'vitest';
import { PreparedFrameCache, type PreparedFrameSource } from '../../src/effects/time/PreparedFrameCache';

const stamps = [{ time: 0.02, duration: 0.03 }, { time: 0.05, duration: 0.07 }, { time: 0.12, duration: 0.04 }];
const frame = (time: number) => ({ time, duration: stamps.find(stamp => stamp.time === time)!.duration,
  pixels: { width: 1, height: 1, data: new Uint8ClampedArray([Math.round(time * 100), 0, 0, 255]) } as ImageData });
function source(): PreparedFrameSource {
  return { frames: stamps, read: vi.fn(async time => frame(time)), close: vi.fn() };
}

describe('Prepared frame cache', () => {
  it('holds exact variable-duration source frames at trims and boundaries', async () => {
    const decoder = source(), cache = new PreparedFrameCache(decoder, 12, 4);
    const output = await cache.prepare([-1, 0.04, 0.05, 0.119, 0.12, 99]);
    expect(output.map(sample => [sample.time, sample.duration])).toEqual([
      [0.02, 0.03], [0.02, 0.03], [0.05, 0.07], [0.05, 0.07], [0.12, 0.04], [0.12, 0.04],
    ]);
    expect(decoder.read).toHaveBeenCalledTimes(3);
    expect(cache.status).toEqual({ state: 'ready', completed: 3, total: 3 });
  });

  it('returns identical pixels after a direct jump, sequential reads, and reverse requests', async () => {
    const direct = new PreparedFrameCache(source(), 8, 4), sequence = new PreparedFrameCache(source(), 8, 4);
    await sequence.prepare([0.02]);
    await sequence.prepare([0.05]);
    expect(await sequence.prepare([0.12, 0.05])).toEqual(await direct.prepare([0.12, 0.05]));
    expect(sequence.residentBytes).toBe(8);
    expect(await sequence.prepare([0.02])).toEqual([frame(0.02)]);
    expect(sequence.residentBytes).toBeLessThanOrEqual(8);
  });

  it('rejects oversized windows before decoding and never calls them ready', async () => {
    const decoder = source(), cache = new PreparedFrameCache(decoder, 8, 4);
    await expect(cache.prepare([0, 0.05, 1])).rejects.toThrow(/budget/);
    expect(decoder.read).not.toHaveBeenCalled();
    expect(cache.status.state).toBe('error');
    expect(cache.residentBytes).toBe(0);
  });

  it('cancels an in-flight decode without publishing its pixels or progress', async () => {
    const decoder = source();
    let release!: (value: ReturnType<typeof frame>) => void;
    decoder.read = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const cache = new PreparedFrameCache(decoder, 8, 4);
    const request = cache.prepare([0]);
    await Promise.resolve();
    cache.cancel();
    release(frame(0.02));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.status.state).toBe('cancelled');
    expect(cache.residentBytes).toBe(0);
  });

  it('serializes a superseding request behind the existing decoder operation', async () => {
    const decoder = source();
    let release!: (value: ReturnType<typeof frame>) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockImplementation(async (time: number) => frame(time));
    decoder.read = read;
    const cache = new PreparedFrameCache(decoder, 8, 4);
    const first = cache.prepare([0]);
    await Promise.resolve();
    const second = cache.prepare([0.05]);
    expect(read).toHaveBeenCalledTimes(1);
    release(frame(0.02));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(await second).toEqual([frame(0.05)]);
    expect(cache.status.state).toBe('ready');
  });

  it('handles caller abort, decoder failure and explicit lifetime release', async () => {
    const decoder = source(), cache = new PreparedFrameCache(decoder, 8, 4);
    const abort = new AbortController(); abort.abort();
    await expect(cache.prepare([0], abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.status.state).toBe('cancelled');
    decoder.read = vi.fn(async () => { throw new Error('Decode failed'); });
    await expect(cache.prepare([0])).rejects.toThrow('Decode failed');
    expect(cache.status).toMatchObject({ state: 'error', message: 'Decode failed' });
    cache.close(); cache.close();
    expect(decoder.close).toHaveBeenCalledTimes(1);
    expect(cache.residentBytes).toBe(0);
    await expect(cache.prepare([0])).rejects.toThrow(/closed/);
  });

  it('rejects missing PTS, incorrect decoder PTS and invalid pixel reservations', async () => {
    expect(() => new PreparedFrameCache({ ...source(), frames: [] }, 8, 4)).toThrow(/PTS/);
    expect(() => new PreparedFrameCache(source(), Infinity, 4)).toThrow(/budget/);
    const decoder = source();
    decoder.read = vi.fn(async () => frame(0.12));
    const cache = new PreparedFrameCache(decoder, 8, 4);
    await expect(cache.prepare([0])).rejects.toThrow(/wrong source frame/);
    decoder.read = vi.fn(async () => ({ ...frame(0.02), pixels: { width: 2, height: 1, data: new Uint8ClampedArray(8) } as ImageData }));
    await expect(cache.prepare([0])).rejects.toThrow(/pixel budget/);
    expect(cache.residentBytes).toBe(0);
  });
});
