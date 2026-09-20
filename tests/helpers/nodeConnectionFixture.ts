import type { NodeGraph, NodeGraphNode } from '../../src/types/nodeGraph';

const node = (id: string, x: number, y: number, type: 'video' | 'geometry' = 'video'): NodeGraphNode => ({
  id, label: id, kind: 'effect', runtime: 'builtin', layout: { x, y },
  inputs: [{ id: 'in', label: 'Image in', direction: 'input', type }],
  outputs: [{ id: 'out', label: 'Image out', direction: 'output', type }],
});

export const connectionFixture: NodeGraph = {
  id: 'plug-test', owner: { kind: 'clip', id: 'plug-fixture', name: 'Cable interaction test' },
  nodes: [node('Source', 50, 40), node('Surface', 390, 40), node('Depth', 390, 270), node('Geometry', 730, 270, 'geometry')],
  edges: [
    { id: 'surface-link', fromNodeId: 'Source', fromPortId: 'out', toNodeId: 'Surface', toPortId: 'in', type: 'video' },
    { id: 'depth-link', fromNodeId: 'Source', fromPortId: 'out', toNodeId: 'Depth', toPortId: 'in', type: 'video' },
  ],
};
