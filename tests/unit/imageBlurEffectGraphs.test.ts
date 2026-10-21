import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { separableBlurTaps } from '../../src/effects/blur/blurSampling';
import { createDefaultBoxBlurGraph, createDefaultGaussianBlurGraph, createDefaultSharpenGraph } from '../../src/services/operators/blurEffectGraphs';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { evaluateImagePasses, type Pixel } from '../helpers/imageGraphPasses';
const connection = (graph: ReturnType<typeof createDefaultBoxBlurGraph>, from: string, to: string, input: string) =>
  graph.edges.some(edge => edge.from === from && edge.to === to && edge.input === input);

/** Smooth straight-alpha test image with transparent and opaque regions. */
const source = ([u, v]: [number, number]): Pixel => [0.5 + 0.4 * Math.sin(u * 23), 0.5 + 0.4 * Math.cos(v * 17), (u + v) % 1,
  Math.min(1, Math.max(0, 1.6 * Math.sin(u * 7 + v * 3)))];
const premultiply = (pixel: Pixel): Pixel => [pixel[0] * pixel[3], pixel[1] * pixel[3], pixel[2] * pixel[3], pixel[3]];

/** Independent reference: blurSampling's taps, horizontal premultiplied pass, vertical pass, straight output. */
function separableReference(kind: 'gaussian' | 'box', radius: number, uv: [number, number], resolution: [number, number]): Pixel {
  const { taps } = separableBlurTaps(kind, radius, resolution[0], resolution[1]);
  const pass = (axis: 0 | 1, at: [number, number], read: (uv: [number, number]) => Pixel): Pixel => {
    const sum: Pixel = [0, 0, 0, 0]; let weight = 0;
    for (const tap of taps) {
      const shifted: [number, number] = [at[0] + (axis === 0 ? tap.offset / resolution[0] : 0), at[1] + (axis === 1 ? tap.offset / resolution[1] : 0)];
      read(shifted).forEach((value, channel) => { sum[channel] += value * tap.weight; }); weight += tap.weight;
    }
    return sum.map(value => value / weight) as Pixel;
  };
  const result = pass(1, uv, at => pass(0, at, sample => premultiply(source(sample))));
  return [...result.slice(0, 3).map(value => value / Math.max(result[3], 1e-6)), result[3]] as Pixel;
}

describe('blur effect operator graph ownership', () => {
  it.each([
    ['box-blur', createDefaultBoxBlurGraph, ['radius']],
    ['gaussian-blur', createDefaultGaussianBlurGraph, ['radius']],
    ['sharpen', createDefaultSharpenGraph, ['amount', 'radius']],
  ] as const)('owns a valid %s graph with only stable effect bindings', (type, factory, bindings) => {
    const graph = factory();
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.length).toBeLessThanOrEqual(100);
    expect(graph.nodes.flatMap(node => Object.values(node.bindings)).toSorted()).toEqual([...bindings].toSorted());
    expect(isImageGraphEffectType(type)).toBe(true);
    // Composition recognition may reorder nodes and duplicate captured literals; the computation is the recipe.
    const owned = effectOperatorGraph({ type, params: {} });
    const computed = (nodes: typeof graph.nodes) => nodes.filter(node => node.operator !== 'values.number' || Object.keys(node.bindings).length).map(node => node.id).toSorted();
    expect(computed(owned.nodes)).toEqual(computed(graph.nodes));
    expect(matchesEffectRecipe(owned, graph)).toBe(true);
    expect(effectOperatorParams({ type, params: {} })).toMatchObject(Object.fromEntries(bindings.map(id => [id, getEffect(type)!.params[id].default])));
  });

  it.each(['box-blur', 'gaussian-blur'] as const)('%s premultiplies the source into a cache before the horizontal and vertical passes', type => {
    const graph = type === 'box-blur' ? createDefaultBoxBlurGraph() : createDefaultGaussianBlurGraph();
    expect(connection(graph, 'source-premultiplied', 'source-cache', 'image')).toBe(true);
    expect(connection(graph, 'source-cache', 'horizontal-sample', 'image')).toBe(true);
    expect(connection(graph, 'horizontal-sample', 'horizontal-reduce', 'sample')).toBe(true);
    expect(connection(graph, 'horizontal-image', 'horizontal-cache', 'image')).toBe(true);
    expect(connection(graph, 'horizontal-cache', 'vertical-sample', 'image')).toBe(true);
    expect(connection(graph, 'short-side', 'pixel-scale', 'a')).toBe(true);
    const plan = compileImageOperatorGraph(graph, effectOperatorParams({ type, params: {} }), effectOperatorCompileContext({ type }));
    expect(plan.passes).toHaveLength(3);
    // Radius stays a runtime value: animating it never recompiles the shader.
    expect(compileImageOperatorGraph(graph, effectOperatorParams({ type, params: { radius: 31.7 } })).key).toBe(plan.key);
  });

  it.each(['box-blur', 'gaussian-blur'] as const)('%s presents both passes through the shared pair-tap compositions', type => {
    const graph = type === 'box-blur' ? createDefaultBoxBlurGraph() : createDefaultGaussianBlurGraph();
    const packed = recognizeOperatorCompositions(graph);
    const count = (id: string) => packed.nodes.filter(node => node.operator === id).length;
    expect(count('sampling.pair-tap-offsets')).toBe(2);
    expect(count('sampling.pair-merge')).toBe(2);
    expect(count('sampling.normalize-rgba')).toBe(2);
    expect(packed.nodes.length).toBeLessThan(graph.nodes.length - 30);
  });

  it.each([
    ['gaussian', 'gaussian-blur', 10, [1920, 1080]], ['gaussian', 'gaussian-blur', 37.5, [640, 360]], ['gaussian', 'gaussian-blur', 0, [320, 180]],
    ['box', 'box-blur', 5, [1920, 1080]], ['box', 'box-blur', 3.4, [800, 1200]], ['box', 'box-blur', 50, [400, 300]],
  ] as const)('%s radius %s on %j matches the separable reference on the CPU', (kind, type, radius, resolution) => {
    const graph = effectOperatorGraph({ type, params: {} });
    const plan = compileImageOperatorGraph(graph, effectOperatorParams({ type, params: { radius } }), effectOperatorCompileContext({ type }));
    for (const uv of [[0.31, 0.62], [0.02, 0.97], [0.5, 0.5]] as [number, number][]) {
      const actual = evaluateImagePasses(plan, uv, [...resolution], source), expected = separableReference(kind, radius, uv, [...resolution]);
      expected.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value, 5));
    }
  });

  it('builds Sharpen as a fixed extent weighted blur and preserves center alpha', () => {
    const graph = createDefaultSharpenGraph();
    expect(graph.nodes.find(node => node.id === 'extent')?.constants?.value).toBe(3);
    expect(connection(graph, 'offset', 'scaled-offset', 'a')).toBe(true);
    expect(connection(graph, 'center-split', 'difference', 'a')).toBe(true);
    expect(connection(graph, 'blurred-split', 'difference', 'b')).toBe(true);
    expect(connection(graph, 'center-split', 'combine', 'alpha')).toBe(true);
    expect(connection(graph, 'clamped', 'combine', 'rgb')).toBe(true);
  });
});
