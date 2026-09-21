import { describe, expect, it, vi } from 'vitest';
import { voronoi } from '../../src/effects/geometry';

describe('compute effect timeline clock', () => {
  it('packs explicit composition time and deterministically defaults invalid or omitted time to zero', () => {
    const wallClock = vi.spyOn(performance, 'now');
    wallClock.mockReturnValueOnce(1_000).mockReturnValueOnce(9_000);

    const explicit = voronoi.packUniforms({}, 64, 37, 2.75);
    const omittedAtFirstWallClock = voronoi.packUniforms({}, 64, 37);
    const omittedAtSecondWallClock = voronoi.packUniforms({}, 64, 37);
    const invalid = voronoi.packUniforms({}, 64, 37, Number.NaN);

    expect(explicit?.[5]).toBe(2.75);
    expect(omittedAtFirstWallClock?.[5]).toBe(0);
    expect(omittedAtSecondWallClock).toEqual(omittedAtFirstWallClock);
    expect(invalid?.[5]).toBe(0);
    expect(wallClock).not.toHaveBeenCalled();

    wallClock.mockRestore();
  });
});
