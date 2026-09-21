import { describe, expect, it } from 'vitest';
import { createDefaultCrystalGraph } from '../../src/services/operators/crystalEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u * .3 + v * .7, .25 + u * .5];
const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
const clamp = (value: number) => Math.max(.001, Math.min(.999, value));
function reference(uv: [number, number], time: number, scale: number, amount: number, speed: number): Rgba {
  const cells = Math.max(scale, 4), grid: [number, number] = [uv[0] * cells, uv[1] * cells];
  const id: [number, number] = [Math.floor(grid[0]), Math.floor(grid[1])], local: [number, number] = [fract(grid[0]) - .5, fract(grid[1]) - .5];
  const raw: [number, number] = [hash(id) - .5 + .001, hash([id[0] + 13.7, id[1] + 13.7]) - .5 + .001];
  const length = Math.hypot(raw[0], raw[1]), facet: [number, number] = [raw[0] / length, raw[1] / length];
  const projection = local[0] * facet[0] + local[1] * facet[1];
  const refraction: [number, number] = [facet[0] * projection * amount * .08, facet[1] * projection * amount * .08];
  const shimmer = Math.sin(time * speed + hash(id) * (Math.PI * 2)) * .003;
  return sample([clamp(uv[0] + refraction[0] + shimmer), clamp(uv[1] + refraction[1] + shimmer)]);
}

describe('Crystal image graph', () => {
  it('uses the contextual owner with authoritative catalog defaults', () => {
    const effect: Effect = { id: 'crystal', name: 'Crystal Glass', type: 'crystal', enabled: true, params: {} };
    expect(isImageGraphEffectType(effect.type)).toBe(true);
    expect(isLocalImageEffectType(effect.type)).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject(getDefaultParams('crystal'));
    expect(effectOperatorGraph(effect)).toEqual({ ...createDefaultCrystalGraph(), compositionRules: 2 });
  });

  it('uses the agreed generic normalize contract, shared hash and one RGBA sample', () => {
    const graph = createDefaultCrystalGraph();
    expect(graph.nodes.filter(node => node.operator === 'vector.normalize.vec2')).toHaveLength(1);
    expect(graph.nodes.filter(node => node.operator === 'noise.hash2d.vec2')).toHaveLength(2);
    expect(graph.nodes.filter(node => node.operator === 'image.sample')).toHaveLength(1);
    for (const id of ['scale', 'amount', 'speed'] as const) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
  });

  it('matches legacy cell, facet, projection, shimmer, clamp and alpha order', () => {
    const params = { scale: 7.5, amount: .8, speed: .35 }, plan = compileImageOperatorGraph(createDefaultCrystalGraph(), params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'time', 'sample']));
    for (const context of [{ uv: [.002, .12] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.53, .71] as [number, number], timelineTimeSeconds: 1.25 }, { uv: [.998, .97] as [number, number], timelineTimeSeconds: 4 }]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
    }
  });

  it('retains amount-zero refraction while shimmer remains animated', () => {
    const params = { scale: 2, amount: 0, speed: 1 }, context = { uv: [.4, .33] as [number, number], timelineTimeSeconds: .75, sampleImage: sample };
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultCrystalGraph(), params), [0, 0, 0, 0], context))
      .toEqual(reference(context.uv, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
  });
});
