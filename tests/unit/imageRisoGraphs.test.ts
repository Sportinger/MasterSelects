import { describe, expect, it } from 'vitest';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { riso, risoGlow } from '../../src/effects/halftone';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultRisoGraph } from '../../src/services/operators/risoEffectGraphs';

const sample = ([u, v]: [number, number]): [number, number, number, number] => [u, v, u * .3 + v * .2, .2 + u * .6];
const luma = (value: readonly number[]) => value[0] * .2126 + value[1] * .7152 + value[2] * .0722;
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

describe('Riso image graphs', () => {
  it.each([['riso', riso], ['riso-glow', risoGlow]] as const)('binds %s to catalog-owned parameters', (type) => {
    const graph = createDefaultRisoGraph(type);
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['amount', 'amount'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    expect(graph.nodes.find(node => node.id === 'speed')?.bindings).toEqual(type === 'riso-glow' ? { value: 'speed' } : undefined);
  });

  it.each([['riso', riso], ['riso-glow', risoGlow]] as const)('matches the %s legacy operation order', (type, definition) => {
    const params = { scale: 8, amount: .7, speed: 1.3, colorA: definition.params.colorA.default as string, colorB: definition.params.colorB.default as string };
    const uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37], time = .75, offset = params.scale / resolution[0] * .35;
    const color = sample(uv), a = 1 - luma(sample([uv[0] - offset, uv[1]])), b = 1 - luma(sample([uv[0] + offset, uv[1]]));
    const colorA = colorToRgba(params.colorA, params.colorA), colorB = colorToRgba(params.colorB, params.colorB), paper = [.96, .93, .85];
    const glow = type === 'riso-glow' ? .55 + .45 * Math.sin(time * params.speed * 2) : 0;
    const expected = [0, 1, 2].map(index => { const subtractive = paper[index] * (1 - a * colorA[index]) * (1 - b * colorB[index]);
      return mix(color[index], subtractive + glow * (a * colorA[index] + b * colorB[index]) * .3, params.amount); }).concat(color[3]);
    const plan = compileImageOperatorGraph(createDefaultRisoGraph(type), params, { parameterSchema: definition.params });
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, timelineTimeSeconds: time, sampleImage: sample });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
  });
});
