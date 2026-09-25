import type { NodeCableBranch, NodeGraphEdge } from '../../../../types/nodeGraph';
import type { NodeGraphPoint } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';

type Branches = Readonly<Record<string, NodeCableBranch>>;

export interface ResolvedCableBranches {
  /** Branch point each branched edge leaves from. */
  edgeBranch: Map<string, string>;
  /** Top-level branch of each branched edge; its cables share one output grip. */
  edgeRoot: Map<string, string>;
  /** Branches with at least one live cable below them, with their validated parent. */
  live: Map<string, NodeCableBranch & { parent?: string }>;
}

/** One painted, hit-tested cable: a whole connection, a branch-to-input leg, or a trunk into a branch point. */
export interface RoutedCable {
  id: string;
  edge?: NodeGraphEdge;
  /** Output grip whose port colors the cable. */
  output: ConnectionPlug;
  from: NodeGraphPoint;
  to: NodeGraphPoint;
  fromNode?: string; toNode?: string;
  fromBranch?: string; toBranch?: string;
  /** Waypoints that route the cable around cards; absent for direct cables. */
  via?: readonly NodeGraphPoint[];
}

/** Graph units shared by the painted branch point and its DOM hit targets. */
export const BRANCH_RADIUS = 7;
/** Distance from a branch point to the end of its connection grip. */
export const BRANCH_GRIP = 22;
/** Branch points keep a usable screen size in far overviews. */
export const branchMetrics = (zoom: number) => ({ radius: Math.max(BRANCH_RADIUS, 5 / zoom), grip: Math.max(BRANCH_GRIP, 18 / zoom) });

const TRUNK = 'branch:';
export const branchCableId = (id: string) => `${TRUNK}${id}`;
export const branchOfCable = (cableId: string | null | undefined) => cableId?.startsWith(TRUNK) ? cableId.slice(TRUNK.length) : undefined;
export const newBranchId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Parent branch, only when it exists and belongs to the same output socket. */
function validParent(branches: Branches, id: string): string | undefined {
  const branch = branches[id], parent = branch?.parentId ? branches[branch.parentId] : undefined;
  return parent && parent.nodeId === branch.nodeId && parent.portId === branch.portId ? branch.parentId : undefined;
}

/** Branch ids from `id` up to its top-level branch, stopping at invalid parents and cycles. */
export function branchChain(branches: Branches, id: string): string[] {
  const chain = [id];
  for (let parent = validParent(branches, id); parent && !chain.includes(parent); parent = validParent(branches, parent)) chain.push(parent);
  return chain;
}

export function resolveCableBranches(edges: readonly NodeGraphEdge[], branches: Branches = {}): ResolvedCableBranches {
  const edgeBranch = new Map<string, string>(), edgeRoot = new Map<string, string>();
  const live = new Map<string, NodeCableBranch & { parent?: string }>();
  const ids = Object.keys(branches);
  if (!ids.length) return { edgeBranch, edgeRoot, live };
  for (const edge of edges) {
    const id = ids.find(key => {
      const branch = branches[key];
      return branch.nodeId === edge.fromNodeId && branch.portId === edge.fromPortId
        && branch.targets.some(target => target.nodeId === edge.toNodeId && target.portId === edge.toPortId);
    });
    if (!id) continue;
    const chain = branchChain(branches, id);
    edgeBranch.set(edge.id, id); edgeRoot.set(edge.id, chain.at(-1)!);
    chain.forEach((branchId, index) => live.set(branchId, { ...branches[branchId], parent: chain[index + 1] }));
  }
  return { edgeBranch, edgeRoot, live };
}

/** Pairs each connection's grips and routes branched ones through their branch points. */
export function routeCables(plugs: readonly ConnectionPlug[], resolved: ResolvedCableBranches): RoutedCable[] {
  const pairs = new Map<string, { output?: ConnectionPlug; input?: ConnectionPlug }>();
  for (const plug of plugs) {
    const pair = pairs.get(plug.edge.id) ?? {};
    pair[plug.port.direction] = plug; pairs.set(plug.edge.id, pair);
  }
  const cables: RoutedCable[] = [], rootGrip = new Map<string, ConnectionPlug>();
  for (const [id, { output, input }] of pairs) {
    if (!output || !input) continue;
    const edge = output.edge, branchId = resolved.edgeBranch.get(id), branch = branchId ? resolved.live.get(branchId) : undefined;
    if (!branch) {
      cables.push({ id, edge, output, from: output.tip, to: input.tip, fromNode: edge.fromNodeId, toNode: edge.toNodeId });
      continue;
    }
    cables.push({ id, edge, output, from: { x: branch.x, y: branch.y }, to: input.tip, fromBranch: branchId, toNode: edge.toNodeId });
    const root = resolved.edgeRoot.get(id)!;
    if (!rootGrip.has(root)) rootGrip.set(root, output);
  }
  for (const [id, branch] of resolved.live) {
    const parent = branch.parent ? resolved.live.get(branch.parent) : undefined;
    let root = id;
    for (let above = branch.parent; above; above = resolved.live.get(above)?.parent) root = above;
    const grip = rootGrip.get(root);
    if (!grip) continue;
    cables.push({ id: branchCableId(id), output: grip, to: { x: branch.x, y: branch.y }, toBranch: id,
      ...(parent ? { from: { x: parent.x, y: parent.y }, fromBranch: branch.parent } : { from: grip.tip, fromNode: branch.nodeId }) });
  }
  return cables;
}

const matches = (a: { nodeId: string; portId: string }, b: { nodeId: string; portId: string }) => a.nodeId === b.nodeId && a.portId === b.portId;

/** Splits a cable at `point`: a connection moves onto a new branch point, a trunk gets a point inserted. */
export function insertCableBranch(branches: Branches, cable: RoutedCable, point: NodeGraphPoint, id = newBranchId()): Record<string, NodeCableBranch> {
  const next = { ...branches };
  const trunk = branchOfCable(cable.id);
  if (trunk && next[trunk]) {
    next[id] = { nodeId: next[trunk].nodeId, portId: next[trunk].portId, parentId: validParent(branches, trunk), x: point.x, y: point.y, targets: [] };
    next[trunk] = { ...next[trunk], parentId: id };
    return next;
  }
  const edge = cable.edge;
  if (!edge) return next;
  const target = { nodeId: edge.toNodeId, portId: edge.toPortId };
  if (cable.fromBranch && next[cable.fromBranch]) {
    next[cable.fromBranch] = { ...next[cable.fromBranch], targets: next[cable.fromBranch].targets.filter(item => !matches(item, target)) };
  }
  next[id] = { nodeId: edge.fromNodeId, portId: edge.fromPortId, ...(cable.fromBranch ? { parentId: cable.fromBranch } : {}), x: point.x, y: point.y, targets: [target] };
  return next;
}

/** Removes branch points; their cables and child points continue from the parent (or the socket). */
export function removeCableBranches(branches: Branches, ids: ReadonlySet<string>): Record<string, NodeCableBranch> {
  const next = { ...branches };
  for (const id of ids) {
    const branch = next[id];
    if (!branch) continue;
    const parent = validParent(next, id);
    for (const [childId, child] of Object.entries(next)) if (child.parentId === id) next[childId] = { ...child, parentId: parent };
    if (parent) next[parent] = { ...next[parent], targets: [...next[parent].targets, ...branch.targets.filter(target => !next[parent].targets.some(item => matches(item, target)))] };
    delete next[id];
  }
  return next;
}

/** Adds an input socket to a branch point, taking it away from any other point of the same output. */
export function addBranchTarget(branches: Branches, id: string, target: { nodeId: string; portId: string }): Record<string, NodeCableBranch> {
  const branch = branches[id];
  if (!branch) return { ...branches };
  const next: Record<string, NodeCableBranch> = {};
  for (const [key, value] of Object.entries(branches)) next[key] = value.nodeId === branch.nodeId && value.portId === branch.portId
    ? { ...value, targets: value.targets.filter(item => !matches(item, target)) } : value;
  next[id] = { ...next[id], targets: [...next[id].targets, target] };
  return next;
}
