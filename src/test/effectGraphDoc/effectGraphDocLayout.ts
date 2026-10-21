// Presentation-only layout steps for the effect graph doc shots. Nodes, ports, cables and
// folders stay exactly as projected; only card positions change, and focused folders get
// named stub cards for the values that come from outside them.
import { reconcileCanvasPlacement } from '../../components/panels/nodes/canvas/nodeCanvasPlacement';
import { getNodeHeight, getNodeWidth } from '../../components/panels/nodes/canvas/canvasGeometry';
import type { NodeGraph, NodeGraphEdge, NodeGraphLayout, NodeGraphNode, NodeGraphPort } from '../../types/nodeGraph';

/** Cards closer than this share a flow column. */
const COLUMN_TOLERANCE = 60;
const ROW_GAP = 150;
const STUB_GAP = 56;
const STUB_STACK_GAP = 24;
/** Docs columns are wide: aim for a landscape picture. */
const TARGET_ASPECT = 1.6;
const MAX_ROWS = 4;
export const DOC_STUB_PREFIX = 'doc-stub:';

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

/** What an output carries, as the folder ports name it ("Sigma", "Tap Count", a value's name). */
export function carriedPortLabel(node: NodeGraphNode, port: NodeGraphPort): string {
  if (port.label && port.label !== 'Value') return port.label;
  const name = node.params?.valueLabel;
  return typeof name === 'string' && name ? name : node.label;
}

/**
 * A focused folder shows only its own cards, so inputs fed from outside would look unconnected.
 * Each such source becomes a small named stub card in a column right before its first consumer.
 */
export function withBoundaryStubs(cropped: NodeGraph, full: NodeGraph, skip: (source: NodeGraphNode) => boolean): NodeGraph {
  const members = new Map(cropped.nodes.map(node => [node.id, node]));
  const sources = new Map(full.nodes.map(node => [node.id, node]));
  const stubs = new Map<string, { node: NodeGraphNode; targets: NodeGraphNode[] }>();
  const edges: NodeGraphEdge[] = [];
  for (const edge of full.edges) {
    const target = members.get(edge.toNodeId);
    if (!target || members.has(edge.fromNodeId)) continue;
    const source = sources.get(edge.fromNodeId), port = source?.outputs.find(item => item.id === edge.fromPortId);
    if (!source || !port || skip(source)) continue;
    const key = `${edge.fromNodeId}:${edge.fromPortId}`;
    let stub = stubs.get(key);
    if (!stub) {
      const label = carriedPortLabel(source, port);
      stub = { node: { id: `${DOC_STUB_PREFIX}${key}`, kind: 'source', runtime: 'builtin', label,
        description: `${label}, from ${source.label} outside this folder.`, inputs: [], outputs: [{ ...port, label }],
        layout: { x: 0, y: 0 }, ...(source.domain ? { domain: source.domain } : {}) }, targets: [] };
      stubs.set(key, stub);
    }
    stub.targets.push(target);
    edges.push({ ...edge, id: `doc-stub-edge:${edge.id}`, fromNodeId: stub.node.id });
  }
  if (!stubs.size) return cropped;
  const columns = flowColumns(cropped.nodes);
  const columnOf = new Map(columns.flatMap((column, index) => column.map(node => [node.id, index] as const)));
  const byColumn = new Map<number, Array<{ node: NodeGraphNode; targets: NodeGraphNode[] }>>();
  for (const stub of stubs.values()) {
    const column = Math.min(...stub.targets.map(target => columnOf.get(target.id)!));
    byColumn.set(column, [...byColumn.get(column) ?? [], stub]);
  }
  const moved = new Map<string, NodeGraphLayout>();
  let offset = 0;
  columns.forEach((column, index) => {
    const here = byColumn.get(index);
    if (here) {
      const left = Math.min(...column.map(node => node.layout.x)) + offset;
      let nextTop = -Infinity;
      const firstTarget = (stub: { targets: NodeGraphNode[] }) => stub.targets.find(target => columnOf.get(target.id) === index)!;
      for (const stub of here.toSorted((a, b) => firstTarget(a).layout.y - firstTarget(b).layout.y)) {
        const y = Math.max(firstTarget(stub).layout.y, nextTop);
        stub.node.layout = { x: left, y };
        nextTop = y + getNodeHeight(stub.node) + STUB_STACK_GAP;
      }
      offset += getNodeWidth(here[0].node) + STUB_GAP;
    }
    for (const node of column) moved.set(node.id, { x: node.layout.x + offset, y: node.layout.y });
  });
  const stubIds = [...stubs.values()].map(stub => stub.node.id);
  // Stubs join the focused folder: the canvas pushes foreign cards out of an open folder's frame.
  const focus = cropped.groups?.find(group => !group.collapsed && !cropped.groups!.some(other => other.id === group.parentId));
  return { ...cropped, nodes: [...cropped.nodes.map(node => ({ ...node, layout: moved.get(node.id) ?? node.layout })),
    ...[...stubs.values()].map(stub => stub.node)], edges: [...cropped.edges, ...edges],
  groups: cropped.groups?.map(group => group === focus ? { ...group, nodeIds: [...group.nodeIds, ...stubIds] } : group) };
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

/**
 * Splits a long left-to-right chain into rows that read like lines of text. `breaks` (node ids)
 * start a new row at their column; otherwise `rows` rows of equal column count. A stub column
 * stays on the row of the column it feeds.
 */
export function wrapFlowRows(graph: NodeGraph, rows: number | 'auto', breaks: readonly string[] = []): NodeGraph {
  const columns = flowColumns(graph.nodes);
  if (columns.length < 2) return graph;
  const left = columns[0][0].layout.x;
  const top = Math.min(...graph.nodes.map(node => node.layout.y));
  const height = Math.max(...graph.nodes.map(node => node.layout.y + getNodeHeight(node))) - top;
  const width = Math.max(...graph.nodes.map(node => node.layout.x + getNodeWidth(node))) - left;
  // Effect node ids are scoped (`clip-graph:…/horizontal-sample`): a break names the local id.
  const isBreak = (id: string) => breaks.some(token => id === token || id.endsWith(`/${token}`));
  const breakColumns = new Set(columns.flatMap((column, index) => column.some(node => isBreak(node.id)) ? [index] : []));
  const count = breakColumns.size ? breakColumns.size + 1
    : rows === 'auto' ? wrappedRowCount(width, height, columns.length) : Math.max(1, Math.min(Math.round(rows), columns.length));
  if (count === 1) return graph;
  const perRow = Math.ceil(columns.length / count);
  const rowOf = columns.map((_column, index) => breakColumns.size
    ? [...breakColumns].filter(start => start > 0 && start <= index).length : Math.floor(index / perRow));
  const isStubColumn = (column: NodeGraphNode[]) => column.every(node => node.id.startsWith(DOC_STUB_PREFIX));
  for (let index = columns.length - 2; index >= 0; index--) if (isStubColumn(columns[index])) rowOf[index] = rowOf[index + 1];
  const rowLeft = new Map<number, number>();
  columns.forEach((column, index) => rowLeft.set(rowOf[index], Math.min(rowLeft.get(rowOf[index]) ?? Infinity, ...column.map(node => node.layout.x))));
  const moved = new Map<string, NodeGraphLayout>();
  columns.forEach((column, index) => {
    const row = rowOf[index];
    for (const node of column) moved.set(node.id, { x: node.layout.x - rowLeft.get(row)! + left, y: node.layout.y + row * (height + ROW_GAP) });
  });
  return { ...graph, nodes: graph.nodes.map(node => moved.has(node.id) ? { ...node, layout: moved.get(node.id)! } : node) };
}
