import type { HistoryListEntry, HistoryTimelineEvent } from '../../types/history';
import type { HistoryBranch, HistoryNavigationState, StateSnapshot } from './historyStoreTypes';
import { cloneSnapshotStack, deepClone } from './snapshotCloning';

function createHistoryEntry(
  snapshot: StateSnapshot,
  kind: HistoryListEntry['kind'],
  stackIndex: number
): HistoryListEntry {
  return {
    id: `${kind}:${stackIndex}:${snapshot.timestamp}:${snapshot.label}`,
    kind,
    label: snapshot.label,
    timestamp: snapshot.timestamp,
    stackIndex,
  };
}

function createHistoryEventEntry(event: HistoryTimelineEvent): HistoryListEntry {
  return {
    id: event.id,
    kind: 'event',
    label: event.label,
    timestamp: event.timestamp,
    eventType: event.type,
    highlighted: event.type === 'manual-save',
  };
}

function createHistoryBranchEntries(branch: HistoryBranch): HistoryListEntry[] {
  const baseStackIndex = branch.baseUndoStack.length + (branch.baseSnapshot ? 1 : 0);

  return branch.snapshots.map((snapshot, index) => ({
    id: `branch:${branch.id}:${index}:${snapshot.timestamp}:${snapshot.label}`,
    kind: 'branch',
    label: snapshot.label || branch.label || 'Alternative branch',
    timestamp: snapshot.timestamp,
    stackIndex: index,
    branchId: branch.id,
    branchLabel: branch.label,
    branchIndex: index,
    branchBaseStackIndex: baseStackIndex,
    branchBaseTimestamp: branch.baseSnapshot?.timestamp ?? branch.createdAt,
    branchLength: branch.snapshots.length,
  }));
}

export function createHistoryEntries(
  undoStack: StateSnapshot[],
  currentSnapshot: StateSnapshot | null,
  redoStack: StateSnapshot[],
  eventLog: HistoryTimelineEvent[],
  branches: HistoryBranch[]
): HistoryListEntry[] {
  return [
    ...undoStack.map((snapshot, index) => createHistoryEntry(snapshot, 'undoable', index)),
    ...(currentSnapshot ? [createHistoryEntry(currentSnapshot, 'current', undoStack.length)] : []),
    ...redoStack
      .slice()
      .reverse()
      .map((snapshot, index) => createHistoryEntry(snapshot, 'redoable', index)),
    ...eventLog.filter((event) => event.type !== 'autosave').map(createHistoryEventEntry),
    ...branches.flatMap(createHistoryBranchEntries),
  ];
}

export function createHistoryNavigationState(
  undoStack: StateSnapshot[],
  currentSnapshot: StateSnapshot | null,
  redoStack: StateSnapshot[],
  eventLog: HistoryTimelineEvent[],
  branches: HistoryBranch[]
): HistoryNavigationState {
  const entries = createHistoryEntries(undoStack, currentSnapshot, redoStack, eventLog, branches);
  const snapshotsByEntryId: Record<string, StateSnapshot> = {};

  undoStack.forEach((snapshot, index) => {
    const entry = createHistoryEntry(snapshot, 'undoable', index);
    snapshotsByEntryId[entry.id] = snapshot;
  });

  if (currentSnapshot) {
    const entry = createHistoryEntry(currentSnapshot, 'current', undoStack.length);
    snapshotsByEntryId[entry.id] = currentSnapshot;
  }

  redoStack
    .slice()
    .reverse()
    .forEach((snapshot, index) => {
      const entry = createHistoryEntry(snapshot, 'redoable', index);
      snapshotsByEntryId[entry.id] = snapshot;
    });

  for (const branch of branches) {
    for (const entry of createHistoryBranchEntries(branch)) {
      const index = entry.stackIndex;
      if (typeof index !== 'number') continue;
      const snapshot = branch.snapshots[index];
      if (snapshot) {
        snapshotsByEntryId[entry.id] = snapshot;
      }
    }
  }

  return { entries, snapshotsByEntryId };
}

export function markActiveHistoryEntry(
  entries: HistoryListEntry[],
  activeEntryId: string | null
): HistoryListEntry[] {
  return entries.map((entry) => ({
    ...entry,
    active: entry.id === activeEntryId || (!activeEntryId && entry.kind === 'current'),
  }));
}

function createBranchId(type: string): string {
  return `branch:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createBranchLabel(snapshots: StateSnapshot[], fallback = 'Alternative branch'): string {
  const tip = snapshots[snapshots.length - 1];
  return tip?.label ? `Branch: ${tip.label}` : fallback;
}

export function createBranchFromRedoPath(
  undoStack: StateSnapshot[],
  currentSnapshot: StateSnapshot | null,
  redoStack: StateSnapshot[]
): HistoryBranch | null {
  if (!currentSnapshot || redoStack.length === 0) return null;

  const snapshots = cloneSnapshotStack(redoStack.slice().reverse());
  if (snapshots.length === 0) return null;

  return {
    id: createBranchId('redo'),
    label: createBranchLabel(snapshots),
    createdAt: Date.now(),
    baseSnapshot: deepClone(currentSnapshot),
    baseUndoStack: cloneSnapshotStack(undoStack),
    snapshots,
  };
}

export function appendHistoryBranch(
  branches: HistoryBranch[],
  branch: HistoryBranch | null,
  maxBranches: number
): HistoryBranch[] {
  if (!branch || branch.snapshots.length === 0) return branches;
  return [...branches, branch].slice(-maxBranches);
}
