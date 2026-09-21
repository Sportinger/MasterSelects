import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { ANALOG_SIGNAL_EFFECT_GRAPH_LIMITS, IMAGE_EFFECT_GRAPH_LIMITS, LEGACY_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';
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
    nodes.push({ ...value(condition, 'values.boolean'), constants: { value: index % 2 === 0 } },
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

describe('effect graph persisted limits', () => {
  it('accepts image graphs beyond the legacy node and edge caps', () => {
    const graph = largeImageGraph(150);
    expect(graph.nodes.length).toBeGreaterThan(LEGACY_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeGreaterThan(LEGACY_EFFECT_GRAPH_LIMITS.edges);
    expect(validateEffectGraph(graph)).toEqual([]);
  });

  it('rejects image graphs beyond either image-domain cap', () => {
    const nodes = largeImageGraph(0);
    while (nodes.nodes.length <= IMAGE_EFFECT_GRAPH_LIMITS.nodes) {
      const id = `extra-${nodes.nodes.length}`; nodes.nodes.push(value(id)); nodes.layout[id] = { x: 0, y: 0 };
    }
    expect(validateEffectGraph(nodes)).toEqual(['Invalid operator graph.']);
    const edges = largeImageGraph(0);
    edges.edges = Array.from({ length: IMAGE_EFFECT_GRAPH_LIMITS.edges + 1 }, (_, index) => ({
      id: `overflow-${index}`, from: 'frame', output: 'image', to: 'output', input: 'image',
    }));
    expect(validateEffectGraph(edges)).toEqual(['Invalid operator graph.']);
  });

  it('rejects unreachable over-budget data before full and preview compilation', () => {
    const nodes = largeImageGraph(0);
    while (nodes.nodes.length <= IMAGE_EFFECT_GRAPH_LIMITS.nodes) {
      const id = `unreachable-${nodes.nodes.length}`; nodes.nodes.push(value(id)); nodes.layout[id] = { x: 0, y: 0 };
    }
    const edges = largeImageGraph(0);
    edges.edges = Array.from({ length: IMAGE_EFFECT_GRAPH_LIMITS.edges + 1 }, (_, index) => ({
      id: `unreachable-edge-${index}`, from: 'a', output: 'value', to: 'b', input: 'value',
    }));
    const preview = { nodeId: 'output', direction: 'input' as const, portId: 'image' };
    expect(() => compileImageOperatorGraph(nodes)).toThrow(/node or edge budget/);
    expect(() => compileImageOperatorPreview(nodes, {}, preview)).toThrow(/node or edge budget/);
    expect(() => compileImageOperatorGraph(edges)).toThrow(/node or edge budget/);
    expect(() => compileImageOperatorPreview(edges, {}, preview)).toThrow(/node or edge budget/);
  });

  it('bounds scoped instruction expansion independently of persisted graph size', () => {
    const compact = compileImageOperatorGraph(nestedImageSelectionGraph(4));
    expect(compact.passes).toBeUndefined();
    expect(() => compileImageOperatorGraph(nestedImageSelectionGraph(12))).toThrow(/exceeds 2048 instructions/);
  });

  it('retains the original cap outside the image and Analog domains', () => {
    const graph = largeImageGraph(61); // 65 nodes, below the image cap but above the legacy cap.
    for (const domain of ['voxel', 'scene', 'cables', undefined] as const)
      expect(validateEffectGraph({ ...graph, domain })).toEqual(['Invalid operator graph.']);
  });

  it('bounds the larger Analog domain independently', () => {
    const graph = { ...largeImageGraph(61), domain: 'analog-signal' as const };
    expect(validateEffectGraph(graph)).toEqual([]);
    while (graph.nodes.length <= ANALOG_SIGNAL_EFFECT_GRAPH_LIMITS.nodes) {
      const id = `analog-extra-${graph.nodes.length}`;
      graph.nodes.push(value(id)); graph.layout[id] = { x: 0, y: 0 };
    }
    expect(validateEffectGraph(graph)).toEqual(['Invalid operator graph.']);
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

  it('allows legacy image expansion exactly through the shared image node cap', () => {
    const migrationGraph = (count: number) => {
      const graph = largeImageGraph(0);
      graph.nodes.push({ id: 'legacy', operator: 'color.invert.rgb', operatorVersion: 1, bindings: {} });
      while (graph.nodes.length < count) graph.nodes.push(value(`migration-${graph.nodes.length}`));
      graph.layout = Object.fromEntries(graph.nodes.map((node, index) => [node.id, { x: index, y: 0 }]));
      return graph;
    };
    expect(migrateImageOperatorGraph(migrationGraph(IMAGE_EFFECT_GRAPH_LIMITS.nodes - 2)).nodes).toHaveLength(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(() => migrateImageOperatorGraph(migrationGraph(IMAGE_EFFECT_GRAPH_LIMITS.nodes - 1))).toThrow(`exceeds ${IMAGE_EFFECT_GRAPH_LIMITS.nodes} nodes`);
  });
});
