import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultBoxBlurGraph, createDefaultGaussianBlurGraph, createDefaultSharpenGraph } from '../../src/services/operators/blurEffectGraphs';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';

const connection = (graph: ReturnType<typeof createDefaultBoxBlurGraph>, from: string, to: string, input: string) =>
  graph.edges.some(edge => edge.from === from && edge.to === to && edge.input === input);

describe('blur effect operator graph ownership', () => {
  it.each([
    ['box-blur', createDefaultBoxBlurGraph, ['radius']],
    ['gaussian-blur', createDefaultGaussianBlurGraph, ['radius', 'samples']],
    ['sharpen', createDefaultSharpenGraph, ['amount', 'radius']],
  ] as const)('owns a valid compact %s graph with only stable effect bindings', (type, factory, bindings) => {
    const graph = factory();
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.length).toBeLessThanOrEqual(64);
    expect(graph.nodes.flatMap(node => Object.values(node.bindings))).toEqual(expect.arrayContaining(bindings));
    expect(graph.nodes.flatMap(node => Object.values(node.bindings)).every(binding => typeof binding === 'string' && bindings.includes(binding as never))).toBe(true);
    expect(isImageGraphEffectType(type)).toBe(true);
    expect(effectOperatorGraph({ type, params: {} }).nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    expect(effectOperatorParams({ type, params: {} })).toMatchObject(Object.fromEntries(bindings.map(id => [id, getEffect(type)!.params[id].default])));
  });

  it('keeps Box Blur identity lazy at radius below one half and reduces a unit-weight texel kernel', () => {
    const graph = createDefaultBoxBlurGraph();
    expect(connection(graph, 'half', 'enabled', 'a')).toBe(true);
    expect(connection(graph, 'radius', 'enabled', 'b')).toBe(true);
    expect(connection(graph, 'frame', 'selected', 'trueValue')).toBe(true);
    expect(connection(graph, 'blurred', 'selected', 'falseValue')).toBe(true);
    expect(connection(graph, 'radius', 'reduce', 'extent')).toBe(true);
    expect(connection(graph, 'weight', 'reduce', 'weight')).toBe(true);
    expect(connection(graph, 'index', 'offset', 'a')).toBe(true);
    expect(connection(graph, 'texel-size', 'offset', 'b')).toBe(true);
  });

  it('uses the truncated clamped Gaussian extent for both iteration and radius scaling', () => {
    const graph = createDefaultGaussianBlurGraph();
    expect(connection(graph, 'clamped-samples', 'extent', 'value')).toBe(true);
    expect(connection(graph, 'extent', 'reduce', 'extent')).toBe(true);
    expect(connection(graph, 'extent', 'radius-per-sample', 'b')).toBe(true);
    expect(connection(graph, 'offset', 'scaled-offset', 'a')).toBe(true);
    expect(connection(graph, 'two-sigma', 'two-sigma-squared', 'a')).toBe(true);
    expect(connection(graph, 'sigma', 'two-sigma-squared', 'b')).toBe(true);
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
