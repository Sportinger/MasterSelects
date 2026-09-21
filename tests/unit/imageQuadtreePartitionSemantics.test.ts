import { describe, expect, it, vi } from 'vitest';
import { partitionImageQuadtree } from '../../src/services/operators/imageQuadtreePartitionSemantics';

const base = { pixel: [37, 19] as const, resolution: [128, 96] as const, scale: 2,
  threshold: .025, timelineTimeSeconds: 0, speed: .5 };

describe('image Quadtree partition semantics', () => {
  it('stops after the exact five-load constant block test', () => {
    const loadPixel = vi.fn(() => [0.25, 0.25, 0.25, 1] as const);
    expect(partitionImageQuadtree({ ...base, loadPixel })).toEqual({ origin: [0, 0], size: 64 });
    expect(loadPixel.mock.calls.map(call => call[0])).toEqual([[0, 0], [63, 0], [0, 63], [63, 63], [32, 32]]);
  });

  it('runs to minimum size for persistent variance and uses nearest-even scale rounding', () => {
    const loadPixel = vi.fn(([x, y]: readonly [number, number]) => ((x + y) & 1) ? [1, 1, 1, 1] as const : [0, 0, 0, 1] as const);
    const result = partitionImageQuadtree({ ...base, scale: 2.5, threshold: 0, loadPixel });
    expect(result).toEqual({ origin: [36, 18], size: 2 });
    expect(loadPixel).toHaveBeenCalledTimes(25);
  });

  it('clamps the ordered corner and center loads at raster edges', () => {
    const loadPixel = vi.fn(() => [0, 0, 0, 1] as const);
    partitionImageQuadtree({ ...base, pixel: [7, 7], resolution: [8, 8], loadPixel });
    expect(loadPixel.mock.calls.map(call => call[0])).toEqual([[0, 0], [7, 0], [0, 7], [7, 7], [7, 7]]);
  });

  it('fails closed for invalid frame context and loader output', () => {
    const loadPixel = () => [0, 0, 0, 1] as const;
    expect(() => partitionImageQuadtree({ ...base, resolution: [0, 8], loadPixel })).toThrow(/resolution/);
    expect(() => partitionImageQuadtree({ ...base, pixel: [-1, 0], loadPixel })).toThrow(/in-bounds/);
    expect(() => partitionImageQuadtree({ ...base, timelineTimeSeconds: Number.NaN, loadPixel })).toThrow(/timeline time/);
    expect(() => partitionImageQuadtree({ ...base, scale: Number.MAX_VALUE, loadPixel })).toThrow(/finite f32/);
    expect(() => partitionImageQuadtree({ ...base, scale: 100_000_000, loadPixel })).toThrow(/i32 block-size/);
    expect(() => partitionImageQuadtree({ ...base, resolution: [2_147_483_648, 8], loadPixel })).toThrow(/resolution/);
    expect(() => partitionImageQuadtree({ ...base, timelineTimeSeconds: 2e38, speed: 2, loadPixel })).toThrow(/overflow f32/);
    expect(() => partitionImageQuadtree({ ...base, loadPixel: () => [0, Number.NaN, 0, 1] as const })).toThrow(/four finite channels/);
  });
});
