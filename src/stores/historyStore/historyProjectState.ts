import type { ProjectHistoryState, ProjectHistoryStateV1 } from '../../types/history';
import type { HistoryNode, HistoryState, StateSnapshot } from './historyStoreTypes';
import { cloneHistoryForProject, deepClone } from './snapshotCloning';
import { normalizePersistedEventLog, normalizePersistedSnapshot } from './projectHistoryPersistence';

const nodeId = () => `node:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
const MAX_PERSISTED_HISTORY_NODES = 50;

export function serializeHistoryForProject(input: Pick<HistoryState, 'nodes' | 'rootId' | 'activeNodeId' | 'lastVisitedChildByNodeId' | 'eventLog'> & { isHistoryDisabled: boolean; persistHistorySnapshots: boolean; maxEventLogSize: number }): ProjectHistoryState | null {
  const eventLog = input.isHistoryDisabled ? [] : input.eventLog.filter((event) => event.type !== 'autosave').slice(-input.maxEventLogSize);
  if (input.isHistoryDisabled || !input.persistHistorySnapshots) return { schemaVersion: 2, nodes: [], activeNodeId: null, lastVisitedChildByNodeId: {}, eventLog };
  const included = new Set<string>();
  let cursor = input.activeNodeId;
  while (cursor && input.nodes[cursor] && included.size < 32) { included.add(cursor); cursor = input.nodes[cursor].parentId; }
  let changed = true;
  while (changed && included.size < MAX_PERSISTED_HISTORY_NODES) {
    changed = false;
    for (const node of Object.values(input.nodes).sort((a, b) => b.snapshot.timestamp - a.snapshot.timestamp)) {
      if (included.size >= MAX_PERSISTED_HISTORY_NODES) break;
      if (!included.has(node.id) && (!node.parentId || included.has(node.parentId))) { included.add(node.id); changed = true; }
    }
  }
  const nodes = Object.values(input.nodes).filter((n) => included.has(n.id)).map((node) => ({
    id: node.id, parentId: node.parentId && included.has(node.parentId) ? node.parentId : null, snapshot: deepClone(node.snapshot),
  }));
  const lastVisitedChildByNodeId = Object.fromEntries(Object.entries(input.lastVisitedChildByNodeId).filter(([parent, child]) => included.has(parent) && included.has(child)));
  return cloneHistoryForProject({ schemaVersion: 2, nodes, activeNodeId: included.has(input.activeNodeId ?? '') ? input.activeNodeId : null, lastVisitedChildByNodeId, eventLog });
}

function addChain(nodes: Record<string, HistoryNode>, snapshots: StateSnapshot[], parentId: string | null): string | null {
  let parent = parentId;
  for (const snapshot of snapshots) { const id = nodeId(); nodes[id] = { id, parentId: parent, snapshot }; parent = id; }
  return parent;
}

function migrateV1(history: ProjectHistoryStateV1): { nodes: Record<string, HistoryNode>; rootId: string | null; activeNodeId: string | null } {
  const nodes: Record<string, HistoryNode> = {};
  const undo = history.undoStack.map(normalizePersistedSnapshot).filter((x): x is StateSnapshot => !!x);
  const current = normalizePersistedSnapshot(history.currentSnapshot);
  const redo = history.redoStack.map(normalizePersistedSnapshot).filter((x): x is StateSnapshot => !!x).reverse();
  const trunk = [...undo, ...(current ? [current] : []), ...redo];
  addChain(nodes, trunk, null);
  const trunkIds = Object.keys(nodes);
  const activeNodeId = current ? trunkIds[undo.length] ?? null : trunkIds[trunkIds.length - 1] ?? null;
  for (const branch of history.branches ?? []) {
    const baseUndo = branch.baseUndoStack.map(normalizePersistedSnapshot).filter((x): x is StateSnapshot => !!x);
    const base = normalizePersistedSnapshot(branch.baseSnapshot);
    const index = Math.max(0, Math.min(trunkIds.length - 1, baseUndo.length + (base ? 1 : 0) - 1));
    const snapshots = branch.snapshots.map(normalizePersistedSnapshot).filter((x): x is StateSnapshot => !!x);
    if (snapshots.length) addChain(nodes, snapshots, trunkIds[index] ?? null);
  }
  return { nodes, rootId: trunkIds[0] ?? null, activeNodeId };
}

export function createHistoryProjectHydrationState(input: { history: ProjectHistoryState | null | undefined; isHistoryDisabled: boolean; createInitialHistorySnapshot: () => StateSnapshot | null; maxEventLogSize: number }): Partial<HistoryState> {
  if (input.isHistoryDisabled) return { nodes: {}, rootId: null, activeNodeId: null, lastVisitedChildByNodeId: {}, eventLog: [], isApplying: false, batchId: null, batchLabel: null };
  if (!input.history) {
    const initial = input.createInitialHistorySnapshot(); const id = initial ? nodeId() : null;
    return { nodes: initial && id ? { [id]: { id, parentId: null, snapshot: initial } } : {}, rootId: id, activeNodeId: id, lastVisitedChildByNodeId: {}, eventLog: [], isApplying: false, batchId: null, batchLabel: null };
  }
  let nodes: Record<string, HistoryNode> = {}; let rootId: string | null = null; let activeNodeId: string | null = null; let directions: Record<string, string> = {};
  if (input.history.schemaVersion === 1) ({ nodes, rootId, activeNodeId } = migrateV1(input.history));
  else {
    for (const raw of input.history.nodes) if (typeof raw.id === 'string' && (raw.parentId === null || typeof raw.parentId === 'string')) { const snapshot = normalizePersistedSnapshot(raw.snapshot); if (snapshot) nodes[raw.id] = { id: raw.id, parentId: raw.parentId, snapshot }; }
    for (const id of Object.keys(nodes)) { let cursor: HistoryNode | undefined = nodes[id]; const seen = new Set<string>(); while (cursor?.parentId) { if (seen.has(cursor.id) || !nodes[cursor.parentId]) { delete nodes[id]; break; } seen.add(cursor.id); cursor = nodes[cursor.parentId]; } }
    const roots = Object.values(nodes).filter((n) => !n.parentId); const wanted = input.history.activeNodeId;
    const containsActive = (root: string) => { let c = wanted ? nodes[wanted] : undefined; while (c) { if (c.id === root) return true; c = c.parentId ? nodes[c.parentId] : undefined; } return false; };
    rootId = roots.find((n) => containsActive(n.id))?.id ?? roots.sort((a,b) => Object.values(nodes).filter(n => n.id === a.id || n.parentId === a.id).length - Object.values(nodes).filter(n => n.id === b.id || n.parentId === b.id).length)[0]?.id ?? null;
    const keep = new Set<string>(); for (const n of Object.values(nodes)) { let c: HistoryNode | undefined = n; while (c) { if (c.id === rootId) { keep.add(n.id); break; } c = c.parentId ? nodes[c.parentId] : undefined; } } for (const id of Object.keys(nodes)) if (!keep.has(id)) delete nodes[id];
    activeNodeId = wanted && nodes[wanted] ? wanted : Object.values(nodes).sort((a,b) => b.snapshot.timestamp - a.snapshot.timestamp)[0]?.id ?? null;
    directions = Object.fromEntries(Object.entries(input.history.lastVisitedChildByNodeId ?? {}).filter(([p,c]) => nodes[p] && nodes[c]?.parentId === p));
  }
  // A persisted history without snapshot nodes (snapshots disabled, stripped,
  // or all invalid) must still seed the boot state — otherwise the first
  // capture after load becomes the root and that edit can never be undone.
  if (Object.keys(nodes).length === 0) {
    const initial = input.createInitialHistorySnapshot();
    if (initial) {
      const id = nodeId();
      nodes[id] = { id, parentId: null, snapshot: initial };
      rootId = id; activeNodeId = id; directions = {};
    }
  }
  return { nodes, rootId, activeNodeId, lastVisitedChildByNodeId: directions, eventLog: normalizePersistedEventLog(input.history.eventLog, input.maxEventLogSize), isApplying: false, batchId: null, batchLabel: null };
}
