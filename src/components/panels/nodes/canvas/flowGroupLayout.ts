import type { NodeGraphEdge } from '../../../../types/nodeGraph';
import type { PreviewLayoutBlock } from './spacePreviewNodes';

/** Both sides of an expanding effect participate, including bypass/side links. */
export function connectedFlowBlocks(blocks: Array<PreviewLayoutBlock & { nodeIds: string[]; flow?: boolean }>, edges: NodeGraphEdge[]): Set<string> {
  const owner = new Map(blocks.flatMap(block => block.nodeIds.map(id => [id, block.id] as const)));
  const connected = new Set(blocks.filter(block => block.flow).map(block => block.id));
  const links = edges.map(edge => [owner.get(edge.fromNodeId), owner.get(edge.toNodeId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of links) if (from && to && (connected.has(from) || connected.has(to))) {
      if (!connected.has(from) || !connected.has(to)) changed = true;
      connected.add(from); connected.add(to);
    }
  }
  return connected;
}

/** Arrange the current visible hierarchy, using measured child frames as single units. */
export function flowGroupLayout<T extends PreviewLayoutBlock & { nodeIds: string[]; source?: boolean }>(blocks: T[], edges: NodeGraphEdge[], fixed: ReadonlySet<string>, anchor?: { x: number; y: number }): T[] {
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
  const origin = anchor ?? { x: Math.min(...blocks.map(block => block.x)), y: Math.min(...blocks.map(block => block.y)) };
  const placed = new Map<string, T>();
  let x = origin.x;
  for (const column of [...new Set(ranks.values())].toSorted((a, b) => a - b)) {
    let items = blocks.filter(block => ranks.get(block.id) === column);
    let bottom = origin.y, columnWidth = Math.max(...items.map(block => block.width));
    // Large banks of independent values belong in a readable grid, not a single
    // multi-screen column. Processing steps and expanded groups retain flow order.
    const sources = items.filter(block => block.source);
    if (sources.length >= 8) {
      const rows = Math.ceil(Math.sqrt(sources.length)), width = Math.max(...sources.map(block => block.width));
      const height = Math.max(...sources.map(block => block.height));
      sources.toSorted((a, b) => a.id.localeCompare(b.id)).forEach((block, index) => placed.set(block.id,
        fixed.has(block.id) ? block : { ...block, x: x + Math.floor(index / rows) * (width + 100), y: origin.y + (index % rows) * (height + 80) }));
      columnWidth = Math.max(columnWidth, Math.ceil(sources.length / rows) * (width + 100) - 100);
      bottom += rows * (height + 80);
      items = items.filter(block => !block.source);
    }
    const desiredY = (block: T) => {
      const parents = [...incoming.get(block.id)!].flatMap(id => placed.has(id) ? [placed.get(id)!] : []);
      return parents.length ? parents.reduce((sum, parent) => sum + parent.y + parent.height / 2, 0) / parents.length - block.height / 2 : origin.y;
    };
    for (const block of items.toSorted((a, b) => desiredY(a) - desiredY(b) || a.id.localeCompare(b.id))) {
      const next = fixed.has(block.id) ? block : { ...block, x, y: Math.max(bottom, desiredY(block), origin.y) };
      placed.set(block.id, next); bottom = Math.max(bottom, next.y + next.height + 80);
    }
    x += columnWidth + 100;
  }
  return blocks.map(block => placed.get(block.id)!);
}
