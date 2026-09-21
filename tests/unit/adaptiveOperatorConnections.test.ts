import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';
import { connectEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { IMAGE_OPERATORS } from '../../src/services/operators/imageOperators';
import { operatorConnectionGraph } from '../../src/services/operators/operatorConnectionGraph';
import { resolveAdaptiveGraphConnection } from '../../src/services/nodeGraph/adaptiveGraphConnections';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

function graph(operators: Record<string, string>, edges: OperatorEdge[] = []): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: Object.entries(operators).map(([id, operator]) => ({
    id, operator, operatorVersion: 1, bindings: {}, ...(operator === 'values.number' ? { constants: { value: 2 } } : {}),
  })), edges, layout: Object.fromEntries(Object.keys(operators).map(id => [id, { x: 0, y: 0 }])) };
}
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const connect = (g: EffectOperatorGraph, e: OperatorEdge) => connectEffectGraph(g, e, IMAGE_OPERATORS);

describe('shared adaptive operator connections', () => {
  it('uses the image × scalar implementation and executes the new shader plan', () => {
    const g = graph({ frame: 'image.frame', factor: 'values.number', math: 'math.multiply.scalar', output: 'image.output' }, [
      edge('factor', 'value', 'math', 'b'),
    ]);
    const next = connect(g, edge('frame', 'image', 'math', 'a'));
    expect(next.nodes.find(n => n.id === 'math')?.operator).toBe('math.multiply.image-scalar');
    const complete = connect(next, edge('math', 'value', 'output', 'image'));
    expect(validateEffectGraph(complete)).toEqual([]);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(complete, {}), [0.1, 0.2, 0.3, 0.5])).toEqual([0.2, 0.4, 0.6, 1]);
    expect(g.nodes.find(n => n.id === 'math')?.operator).toBe('math.multiply.scalar');
    expect(g.edges).toHaveLength(1);
  });

  it('propagates vector constraints through existing connected math nodes', () => {
    const g = graph({ uv: 'image.normalized-uv', add: 'math.add.scalar', multiply: 'math.multiply.scalar', split: 'vector.split.vec2' }, [
      edge('add', 'value', 'multiply', 'a'), edge('multiply', 'value', 'split', 'value'),
    ]);
    const next = connect(g, edge('uv', 'uv', 'add', 'a'));
    expect(next.nodes.find(n => n.id === 'add')?.operator).toBe('math.add.vec2');
    expect(next.nodes.find(n => n.id === 'multiply')?.operator).toBe('math.multiply.vec2');
    expect(next.edges).toHaveLength(3);
  });

  it('preserves a wired scalar factor while selecting vector × scalar', () => {
    const g = graph({ uv: 'image.normalized-uv', factor: 'values.number', multiply: 'math.multiply.scalar' }, [edge('factor', 'value', 'multiply', 'b')]);
    const next = connect(g, edge('uv', 'uv', 'multiply', 'a'));
    expect(next.nodes.find(n => n.id === 'multiply')?.operator).toBe('math.multiply.vec2-scalar');
  });

  it('rejects conflicting consumers without mutating nodes, values or cables', () => {
    const g = graph({ uv: 'image.normalized-uv', math: 'math.multiply.scalar', consumer: 'math.sin.scalar' }, [edge('math', 'value', 'consumer', 'value')]);
    const saved = structuredClone(g);
    expect(() => connect(g, edge('uv', 'uv', 'math', 'a'))).toThrow('No supported variant');
    expect(g).toEqual(saved);
  });

  it('does not invent variants unsupported by the executor', () => {
    const g = graph({ uv: 'image.normalized-uv', math: 'math.multiply.scalar' });
    expect(() => connectEffectGraph(g, edge('uv', 'uv', 'math', 'a'), IMAGE_OPERATORS.filter(op => op.variant === 'scalar'))).toThrow();
  });

  it('keeps current compatible variants and preserves cycle validation', () => {
    const g = graph({ a: 'math.multiply.scalar', b: 'math.add.scalar' }, [edge('a', 'value', 'b', 'a')]);
    expect(() => connect(g, edge('b', 'value', 'a', 'a'))).toThrow('cycle');
    const next = connect(graph({ a: 'values.number', b: 'math.multiply.scalar' }), edge('a', 'value', 'b', 'a'));
    expect(next.nodes[1].operator).toBe('math.multiply.scalar');
  });

  it('will not silently drop a connected fourth split component', () => {
    const g = graph({ uv: 'image.normalized-uv', split: 'vector.split.vec4', math: 'math.sin.scalar' }, [edge('split', 'w', 'math', 'value')]);
    expect(() => connect(g, edge('uv', 'uv', 'split', 'value'))).toThrow();
  });

  it('preflights inspector and reconnection requests with the same resolution', () => {
    const g = graph({ frame: 'image.frame', factor: 'values.number', math: 'math.multiply.scalar' }, [edge('factor', 'value', 'math', 'a')]);
    const e = edge('frame', 'image', 'math', 'a');
    const request = { fromNodeId: e.from, fromPortId: e.output, toNodeId: e.to, toPortId: e.input };
    const resolved = resolveAdaptiveGraphConnection(operatorConnectionGraph(g, IMAGE_OPERATORS), request);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.variants.get('math')).toBe('math.multiply.image-scalar');
      expect(resolved.replacesEdgeId).toBe(g.edges[0].id);
    }
  });

  it('retains a fixed recorded boundary whose source is not an operator', () => {
    const g = operatorConnectionGraph(graph({ frame: 'image.frame', math: 'math.multiply.scalar' }), IMAGE_OPERATORS);
    const frame = g.nodes.find(node => node.id === 'frame')!;
    const boundary = { id: 'group-in-image', label: 'Clip input', type: 'texture' as const, direction: 'input' as const, metadata: { readOnly: true } };
    const resolved = resolveAdaptiveGraphConnection({ ...g, nodes: [
      { id: 'clip-source', inputs: [], outputs: [{ ...boundary, id: 'image', direction: 'output' }] },
      ...g.nodes.map(node => node === frame ? { ...node, inputs: [...node.inputs, boundary] } : node),
    ], edges: [{ id: 'recorded', fromNodeId: 'clip-source', fromPortId: 'image', toNodeId: 'frame', toPortId: boundary.id, readOnly: true }] },
    { fromNodeId: 'frame', fromPortId: 'image', toNodeId: 'math', toPortId: 'a' });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.variants.size).toBe(1);
      expect(resolved.graph.edges[0].readOnly).toBe(true);
    }
  });
});
