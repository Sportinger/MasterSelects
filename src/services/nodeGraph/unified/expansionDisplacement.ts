import type { NodeGraphLayout } from '../../../types/nodeGraph';

export interface WorkspaceLayoutBlock {
  id: string;
  anchor: NodeGraphLayout;
  bounds: { left: number; top: number; right: number; bottom: number };
  expanded: boolean;
  cardWidth: number;
  cardHeight: number;
  /** Lane rows and strips: stacked tightly; open bodies keep the full gap around them. */
  compact?: boolean;
}
const GAP = 32, COMPACT_GAP = 6;
export const workspaceBlockGap = (a: { compact?: boolean }, b: { compact?: boolean }) => a.compact && b.compact ? COMPACT_GAP : GAP;

/** Insert expansion space into the saved/default anchor grid, without changing it.
 * A final monotone sweep also handles manually overlapping anchors and tall nodes.
 * Each collision moves past a fixed earlier rectangle, so the sweep terminates. */
export function expansionDisplacements(blocks: readonly WorkspaceLayoutBlock[]): Record<string, NodeGraphLayout> {
  const ordered = blocks.toSorted((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x || a.id.localeCompare(b.id));
  const shifts = Object.fromEntries(ordered.map(block => [block.id, block.expanded
    ? { x: block.anchor.x - block.bounds.left, y: block.anchor.y - block.bounds.top }
    : { x: 0, y: 0 }]));
  const expansions = ordered.filter(block => block.expanded);
  if (!expansions.length) return shifts;
  for (const expansion of expansions) {
    const dx = Math.max(0, expansion.bounds.right - expansion.bounds.left - expansion.cardWidth + GAP);
    const dy = Math.max(0, expansion.bounds.bottom - expansion.bounds.top - expansion.cardHeight + GAP);
    for (const block of ordered) {
      if (block === expansion || block.anchor.y < expansion.anchor.y) continue;
      if (block.anchor.x > expansion.anchor.x) shifts[block.id].x += dx;
      if (block.anchor.y >= expansion.anchor.y + expansion.cardHeight) shifts[block.id].y += dy;
    }
  }
  const placed: Array<WorkspaceLayoutBlock> = [];
  for (const block of ordered) {
    const offset = shifts[block.id];
    const box = { left: block.bounds.left + offset.x, right: block.bounds.right + offset.x,
      top: block.bounds.top + offset.y, bottom: block.bounds.bottom + offset.y };
    for (;;) {
      const gap = (other: WorkspaceLayoutBlock) => workspaceBlockGap(block, other);
      const collision = placed.find(other => box.left < other.bounds.right + gap(other) && box.right + gap(other) > other.bounds.left
        && box.top < other.bounds.bottom + gap(other) && box.bottom + gap(other) > other.bounds.top);
      if (!collision) break;
      if (block.anchor.y >= collision.anchor.y + collision.cardHeight) {
        const delta = collision.bounds.bottom + gap(collision) - box.top;
        offset.y += delta; box.top += delta; box.bottom += delta;
      } else {
        const delta = collision.bounds.right + gap(collision) - box.left;
        offset.x += delta; box.left += delta; box.right += delta;
      }
    }
    placed.push({ ...block, bounds: box });
  }
  return shifts;
}

/** Persist a drag relative to its undisplaced anchor, never bake expansion into it. */
export function undisplacedWorkspacePoint(point: NodeGraphLayout, offset?: NodeGraphLayout): NodeGraphLayout {
  return { x: point.x - (offset?.x ?? 0), y: point.y - (offset?.y ?? 0) };
}
