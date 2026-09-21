import { describe, expect, it } from 'vitest';
import { holo } from '../../src/effects/analog';
import { createDefaultHoloGraph } from '../../src/services/operators/holoEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u * u, v * v, u * v, .2 + .6 * u];
const luma = ([r, g, b]: Rgba) => r * .2126 + g * .7152 + b * .0722;
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

function reference(uv: [number, number], time: number, params: { amount: number; speed: number }): Rgba {
  const centers: [number, number][] = [[.125, .125], [.375, .125], [.125, .375], [.375, .375]];
  const values = centers.map(point => luma(sample(point))), gradient = [values[1] - values[0], values[2] - values[0]];
  const color = sample(uv), phase = uv[0] * 12 + uv[1] * 19 + time * params.speed * 2;
  const interference = .5 + .5 * Math.sin(phase + Math.sin(phase * .37) * 3);
  const a = [34 / 255, 211 / 255, 238 / 255], b = [244 / 255, 114 / 255, 182 / 255];
  const spectrum = a.map((value, index) => mix(value, b[index], interference)), edge = Math.hypot(...gradient) * 8;
  return [0, 1, 2].map(index => mix(color[index], color[index] * .55 + spectrum[index] * (.3 + edge), params.amount)).concat(color[3]) as Rgba;
}

describe('Holo image graph', () => {
  it('binds only the catalog parameters used by the legacy shader', () => {
    const graph = createDefaultHoloGraph();
    expect(graph.nodes.find(node => node.id === 'scale')).toBeUndefined();
    for (const [nodeId, parameterId] of [['amount', 'amount'], ['speed', 'speed'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    expect(graph.nodes.find(node => node.id === 'luminance-derivative')?.operator).toBe('image.derivative.auto.scalar');
  });

  it('matches the legacy formula with an explicit coarse CPU derivative policy', () => {
    const params = { amount: .73, speed: 1.4, colorA: '#22d3ee', colorB: '#f472b6' }, time = .65;
    const plan = compileImageOperatorGraph(createDefaultHoloGraph(), params, { parameterSchema: holo.params });
    const context = { uv: [.375, .375] as [number, number], resolution: [4, 4] as [number, number], pixelCoordinate: [1, 1] as [number, number],
      derivativeAutoMode: 'coarse' as const, timelineTimeSeconds: time, sampleImage: sample };
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], context), expected = reference(context.uv, time, params);
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
    expect(actual[3]).toBe(sample(context.uv)[3]);
  });
});
