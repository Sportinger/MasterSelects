import { describe, expect, it } from 'vitest';
import { createDefaultGlassDispersionGraph } from '../../src/services/operators/glassDispersionEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u * .3 + v * .7, .25 + v * .5];
const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
const clamp = (value: number) => Math.max(.001, Math.min(.999, value));
function reference(uv: [number, number], resolution: [number, number], time: number, scale: number, amount: number, speed: number): Rgba {
  const grid = Math.max(scale, 4), cell: [number, number] = [Math.floor(uv[0] * resolution[0] / grid), Math.floor(uv[1] * resolution[1] / grid)];
  const raw: [number, number] = [hash(cell) - .5 + .001, hash([cell[0] + 31, cell[1] + 31]) - .5 + .001];
  const length = Math.hypot(raw[0], raw[1]), direction: [number, number] = [raw[0] / length, raw[1] / length];
  const pulse = .6 + .4 * Math.sin(time * speed + hash(cell) * (Math.PI * 2));
  const offset: [number, number] = [direction[0] * amount * pulse * .025, direction[1] * amount * pulse * .025];
  const at = (x: number, y: number) => sample([clamp(x), clamp(y)]);
  return [at(uv[0] + offset[0], uv[1] + offset[1])[0], at(uv[0], uv[1])[1],
    at(uv[0] - offset[0], uv[1] - offset[1])[2], at(uv[0], uv[1])[3]];
}

describe('Glass Dispersion image graph', () => {
  it('uses the contextual owner with authoritative catalog defaults', () => {
    const effect: Effect = { id: 'glass', name: 'Glass Pixel Dispersion', type: 'glass-dispersion', enabled: true, params: {} };
    expect(isImageGraphEffectType(effect.type)).toBe(true);
    expect(isLocalImageEffectType(effect.type)).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject(getDefaultParams('glass-dispersion'));
    expect(effectOperatorGraph(effect)).toEqual({ ...createDefaultGlassDispersionGraph(), compositionRules: 2 });
  });

  it('uses generic normalize, shared hashes and four explicit channel/alpha samples', () => {
    const graph = createDefaultGlassDispersionGraph();
    expect(graph.nodes.filter(node => node.operator === 'vector.normalize.vec2')).toHaveLength(1);
    expect(graph.nodes.filter(node => node.operator === 'noise.hash2d.vec2')).toHaveLength(2);
    expect(graph.nodes.filter(node => node.operator === 'image.sample').map(node => node.id))
      .toEqual(['red-sample', 'green-sample', 'blue-sample', 'alpha-sample']);
    for (const id of ['scale', 'amount', 'speed'] as const) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
  });

  it('matches cell grid, facet hash, pulse, offset, clamps and center alpha', () => {
    const params = { scale: 7.5, amount: .8, speed: .35 }, plan = compileImageOperatorGraph(createDefaultGlassDispersionGraph(), params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'resolution', 'time', 'sample']));
    for (const context of [{ uv: [.002, .12] as [number, number], resolution: [64, 37] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.53, .71] as [number, number], resolution: [31, 19] as [number, number], timelineTimeSeconds: 1.25 },
      { uv: [.998, .97] as [number, number], resolution: [17, 9] as [number, number], timelineTimeSeconds: 4 }]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
    }
  });

  it('retains amount-zero dispersion and original-alpha semantics', () => {
    const params = { scale: 2, amount: 0, speed: 1 }, context = { uv: [.4, .33] as [number, number], resolution: [23, 11] as [number, number], timelineTimeSeconds: .75, sampleImage: sample };
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultGlassDispersionGraph(), params), [0, 0, 0, 0], context))
      .toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
  });
});
