// Presentation-only layout steps for the effect graph doc shots. Nodes, ports, cables and
// folders stay exactly as projected; only card positions change, and focused folders get
// named stub cards for the values that come from outside them.
import { reconcileCanvasPlacement } from '../../components/panels/nodes/canvas/nodeCanvasPlacement';
import { getNodeHeight, getNodeWidth, getPortCenter } from '../../components/panels/nodes/canvas/canvasGeometry';
import { cableRoute, sampleCableRoute } from '../../components/panels/nodes/canvas/cableRoute';
import { PREVIEW_BLOCK_GAP } from '../../components/panels/nodes/canvas/spacePreviewNodes';
import type { NodeGraph, NodeGraphEdge, NodeGraphLayout, NodeGraphNode, NodeGraphPort } from '../../types/nodeGraph';

/** Cards closer than this share a flow column. */
const COLUMN_TOLERANCE = 60;
const ROW_GAP = 90;
/** Gaps of the compact layout used for a hand-picked node selection (`only=`). */
const COMPACT_COLUMN_GAP = PREVIEW_BLOCK_GAP;
const COMPACT_ROW_GAP = PREVIEW_BLOCK_GAP;
const STUB_GAP = 56;
/** A cable keeps this distance (graph units) from cards it does not connect, or it seems to leave them. */
const CABLE_CLEARANCE = 8;
/** Candidate vertical moves for a card looking for a free slot, cheapest first (moving up costs three times more). */
const SLOT_OFFSETS = Array.from({ length: 240 }, (_, index) => (index >> 1) * 8 * (index % 2 ? -1 : 1) || 0)
  .toSorted((a, b) => (a < 0 ? -3 * a : a) - (b < 0 ? -3 * b : b));
/** Stacked cards keep the canvas' own clearance, or its placement pass pushes them further apart. */
const STUB_STACK_GAP = PREVIEW_BLOCK_GAP;
/** Room between a cable that passes a stub column and the stub's top edge. */
const STUB_CABLE_CLEARANCE = 24;
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

/** Title of a constant card: its value's name ("taper gain" → "Taper Gain"). */
const constantTitle = (node: NodeGraphNode) => String(node.params?.valueLabel ?? node.label).replace(/\b[a-z]/g, letter => letter.toUpperCase());

/**
 * The literal value node behind a folder port (a folded Constants folder exposes each value as
 * an output), or undefined. Shown as its own value card, the reader sees the number.
 */
function literalBehind(source: NodeGraphNode, port: NodeGraphPort, full: NodeGraph): NodeGraphNode | undefined {
  const endpoint = port.metadata?.groupEndpoint;
  if (source.label !== 'Constants' || source.binding?.kind !== 'operator-group' || !endpoint) return undefined;
  const inner = full.expandedNodes?.find(node => node.id === endpoint.nodeId || node.id.endsWith(`/${endpoint.nodeId}`));
  return inner?.operatorId?.startsWith('values.') ? inner : undefined;
}

export interface BoundaryStubOptions {
  /** Literal values from the Constants folder become value cards (else they stay cut, like plumbing). */
  constants?: boolean;
  /** false: leave the new cards for a later layout pass (compactRecipeLayout) instead of inserting stub columns. */
  place?: boolean;
}

/**
 * A focused folder shows only its own cards, so inputs fed from outside would look unconnected.
 * Each such source becomes a small named stub card in a column right before its first consumer;
 * with `constants`, a literal from the Constants folder becomes a copy of its value card.
 */
export function withBoundaryStubs(cropped: NodeGraph, full: NodeGraph, skip: (source: NodeGraphNode) => boolean,
  { constants = false, place = true }: BoundaryStubOptions = {}): NodeGraph {
  const members = new Map(cropped.nodes.map(node => [node.id, node]));
  const sources = new Map(full.nodes.map(node => [node.id, node]));
  const stubs = new Map<string, { node: NodeGraphNode; targets: NodeGraphNode[] }>();
  const edges: NodeGraphEdge[] = [];
  for (const edge of full.edges) {
    const target = members.get(edge.toNodeId);
    if (!target || members.has(edge.fromNodeId)) continue;
    const source = sources.get(edge.fromNodeId), port = source?.outputs.find(item => item.id === edge.fromPortId);
    if (!source || !port) continue;
    const literal = constants ? literalBehind(source, port, full) : undefined;
    if (literal) {
      let card = stubs.get(literal.id);
      if (!card) stubs.set(literal.id, card = { node: { ...literal, label: constantTitle(literal), layout: { x: 0, y: 0 } }, targets: [] });
      card.targets.push(target);
      edges.push({ ...edge, id: `doc-constant-edge:${edge.id}`, fromNodeId: literal.id, fromPortId: port.metadata!.groupEndpoint!.portId });
      continue;
    }
    if (skip(source)) continue;
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
  const stubIds = [...stubs.values()].map(stub => stub.node.id);
  // Stubs join the focused folder: the canvas pushes foreign cards out of an open folder's frame.
  const focus = cropped.groups?.find(group => !group.collapsed && !cropped.groups!.some(other => other.id === group.parentId));
  const groups = cropped.groups?.map(group => group === focus ? { ...group, nodeIds: [...group.nodeIds, ...stubIds] } : group);
  if (!place) return { ...cropped, nodes: [...cropped.nodes, ...[...stubs.values()].map(stub => stub.node)], edges: [...cropped.edges, ...edges], groups };
  const columns = flowColumns(cropped.nodes);
  const columnOf = new Map(columns.flatMap((column, index) => column.map(node => [node.id, index] as const)));
  const byColumn = new Map<number, Array<{ node: NodeGraphNode; targets: NodeGraphNode[] }>>();
  for (const stub of stubs.values()) {
    const column = Math.min(...stub.targets.map(target => columnOf.get(target.id)!));
    byColumn.set(column, [...byColumn.get(column) ?? [], stub]);
  }
  // Stubs whose consumers follow a column of plain value cards join that column instead of a new
  // one in between, so the value cables do not run behind the stubs (cards restack by consumer).
  const joinsPrevious = (index: number) => index > 0 && byColumn.has(index) && columns[index - 1].every(node => node.inputs.length === 0);
  // Height of the first input a card feeds: the consumer's top plus its port slot, so a card feeding Min sits above one feeding Max.
  const consumerY = (id: string) => Math.min(...[...cropped.edges, ...edges].filter(edge => edge.fromNodeId === id).map(edge => {
    const target = members.get(edge.toNodeId);
    return target ? target.layout.y + Math.max(0, target.inputs.findIndex(port => port.id === edge.toPortId)) : Infinity;
  }));
  const moved = new Map<string, NodeGraphLayout>();
  let offset = 0;
  columns.forEach((column, index) => {
    if (joinsPrevious(index + 1)) {
      const left = Math.min(...column.map(node => node.layout.x)) + offset;
      const cards = [...column.map(node => ({ node, y: consumerY(node.id), stub: false })),
        ...byColumn.get(index + 1)!.map(stub => ({ node: stub.node, y: consumerY(stub.node.id), stub: true }))];
      let nextTop = Math.min(...column.map(node => node.layout.y));
      for (const card of cards.toSorted((a, b) => a.y - b.y)) {
        const y = Math.max(Number.isFinite(card.y) ? card.y : nextTop, nextTop);
        if (card.stub) card.node.layout = { x: left, y }; else moved.set(card.node.id, { x: left, y });
        nextTop = y + getNodeHeight(card.node) + STUB_STACK_GAP;
      }
      return;
    }
    const here = joinsPrevious(index) ? undefined : byColumn.get(index);
    if (here) {
      const left = Math.min(...column.map(node => node.layout.x)) + offset;
      let nextTop = -Infinity;
      const firstTarget = (stub: { targets: NodeGraphNode[] }) => stub.targets.find(target => columnOf.get(target.id) === index)!;
      for (const stub of here.toSorted((a, b) => firstTarget(a).layout.y - firstTarget(b).layout.y)) {
        // Cables into the same card from earlier columns pass through this stub column: the stub
        // starts just below the lowest such port, so they run above it instead of behind it.
        const target = firstTarget(stub);
        const crossing = cropped.edges.filter(edge => edge.toNodeId === target.id && (columnOf.get(edge.fromNodeId) ?? index) < index)
          .map(edge => getPortCenter(target, edge.toPortId, 'input').y + STUB_CABLE_CLEARANCE);
        const y = Math.max(target.layout.y, ...crossing, nextTop);
        stub.node.layout = { x: left, y };
        nextTop = y + getNodeHeight(stub.node) + STUB_STACK_GAP;
      }
      offset += getNodeWidth(here[0].node) + STUB_GAP;
    }
    for (const node of column) moved.set(node.id, { x: node.layout.x + offset, y: node.layout.y });
  });
  return { ...cropped, nodes: [...cropped.nodes.map(node => ({ ...node, layout: moved.get(node.id) ?? node.layout })),
    ...[...stubs.values()].map(stub => stub.node)], edges: [...cropped.edges, ...edges], groups };
}

type Box = { left: number; top: number; right: number; bottom: number };
const boxOf = (node: NodeGraphNode): Box => ({ left: node.layout.x, top: node.layout.y, right: node.layout.x + getNodeWidth(node), bottom: node.layout.y + getNodeHeight(node) });
const inside = (box: Box, point: { x: number; y: number }, inset: number) =>
  point.x > box.left + inset && point.x < box.right - inset && point.y > box.top + inset && point.y < box.bottom - inset;

/** The points of an edge's cable as the canvas draws it without obstacle routing. */
export function edgeCablePoints(from: NodeGraphNode, to: NodeGraphNode, edge: NodeGraphEdge) {
  return sampleCableRoute(cableRoute(getPortCenter(from, edge.fromPortId, 'output'), getPortCenter(to, edge.toPortId, 'input')), 24);
}

/**
 * Cables that run through a card other than their own two ends: a reader would take them for a
 * connection of that card. The docs shot fails on them (effect-graph-shot.mjs).
 */
export function cableCrossings(nodes: readonly NodeGraphNode[], edges: readonly NodeGraphEdge[], inset = -CABLE_CLEARANCE): Array<{ edge: NodeGraphEdge; card: NodeGraphNode }> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const boxes = nodes.map(node => ({ node, box: boxOf(node) }));
  const found: Array<{ edge: NodeGraphEdge; card: NodeGraphNode }> = [];
  for (const edge of edges) {
    const from = byId.get(edge.fromNodeId), to = byId.get(edge.toNodeId);
    if (!from || !to || from === to) continue;
    const points = edgeCablePoints(from, to, edge);
    for (const { node, box } of boxes) if (node !== from && node !== to && points.some(point => inside(box, point, inset))) found.push({ edge, card: node });
  }
  return found;
}

/**
 * Lays a recipe (a hand-picked selection plus its stub and constant cards) out afresh. Columns
 * follow the cables, every card as far right as its consumers allow, so cables stay short. Cards
 * fed from inside the recipe sit level with their first input; cards fed by nothing (stubs,
 * constants) are placed afterwards next to their consumer's port, in a free slot that no cable
 * runs through and from where their own cable passes no other card (preferably below). Cards a
 * long cable still crosses then move up or down to the slot where the fewest cables cross cards.
 */
export function compactRecipeLayout(graph: NodeGraph): NodeGraph {
  const ids = new Set(graph.nodes.map(node => node.id));
  const internal = graph.edges.filter(edge => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId) && edge.fromNodeId !== edge.toNodeId);
  const sources = new Map<string, NodeGraphEdge[]>(), consumers = new Map<string, NodeGraphEdge[]>();
  for (const edge of internal) {
    sources.set(edge.toNodeId, [...sources.get(edge.toNodeId) ?? [], edge]);
    consumers.set(edge.fromNodeId, [...consumers.get(edge.fromNodeId) ?? [], edge]);
  }
  const depth = new Map<string, number>();
  const depthOf = (id: string, path: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return 0;
    path.add(id);
    const value = Math.max(-1, ...(sources.get(id) ?? []).map(edge => depthOf(edge.fromNodeId, path))) + 1;
    path.delete(id); depth.set(id, value);
    return value;
  };
  for (const node of graph.nodes) depthOf(node.id, new Set());
  for (const node of graph.nodes.toSorted((a, b) => depth.get(b.id)! - depth.get(a.id)!)) {
    const next = consumers.get(node.id)?.map(edge => depth.get(edge.toNodeId)!);
    if (next?.length) depth.set(node.id, Math.max(depth.get(node.id)!, Math.min(...next) - 1));
  }
  const pitch = Math.max(...graph.nodes.map(getNodeWidth)) + COMPACT_COLUMN_GAP;
  const columnCount = Math.max(...depth.values()) + 1;
  const portY = (node: NodeGraphNode, portId: string, direction: 'input' | 'output') => getPortCenter({ ...node, layout: { x: 0, y: 0 } }, portId, direction).y;
  const placed = new Map<string, NodeGraphNode>();
  const at = (node: NodeGraphNode, y: number) => { const card = { ...node, layout: { x: depth.get(node.id)! * pitch, y } }; placed.set(node.id, card); return card; };
  // Pass 1: fed cards, column by column, level with their highest placed source.
  for (let column = 0; column < columnCount; column++) {
    const fed = graph.nodes.filter(node => depth.get(node.id) === column && sources.has(node.id)).map(node => {
      const tops = (sources.get(node.id) ?? []).flatMap(edge => placed.has(edge.fromNodeId) ? [placed.get(edge.fromNodeId)!.layout.y] : []);
      return { node, desired: tops.length ? Math.min(...tops) : undefined };
    }).toSorted((a, b) => (a.desired ?? Infinity) - (b.desired ?? Infinity) || a.node.layout.y - b.node.layout.y);
    let nextTop = 0;
    for (const { node, desired } of fed) {
      const card = at(node, Math.max(nextTop, desired ?? nextTop));
      nextTop = card.layout.y + getNodeHeight(card) + COMPACT_ROW_GAP;
    }
  }
  const crowded = (card: NodeGraphNode) => {
    const box = boxOf(card);
    return [...placed.values()].some(other => { if (other.id === card.id) return false; const b = boxOf(other);
      return b.left < box.right && b.right > box.left && b.top < box.bottom + COMPACT_ROW_GAP && b.bottom + COMPACT_ROW_GAP > box.top; });
  };
  // Pass 2: cards fed by nothing, beside the consumer port they feed, in the order of those ports.
  const free = graph.nodes.filter(node => !sources.has(node.id)).map(node => {
    const target = (consumers.get(node.id) ?? []).filter(edge => placed.has(edge.toNodeId))
      .map(edge => ({ edge, y: placed.get(edge.toNodeId)!.layout.y + portY(placed.get(edge.toNodeId)!, edge.toPortId, 'input') }))
      .toSorted((a, b) => depth.get(a.edge.toNodeId)! - depth.get(b.edge.toNodeId)! || a.y - b.y)[0];
    return { node, desired: target ? target.y - portY(node, target.edge.fromPortId, 'output') : 0 };
  }).toSorted((a, b) => depth.get(a.node.id)! - depth.get(b.node.id)! || a.desired - b.desired);
  for (const { node, desired } of free) {
    const fits = (y: number) => {
      const card = { ...node, layout: { x: depth.get(node.id)! * pitch, y } }, box = boxOf(card);
      if (crowded(card)) return false;
      const cards = [...placed.values()];
      const own = (consumers.get(node.id) ?? []).filter(edge => placed.has(edge.toNodeId));
      if (own.some(edge => { const to = placed.get(edge.toNodeId)!; const points = edgeCablePoints(card, to, edge);
        return cards.some(other => other !== to && points.some(point => inside(boxOf(other), point, -CABLE_CLEARANCE))); })) return false;
      return !internal.some(edge => placed.has(edge.fromNodeId) && placed.has(edge.toNodeId)
        && edgeCablePoints(placed.get(edge.fromNodeId)!, placed.get(edge.toNodeId)!, edge).some(point => inside(box, point, -CABLE_CLEARANCE)));
    };
    // Below is cheaper than above: stacked inputs keep the order of the ports they feed.
    const y = SLOT_OFFSETS.map(offset => desired + offset).find(fits) ?? desired;
    at(node, y);
  }
  const firstPass = new Map([...placed.values()].map(card => [card.id, card.layout.y]));
  // A long cable that still runs through a card: move single cards up or down to where the fewest
  // cables cross any card (a few rounds of local search; cables between moved cards follow).
  const crossingCount = () => cableCrossings([...placed.values()], internal).length;
  for (let round = 0, count = crossingCount(); round < 6 && count > 0; round++) {
    const crossed = [...new Set(cableCrossings([...placed.values()], internal).flatMap(({ edge, card }) => [card.id, edge.toNodeId]))];
    for (const id of crossed) {
      const card = placed.get(id)!, start = card.layout.y;
      let best = { y: start, score: count * 10_000 };
      for (const offset of SLOT_OFFSETS) {
        const moved = at(card, start + offset);
        if (crowded(moved)) continue;
        const score = crossingCount() * 10_000 + Math.abs(offset);
        if (score < best.score) best = { y: start + offset, score };
      }
      at(card, best.y);
      count = Math.floor(best.score / 10_000);
      if (!count) break;
    }
  }
  // Then every card moves back as close to where the first passes wanted it as the crossings allow
  // (a card pushed far down for a cable that another move resolved returns).
  const wanted = new Map(graph.nodes.map(node => [node.id, firstPass.get(node.id)!]));
  for (let round = 0, count = crossingCount(); round < 2; round++) for (const node of graph.nodes.toSorted((a, b) => depth.get(a.id)! - depth.get(b.id)!)) {
    const card = placed.get(node.id)!, start = card.layout.y, target = wanted.get(node.id)!;
    if (start === target) continue;
    const candidates = SLOT_OFFSETS.map(offset => target + offset).filter(y => Math.abs(y - target) < Math.abs(start - target));
    let settled = start;
    for (const y of candidates) {
      if (crowded(at(card, y)) || crossingCount() > count) continue;
      settled = y; break;
    }
    at(card, settled);
  }
  const top = Math.min(...[...placed.values()].map(node => node.layout.y));
  return { ...graph, nodes: graph.nodes.map(node => ({ ...node, layout: { x: placed.get(node.id)!.layout.x, y: placed.get(node.id)!.layout.y - top } })) };
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
  const rowLeft = new Map<number, number>(), rowTop = new Map<number, number>(), rowBottom = new Map<number, number>();
  columns.forEach((column, index) => {
    const row = rowOf[index];
    rowLeft.set(row, Math.min(rowLeft.get(row) ?? Infinity, ...column.map(node => node.layout.x)));
    rowTop.set(row, Math.min(rowTop.get(row) ?? Infinity, ...column.map(node => node.layout.y)));
    rowBottom.set(row, Math.max(rowBottom.get(row) ?? -Infinity, ...column.map(node => node.layout.y + getNodeHeight(node))));
  });
  // Each row is as tall as its own cards, so short rows leave no empty band.
  const rowOffset = new Map<number, number>();
  let nextTop = top;
  for (const row of [...rowTop.keys()].toSorted((a, b) => a - b)) {
    rowOffset.set(row, nextTop - rowTop.get(row)!);
    nextTop += rowBottom.get(row)! - rowTop.get(row)! + ROW_GAP;
  }
  const moved = new Map<string, NodeGraphLayout>();
  columns.forEach((column, index) => {
    const row = rowOf[index];
    for (const node of column) moved.set(node.id, { x: node.layout.x - rowLeft.get(row)! + left, y: node.layout.y + rowOffset.get(row)! });
  });
  return { ...graph, nodes: graph.nodes.map(node => moved.has(node.id) ? { ...node, layout: moved.get(node.id)! } : node) };
}
