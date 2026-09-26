import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import type { TimelineClip } from '../../../../types/timeline';

export interface NodeContextDeleteTargets {
  /** Clip effect the right-clicked node belongs to. */
  effect?: { effectId: string; label: string };
  /** Nested node group inside that effect's graph, addressed by its graph-local id. */
  group?: { effectId: string; groupId: string; label: string };
}

type Group = NonNullable<NodeGraph['groups']>[number];

/** Resolves which effect and nested node group a context-menu delete would remove. */
export function resolveNodeContextDeleteTargets(
  clip: TimelineClip,
  graph: NodeGraph,
  node: NodeGraphNode | null,
  /** Right-clicked group frame, used when no node card is the target. */
  groupId?: string | null,
): NodeContextDeleteTargets {
  const groups = graph.groups ?? [];
  const find = (id?: string | null) => (id ? groups.find(group => group.id === id) : undefined);
  const own = !node ? find(groupId)
    : node.binding?.kind === 'operator-group' ? find(node.binding.groupId)
    : groups.find(group => group.proxyId === node.id) ?? find(node.groupId);
  if (!node && !own) return {};

  let root: Group | undefined = own;
  while (root && !root.effectId && root.parentId) root = find(root.parentId);
  const effectId = (node?.binding && 'effectId' in node.binding ? node.binding.effectId : undefined)
    ?? root?.effectId
    ?? (node?.id.startsWith('effect-') ? node.id.slice('effect-'.length) : undefined);
  const effect = effectId ? clip.effects.find(candidate => candidate.id === effectId) : undefined;
  if (!effect) return {};

  const targets: NodeContextDeleteTargets = { effect: { effectId: effect.id, label: effect.name } };
  // Only nested groups are separate from the effect; an effect's own group is the effect.
  if (own && !own.effectId && own.parentId) {
    targets.group = { effectId: effect.id, groupId: own.id.split('/').at(-1)!, label: own.label };
  }
  return targets;
}
