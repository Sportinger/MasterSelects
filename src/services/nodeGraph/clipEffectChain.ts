import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import type { NodeGraph, NodeGraphConnectionRequest, NodeGraphEdge } from './types';
import type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
import { buildClipNodeGraphView } from './clipGraphProjectionBuildView';
import { migrateTextSourceEdges } from './textGraphProjection';

/** The effect stack owns the image chain. Saved manual links may also contain sidechains. */
export function synchronizeEffectChain(graph: NodeGraph, saved: NodeGraphEdge[]): NodeGraphEdge[] {
  saved = migrateTextSourceEdges(graph, saved);
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
  const detached = new Set(clip.effects.filter(effect => effect.detached).map(effect => effect.id));
  const order = graph.nodes.filter(n => n.binding?.kind === 'clip-effect' && n.inputs.some(p => p.type !== 'audio'))
    .map(n => n.binding!.kind === 'clip-effect' ? n.binding!.effectId : '').filter(id => !detached.has(id));
  const a = from.binding?.kind === 'clip-effect' ? from.binding.effectId : undefined;
  const b = to.binding?.kind === 'clip-effect' ? to.binding.effectId : undefined;
  // Wiring a free-standing group attaches it next to its chained partner.
  if (a && b && detached.has(a) && detached.has(b)) return null;
  if (a && b && detached.has(b)) { const next = [...order]; next.splice(next.indexOf(a) + 1, 0, b); return next; }
  if (a && b && a !== b) {
    const next = order.filter(id => id !== a); next.splice(next.indexOf(b), 0, a); return next;
  }
  if (b && ['clip-source', 'clip-text', 'clip-transform', 'clip-mask-stack', 'clip-color-correction'].includes(from.binding?.kind ?? '')) return [b, ...order.filter(id => id !== b)];
  if (a && (to.binding?.kind === 'clip-output' || to.binding?.kind === 'clip-custom-node')) return [...order.filter(id => id !== a), a];
  return null;
}

/**
 * Which effect a cut chain cable frees: the effect the cable feeds, or, for the cable into
 * the clip output, the effect it comes from. Undefined when the cable is not a chain link.
 */
export function chainCutEffect(graph: NodeGraph, edge: NodeGraphEdge): string | undefined {
  if (!['texture', 'scene', 'geometry'].includes(edge.type)) return undefined;
  const effectOf = (nodeId: string) => {
    const node = graph.nodes.find(candidate => candidate.id === nodeId);
    if (node?.binding?.kind === 'clip-effect') return node.binding.effectId;
    return graph.groups?.find(group => group.effectId && !group.parentId && (group.proxyId === nodeId || group.nodeIds.includes(nodeId)))?.effectId;
  };
  const into = effectOf(edge.toNodeId), from = effectOf(edge.fromNodeId);
  if (into && into !== from) return into;
  const target = graph.nodes.find(candidate => candidate.id === edge.toNodeId);
  return from && from !== into && target?.binding?.kind === 'clip-output' ? from : undefined;
}

/** Takes an effect out of the clip chain; the chain closes around it and the group stands free. */
export function detachChainEffect(clip: TimelineClip, effectId: string): TimelineClip {
  if (!clip.effects.some(effect => effect.id === effectId && !effect.detached)) return clip;
  return { ...clip, effects: clip.effects.map(effect => effect.id === effectId ? { ...effect, detached: true, enabled: false } : effect) };
}

export function applyVisualEffectOrder(clip: TimelineClip, order: string[]): TimelineClip {
  // A free-standing group named in the order joins the chain (its own array slot) and starts rendering.
  const ordered = order.map(id => clip.effects.find(e => e.id === id)!)
    .map(effect => effect.detached ? { ...effect, detached: undefined, enabled: true } : effect);
  let index = 0;
  return { ...clip, effects: clip.effects.map(effect => order.includes(effect.id) ? ordered[index++] : effect) };
}
