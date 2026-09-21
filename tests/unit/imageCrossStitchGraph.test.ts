import { describe, expect, it } from 'vitest';
import { createDefaultCrossStitchGraph } from '../../src/services/operators/crossStitchEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, .2 + u * .4, .3 + v * .4];
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (value: number) => value - Math.floor(value);

describe('Cross Stitch image graph', () => {
  it('is bounded and uses reusable operators with catalog bindings', () => {
    const graph = createDefaultCrossStitchGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    for (const id of ['amount', 'scale']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.some(node => node.operator.includes('cross-stitch'))).toBe(false);
  });

  it('matches legacy stitch geometry, source clamp, ink ordering and sampled alpha', () => {
    const params = { amount: .76, scale: 12, colorA: '#4080c0', colorB: '#e0d0b0' }, uv: [number, number] = [1, .37], resolution: [number, number] = [53, 31];
    const sampled = sample([.999, uv[1]]), cell: [number, number] = [fract(uv[0] * resolution[0] / Math.max(params.scale, 3)) - .5, fract(uv[1] * resolution[1] / Math.max(params.scale, 3)) - .5];
    const line = Math.min(Math.abs(cell[0] - cell[1]), Math.abs(cell[0] + cell[1]));
    const stitch = (1 - smoothstep(.04, .1, line)) * (Math.hypot(...cell) <= .62 ? 1 : 0);
    const a = [0x40 / 255, 0x80 / 255, 0xc0 / 255], b = [0xe0 / 255, 0xd0 / 255, 0xb0 / 255];
    const expected = [0, 1, 2].map(index => mix(sampled[index], mix(b[index], sampled[index] * a[index], stitch), params.amount));
    const plan = compileImageOperatorGraph(createDefaultCrossStitchGraph(), params), actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, sampleImage: sample });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 12));
    expect(actual[3]).toBe(sampled[3]);
  });
});
