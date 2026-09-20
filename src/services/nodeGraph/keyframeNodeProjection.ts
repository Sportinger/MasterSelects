import type { TimelineClip } from '../../types';
import type { NodeGraph, NodeGraphNode } from '../../types/nodeGraph';
import { keyframeNodeParameters, parameterNode } from './keyframeNodeParameters';

export const keyframePortId = (property: string) => `animation:${property}`;
export const keyframeEdgeId = (nodeId: string, property: string) => `animation:${nodeId}:${property}`;

export function projectKeyframeNodes(graph: NodeGraph, clip: TimelineClip): NodeGraph {
  if (!clip.nodeGraph?.keyframeNodes?.length) return graph;
  const parameters = keyframeNodeParameters(clip);
  const nodes = graph.nodes.map(node => ({ ...node, inputs: [...node.inputs] }));
  const edges = [...graph.edges];
  for (const definition of clip.nodeGraph.keyframeNodes) {
    const animation: NodeGraphNode = {
      id: definition.id, label: definition.label, kind: 'motion', runtime: 'builtin', domain: 'motion',
      binding: { kind: 'keyframe-node', nodeId: definition.id }, layout: definition.layout,
      description: definition.channels.length ? 'Shared timeline animation' : 'Connect an animatable parameter in the inspector',
      inputs: [], outputs: [], params: { targetClipId: clip.id },
    };
    for (const channel of definition.channels) {
      const source = parameters.find(p => p.property === channel.property);
      animation.outputs.push({ id: channel.id, label: source?.label ?? channel.property, type: 'number', direction: 'output',
        metadata: { semanticKind: 'animation:number', animationProperty: channel.property } });
      for (const property of [channel.property, ...channel.targets.map(t => t.property)]) {
        if (!parameters.some(p => p.property === property)) continue;
        const owner = parameterNode(clip, property, nodes);
        if (!owner) continue;
        const portId = keyframePortId(property);
        if (!owner.inputs.some(p => p.id === portId)) owner.inputs.push({
          id: portId, label: parameters.find(p => p.property === property)?.label ?? property,
          type: 'number', direction: 'input', metadata: { semanticKind: 'animation:number', animationProperty: property },
        });
        edges.push({ id: keyframeEdgeId(definition.id, property), fromNodeId: definition.id, fromPortId: channel.id,
          toNodeId: owner.id, toPortId: portId, type: 'number' });
      }
    }
    nodes.push(animation);
  }
  return { ...graph, nodes, edges };
}
