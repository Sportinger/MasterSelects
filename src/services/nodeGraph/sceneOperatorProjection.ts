import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph } from '../../types/nodeGraph';
import { sceneGraphForClip, validateSceneGraph } from '../operators/sceneGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { projectOperatorPort } from './effectGraphProjection';
import { sceneBypassDescription } from '../operators/sceneOperators';

export function sceneOperatorProjection(clip: TimelineClip, id: string): NodeGraph {
  const definition = sceneGraphForClip(clip), errors = validateSceneGraph(definition);
  const owner = { kind: 'clip' as const, id: clip.id, name: clip.name };
  if (errors.length) return { id, owner, nodes: [{ id: 'invalid', label: 'Invalid scene graph', description: errors[0], kind: 'output', runtime: 'builtin', inputs: [], outputs: [], layout: { x: 0, y: 0 } }], edges: [] };
  return { id, owner, nodes: definition.graph.nodes.map(node => {
    const op = getEffectOperator(node.operator)!;
    return { id: node.id, label: op.label, description: op.description, operatorId: op.id,
      params: { bypassable: true, enabled: !node.bypassed, bypassDescription: sceneBypassDescription(node.operator) },
      kind: op.id === 'scene.render' ? 'output' : op.id === 'image.frame' ? 'source' : 'effect', runtime: op.runtime,
      inputs: op.inputs.map(p => projectOperatorPort(p, 'input')), outputs: op.outputs.map(p => projectOperatorPort(p, 'output')),
      layout: definition.graph.layout[node.id] ?? { x: 0, y: 0 }, binding: { kind: 'scene-operator', nodeId: node.id, operator: node.operator },
    };
  }), edges: definition.graph.edges.map(e => ({ id: e.id, fromNodeId: e.from, fromPortId: e.output, toNodeId: e.to, toPortId: e.input,
    type: projectOperatorPort(getEffectOperator(definition.graph.nodes.find(n => n.id === e.from)!.operator)!.outputs.find(p => p.id === e.output)!, 'output').type })),
  groups: definition.graph.groups?.map(g => ({ ...g, collapsed: false, proxyId: `group-${g.id}` })) };
}
