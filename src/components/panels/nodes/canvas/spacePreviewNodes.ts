import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from './canvasGeometry';

/** Minimum clearance between placed blocks. */
export const PREVIEW_BLOCK_GAP = 56;
const GAP = PREVIEW_BLOCK_GAP, CELL = 512;
export interface PreviewLayoutBlock { id: string; x: number; y: number; width: number; height: number }
type Box = PreviewLayoutBlock & { originalX: number; originalY: number };

/** Resolve saved/default placement against the complete card, including its viewer.
 * Run only when graph geometry changes. A spatial grid keeps large graphs inexpensive.
 * Manual drag coordinates remain the visible coordinates and can be saved normally.
 */
export function spacePreviewNodes(nodes: NodeGraphNode[]): NodeGraphNode[] {
  const positions = new Map(spacePreviewBlocks(nodes.map(node => ({ id: node.id, ...node.layout, width: NODE_WIDTH, height: getNodeHeight(node) }))).map(box => [box.id, box]));
  return nodes.map(node => {
    const box = positions.get(node.id)!;
    return box.x === node.layout.x && box.y === node.layout.y ? node : { ...node, layout: { x: box.x, y: box.y } };
  });
}

/** Sibling groups occupy their full frame; moving a block preserves all its contents. */
export function spacePreviewBlocks(blocks: PreviewLayoutBlock[], fixedIds: ReadonlySet<string> = new Set()): PreviewLayoutBlock[] {
  const cells = new Map<string, Set<Box>>(), positions = new Map<string, PreviewLayoutBlock>();
  const keys = (box: Box) => {
    const result: string[] = [];
    for (let x = Math.floor((box.x - GAP) / CELL); x <= Math.floor((box.x + box.width + GAP) / CELL); x++)
      for (let y = Math.floor((box.y - GAP) / CELL); y <= Math.floor((box.y + box.height + GAP) / CELL); y++) result.push(`${x}:${y}`);
    return result;
  };
  for (const block of blocks.toSorted((a, b) => Number(fixedIds.has(b.id)) - Number(fixedIds.has(a.id)) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))) {
    const box: Box = { ...block, originalX: block.x, originalY: block.y };
    for (let attempt = 0; !fixedIds.has(block.id) && attempt < blocks.length; attempt++) {
      const neighbours = new Set(keys(box).flatMap(key => [...(cells.get(key) ?? [])]));
      const hit = [...neighbours].find(other => box.x < other.x + other.width + GAP && box.x + box.width + GAP > other.x
        && box.y < other.y + other.height + GAP && box.y + box.height + GAP > other.y);
      if (!hit) break;
      const nextX = hit.x + hit.width + GAP, nextY = hit.y + hit.height + GAP;
      // Preserve horizontal chains and stacked columns instead of packing every node into one row.
      if (Math.abs(block.y - hit.originalY) < 60 && block.x > hit.originalX - Math.min(block.width, hit.width) / 2) { box.x = nextX; box.y = Math.max(box.y, hit.y); }
      else box.y = nextY;
    }
    for (const key of keys(box)) { if (!cells.has(key)) cells.set(key, new Set()); cells.get(key)!.add(box); }
    positions.set(block.id, { ...block, x: box.x, y: box.y });
  }
  return blocks.map(block => positions.get(block.id)!);
}
