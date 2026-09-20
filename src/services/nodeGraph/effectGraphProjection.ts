import { projectOperatorPort } from '../operators/operatorPortProjection';
export { projectOperatorPort } from '../operators/operatorPortProjection';
import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph } from '../../types/nodeGraph';
import { effectOperatorGraph } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { operatorEnabled } from '../operators/effectGraph';
import { mathNodeSymbol } from './mathNodeSymbol';

export const effectGraphId = (clipId: string, effectId: string) => `clip-graph:${clipId}:effect:${effectId}`;

export function buildEffectOperatorGraph(clip: TimelineClip, effect: Effect): NodeGraph {
  let graph;
  try { graph = effectOperatorGraph(effect); }
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
        kind: ['media.source', 'image.frame'].includes(operator.id) ? 'source' : ['scene.output', 'render.voxel'].includes(operator.id) ? 'output' : 'effect',
        runtime: operator.runtime, inputs: operator.inputs.map(p => projectOperatorPort(p, 'input')), outputs: operator.outputs.map(p => projectOperatorPort(p, 'output')),
        params: { enabled: operatorEnabled(node, effect.params), bypassable: graph.domain === 'voxel' || !!operator.bypass,
          mathSymbol: mathNodeSymbol(operator.id) ?? '',
          categoryLabel: ({ math: 'Math', image: 'Image', texture: 'Texture', geometry: 'Geometry', material: 'Material', camera: 'Camera', light: 'Light', render: 'Render', scene: 'Scene', forces: 'Force', simulation: 'Simulation', tracking: 'Tracking' } as Record<string, string>)[operator.id.split('.')[0]] ?? 'Effect' },
        layout: graph.layout[node.id] ?? { x: 0, y: 0 }, domain: 'clip',
        binding: { kind: 'effect-operator', effectId: effect.id, nodeId: node.id, operator: operator.id },
      };
    }),
    edges: graph.edges.map(edge => ({ id: edge.id, fromNodeId: edge.from, fromPortId: edge.output, toNodeId: edge.to, toPortId: edge.input,
      type: projectOperatorPort(getEffectOperator(graph.nodes.find(n => n.id === edge.from)!.operator)!.outputs.find(p => p.id === edge.output)!, 'output').type })),
    groups: graph.groups?.map(g => ({ ...g, collapsed: false, proxyId: `group-${g.id}` })),
  };
}
