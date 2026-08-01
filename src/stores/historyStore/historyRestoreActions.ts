import type { HistoryListEntry } from '../../types/history';
import type { HistoryRestoreResult, HistoryState, StateSnapshot } from './historyStoreTypes';
import { deepClone } from './snapshotCloning';

type Setter = (state: Partial<HistoryState>) => void;
export interface HistoryRestoreActionContext {
  get: () => HistoryState; set: Setter; applySnapshot: (snapshot: StateSnapshot) => void;
  isHistoryDisabledForDebug: () => boolean; isTimelineHistoryLocked: () => boolean;
  flushPendingCapture: () => void; suppressCaptures: () => void;
  log: { warn: (message: string) => void; debug: (message: string) => void };
}

export function restoreHistoryEntryAction(entry: HistoryListEntry, context: HistoryRestoreActionContext): HistoryRestoreResult | null {
  if (entry.kind === 'event' || context.isHistoryDisabledForDebug()) return null;
  if (context.isTimelineHistoryLocked()) { context.log.warn('Blocked history jump during timeline export'); return null; }
  if (context.get().batchId !== null) context.get().endBatch();
  context.flushPendingCapture();
  const state = context.get();
  const node = state.nodes[entry.nodeId ?? entry.id];
  if (!node || node.id === state.activeNodeId) return null;
  const directions = { ...state.lastVisitedChildByNodeId };
  let child = node;
  while (child.parentId && state.nodes[child.parentId]) {
    directions[child.parentId] = child.id;
    child = state.nodes[child.parentId];
  }
  context.set({ isApplying: true });
  context.applySnapshot(deepClone(node.snapshot));
  context.set({ activeNodeId: node.id, lastVisitedChildByNodeId: directions, isApplying: false });
  context.suppressCaptures();
  context.log.debug(`Jump to history entry: ${entry.label}`);
  return { operation: 'restore-branch', label: entry.label };
}

export function restoreHistoryBranchAction(branchId: string, _snapshotIndex: number | undefined, context: HistoryRestoreActionContext): HistoryRestoreResult | null {
  const node = context.get().nodes[branchId];
  return node ? restoreHistoryEntryAction({ id: node.id, nodeId: node.id, kind: 'branch', label: node.snapshot.label, timestamp: node.snapshot.timestamp }, context) : null;
}
