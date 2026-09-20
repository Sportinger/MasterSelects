import type { EffectOperatorGraph } from '../../types/operatorGraph';

/** Group hierarchy owns presentation and exposed boundaries, never copies processing nodes. */
export function groupOperators(graph: EffectOperatorGraph, nodeIds: string[], childIds: string[] = [], label = 'Group'): string {
  if (!nodeIds.length && !childIds.length) throw new Error('Select nodes to group.');
  const groups = graph.groups ??= [];
  if (nodeIds.some(id => !graph.nodes.some(n => n.id === id)) || childIds.some(id => !groups.some(g => g.id === id))) throw new Error('Group member unavailable.');
  const parents = new Set([...nodeIds.map(id => groups.find(g => g.nodeIds.includes(id))?.id), ...childIds.map(id => groups.find(g => g.id === id)?.parentId)]);
  const parentId = parents.size === 1 ? [...parents][0] : undefined;
  // Selecting a parent and its descendants is ambiguous; keep their existing hierarchy.
  if (childIds.some(id => { let p = groups.find(g => g.id === id)?.parentId; while (p) { if (childIds.includes(p)) return true; p = groups.find(g => g.id === p)?.parentId; } return false; })) throw new Error('Select sibling groups, not a parent and its child.');
  const id = `group-${crypto.randomUUID().slice(0, 8)}`;
  for (const group of groups) { group.nodeIds = group.nodeIds.filter(nodeId => !nodeIds.includes(nodeId)); if (childIds.includes(group.id)) group.parentId = id; }
  groups.push({ id, label, color: '#6d9ebd', nodeIds: [...new Set(nodeIds)], parentId });
  return id;
}

export function ungroupOperators(graph: EffectOperatorGraph, id: string) {
  const group = graph.groups?.find(g => g.id === id); if (!group) return;
  const parent = graph.groups?.find(g => g.id === group.parentId);
  parent?.nodeIds.push(...group.nodeIds);
  graph.groups = graph.groups!.filter(g => g.id !== id).map(g => g.parentId === id ? { ...g, parentId: group.parentId } : g);
}
