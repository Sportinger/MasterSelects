import { describe, expect, it } from 'vitest';
import { checkGraphConnection, graphHasCycle, nodePortsCompatible, type ConnectionGraph } from '../../src/services/nodeGraph/graphConnections';
import { colorNodePorts } from '../../src/services/nodeGraph/colorGraphPorts';
import { createColorNode } from '../../src/types/colorCorrection';
import type { NodeGraphPort } from '../../src/types/nodeGraph';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { flockConnectionGraph } from '../../src/services/flock/graph/flockConnectionGraph';
import { checkFlockConnection } from '../../src/services/flock/graph/flockGraphValidation';
import { defaultSceneGraph } from '../../src/services/operators/sceneGraph';
import { operatorConnectionGraph } from '../../src/services/operators/operatorConnectionGraph';

const port = (direction: 'input' | 'output', metadata?: NodeGraphPort['metadata']): NodeGraphPort => ({ id: direction, label: direction, direction, type: 'number', metadata });
const node = (id: string, repeated = false) => ({ id, inputs: [port('input', { repeated })], outputs: [port('output')] });
const edge = (id: string, fromNodeId: string, toNodeId: string) => ({ id, fromNodeId, toNodeId, fromPortId: 'output', toPortId: 'input' });

describe('shared graph connection contract', () => {
  it('replaces single inputs, preserves repeated inputs, and never mutates a rejected graph', () => {
    const graph: ConnectionGraph = { nodes: [node('a'), node('b'), node('c')], edges: [edge('old', 'a', 'c')] };
    const before = JSON.stringify(graph);
    expect(checkGraphConnection(graph, edge('new', 'b', 'c'))).toEqual({ ok: true, replacesEdgeId: 'old' });
    expect(checkGraphConnection({ ...graph, nodes: [node('a'), node('b'), node('c', true)] }, edge('new', 'b', 'c'))).toEqual({ ok: true });
    expect(checkGraphConnection(graph, edge('cycle', 'c', 'a'))).toMatchObject({ ok: false, code: 'cycle' });
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('checks reconnect against the resulting topology, without deleting the original', () => {
    const graph = { nodes: [node('a'), node('b')], edges: [edge('old', 'a', 'b')] };
    expect(checkGraphConnection(graph, edge('new', 'b', 'a'))).toMatchObject({ ok: false, code: 'cycle' });
    expect(checkGraphConnection(graph, edge('new', 'b', 'a'), 'old')).toEqual({ ok: true });
    expect(graph.edges).toEqual([edge('old', 'a', 'b')]);
  });
  it('protects recorded dependencies and distinguishes semantic types and formats', () => {
    expect(nodePortsCompatible(port('output', { semanticKind: 'flock:spawn' }), port('input', { semanticKind: 'flock:behavior' }))).toBe(false);
    const contract = (formats: string[]) => ({ typeLabel: 'Depth', description: 'Depth', formats });
    expect(nodePortsCompatible(port('output', { contract: contract(['relative-depth']) }), port('input', { contract: contract(['calibrated-depth']) }))).toBe(false);
    expect(nodePortsCompatible(port('output'), port('input', { readOnly: true }))).toBe(false);
    expect(checkGraphConnection({ nodes: [node('a'), node('b'), node('c')], edges: [{ ...edge('saved', 'a', 'c'), readOnly: true }] }, edge('new', 'b', 'c'))).toMatchObject({ ok: false, code: 'read-only' });
  });
  it('uses actual Color ports rather than accepting any name with the same prefix', () => {
    const graph = { nodes: ['a', 'b'].map(id => ({ id, ...colorNodePorts(createColorNode('primary', id)) })), edges: [] };
    expect(checkGraphConnection(graph, { fromNodeId: 'a', fromPortId: 'invented', toNodeId: 'b', toPortId: 'in' })).toMatchObject({ ok: false, code: 'missing-port' });
    expect(checkGraphConnection(graph, { fromNodeId: 'a', fromPortId: 'key-out', toNodeId: 'b', toPortId: 'key-in' })).toEqual({ ok: true });
  });
  it('uses exactly the displayed Flock ports for canonical edits', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const graph = flockConnectionGraph(definition);
    for (const edge of definition.edges) {
      const connection = { fromNodeId: edge.from.nodeId, fromPortId: edge.from.port, toNodeId: edge.to.nodeId, toPortId: edge.to.port };
      expect(checkFlockConnection(definition, edge.from, edge.to, definition.nodes, definition.edges, edge.id))
        .toEqual(checkGraphConnection(graph, connection, edge.id));
    }
  });
  it('uses the same graph contract for scene operators and rejects a UV feedback cycle', () => {
    const graph = operatorConnectionGraph(defaultSceneGraph().graph);
    expect(graphHasCycle(graph.nodes, graph.edges)).toBe(false);
    for (const edge of graph.edges) expect(checkGraphConnection(graph, edge, edge.id).ok).toBe(true);
  });
  it('detects deep cycles iteratively without recursion limits', () => {
    const nodes = Array.from({ length: 20000 }, (_, i) => ({ id: String(i) }));
    const edges = nodes.slice(1).map((node, i) => ({ fromNodeId: String(i), toNodeId: node.id }));
    expect(graphHasCycle(nodes, edges)).toBe(false);
    expect(graphHasCycle(nodes, [...edges, { fromNodeId: '19999', toNodeId: '0' }])).toBe(true);
  });
});
