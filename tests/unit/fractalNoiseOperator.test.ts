import { describe, expect, it } from 'vitest';
import { evaluateFractalNoise2d, fractalNoiseOctaves, IMAGE_FRACTAL_NOISE_WGSL } from '../../src/services/operators/imageNoiseSemantics';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/** Pearson correlation of paired samples. */
function correlation(a: number[], b: number[]): number {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma = mean(a), mb = mean(b);
  let cov = 0, va = 0, vb = 0;
  for (let index = 0; index < a.length; index += 1) { cov += (a[index] - ma) * (b[index] - mb); va += (a[index] - ma) ** 2; vb += (b[index] - mb) ** 2; }
  return cov / Math.sqrt(va * vb);
}

describe('Fractal Noise operator', () => {
  it('stays in 0..1 around a 0.5 mean and changes smoothly', () => {
    const values: number[] = [];
    for (let y = 0; y < 60; y += 1) for (let x = 0; x < 60; x += 1) values.push(evaluateFractalNoise2d([x * 0.37 + 0.11, y * 0.41 + 0.07], 4, 0.6));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBeCloseTo(0.5, 1);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.3);
    for (const [x, y] of [[3.3, 7.7], [120.25, -40.5], [5e4 + 0.3, 7e4 + 0.6]]) {
      expect(Math.abs(evaluateFractalNoise2d([x + 1e-3, y], 3, 0.5) - evaluateFractalNoise2d([x, y], 3, 0.5))).toBeLessThan(0.01);
    }
  });

  it('shows no lattice streaks at large positions (cells two apart are uncorrelated)', () => {
    // A sine hash turns into diagonal stripes once its argument is large; the integer hash must not.
    for (const origin of [0, 1e4, 3e5]) {
      const here: number[] = [], diagonal: number[] = [], across: number[] = [];
      for (let y = 0; y < 40; y += 1) for (let x = 0; x < 40; x += 1) {
        const px = origin + x * 4 + 0.5, py = origin + y * 4 + 0.5;
        here.push(evaluateFractalNoise2d([px, py], 1, 0));
        diagonal.push(evaluateFractalNoise2d([px + 2, py + 2], 1, 0));
        across.push(evaluateFractalNoise2d([px + 2, py - 2], 1, 0));
      }
      expect(Math.abs(correlation(here, diagonal)), `origin ${origin}`).toBeLessThan(0.15);
      expect(Math.abs(correlation(here, across)), `origin ${origin}`).toBeLessThan(0.15);
    }
  });

  it('clamps octaves to 1..8 and roughness to 0..1, and reads non-finite inputs as defaults', () => {
    const at: [number, number] = [12.3, 4.56];
    expect(fractalNoiseOctaves(0)).toBe(1);
    expect(fractalNoiseOctaves(Number.NaN)).toBe(1);
    expect(fractalNoiseOctaves(3.9)).toBe(3);
    expect(fractalNoiseOctaves(40)).toBe(8);
    expect(evaluateFractalNoise2d(at, -2, 0.5)).toBe(evaluateFractalNoise2d(at, 1, 0.5));
    expect(evaluateFractalNoise2d(at, 99, 0.5)).toBe(evaluateFractalNoise2d(at, 8, 0.5));
    expect(evaluateFractalNoise2d(at, 4, 7)).toBe(evaluateFractalNoise2d(at, 4, 1));
    expect(evaluateFractalNoise2d(at, 4, Number.NaN)).toBe(evaluateFractalNoise2d(at, 4, 0));
    expect(evaluateFractalNoise2d([Number.NaN, Number.POSITIVE_INFINITY], 2, 0.5)).toBe(evaluateFractalNoise2d([0, 0], 2, 0.5));
    // Roughness 0 keeps only the first octave.
    expect(evaluateFractalNoise2d(at, 6, 0)).toBe(evaluateFractalNoise2d(at, 1, 0.9));
  });

  it('is a registered image node whose shader shares the CPU octave constants', () => {
    expect(getEffectOperator('noise.fractal2d.vec2')).toMatchObject({ label: 'Fractal Noise', addable: true });
    const turn = 37.5 * Math.PI / 180;
    expect(IMAGE_FRACTAL_NOISE_WGSL).toContain(`mat2x2f(${Math.cos(turn).toPrecision(9)}, ${Math.sin(turn).toPrecision(9)}, ${(-Math.sin(turn)).toPrecision(9)}`);
    expect(IMAGE_FRACTAL_NOISE_WGSL).toContain('vec2f(19.19, 7.73)');
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, edges: [
      { id: 'a', from: 'uv', output: 'uv', to: 'noise', input: 'value' }, { id: 'b', from: 'octaves', output: 'value', to: 'noise', input: 'octaves' },
      { id: 'c', from: 'roughness', output: 'value', to: 'noise', input: 'roughness' }, { id: 'd', from: 'noise', output: 'value', to: 'rgb', input: 'value' },
      { id: 'e', from: 'rgb', output: 'rgb', to: 'rgba', input: 'rgb' }, { id: 'f', from: 'frame', output: 'image', to: 'split', input: 'image' },
      { id: 'g', from: 'split', output: 'alpha', to: 'rgba', input: 'alpha' }, { id: 'h', from: 'rgba', output: 'image', to: 'output', input: 'image' }],
    nodes: [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} }, { id: 'uv', operator: 'image.normalized-uv', operatorVersion: 1, bindings: {} },
      { id: 'octaves', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 3 } },
      { id: 'roughness', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0.5 } },
      { id: 'noise', operator: 'noise.fractal2d.vec2', operatorVersion: 1, bindings: {} }, { id: 'rgb', operator: 'convert.scalar-to-rgb', operatorVersion: 1, bindings: {} },
      { id: 'split', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} }, { id: 'rgba', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }] };
    const plan = compileImageOperatorGraph(graph, {}, {});
    expect(plan.wgsl).toContain('imageGraphFractalNoise(');
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [0.3, 0.7], resolution: [8, 8], timelineTimeSeconds: 0, sampleImage: () => [0, 0, 0, 1] });
    expect(result[0]).toBeCloseTo(evaluateFractalNoise2d([0.3, 0.7], 3, 0.5), 9);
    expect(result[3]).toBe(1);
  });
});
