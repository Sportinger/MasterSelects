import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

function kernelGraph(extent = 1, weight = 2): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'),
    node('index', 'image.kernel-index'), node('offset', 'math.divide-ieee.vec2'), node('sample-uv', 'math.add.vec2'),
    node('sample', 'image.sample'), node('weight', 'values.number', weight), node('extent', 'values.number', extent),
    node('reduce', 'image.kernel-grid-reduce'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')];
  const edges = [edge('index', 'value', 'offset', 'a'), edge('resolution', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'),
    edge('offset', 'value', 'sample-uv', 'b'), edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'),
    edge('sample', 'image', 'reduce', 'sample'), edge('weight', 'value', 'reduce', 'weight'), edge('extent', 'value', 'reduce', 'extent'),
    edge('reduce', 'sum', 'image', 'value'), edge('image', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index * 100, y: 0 }])) };
}

describe('image kernel operator compiler', () => {
  it('evaluates the connected sample and edited weight once per x-major grid tap', () => {
    const plan = compileImageOperatorGraph(kernelGraph(1, 3));
    const coordinates: [number, number][] = [];
    const result = evaluateImageOperatorPlan(plan, [.5, .5, 1, .25], {
      uv: [.5, .5], resolution: [10, 10], sampleImage: uv => { coordinates.push(uv); return [uv[0], uv[1], 1, .25]; },
    });
    expect(coordinates).toHaveLength(9);
    expect(coordinates[0]).toEqual([.4, .4]);
    expect(coordinates[1]).toEqual([.4, .5]);
    [13.5, 13.5, 27, 6.75].forEach((expected, index) => expect(result[index]).toBeCloseTo(expected, 12));
    expect(plan.wgsl).toContain('let term = evaluateKernelTerm');
    expect(plan.wgsl).toContain('sum += term.sample * term.weight; weightSum += term.weight;');
  });

  it('truncates and clamps extent, and rejects kernel index previews outside a reducer scope', () => {
    const plan = compileImageOperatorGraph(kernelGraph(-4.8));
    let samples = 0;
    evaluateImageOperatorPlan(plan, [1, 1, 1, 1], { uv: [.5, .5], resolution: [8, 8], sampleImage: () => { samples++; return [1, 1, 1, 1]; } });
    expect(samples).toBe(1);
    expect(() => compileImageOperatorPreview(kernelGraph(), {}, { nodeId: 'index', direction: 'output', portId: 'value' }))
      .toThrow('image.kernel-index is only available inside a kernel reduction scope.');
  });

  it('does not evaluate an unselected singular image branch', () => {
    const graph = kernelGraph(0, 0);
    graph.edges = graph.edges.filter(item => item.to !== 'image' && item.to !== 'output');
    graph.nodes.push(node('weight-vec', 'convert.scalar-to-vec4'), node('divide', 'math.divide-ieee.vec4'),
      node('blurred', 'convert.vec4-to-image'), { ...node('identity', 'values.boolean'), constants: { value: true } },
      node('select', 'control.select.image'));
    graph.edges.push(edge('reduce', 'weightSum', 'weight-vec', 'value'), edge('reduce', 'sum', 'divide', 'a'),
      edge('weight-vec', 'value', 'divide', 'b'), edge('divide', 'value', 'blurred', 'value'),
      edge('identity', 'value', 'select', 'condition'), edge('blurred', 'image', 'select', 'falseValue'),
      edge('frame', 'image', 'select', 'trueValue'), edge('select', 'image', 'output', 'image'));
    let samples = 0;
    const result = evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [.2, .3, .4, .5], {
      uv: [.5, .5], resolution: [8, 8], sampleImage: () => { samples++; return [1, 1, 1, 1]; },
    });
    expect(result).toEqual([.2, .3, .4, .5]);
    expect(samples).toBe(0);
  });

  it('keeps graph-cycle rejection ahead of scoped lowering', () => {
    const graph = kernelGraph();
    graph.edges.push(edge('sample-uv', 'value', 'offset', 'a'));
    expect(() => compileImageOperatorGraph(graph)).toThrow(/connected more than once|cycle/);
  });
});
