import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { IMAGE_SCOPED_INSTRUCTION_LIMIT } from '../../src/services/operators/effectGraphLimits';
import { compileImageOperatorGraph, compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';
import { migrateImageOperatorGraph } from '../../src/services/operators/imageOperatorMigration';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const value = (id: string, operator = 'values.number'): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {}, constants: { value: 1 } });
function largeImageGraph(additions: number): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }, value('a'), value('b')];
  const edges: OperatorEdge[] = [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' }];
  for (let index = 0; index < additions; index++) {
    const id = `add-${index}`; nodes.push(value(id, 'math.add.scalar'));
    edges.push({ id: `a-${id}`, from: 'a', output: 'value', to: id, input: 'a' }, { id: `b-${id}`, from: 'b', output: 'value', to: id, input: 'b' });
  }
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((node, index) => [node.id, { x: index, y: 0 }])) };
}

function nestedImageSelectionGraph(depth: number): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ];
  const edges: OperatorEdge[] = [];
  let imageNode = 'frame';
  let imagePort = 'image';
  for (let index = 0; index < depth; index++) {
    const condition = `condition-${index}`, select = `select-${index}`;
    // Parameter-bound conditions stay runtime-variable; constant switches are folded before lowering.
    nodes.push({ ...value(condition, 'values.boolean'), bindings: { value: condition }, constants: { value: index % 2 === 0 } },
      { id: select, operator: 'control.select.image', operatorVersion: 1, bindings: {} });
    edges.push({ id: `${condition}-select`, from: condition, output: 'value', to: select, input: 'condition' },
      { id: `${imageNode}-${select}-false`, from: imageNode, output: imagePort, to: select, input: 'falseValue' },
      { id: `${imageNode}-${select}-true`, from: imageNode, output: imagePort, to: select, input: 'trueValue' });
    imageNode = select; imagePort = 'image';
  }
  edges.push({ id: 'selected-output', from: imageNode, output: imagePort, to: 'output', input: 'image' });
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((node, index) => [node.id, { x: index, y: 0 }])) };
}

// Effect graphs have no node or edge cap (decision 2026-10-28, user); only the compiled image plan is
// bounded (IMAGE_SCOPED_INSTRUCTION_LIMIT), which stops runaway expansion of kernel and sequence scopes.
describe('effect graph limits', () => {
  it('rejects malformed structure', () => {
    const graph = largeImageGraph(0);
    expect(validateEffectGraph({ ...graph, nodes: {} as never })).toEqual(['Invalid operator graph.']);
    expect(validateEffectGraph({ ...graph, version: 2 as 1 })).toEqual(['Invalid operator graph.']);
  });

  it('accepts graphs of any size in every domain', () => {
    const graph = largeImageGraph(700);
    expect(graph.nodes.length).toBeGreaterThan(512);
    expect(graph.edges.length).toBeGreaterThan(1024);
    for (const domain of ['image', 'analog-signal', 'scene', 'geometry', 'voxel', 'cables', undefined] as const)
      expect(validateEffectGraph({ ...graph, domain })).not.toContainEqual(expect.stringContaining('budget'));
  });

  it('compiles image graphs with more than the former 512 nodes and 2048 edges', () => {
    const graph = largeImageGraph(1100);
    expect(graph.edges.length).toBeGreaterThan(2048);
    expect(() => compileImageOperatorGraph(graph)).not.toThrow();
    expect(() => compileImageOperatorPreview(graph, {}, { nodeId: 'output', direction: 'input', portId: 'image' })).not.toThrow();
  });

  it('bounds scoped instruction expansion independently of persisted graph size', () => {
    const compact = compileImageOperatorGraph(nestedImageSelectionGraph(4));
    expect(compact.passes).toBeUndefined();
    expect(() => compileImageOperatorGraph(nestedImageSelectionGraph(16))).toThrow(new RegExp(`exceeds ${IMAGE_SCOPED_INSTRUCTION_LIMIT} instructions`));
  });

  it('keeps duplicate, cycle, and malformed connection checks fail-closed', () => {
    const duplicate = largeImageGraph(1); duplicate.nodes.push({ ...duplicate.nodes.at(-1)! });
    expect(validateEffectGraph(duplicate)).toContain('Duplicate node ID.');
    const cycle = largeImageGraph(2);
    cycle.edges = cycle.edges.filter(edge => !edge.id.startsWith('a-add-'));
    cycle.edges.push({ id: 'cycle-a', from: 'add-0', output: 'value', to: 'add-1', input: 'a' },
      { id: 'cycle-b', from: 'add-1', output: 'value', to: 'add-0', input: 'a' });
    expect(validateEffectGraph(cycle)).toContain('Cycles are not supported.');
    const malformed = largeImageGraph(1); malformed.edges.push({ id: 'missing-node', from: 'missing', output: 'value', to: 'add-0', input: 'a' });
    expect(validateEffectGraph(malformed).some(error => error.startsWith('Invalid connection:'))).toBe(true);
  });

  it('expands legacy image nodes in graphs of any size', () => {
    const graph = largeImageGraph(0);
    graph.nodes.push({ id: 'legacy', operator: 'color.invert.rgb', operatorVersion: 1, bindings: {} });
    while (graph.nodes.length < 600) graph.nodes.push(value(`migration-${graph.nodes.length}`));
    graph.layout = Object.fromEntries(graph.nodes.map((node, index) => [node.id, { x: index, y: 0 }]));
    expect(migrateImageOperatorGraph(graph).nodes).toHaveLength(602);
  });
});
