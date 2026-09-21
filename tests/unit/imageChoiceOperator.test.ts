import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan, type ImageOperatorCompileContext } from '../../src/services/operators/imageOperatorGraph';
import { fisheye } from '../../src/effects/distort/fisheye';

const context: ImageOperatorCompileContext = { parameterSchema: { projection: { type: 'select', label: 'Projection', default: 'equisolid',
  options: [{ value: 'equidistant', label: 'Equidistant' }, { value: 'equisolid', label: 'Equisolid' }, { value: 'stereographic', label: 'Stereographic' }] } } };
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });

function choiceGraph(materialized = false): EffectOperatorGraph {
  const nodes: EffectOperatorGraph['nodes'] = [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'choice', operator: 'values.choice', operatorVersion: 1, bindings: { value: 'projection' } },
    { id: 'scale', operator: 'math.multiply.image-scalar', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ];
  const edges = [edge('frame', 'image', 'scale', 'a'), edge('choice', 'value', 'scale', 'b')];
  if (materialized) {
    nodes.push({ id: 'materialize', operator: 'image.materialize', operatorVersion: 1, bindings: {} });
    edges.push(edge('scale', 'value', 'materialize', 'image'), edge('materialize', 'image', 'output', 'image'));
  } else edges.push(edge('scale', 'value', 'output', 'image'));
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} };
}

describe('image choice operator', () => {
  it('encodes owner option order and falls back to the declared default', () => {
    const graph = choiceGraph();
    const selected = compileImageOperatorPreview(graph, { projection: 'stereographic' }, { nodeId: 'choice', direction: 'output', portId: 'value' }, context);
    const fallback = compileImageOperatorPreview(graph, { projection: 'unknown' }, { nodeId: 'choice', direction: 'output', portId: 'value' }, context);
    expect(evaluateImageOperatorPlan(selected, [0, 0, 0, 0])[0]).toBe(2);
    expect(evaluateImageOperatorPlan(fallback, [0, 0, 0, 0])[0]).toBe(1);
    expect(selected.key).toBe(fallback.key);
    expect(selected.wgsl).toBe(fallback.wgsl);
  });

  it('fails closed for missing bindings or invalid owner schemas', () => {
    const graph = choiceGraph();
    expect(() => compileImageOperatorGraph(graph, {}, {})).toThrow(/non-empty select parameter schema/);
    graph.nodes.find(node => node.id === 'choice')!.bindings = {};
    expect(() => compileImageOperatorGraph(graph, {}, context)).toThrow(/must bind/);
    const invalid: ImageOperatorCompileContext = { parameterSchema: { projection: { type: 'select', label: 'Projection', default: 'missing', options: [{ value: 'valid', label: 'Valid' }] } } };
    graph.nodes.find(node => node.id === 'choice')!.bindings = { value: 'projection' };
    expect(() => compileImageOperatorGraph(graph, {}, invalid)).toThrow(/invalid select default/);
    const duplicate: ImageOperatorCompileContext = { parameterSchema: { projection: { type: 'select', label: 'Projection', default: 'same',
      options: [{ value: 'same', label: 'One' }, { value: 'same', label: 'Two' }] } } };
    expect(() => compileImageOperatorGraph(graph, {}, duplicate)).toThrow(/invalid select options/);
  });

  it('propagates the schema through materialized producer passes', () => {
    const first = compileImageOperatorGraph(choiceGraph(true), { projection: 'equidistant' }, context);
    const second = compileImageOperatorGraph(choiceGraph(true), { projection: 'stereographic' }, context);
    expect(first.passes).toHaveLength(2);
    expect(first.passes![0].program.values).toEqual([0]);
    expect(second.passes![0].program.values).toEqual([2]);
    expect(first.key).toBe(second.key);
  });

  it('uses the canonical Fisheye select ordering', () => {
    const actualContext: ImageOperatorCompileContext = { parameterSchema: fisheye.params };
    const resolve = (binding: string, value: string) => {
      const graph = choiceGraph(); graph.nodes.find(node => node.id === 'choice')!.bindings.value = binding;
      const plan = compileImageOperatorPreview(graph, { [binding]: value }, { nodeId: 'choice', direction: 'output', portId: 'value' }, actualContext);
      return evaluateImageOperatorPlan(plan, [0, 0, 0, 0])[0];
    };
    expect(resolve('projection', 'orthographic')).toBe(3);
    expect(resolve('edgeMode', 'repeat')).toBe(3);
    expect(resolve('outside', 'transparent')).toBe(1);
  });
});
