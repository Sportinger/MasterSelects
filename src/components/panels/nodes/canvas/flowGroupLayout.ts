import type { NodeGraphEdge } from '../../../../types/nodeGraph';
import type { PreviewLayoutBlock } from './spacePreviewNodes';

/** Arrange the current visible hierarchy, using measured child frames as single units. */
export function flowGroupLayout<T extends PreviewLayoutBlock & { nodeIds: string[] }>(blocks: T[], edges: NodeGraphEdge[], fixed: ReadonlySet<string>): T[] {
  if (!blocks.length) return blocks;
  const owner = new Map(blocks.flatMap(block => block.nodeIds.map(id => [id, block.id] as const)));
  const incoming = new Map(blocks.map(block => [block.id, new Set<string>()]));
  for (const edge of edges) {
    const from = owner.get(edge.fromNodeId), to = owner.get(edge.toNodeId);
    if (from && to && from !== to) incoming.get(to)!.add(from);
  }
  const ranks = new Map<string, number>(), visiting = new Set<string>();
  const rank = (id: string): number => {
    if (ranks.has(id)) return ranks.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value = Math.max(0, ...[...incoming.get(id)!].map(parent => rank(parent) + 1));
    visiting.delete(id); ranks.set(id, value); return value;
  };
  blocks.forEach(block => rank(block.id));
  for (const block of blocks) if (!incoming.get(block.id)!.size) {
    const consumers = blocks.filter(other => incoming.get(other.id)!.has(block.id));
    if (consumers.length) ranks.set(block.id, Math.max(0, Math.min(...consumers.map(other => ranks.get(other.id)!)) - 1));
  }
  const origin = { x: Math.min(...blocks.map(block => block.x)), y: Math.min(...blocks.map(block => block.y)) };
  const placed = new Map<string, T>();
  let x = origin.x;
  for (const column of [...new Set(ranks.values())].toSorted((a, b) => a - b)) {
    const items = blocks.filter(block => ranks.get(block.id) === column);
    const desiredY = (block: T) => {
      const parents = [...incoming.get(block.id)!].flatMap(id => placed.has(id) ? [placed.get(id)!] : []);
      return parents.length ? parents.reduce((sum, parent) => sum + parent.y + parent.height / 2, 0) / parents.length - block.height / 2 : origin.y;
    };
    let bottom = origin.y;
    for (const block of items.toSorted((a, b) => desiredY(a) - desiredY(b) || a.id.localeCompare(b.id))) {
      const next = fixed.has(block.id) ? block : { ...block, x, y: Math.max(bottom, desiredY(block), origin.y) };
      placed.set(block.id, next); bottom = Math.max(bottom, next.y + next.height + 80);
    }
    x += Math.max(...items.map(block => block.width)) + 100;
  }
  return blocks.map(block => placed.get(block.id)!);
}
