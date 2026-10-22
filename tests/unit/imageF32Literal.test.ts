import { describe, expect, it } from 'vitest';
import { BlurGraphBuilder } from '../../src/services/operators/blurGraphBuilder';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { imageF32 } from '../../src/services/operators/imageOperatorWgsl';

// WGSL decimal float literals (WGSL spec, decimal_float_literal), with an optional leading minus.
const WGSL_FLOAT = /^-?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+\.\d*(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/;

describe('image graph f32 literals', () => {
  it('writes valid WGSL for every magnitude, also the ones JavaScript prints with an exponent', () => {
    for (const value of [0, -0, 1, -3, 0.5, 1e-6, 1.5e-7, 1e20, 1e21, -1e30, 3.4e38, Math.PI]) {
      expect(imageF32(value), String(value)).toMatch(WGSL_FLOAT);
      expect(Number(imageF32(value))).toBe(Object.is(value, -0) ? 0 : value);
    }
    expect(imageF32(-1e30)).toBe('-1e+30');
    expect(imageF32(2)).toBe('2.0');
  });

  it('refuses values a 32-bit float cannot hold instead of emitting broken WGSL', () => {
    for (const value of [Infinity, -Infinity, NaN, 1e39]) expect(() => imageF32(value)).toThrow(/32-bit float/);
  });

  it('compiles a -1e30 sentinel constant into a valid literal', () => {
    const g = new BlurGraphBuilder();
    g.add('frame', 'image.frame');
    const split = g.add('split', 'vector.split.rgba', { image: ['frame', 'image'] });
    const sentinel = g.number('sentinel', -1e30);
    const alpha = g.add('alpha', 'convert.alpha-to-scalar', { alpha: [split, 'alpha'] });
    const safe = g.binary('safe', 'math.max.scalar', alpha, sentinel);
    const rgb = g.add('rgb', 'convert.scalar-to-rgb', { value: safe });
    g.add('combine', 'vector.combine.rgba', { rgb: [rgb, 'rgb'], alpha: [split, 'alpha'] });
    g.add('output', 'image.output', { image: ['combine', 'image'] });
    const { wgsl } = compileImageOperatorGraph(g.graph(), {});
    expect(wgsl).toContain('-1e+30');
    expect(wgsl).not.toMatch(/e[+-]\d+\.0/);
  });
});
