import type { TimelineClip } from '../../types/timeline';
import type { SharedSceneGraphs, SceneGraphOutput } from '../../types/sharedSceneGraph';
import type { NodeGraph, NodeGraphNode } from '../../types/nodeGraph';
import { effectOperatorGraph } from '../operators/effectGraphOwner';
import { expandOperatorCompositions } from '../operators/operatorComposition';

/** A transient editor projection; the effect is stored only in the document. */
export function projectSceneGraphClip(clip: TimelineClip, documents?: SharedSceneGraphs): TimelineClip {
  const document = clip.sceneGraphOutput && documents?.[clip.sceneGraphOutput.graphId];
  if (!document) return clip;
  return { ...clip, effects: [...clip.effects.filter(e => e.id !== document.effect.id), document.effect] };
}

/** Stable leaf identities survive folding, packing, and unrelated branch insertion. */
export function sceneOutputTarget(clip: TimelineClip, graph: NodeGraph, node: NodeGraphNode | null): Omit<SceneGraphOutput, 'graphId'> | undefined {
  if (!node || clip.source?.type !== 'gaussian-splat') return;
  const binding = node.binding;
  const effectId = binding && 'effectId' in binding ? binding.effectId : undefined;
  const effect = clip.effects.find(e => e.id === effectId && e.type === 'splat-exploration');
  if (!effect) return;
  const executable = expandOperatorCompositions(effectOperatorGraph(effect));
  const group = graph.groups?.find(g => g.proxyId === node.id);
  const groupId = binding?.kind === 'operator-group' ? binding.groupId.split('/').at(-1) : undefined;
  const members = new Set<string>();
  const collect = (id: string) => {
    const candidate = executable.groups?.find(g => g.id === id);
    candidate?.nodeIds.forEach(n => members.add(n));
    executable.groups?.filter(g => g.parentId === id).forEach(g => collect(g.id));
  };
  if (groupId) collect(groupId);
  else if (binding && 'nodeId' in binding) members.add(binding.nodeId);
  const nodeIds = executable.nodes.filter(n => members.has(n.id) && ['splat.render', 'scene.mesh'].includes(n.operator)).map(n => n.id);
  if (!nodeIds.length) return;
  const containingGroup = group ?? graph.groups?.filter(g => g.nodeIds.includes(node.id)).at(-1);
  return { nodeIds, groupId: containingGroup?.id, label: group?.label ?? node.label };
}

/** The original output excludes every published branch, even when its clip is hidden. */
export function sceneOutputSelection(clip: TimelineClip, clips: readonly TimelineClip[]) {
  const output = clip.sceneGraphOutput;
  if (!output) return undefined;
  return output.nodeIds
    ? { include: output.nodeIds }
    : { exclude: [...new Set(clips.filter(c => c.sceneGraphOutput?.graphId === output.graphId)
      .flatMap(c => c.sceneGraphOutput?.nodeIds ?? []))] };
}
