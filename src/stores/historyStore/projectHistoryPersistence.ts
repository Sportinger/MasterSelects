import type {
  HistoryListEntry,
  HistoryTimelineEvent,
  ProjectHistoryBranchState,
} from '../../types/history';
import type { HistoryBranch, StateSnapshot } from './historyStoreTypes';
import { deepClone } from './snapshotCloning';

function isStateSnapshot(value: unknown): value is StateSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<StateSnapshot>;
  return (
    typeof snapshot.timestamp === 'number' &&
    typeof snapshot.label === 'string' &&
    Boolean(snapshot.timeline && typeof snapshot.timeline === 'object') &&
    Boolean(snapshot.media && typeof snapshot.media === 'object') &&
    Boolean(snapshot.dock && typeof snapshot.dock === 'object') &&
    Boolean(snapshot.flashboard && typeof snapshot.flashboard === 'object') &&
    Boolean(snapshot.export && typeof snapshot.export === 'object')
  );
}

export function normalizePersistedSnapshot(value: unknown): StateSnapshot | null {
  if (!isStateSnapshot(value)) return null;
  return deepClone(value);
}

export function normalizePersistedSnapshotStack(
  values: unknown[],
  maxHistorySize: number
): StateSnapshot[] {
  return values
    .map(normalizePersistedSnapshot)
    .filter((snapshot): snapshot is StateSnapshot => snapshot !== null)
    .slice(-maxHistorySize);
}

function isHistoryTimelineEvent(value: unknown): value is HistoryTimelineEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<HistoryTimelineEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.label === 'string' &&
    typeof event.timestamp === 'number' &&
    (event.type === 'manual-save' || event.type === 'autosave' || event.type === 'system')
  );
}

export function normalizePersistedEventLog(
  values: unknown,
  maxEventLogSize: number
): HistoryTimelineEvent[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter(isHistoryTimelineEvent)
    .filter((event) => event.type !== 'autosave')
    .slice(-maxEventLogSize);
}

function isHistoryListEntry(value: unknown): value is HistoryListEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HistoryListEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.kind === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.timestamp === 'number' &&
    (
      entry.kind === 'undoable' ||
      entry.kind === 'current' ||
      entry.kind === 'redoable' ||
      entry.kind === 'event' ||
      entry.kind === 'branch'
    )
  );
}

export function normalizePersistedVisibleEntries(
  values: unknown,
  maxEventLogSize: number
): HistoryListEntry[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter(isHistoryListEntry)
    .filter((entry) => entry.eventType !== 'autosave')
    .slice(-maxEventLogSize);
}

function isProjectHistoryBranchState(value: unknown): value is ProjectHistoryBranchState {
  if (!value || typeof value !== 'object') return false;
  const branch = value as Partial<ProjectHistoryBranchState>;
  return (
    typeof branch.id === 'string' &&
    typeof branch.label === 'string' &&
    typeof branch.createdAt === 'number' &&
    Array.isArray(branch.baseUndoStack) &&
    Array.isArray(branch.snapshots)
  );
}

function normalizePersistedBranch(value: unknown, maxHistorySize: number): HistoryBranch | null {
  if (!isProjectHistoryBranchState(value)) return null;

  const snapshots = normalizePersistedSnapshotStack(value.snapshots, maxHistorySize);
  if (snapshots.length === 0) return null;

  return {
    id: value.id,
    label: value.label,
    createdAt: value.createdAt,
    baseSnapshot: normalizePersistedSnapshot(value.baseSnapshot),
    baseUndoStack: normalizePersistedSnapshotStack(value.baseUndoStack, maxHistorySize),
    snapshots,
  };
}

export function normalizePersistedBranches(
  values: unknown,
  maxHistorySize: number,
  maxBranches: number
): HistoryBranch[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizePersistedBranch(value, maxHistorySize))
    .filter((branch): branch is HistoryBranch => branch !== null)
    .slice(-maxBranches);
}

export function limitSnapshotStackForProject(
  snapshots: StateSnapshot[],
  maxHistorySize: number,
  maxPersistedHistorySnapshots: number
): StateSnapshot[] {
  return snapshots.slice(-Math.min(maxHistorySize, maxPersistedHistorySnapshots));
}

export function limitBranchForProject(
  branch: HistoryBranch,
  maxHistorySize: number,
  maxPersistedHistorySnapshots: number
): HistoryBranch {
  return {
    ...branch,
    baseSnapshot: branch.baseSnapshot,
    baseUndoStack: limitSnapshotStackForProject(
      branch.baseUndoStack,
      maxHistorySize,
      maxPersistedHistorySnapshots
    ),
    snapshots: limitSnapshotStackForProject(
      branch.snapshots,
      maxHistorySize,
      maxPersistedHistorySnapshots
    ),
  };
}
