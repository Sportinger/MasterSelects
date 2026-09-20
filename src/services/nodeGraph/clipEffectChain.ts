import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import type { NodeGraph, NodeGraphConnectionRequest, NodeGraphEdge } from './types';
import type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
import { buildClipNodeGraphView } from './clipGraphProjectionBuildView';

/** The effect stack owns the image chain. Saved manual links may also contain sidechains. */
export function synchronizeEffectChain(graph: NodeGraph, saved: NodeGraphEdge[]): NodeGraphEdge[] {
  const visualEffects = new Set(graph.nodes.filter(n => n.binding?.kind === 'clip-effect'
    && n.inputs.some(p => p.type !== 'audio')).map(n => n.id));
  const isImage = (edge: NodeGraphEdge) => ['texture', 'scene', 'geometry'].includes(edge.type);
  if (!visualEffects.size && !saved.some(e => isImage(e) && (e.fromNodeId.startsWith('effect-') || e.toNodeId.startsWith('effect-')))) return saved;
  const custom = new Set(graph.nodes.filter(n => n.binding?.kind === 'clip-custom-node').map(n => n.id));
  // Preserve custom-node wiring and all non-image signals. Reattach the stack to its custom-node consumer.
  const fixed = (e: NodeGraphEdge) => isImage(e) && !custom.has(e.fromNodeId)
    && (!custom.has(e.toNodeId) || e.toPortId === 'input');
  return [...saved.filter(e => !fixed(e)), ...graph.edges.filter(fixed)];
}

/** Connecting A's output to B's input inserts A immediately before B, with no loose ends. */
export function effectOrderForConnection(clip: TimelineClip, connection: NodeGraphConnectionRequest,
  track?: TimelineTrack, options: ClipNodeGraphBuildOptions = {}): string[] | null {
  const graph = buildClipNodeGraphView(clip, track, options);
  const from = graph.nodes.find(n => n.id === connection.fromNodeId), to = graph.nodes.find(n => n.id === connection.toNodeId);
  const output = from?.outputs.find(p => p.id === connection.fromPortId), input = to?.inputs.find(p => p.id === connection.toPortId);
  if (!from || !to || !output || !input || output.type !== input.type || !['texture', 'scene', 'geometry'].includes(input.type)) return null;
  const order = graph.nodes.filter(n => n.binding?.kind === 'clip-effect' && n.inputs.some(p => p.type !== 'audio'))
    .map(n => n.binding!.kind === 'clip-effect' ? n.binding!.effectId : '');
  const a = from.binding?.kind === 'clip-effect' ? from.binding.effectId : undefined;
  const b = to.binding?.kind === 'clip-effect' ? to.binding.effectId : undefined;
  if (a && b && a !== b) {
    const next = order.filter(id => id !== a); next.splice(next.indexOf(b), 0, a); return next;
  }
  if (b && ['clip-source', 'clip-transform', 'clip-mask-stack', 'clip-color-correction'].includes(from.binding?.kind ?? '')) return [b, ...order.filter(id => id !== b)];
  if (a && (to.binding?.kind === 'clip-output' || to.binding?.kind === 'clip-custom-node')) return [...order.filter(id => id !== a), a];
  return null;
}

export function applyVisualEffectOrder(clip: TimelineClip, order: string[]): TimelineClip {
  const ordered = order.map(id => clip.effects.find(e => e.id === id)!);
  let index = 0;
  return { ...clip, effects: clip.effects.map(effect => order.includes(effect.id) ? ordered[index++] : effect) };
}
