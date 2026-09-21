import { describe, expect, it } from 'vitest';
import { createDefaultGlitchGraph } from '../../src/services/operators/glitchEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u * .25 + v * .75, .2 + v * .6];
const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
const clamp = (value: number) => Math.max(.001, Math.min(.999, value));

function reference(uv: [number, number], time: number, params: { scale: number; amount: number; speed: number }): Rgba {
  const tick = Math.floor(time * params.speed * 12), band = Math.floor(uv[1] * Math.max(params.scale, 4));
  const enabled = hash([band, tick]) >= .76 ? 1 : 0;
  const shift = (hash([tick, band + 3]) - .5) * params.amount * enabled * .16, channel = .004 * params.amount;
  const at = (offset: number) => sample([clamp(uv[0] + offset), clamp(uv[1])]);
  return [at(shift + channel)[0], at(shift)[1], at(shift - channel)[2], at(0)[3]];
}

describe('Glitch image graph', () => {
  it('is registered with catalog-owned parameter defaults', () => {
    expect(isImageGraphEffectType('glitch')).toBe(true);
    expect(effectOperatorGraph({ type: 'glitch', params: {} })).toEqual({ ...createDefaultGlitchGraph(), compositionRules: 2 });
    expect(effectOperatorParams({ type: 'glitch', params: {} })).toMatchObject({ scale: 14, amount: .75, speed: 1 });
  });

  it('reuses the canonical hash operator and four explicit channel/alpha samples', () => {
    const graph = createDefaultGlitchGraph();
    expect(graph.nodes.filter(node => node.operator === 'noise.hash2d.vec2')).toHaveLength(2);
    expect(graph.nodes.filter(node => node.operator === 'image.sample').map(node => node.id))
      .toEqual(['red-sample', 'green-sample', 'blue-sample', 'alpha-sample']);
    for (const id of ['scale', 'amount', 'speed'] as const) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.some(node => node.operator.includes('glitch'))).toBe(false);
  });

  it('matches tick, band, shared hash, threshold and channel offsets', () => {
    const params = { scale: 9.5, amount: .8, speed: .35 }, plan = compileImageOperatorGraph(createDefaultGlitchGraph(), params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'time', 'sample']));
    for (const context of [{ uv: [.002, .12] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.53, .71] as [number, number], timelineTimeSeconds: 1.25 }, { uv: [.998, .97] as [number, number], timelineTimeSeconds: 4 }]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.timelineTimeSeconds, params));
    }
  });

  it('keeps amount-zero RGB and original-alpha sampling semantics', () => {
    const params = { scale: 2, amount: 0, speed: 1 }, context = { uv: [1, .4] as [number, number], timelineTimeSeconds: .5, sampleImage: sample };
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultGlitchGraph(), params), [0, 0, 0, 0], context))
      .toEqual(reference(context.uv, context.timelineTimeSeconds, params));
  });
});
