import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph, NodeGraphNode } from '../../types/nodeGraph';
import { getActiveColorVersion, parseColorProperty } from '../../types/colorCorrection';
import { parameterNode } from '../nodeGraph/keyframeNodeParameters';
import { parameterSourceTargets } from './parameterSourceTargets';
import { getControlOperator } from './controlOperators';

export const controlTargetEdgeId = (property: string) => `control-target:${encodeURIComponent(property)}`;

/** Project the saved scalar graph and its bindings, including collapsed domain boundaries. */
export function projectParameterSources(graph: NodeGraph, clip: TimelineClip): NodeGraph {
  const state = clip.nodeGraph?.parameterSources;
  const nodes = graph.nodes.map(node => ({ ...node, inputs: [...node.inputs] })), edges = [...graph.edges];
  const controls: NodeGraphNode[] = (state?.graph.nodes ?? []).map((node, index) => {
    const definition = getControlOperator(node.operator);
    return { id: node.id, label: definition?.label ?? node.operator, description: 'Clip parameter source',
      kind: 'motion', domain: 'motion', runtime: 'builtin', binding: { kind: 'parameter-source', nodeId: node.id },
      layout: state!.graph.layout[node.id] ?? { x: index * 300, y: -320 },
      params: Object.fromEntries(Object.entries(node.constants ?? {}).filter((entry): entry is [string, number | string | boolean] =>
        typeof entry[1] === 'number' || typeof entry[1] === 'string' || typeof entry[1] === 'boolean')),
      inputs: (definition?.inputs ?? []).map(port => ({ ...port, direction: 'input', type: 'number' })),
      outputs: [{ id: 'value', label: 'Value', type: 'number', direction: 'output' }] };
  });
  nodes.push(...controls);
  edges.push(...(state?.graph.edges ?? []).map(edge => ({ id: edge.id, fromNodeId: edge.from, fromPortId: edge.output,
    toNodeId: edge.to, toPortId: edge.input, type: 'number' as const })));
  for (const target of parameterSourceTargets(clip)) {
    const binding = state?.targets[target.path];
    const color = parseColorProperty(target.path);
    if (color && (!clip.colorCorrection || color.versionId !== getActiveColorVersion(clip.colorCorrection)?.id)) continue;
    // The keyframe locator falls back to the clip source for hidden color nodes;
    // control ports belong on the Color proxy instead, never the media source.
    const owner = color ? nodes.find(node => node.binding?.kind === 'color-node' && node.binding.nodeId === color.nodeId)
      ?? nodes.find(node => node.binding?.kind === 'clip-color-correction') : parameterNode(clip, target.path, nodes);
    if (!owner) continue;
    const label = color ? `${target.group.split(' / ').at(-1)} / ${target.label}` : target.label;
    const visible = Boolean(binding?.source || binding?.exposed === true);
    owner.controlInputs = [...(owner.controlInputs ?? []), { property: target.path, label, group: target.group, visible }];
    if (!visible) continue;
    const portId = `control:${target.path}`;
    owner.inputs.push({ id: portId, label,
      type: 'number', direction: 'input', metadata: { controlProperty: target.path, semanticKind: 'control:number' } });
    if (binding?.source && binding.enabled !== false) edges.push({ id: controlTargetEdgeId(target.path),
      fromNodeId: binding.source.nodeId, fromPortId: binding.source.portId, toNodeId: owner.id, toPortId: portId, type: 'number' });
  }
  return { ...graph, nodes, edges };
}
