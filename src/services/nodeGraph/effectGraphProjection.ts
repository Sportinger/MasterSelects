import { projectOperatorPort } from '../operators/operatorPortProjection';
export { projectOperatorPort } from '../operators/operatorPortProjection';
import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph } from '../../types/nodeGraph';
import { addableEffectOperators, effectOperatorGraph, isImageGraphEffectType } from '../operators/effectGraphOwner';
import { operatorAdaptiveVariants } from '../operators/operatorAdaptiveVariants';
import { prepareImageEffect } from '../operators/imageEffectRuntimePlan';
import { getEffectOperator } from '../operators/operatorRegistry';
import { operatorEnabled } from '../operators/effectGraph';
import { mathNodeSymbol } from './mathNodeSymbol';
import { compositionGroupInterface } from '../operators/operatorComposition';

export const effectGraphId = (clipId: string, effectId: string) => `clip-graph:${clipId}:effect:${effectId}`;

export function buildEffectOperatorGraph(clip: TimelineClip, effect: Effect): NodeGraph {
  let graph;
  try { graph = isImageGraphEffectType(effect.type) ? prepareImageEffect(effect).graph : effectOperatorGraph(effect); }
  catch (error) {
    return { id: effectGraphId(clip.id, effect.id), owner: { kind: 'clip', id: clip.id, name: clip.name }, nodes: [{
      id: 'invalid', kind: 'output', runtime: 'builtin', label: 'Invalid saved graph', description: String(error),
      inputs: [], outputs: [], layout: { x: 0, y: 0 },
    }], edges: [] };
  }
  const supported = addableEffectOperators(effect.type);
  return {
    id: effectGraphId(clip.id, effect.id), owner: { kind: 'clip', id: clip.id, name: clip.name }, domain: 'clip', issue: graph.incomplete,
    nodes: graph.nodes.map(node => {
      const operator = getEffectOperator(node.operator)!;
      const projectPort = (p: (typeof operator.inputs)[number], direction: 'input' | 'output') => {
        const projected = projectOperatorPort(p, direction);
        const channel = graph.domain === 'image' && operator.variant === 'vec4'
          && (operator.family === 'vector.split' || operator.family === 'vector.combine')
          ? ({ x: 'R', y: 'G', z: 'B', w: 'A' } as Record<string, string>)[p.id] : undefined;
        return channel ? { ...projected, label: channel } : projected;
      };
      return { id: node.id, operatorId: operator.id, label: operator.label, description: operator.description,
        connectionVariants: operatorAdaptiveVariants(operator, supported),
        kind: ['media.source', 'image.frame', 'audio.input', 'splat.source'].includes(operator.id) ? 'source' : ['scene.output', 'render.voxel', 'image.output', 'audio.output', 'scene.render'].includes(operator.id) ? 'output' : 'effect',
        runtime: operator.runtime, inputs: operator.inputs.map(p => projectPort(p, 'input')), outputs: operator.outputs.map(p => projectPort(p, 'output')),
        params: { targetClipId: clip.id, operatorOwnerType: effect.type, enabled: operatorEnabled(node, effect.params), bypassable: graph.domain === 'voxel' || graph.domain === 'scene' || !!operator.bypass,
          ...(operator.id.startsWith('values.') ? { valueLabel: (typeof node.bindings.value === 'string' ? node.bindings.value : node.id)
            .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ') } : {}),
          mathSymbol: mathNodeSymbol(operator.id) ?? '',
          categoryLabel: ({ values: 'Value', analog: 'Analog Signal', math: 'Math', image: 'Image', texture: 'Texture', geometry: 'Geometry', material: 'Material', camera: 'Camera', light: 'Light', render: 'Render', scene: 'Scene', forces: 'Force', simulation: 'Simulation', tracking: 'Tracking' } as Record<string, string>)[operator.id.split('.')[0]] ?? 'Effect' },
        layout: graph.layout[node.id] ?? { x: 0, y: 0 }, domain: 'clip',
        binding: { kind: 'effect-operator', effectId: effect.id, nodeId: node.id, operator: operator.id },
      };
    }),
    edges: graph.edges.map(edge => ({ id: edge.id, fromNodeId: edge.from, fromPortId: edge.output, toNodeId: edge.to, toPortId: edge.input,
      type: projectOperatorPort(getEffectOperator(graph.nodes.find(n => n.id === edge.from)!.operator)!.outputs.find(p => p.id === edge.output)!, 'output').type })),
    groups: graph.groups?.map(g => ({ ...g, composition: compositionGroupInterface(graph, g), collapsed: false, proxyId: `group-${g.id}` })),
  };
}
