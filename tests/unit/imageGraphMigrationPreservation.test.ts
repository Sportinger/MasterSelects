import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan, migrateImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';

function legacyGraph(): EffectOperatorGraph {
  return {
    version: 1, schemaVersion: 1, domain: 'image', incomplete: 'User is repairing this graph.',
    nodes: [
      { id: 'source', operator: 'image.frame', operatorVersion: 1, bindings: {} },
      { id: 'channels', operator: 'image.rgb-split', operatorVersion: 1, bindings: {} },
      { id: 'negative', operator: 'color.invert.rgb', operatorVersion: 1, bindings: {}, bypassed: true },
      { id: 'rgba', operator: 'image.rgb-combine', operatorVersion: 1, bindings: {} },
      { id: 'result', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ],
    edges: [
      { id: 'source-channels', from: 'source', output: 'image', to: 'channels', input: 'image' },
      { id: 'channels-negative', from: 'channels', output: 'rgb', to: 'negative', input: 'rgb' },
      { id: 'negative-rgba', from: 'negative', output: 'rgb', to: 'rgba', input: 'rgb' },
      { id: 'channels-rgba', from: 'channels', output: 'alpha', to: 'rgba', input: 'alpha' },
      { id: 'rgba-result', from: 'rgba', output: 'image', to: 'result', input: 'image' },
    ],
    layout: { source: { x: 5, y: 7 }, channels: { x: 105, y: 7 }, negative: { x: 205, y: 7 }, rgba: { x: 305, y: 7 }, result: { x: 405, y: 7 } },
    groups: [{ id: 'user-group', label: 'User group', color: '#123456', nodeIds: ['channels', 'negative', 'rgba'] }],
  };
}

describe('image operator graph migration preservation', () => {
  it('preserves a rewired five-node graph and its real pass-through output', () => {
    const graph = legacyGraph();
    graph.incomplete = undefined;
    graph.edges = [
      { id: 'source-result', from: 'source', output: 'image', to: 'result', input: 'image' },
      ...graph.edges.slice(0, 4),
    ];
    const migrated = migrateImageOperatorGraph(graph);
    expect(migrated.edges.find(edge => edge.id === 'source-result')).toEqual(graph.edges[0]);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(migrated), [0.2, 0.4, 0.8, 0.6]))
      .toEqual([0.2, 0.4, 0.8, 0.6]);
  });

  it('retains groups, layout, metadata, bypass and incomplete state during local substitution', () => {
    const graph = legacyGraph();
    const migrated = migrateImageOperatorGraph(graph);
    expect(migrated.incomplete).toBe(graph.incomplete);
    expect(migrated.layout.source).toEqual({ x: 5, y: 7 });
    expect(migrated.groups?.[0]).toMatchObject({ id: 'user-group', label: 'User group', color: '#123456' });
    expect(migrated.groups?.[0].nodeIds).toEqual(expect.arrayContaining(['channels', 'negative', 'rgba', 'negative-one', 'negative-ones']));
    expect(migrated.nodes.find(node => node.id === 'negative')).toMatchObject({ operator: 'math.subtract.rgb', bypassed: true });
  });

  it('does not downgrade an unknown schema version', () => {
    const graph = { ...legacyGraph(), schemaVersion: 2 as 1 };
    const migrated = migrateImageOperatorGraph(graph);
    expect(migrated.schemaVersion).toBe(2);
    expect(() => compileImageOperatorGraph(migrated)).toThrow('schema version');
  });

  it('allocates collision-free generated node and edge IDs', () => {
    const graph = legacyGraph();
    graph.nodes.push({ id: 'negative-one', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 4 } });
    graph.edges.push({ id: 'negative-one-2-splat', from: 'negative-one', output: 'value', to: 'negative', input: 'unused' });
    const migrated = migrateImageOperatorGraph(graph);
    expect(new Set(migrated.nodes.map(node => node.id)).size).toBe(migrated.nodes.length);
    expect(new Set(migrated.edges.map(item => item.id)).size).toBe(migrated.edges.length);
    expect(migrated.nodes.some(node => node.id === 'negative-one-2')).toBe(true);
    expect(migrated.edges.some(item => item.id === 'negative-one-2-splat-2')).toBe(true);
  });
});
