import { describe, expect, it } from 'vitest';
import { createDefaultPixelPosterGraph } from '../../src/services/operators/pixelPosterEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u * .25 + v * .5, .2 + u * .7];
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

describe('Pixel Poster image graph', () => {
  it('uses only reusable sampling and math operators with catalog parameter bindings', () => {
    const graph = createDefaultPixelPosterGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(64);
    expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    expect(graph.nodes.filter(node => node.operator === 'image.sample')).toHaveLength(1);
    expect(graph.nodes.some(node => node.operator.includes('pixel-poster'))).toBe(false);
  });

  it('matches the legacy pixel-center order, source clamp, posterization and sampled alpha', () => {
    const params = { amount: .64, scale: 11 }, uv: [number, number] = [.03, .97], resolution: [number, number] = [47, 29];
    const grid = Math.max(params.scale, 2), sampledUv: [number, number] = [0, 1].map(axis => {
      const value = (Math.floor(uv[axis] * resolution[axis] / grid) + .5) * grid / resolution[axis];
      return Math.max(.001, Math.min(.999, value));
    }) as [number, number];
    const color = sample(sampledUv), poster = color.slice(0, 3).map(channel => Math.floor(channel * 5) / 4);
    const expected: Rgba = [mix(color[0], poster[0], params.amount), mix(color[1], poster[1], params.amount),
      mix(color[2], poster[2], params.amount), color[3]];
    const plan = compileImageOperatorGraph(createDefaultPixelPosterGraph(), params);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, sampleImage: sample })).toEqual(expected);
  });
});
