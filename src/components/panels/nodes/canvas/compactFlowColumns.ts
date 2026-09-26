import type { PreviewLayoutBlock } from './spacePreviewNodes';

/** Wrap complete dependency columns, preserving branch alignment within each column.
 * Measured group frames are indivisible: their contents move with the frame.
 */
export function compactFlowColumns<T extends PreviewLayoutBlock & { boundary?: 'input' | 'output' }>(blocks: T[], fixed: ReadonlySet<string>): T[] {
  const interior = blocks.filter(block => !block.boundary);
  if (interior.length !== blocks.length) {
    const compact = compactFlowColumns(interior, new Set(interior.filter(block => fixed.has(block.id)).map(block => block.id)));
    if (!interior.length) return blocks;
    const right = Math.max(...compact.map(block => block.x + block.width));
    const positions = new Map(compact.map(block => [block.id, block]));
    return blocks.map(block => positions.get(block.id) ?? (block.boundary === 'output' && !fixed.has(block.id)
      ? { ...block, x: right + 100 } : block));
  }
  if (blocks.length < 2 || fixed.size) return blocks;
  const left = Math.min(...blocks.map(block => block.x));
  const top = Math.min(...blocks.map(block => block.y));
  const columns = [...new Set(blocks.map(block => block.x))].toSorted((a, b) => a - b).map(x => {
    const members = blocks.filter(block => block.x === x);
    const y = Math.min(...members.map(block => block.y));
    return { x, y, members, width: Math.max(...members.map(block => block.width)),
      height: Math.max(...members.map(block => block.y + block.height)) - y };
  });
  if (columns.length < 2) return blocks;
  const totalWidth = columns.reduce((sum, column) => sum + column.width + 100, -100);
  const maxHeight = Math.max(...blocks.map(block => block.y + block.height)) - top;
  // Minimize the longest side, with a small area penalty to avoid excessive whitespace.
  const score = (width: number, height: number) => Math.max(width, height) + Math.min(width, height) * 0.15;
  let bestScore = score(totalWidth, maxHeight), best = blocks;
  const minWidth = Math.max(...columns.map(column => column.width));
  // A bounded search keeps large graphs cheap; always include the narrowest option.
  for (let candidate = 0; candidate < 32; candidate++) {
    const limit = minWidth + (totalWidth - minWidth) * candidate / 31;
    let x = 0, y = 0, rowHeight = 0, width = 0;
    const positions = new Map<string, T>();
    for (const column of columns) {
      if (x && x + column.width > limit) { x = 0; y += rowHeight + 120; rowHeight = 0; }
      for (const block of column.members) positions.set(block.id, { ...block,
        x: left + x, y: top + y + block.y - column.y });
      width = Math.max(width, x + column.width);
      rowHeight = Math.max(rowHeight, column.height);
      x += column.width + 100;
    }
    const nextScore = score(width, y + rowHeight);
    if (nextScore < bestScore) { bestScore = nextScore; best = blocks.map(block => positions.get(block.id)!); }
  }
  return best;
}
