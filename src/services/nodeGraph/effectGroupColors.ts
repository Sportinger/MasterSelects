import type { NodeGraph } from '../../types/nodeGraph';

/** Stable per-instance hue shared by the graph and effect inspector. */
export function effectGroupColor(identity: string, depth = 0): string {
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const hue = ((hash >>> 0) / 0x100000000 * 360).toFixed(2);
  return `hsl(${hue}, 62%, ${depth % 2 ? 85 : 60}%)`;
}

/** Color from the owning effect, alternating light/dark at each nesting level. */
export function colorEffectGroups(graph: NodeGraph): NodeGraph {
  const groups = graph.groups ?? [];
  const byId = new Map(groups.map(group => [group.id, group]));
  return { ...graph, groups: groups.map(group => {
    let root = group, depth = 0;
    const visited = new Set([root.id]);
    while (root.parentId) {
      const parent = byId.get(root.parentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id); root = parent; depth++;
    }
    const identity = root.effectId ? `effect:${root.effectId}` : root.id;
    return { ...group, color: effectGroupColor(identity, depth), colorDepth: depth };
  }) };
}
