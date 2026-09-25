import { getEffect } from '../../effects';
import { isFullscreenEffectDefinition } from '../../effects/types';
import type { TimelineClip } from './clipGraphProjectionDomain';
import { edge } from './clipGraphProjectionGraph';
import type { NodeGraphEdge, NodeGraphNode } from './types';

/** Only an original source video can currently be read at other moments. */
export function clipHasSourceVideo(clip: TimelineClip): boolean {
  return clip.source?.type === 'video' && !clip.isComposition;
}

/**
 * Time effects (Slit Scan, Time Stack) read other moments of the clip's original source video,
 * not the texture on their main input. The projection shows that dependency as an explicit
 * `clip` cable from the source; it is recorded by the effect rather than rewired by hand.
 */
export function connectTimeEffectSourceClip(clip: TimelineClip, nodes: NodeGraphNode[], edges: NodeGraphEdge[], source: NodeGraphNode) {
  const timeEffects = nodes.filter(node => {
    const binding = node.binding;
    if (binding?.kind !== 'clip-effect') return false;
    const effect = clip.effects.find(candidate => candidate.id === binding.effectId);
    const definition = effect && getEffect(effect.type);
    return Boolean(definition && isFullscreenEffectDefinition(definition) && definition.sourceTimeOwner);
  });
  if (!timeEffects.length) return;
  const available = clipHasSourceVideo(clip);
  if (available) source.outputs = [...source.outputs, { id: 'clip', label: 'Clip', type: 'clip', direction: 'output', metadata: { readOnly: true } }];
  for (const node of timeEffects) {
    node.inputs = [...node.inputs, { id: 'clip', label: 'Source clip', type: 'clip', direction: 'input', metadata: { readOnly: true } }];
    if (available) edges.push({ ...edge(source.id, 'clip', node.id, 'clip', 'clip'), readOnly: true });
    else node.params = { ...node.params, sourceClipMissing: true };
  }
}
