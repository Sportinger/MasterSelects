import { describe, expect, it } from 'vitest';
import { BlurGraphBuilder } from '../../src/services/operators/blurGraphBuilder';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imageCellHash } from '../../src/services/operators/imageOperatorEvaluation';
import { CACHE_IMAGE_MIN_SCALE, cacheImageScale, imageResourceSize } from '../../src/services/operators/imageResourceScale';
import { IMAGE_CELL_HASH_WGSL } from '../../src/services/operators/imageOperatorWgsl';

/** Frame → Cache Image (Resolution) → read back at UV. */
function cachedGraph(constants?: Record<string, string>, bindings: Record<string, string> = {}) {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv');
  g.add('cache', 'image.materialize', { image: ['frame', 'image'] }, { bindings, ...(constants ? { constants } : {}) });
  g.add('read', 'image.sample', { image: ['cache', 'image'], uv: ['uv', 'uv'] });
  g.add('output', 'image.output', { image: ['read', 'image'] });
  return g.graph();
}

describe('Cache Image Resolution', () => {
  it('reads the Resolution constant: Full or missing is full size, fractions down to 1/1024, nonsense is an error', () => {
    expect(cacheImageScale(undefined)).toBeUndefined();
    expect(cacheImageScale({})).toBeUndefined();
    expect(cacheImageScale({ scale: '1' })).toBeUndefined();
    expect(cacheImageScale({ scale: 4 })).toBeUndefined();
    expect(cacheImageScale({ scale: '0.25' })).toBe(0.25);
    expect(cacheImageScale({ scale: 1 / 8192 })).toBe(CACHE_IMAGE_MIN_SCALE);
    for (const scale of ['abc', 0, -0.5, Number.NaN, Infinity]) expect(() => cacheImageScale({ scale })).toThrow(/not a positive number/);
  });

  it('sizes pass resources by Resolution and the motion-analysis edge cap, rounded and at least one pixel', () => {
    expect(imageResourceSize(undefined, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(imageResourceSize({ scale: 0.5 }, 1921, 1081)).toEqual({ width: 961, height: 541 });
    expect(imageResourceSize({ scale: 1 / 1024 }, 1920, 1080)).toEqual({ width: 2, height: 1 });
    expect(imageResourceSize({ maxEdge: 480 }, 1920, 1080)).toEqual({ width: 480, height: 270 });
    // The smaller of both wins.
    expect(imageResourceSize({ maxEdge: 960, scale: 0.25 }, 1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(imageResourceSize({ maxEdge: 240, scale: 0.5 }, 1920, 1080)).toEqual({ width: 240, height: 135 });
  });

  it('puts the scale into the plan resource and key, and refuses a Resolution bound to a parameter', () => {
    const full = compileImageOperatorGraph(cachedGraph(), {}), half = compileImageOperatorGraph(cachedGraph({ scale: '0.5' }), {});
    const quarter = compileImageOperatorGraph(cachedGraph({ scale: '0.25' }), {});
    expect(full.resources).toHaveLength(1);
    expect(full.resources![0].scale).toBeUndefined();
    expect(half.resources![0].scale).toBe(0.5);
    expect(new Set([full.key, half.key, quarter.key]).size).toBe(3);
    expect(compileImageOperatorGraph(cachedGraph({ scale: '1' }), {}).key).toBe(full.key);
    expect(() => compileImageOperatorGraph(cachedGraph(undefined, { scale: 'radius' }), { radius: 0.5 })).toThrow(/fixed setting/);
  });
});

/** Independent PCG2D (Jarzynski & Olano 2020) in BigInt arithmetic modulo 2^32. */
function referencePcg2d(x: number, y: number): number {
  const mask = (1n << 32n) - 1n, a = 1664525n, c = 1013904223n;
  const u32 = (value: number) => BigInt.asUintN(32, BigInt(Math.floor(value)));
  let vx = (u32(x) * a + c) & mask, vy = (u32(y) * a + c) & mask;
  vx = (vx + vy * a) & mask; vy = (vy + vx * a) & mask;
  vx ^= vx >> 16n; vy ^= vy >> 16n;
  vx = (vx + vy * a) & mask; vy = (vy + vx * a) & mask;
  vx ^= vx >> 16n;
  return Number(vx >> 8n) / 16777216;
}

describe('Random (Cell)', () => {
  const cells: [number, number][] = [[0, 0], [1, 0], [0, 1], [37, -12], [-1, -1], [-4096, 4095], [123456, 654321], [2 ** 24 - 1, 7919], [-(2 ** 30), 2 ** 30]];

  it('is PCG2D of the whole-number cell, also for negative and large cells', () => {
    for (const [x, y] of cells) expect(imageCellHash([x, y]), `${x},${y}`).toBe(referencePcg2d(x, y));
    // Rounds down: every point of a cell gets its value.
    expect(imageCellHash([3.99, -0.01])).toBe(referencePcg2d(3, -1));
    // Uniform 0..1 with exact 24-bit steps.
    const values = Array.from({ length: 4096 }, (_, index) => imageCellHash([index % 64, Math.floor(index / 64)]));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0); expect(Math.max(...values)).toBeLessThan(1);
    expect(Math.abs(values.reduce((sum, value) => sum + value, 0) / values.length - 0.5)).toBeLessThan(0.02);
    for (const value of values) expect(Number.isInteger(value * 16777216)).toBe(true);
  });

  it('compiles to the shared WGSL hash with the same constants, and the CPU twin evaluates the node', () => {
    const g = new BlurGraphBuilder();
    g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
    const pixel = g.binary('pixel', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
    const hash = g.unary('hash', 'noise.cell-hash.vec2', pixel);
    const split = g.add('split', 'vector.split.rgba', { image: ['frame', 'image'] });
    const rgb = g.add('rgb', 'convert.scalar-to-rgb', { value: hash });
    g.add('combine', 'vector.combine.rgba', { rgb: [rgb, 'rgb'], alpha: [split, 'alpha'] });
    g.add('output', 'image.output', { image: ['combine', 'image'] });
    const plan = compileImageOperatorGraph(g.graph(), {});
    expect(plan.wgsl).toContain(IMAGE_CELL_HASH_WGSL);
    expect(plan.wgsl).toMatch(/imageGraphCellHash\(v\d+\)/);
    expect(IMAGE_CELL_HASH_WGSL).toContain('1664525u');
    expect(IMAGE_CELL_HASH_WGSL).toContain('1013904223u');
    expect(IMAGE_CELL_HASH_WGSL).toContain('bitcast<vec2u>(vec2i(floor(p)))');
    for (const [x, y] of [[0, 0], [17, 4], [63, 35]]) {
      const value = evaluateImageOperatorPlan(plan, [0.2, 0.2, 0.2, 1], { uv: [(x + 0.5) / 64, (y + 0.5) / 36], resolution: [64, 36] });
      expect(value[0]).toBe(referencePcg2d(x, y));
    }
  });
});
