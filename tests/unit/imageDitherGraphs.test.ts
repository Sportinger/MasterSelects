import { describe, expect, it } from 'vitest';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { dither, ditherStudio } from '../../src/effects/halftone';
import { createDefaultDitherGraph } from '../../src/services/operators/ditherEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const sample = ([u, v]: [number, number]): [number, number, number, number] => [u, v, u * .3 + v * .2, .2 + u * .6];
const table = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const fract = (value: number) => value - Math.floor(value);
const bayer4 = ([x, y]: [number, number]) => (table[(Math.max(0, Math.floor(y)) % 4) * 4 + Math.max(0, Math.floor(x)) % 4] + .5) / 16;
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

describe('Dither image graphs', () => {
  it.each(['dither', 'dither-studio'] as const)('binds %s to catalog-owned parameters', type => {
    const graph = createDefaultDitherGraph(type);
    for (const id of ['scale', 'amount']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.find(node => node.id === 'kernel')?.bindings).toEqual(type === 'dither-studio' ? { value: 'kernel' } : undefined);
  });

  it('matches the four-level Bayer quantization order', () => {
    const params = { scale: 3, amount: .72 }, uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37];
    const color = sample(uv), threshold = bayer4([uv[0] * resolution[0] / Math.max(params.scale, 1), uv[1] * resolution[1] / Math.max(params.scale, 1)]);
    const expected = color.slice(0, 3).map(value => mix(value, Math.floor(Math.min(.999, Math.max(0, value + threshold - .5)) * 4) / 3, params.amount)).concat(color[3]);
    const actual = evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultDitherGraph('dither'), params), [0, 0, 0, 0], { uv, resolution, sampleImage: sample });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
  });

  it.each(['bayer-2', 'bayer-4', 'checker'] as const)('matches Dither Studio %s selection', kernel => {
    const params = { scale: 14, amount: .67, kernel, colorA: '#111827', colorB: '#f8fafc' };
    const uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37], color = sample(uv), pixel: [number, number] = [uv[0] * 64, uv[1] * 37];
    const threshold = kernel === 'bayer-2' ? fract(Math.floor(pixel[0]) * .5 + Math.floor(pixel[1]) * .75)
      : kernel === 'checker' ? (fract(pixel[0] / params.scale) > .5 ? .75 : .25)
        : bayer4([pixel[0] / Math.max(params.scale * .35, 1), pixel[1] / Math.max(params.scale * .35, 1)]);
    const tone = color[0] * .2126 + color[1] * .7152 + color[2] * .0722, bit = tone >= threshold ? 1 : 0;
    const a = colorToRgba(params.colorA, params.colorA), b = colorToRgba(params.colorB, params.colorB);
    const expected = color.slice(0, 3).map((value, index) => mix(value, mix(a[index], b[index], bit), params.amount)).concat(color[3]);
    const plan = compileImageOperatorGraph(createDefaultDitherGraph('dither-studio'), params, { parameterSchema: ditherStudio.params });
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, sampleImage: sample });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
    expect(dither.params.scale.default).toBe(3);
  });
});
