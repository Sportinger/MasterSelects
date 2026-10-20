// Presentation-only layout steps for the effect graph doc shots. Nodes, ports, cables and
// folders stay exactly as projected; only card positions change.
import { reconcileCanvasPlacement } from '../../components/panels/nodes/canvas/nodeCanvasPlacement';
import { getNodeHeight, getNodeWidth } from '../../components/panels/nodes/canvas/canvasGeometry';
import type { NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../types/nodeGraph';

/** Cards closer than this share a flow column. */
const COLUMN_TOLERANCE = 60;
const ROW_GAP = 150;
/** Docs columns are wide: aim for a landscape picture. */
const TARGET_ASPECT = 1.6;
const MAX_ROWS = 4;

/** Writes the canvas' own placement (the flow layout of an open effect) into the node layouts,
 * so a folder cropped out of the effect keeps the arrangement it has inside it. */
export function withCanvasPlacement(graph: NodeGraph): NodeGraph {
  const placement = reconcileCanvasPlacement(graph);
  return { ...graph, nodes: graph.nodes.map(node => placement.nodes[node.id] ? { ...node, layout: placement.nodes[node.id] } : node) };
}

function flowColumns(nodes: readonly NodeGraphNode[]): NodeGraphNode[][] {
  const columns: NodeGraphNode[][] = [];
  for (const node of nodes.toSorted((a, b) => a.layout.x - b.layout.x)) {
    const column = columns.at(-1);
    if (column && node.layout.x - column[0].layout.x < COLUMN_TOLERANCE) column.push(node); else columns.push([node]);
  }
  return columns;
}

export function wrappedRowCount(width: number, height: number, columns: number): number {
  let best = 1, bestScore = Infinity;
  for (let rows = 1; rows <= Math.min(MAX_ROWS, columns); rows++) {
    const aspect = (width / rows) / (rows * height + (rows - 1) * ROW_GAP);
    const score = Math.abs(Math.log(aspect / TARGET_ASPECT));
    if (score < bestScore) { best = rows; bestScore = score; }
  }
  return best;
}

/** Splits a long left-to-right chain into rows that read like lines of text. */
export function wrapFlowRows(graph: NodeGraph, rows: number | 'auto'): NodeGraph {
  const columns = flowColumns(graph.nodes);
  if (columns.length < 2) return graph;
  const left = columns[0][0].layout.x;
  const top = Math.min(...graph.nodes.map(node => node.layout.y));
  const height = Math.max(...graph.nodes.map(node => node.layout.y + getNodeHeight(node))) - top;
  const width = Math.max(...graph.nodes.map(node => node.layout.x + getNodeWidth(node))) - left;
  const count = rows === 'auto' ? wrappedRowCount(width, height, columns.length) : Math.max(1, Math.min(Math.round(rows), columns.length));
  if (count === 1) return graph;
  const perRow = Math.ceil(columns.length / count);
  const moved = new Map<string, NodeGraphLayout>();
  columns.forEach((column, index) => {
    const row = Math.floor(index / perRow), rowLeft = columns[row * perRow][0].layout.x;
    for (const node of column) moved.set(node.id, { x: node.layout.x - rowLeft + left, y: node.layout.y + row * (height + ROW_GAP) });
  });
  return { ...graph, nodes: graph.nodes.map(node => moved.has(node.id) ? { ...node, layout: moved.get(node.id)! } : node) };
}
