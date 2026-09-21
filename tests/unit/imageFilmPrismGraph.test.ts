import { describe, expect, it } from 'vitest';
import { createDefaultFilmPrismGraph } from '../../src/services/operators/filmPrismEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u * .3 + v * .7, .2 + u * .6];
const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
function noise([x, y]: [number, number]) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y), ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const row0 = hash([ix, iy]) * (1 - ux) + hash([ix + 1, iy]) * ux;
  const row1 = hash([ix, iy + 1]) * (1 - ux) + hash([ix + 1, iy + 1]) * ux;
  return row0 * (1 - uy) + row1 * uy;
}
const clamp = (value: number) => Math.max(.001, Math.min(.999, value));
function reference(uv: [number, number], resolution: [number, number], time: number, amount: number, speed: number): Rgba {
  const center: [number, number] = [uv[0] - .5, uv[1] - .5], factor = .012 + .005 * Math.sin(time * speed);
  const radial: [number, number] = [center[0] * amount * factor, center[1] * amount * factor];
  const grain = (noise([uv[0] * resolution[0] + time, uv[1] * resolution[1] + time]) - .5) * .035;
  const at = (x: number, y: number) => sample([clamp(x), clamp(y)]);
  return [at(uv[0] + radial[0], uv[1] + radial[1])[0] + grain, at(uv[0], uv[1])[1] + grain,
    at(uv[0] - radial[0], uv[1] - radial[1])[2] + grain, at(uv[0], uv[1])[3]];
}

describe('Film Prism image graph', () => {
  it('uses the contextual owner with authoritative catalog defaults', () => {
    const effect: Effect = { id: 'film-prism', name: 'Film Prism', type: 'film-prism', enabled: true, params: {} };
    expect(isImageGraphEffectType(effect.type)).toBe(true);
    expect(isLocalImageEffectType(effect.type)).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject(getDefaultParams('film-prism'));
    expect(effectOperatorGraph(effect)).toEqual(createDefaultFilmPrismGraph());
  });

  it('expands common noise2d into four shared hashes and keeps four samples', () => {
    const graph = createDefaultFilmPrismGraph();
    expect(graph.nodes.filter(node => node.operator === 'noise.hash2d.vec2')).toHaveLength(4);
    expect(graph.nodes.filter(node => node.operator === 'image.sample').map(node => node.id))
      .toEqual(['red-sample', 'green-sample', 'blue-sample', 'alpha-sample']);
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    expect(graph.nodes.find(node => node.id === 'speed')?.bindings).toEqual({ value: 'speed' });
    expect(graph.nodes.some(node => node.operator.includes('film-prism'))).toBe(false);
  });

  it('matches radial order, nested value noise, clamp, grain and center alpha', () => {
    const params = { amount: .75, speed: .4 }, plan = compileImageOperatorGraph(createDefaultFilmPrismGraph(), params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'resolution', 'time', 'sample']));
    for (const context of [{ uv: [.002, .13] as [number, number], resolution: [64, 37] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.52, .71] as [number, number], resolution: [31, 19] as [number, number], timelineTimeSeconds: 1.25 },
      { uv: [.999, .98] as [number, number], resolution: [17, 9] as [number, number], timelineTimeSeconds: 3 }]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, params.amount, params.speed));
    }
  });

  it('retains amount-zero radial and deterministic grain behavior', () => {
    const context = { uv: [.3, .4] as [number, number], resolution: [23, 11] as [number, number], timelineTimeSeconds: .75, sampleImage: sample };
    const plan = compileImageOperatorGraph(createDefaultFilmPrismGraph(), { amount: 0, speed: 1 });
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], context)).toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, 0, 1));
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], context)).toEqual(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], context));
  });
});
