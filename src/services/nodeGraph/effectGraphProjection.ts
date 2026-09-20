import type { Effect, TimelineClip } from '../../types';
import type { NodeGraph, NodeGraphPort, NodeGraphSignalType } from '../../types/nodeGraph';
import type { OperatorPort } from '../../types/operatorGraph';
import { cableOperatorGraph } from '../faceCables/cableOperatorGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { operatorEnabled } from '../operators/effectGraph';

export const effectGraphId = (clipId: string, effectId: string) => `clip-graph:${clipId}:effect:${effectId}`;
function projectPort(p: OperatorPort, direction: 'input' | 'output'): NodeGraphPort {
  const type: NodeGraphSignalType = p.type === 'image' || p.type === 'depth' ? 'texture' : p.type === 'number' ? 'number' : p.type === 'scene' ? 'scene' : 'geometry';
  return { id: p.id, label: p.label, type, direction, metadata: { semanticKind: `operator:${p.type}`, required: p.required, repeated: p.repeated } };
}

export function buildEffectOperatorGraph(clip: TimelineClip, effect: Effect): NodeGraph {
  let graph;
  try { graph = cableOperatorGraph(effect.params); }
  catch (error) {
    return { id: effectGraphId(clip.id, effect.id), owner: { kind: 'clip', id: clip.id, name: clip.name }, nodes: [{
      id: 'invalid', kind: 'output', runtime: 'builtin', label: 'Invalid saved graph', description: String(error),
      inputs: [], outputs: [], layout: { x: 0, y: 0 },
    }], edges: [] };
  }
  return {
    id: effectGraphId(clip.id, effect.id), owner: { kind: 'clip', id: clip.id, name: clip.name }, domain: 'clip',
    nodes: graph.nodes.map(node => {
      const operator = getEffectOperator(node.operator)!;
      return { id: node.id, operatorId: operator.id, label: operator.label, description: operator.description,
        kind: operator.id === 'media.source' ? 'source' : operator.id === 'scene.output' ? 'output' : 'effect',
        runtime: operator.runtime, inputs: operator.inputs.map(p => projectPort(p, 'input')), outputs: operator.outputs.map(p => projectPort(p, 'output')),
        params: { enabled: operatorEnabled(node, effect.params), bypassable: !!operator.bypass },
        layout: graph.layout[node.id] ?? { x: 0, y: 0 }, domain: 'clip',
        binding: { kind: 'effect-operator', effectId: effect.id, nodeId: node.id, operator: operator.id },
      };
    }),
    edges: graph.edges.map(edge => ({ id: edge.id, fromNodeId: edge.from, fromPortId: edge.output, toNodeId: edge.to, toPortId: edge.input,
      type: projectPort(getEffectOperator(graph.nodes.find(n => n.id === edge.from)!.operator)!.outputs.find(p => p.id === edge.output)!, 'output').type })),
  };
}
