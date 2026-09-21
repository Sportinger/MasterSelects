import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, value?: number | boolean): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });

function derivativeGraph(mode: 'auto' | 'fine' | 'coarse', sampled = false): EffectOperatorGraph {
  const graph: EffectOperatorGraph = {
    version: 1, schemaVersion: 1, domain: 'image', layout: {},
    nodes: [node('frame', 'image.frame'), node('output', 'image.output'), node('uv', 'image.normalized-uv'),
      node('split', 'vector.split.vec2'), node('two', 'values.number', 2), node('twice-y', 'math.multiply.scalar'),
      node('plane', 'math.add.scalar'), node('sample', 'image.sample'), node('luma', 'color.luminance-rec709.image'),
      node('derivative', `image.derivative.${mode}.scalar`)],
    edges: [edge('frame', 'image', 'output', 'image'), edge('uv', 'uv', 'split', 'value'),
      edge('split', 'y', 'twice-y', 'a'), edge('two', 'value', 'twice-y', 'b'), edge('split', 'x', 'plane', 'a'),
      edge('twice-y', 'value', 'plane', 'b'), edge('uv', 'uv', 'sample', 'uv'), edge('frame', 'image', 'sample', 'image'),
      edge(sampled ? 'luma' : 'plane', 'value', 'derivative', 'value'),
      ...(sampled ? [edge('sample', 'image', 'luma', 'image')] : [])],
  };
  return graph;
}

const context = {
  uv: [.375, .375] as [number, number], resolution: [4, 4] as [number, number], pixelCoordinate: [1, 1] as [number, number],
  sampleImage: ([x, y]: [number, number]) => [x + 2 * y, x + 2 * y, x + 2 * y, 1] as [number, number, number, number],
};

describe('image derivative operators', () => {
  it.each(['fine', 'coarse'] as const)('evaluates a true 2x2 %s quad and emits native WGSL derivatives', mode => {
    const plan = compileImageOperatorPreview(derivativeGraph(mode), {}, { nodeId: 'derivative', direction: 'output', portId: 'gradient' });
    expect(plan.capabilities).toContain('derivative');
    expect(plan.wgsl).toContain(mode === 'fine' ? 'dpdxFine(' : 'dpdxCoarse(');
    const evaluate = createImageOperatorEvaluator(plan);
    expect(evaluate([0, 0, 0, 1], context)).toEqual([.25, .5, 0, 1]);
    expect(evaluate([0, 0, 0, 1], { ...context, pixelCoordinate: [2, 2], uv: [.625, .625] })).toEqual([.25, .5, 0, 1]);
  });

  it('re-evaluates sampled source expressions at quad fragment centers', () => {
    const plan = compileImageOperatorPreview(derivativeGraph('fine', true), {}, { nodeId: 'derivative', direction: 'output', portId: 'gradient' });
    const result = createImageOperatorEvaluator(plan)([0, 0, 0, 1], context);
    expect(result[0]).toBeCloseTo(.25, 12);
    expect(result[1]).toBeCloseTo(.5, 12);
    expect(result.slice(2)).toEqual([0, 1]);
  });

  it('evaluates only each independent derivative input dependency closure', () => {
    const graph = derivativeGraph('fine');
    graph.nodes.push(node('derivative-two', 'image.derivative.fine.scalar'), node('split-one', 'vector.split.vec2'),
      node('split-two', 'vector.split.vec2'), node('sum', 'math.add.scalar'));
    graph.edges.push(edge('plane', 'value', 'derivative-two', 'value'), edge('derivative', 'gradient', 'split-one', 'value'),
      edge('derivative-two', 'gradient', 'split-two', 'value'), edge('split-one', 'x', 'sum', 'a'), edge('split-two', 'x', 'sum', 'b'));
    const plan = compileImageOperatorPreview(graph, {}, { nodeId: 'sum', direction: 'output', portId: 'value' });
    let samples = 0;
    const result = createImageOperatorEvaluator(plan)([0, 0, 0, 1], { ...context,
      sampleImage: uv => { samples++; return context.sampleImage(uv); } });
    expect(result[0]).toBe(.5);
    expect(samples).toBe(8);
  });

  it('requires an explicit CPU policy for automatic derivatives', () => {
    const plan = compileImageOperatorPreview(derivativeGraph('auto'), {}, { nodeId: 'derivative', direction: 'output', portId: 'gradient' });
    expect(plan.wgsl).toContain('dpdx(');
    expect(() => createImageOperatorEvaluator(plan)([0, 0, 0, 1], context)).toThrow(/explicit fine or coarse CPU policy/);
    expect(createImageOperatorEvaluator(plan)([0, 0, 0, 1], { ...context, derivativeAutoMode: 'coarse' })).toEqual([.25, .5, 0, 1]);
  });

  it('rejects higher-order and lazy-scope derivatives', () => {
    const higher = derivativeGraph('fine');
    higher.nodes.push(node('gradient-split', 'vector.split.vec2'), node('second', 'image.derivative.fine.scalar'));
    higher.edges.push(edge('derivative', 'gradient', 'gradient-split', 'value'), edge('gradient-split', 'x', 'second', 'value'));
    expect(() => compileImageOperatorPreview(higher, {}, { nodeId: 'second', direction: 'output', portId: 'gradient' })).toThrow(/Higher-order/);

    const lazy = derivativeGraph('fine');
    lazy.nodes.push(node('gradient-split', 'vector.split.vec2'), node('gradient-vec4', 'convert.scalar-to-vec4'),
      node('gradient-image', 'convert.vec4-to-image'), node('condition', 'values.boolean', true), node('select', 'control.select.image'));
    lazy.edges = lazy.edges.filter(candidate => candidate.to !== 'output');
    lazy.edges.push(edge('derivative', 'gradient', 'gradient-split', 'value'), edge('gradient-split', 'x', 'gradient-vec4', 'value'),
      edge('gradient-vec4', 'value', 'gradient-image', 'value'), edge('condition', 'value', 'select', 'condition'),
      edge('frame', 'image', 'select', 'falseValue'), edge('gradient-image', 'image', 'select', 'trueValue'), edge('select', 'image', 'output', 'image'));
    expect(() => compileImageOperatorGraph(lazy, {})).toThrow(/root evaluation scope/);

    const materialized = derivativeGraph('fine');
    materialized.nodes.push(node('barrier', 'image.materialize'), node('barrier-luma', 'color.luminance-rec709.image'));
    materialized.edges = materialized.edges.filter(candidate => candidate.to !== 'derivative');
    materialized.edges.push(edge('frame', 'image', 'barrier', 'image'), edge('barrier', 'image', 'barrier-luma', 'image'),
      edge('barrier-luma', 'value', 'derivative', 'value'));
    expect(() => compileImageOperatorPreview(materialized, {}, { nodeId: 'derivative', direction: 'output', portId: 'gradient' }))
      .toThrow(/root-local input expression/);
  });

  it('requires exact CPU quad context without silently guessing coordinates', () => {
    const plan = compileImageOperatorPreview(derivativeGraph('fine'), {}, { nodeId: 'derivative', direction: 'output', portId: 'gradient' });
    const evaluate = createImageOperatorEvaluator(plan);
    expect(() => evaluate([0, 0, 0, 1], { uv: [.5, .5], resolution: [4, 4], sampleImage: context.sampleImage })).toThrow(/pixel coordinate/);
    expect(() => evaluate([0, 0, 0, 1], { ...context, sampleImage: undefined })).toThrow(/sampling callback/);
  });
});
