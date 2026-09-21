import { describe, expect, it } from 'vitest';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${to}-${input}`, from, output, to, input });
function graph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('output', 'image.output'), node('topology', 'geometry.marching-squares-topology'),
    ...[1, 0, 1, 0].map((value, index) => node(['tl', 'tr', 'br', 'bl'][index], 'values.number', value)),
    ...['top', 'right', 'bottom', 'left'].flatMap((id, index) => [node(`${id}-x`, 'values.number', [.5, 1, .5, 0][index]),
      node(`${id}-y`, 'values.number', [0, .5, 1, .5][index]), node(id, 'vector.combine.vec2')])];
  const edges = [edge('frame', 'image', 'output', 'image'),
    ...['tl', 'tr', 'br', 'bl'].map(id => edge(id, 'value', 'topology', id)),
    ...['top', 'right', 'bottom', 'left'].flatMap(id => [edge(`${id}-x`, 'value', id, 'x'), edge(`${id}-y`, 'value', id, 'y'), edge(id, 'value', 'topology', id)])];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} };
}

describe('geometry.marching-squares-topology compiler', () => {
  it('registers typed, non-addable joint outputs', () => {
    expect(getEffectOperator('geometry.marching-squares-topology')).toMatchObject({ addable: false, implementation: 'shared',
      outputs: [{ id: 'a', type: 'vec2' }, { id: 'b', type: 'vec2' }, { id: 'c', type: 'vec2' }, { id: 'd', type: 'vec2' }, { id: 'count', type: 'number' }] });
  });

  it('evaluates the shared ambiguous-case table once and extracts every output', () => {
    const targets = ['a', 'b', 'c', 'd', 'count'] as const;
    const values = targets.map(portId => {
      const plan = compileImageOperatorPreview(graph(), {}, { nodeId: 'topology', direction: 'output', portId });
      expect(plan.instructions.filter(item => item.operation === 'marching-squares-topology')).toHaveLength(1);
      expect(plan.wgsl).toContain('fn imageMarchingSquaresTopology');
      return evaluateImageOperatorPlan(plan, [0, 0, 0, 0]);
    });
    expect(values).toEqual([[0, .5, 0, 1], [.5, 0, 0, 1], [1, .5, 0, 1], [.5, 1, 0, 1], [2, 2, 2, 1]]);
  });

  it('fails closed when occupancy is not binary', () => {
    const invalid = graph(); invalid.nodes.find(item => item.id === 'tl')!.constants = { value: .5 };
    const plan = compileImageOperatorPreview(invalid, {}, { nodeId: 'topology', direction: 'output', portId: 'count' });
    expect(() => evaluateImageOperatorPlan(plan, [0, 0, 0, 0])).toThrow(/occupancy must be binary/);
  });
});
