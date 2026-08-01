export type HistoryEntryKind = 'undoable' | 'current' | 'redoable' | 'event' | 'branch';
export type HistoryEventType = 'manual-save' | 'autosave' | 'system';

/**
 * One row of the history timeline. Snapshot nodes carry `nodeId`/`parentNodeId`
 * so the panel can draw the tree from parent pointers; the `kind` is always
 * RELATIVE to the active node: ancestors of the active node are 'undoable',
 * the redo continuation (last-visited child chain) is 'redoable', everything
 * else that holds a snapshot is 'branch'.
 */
export interface HistoryListEntry {
  id: string;
  kind: HistoryEntryKind;
  label: string;
  timestamp: number;
  /** Tree node id — set for every snapshot-bearing entry, absent for events. */
  nodeId?: string;
  /** Parent node id; null for the root node, absent for events. */
  parentNodeId?: string | null;
  /** True when this node lies on the root→active chain. */
  onActivePath?: boolean;
  /** Depth on the linear path relative to kind (undo depth / redo distance). */
  stackIndex?: number;
  eventType?: HistoryEventType;
  active?: boolean;
  highlighted?: boolean;

  // Legacy v1 fields — only present on entries parsed from old persisted
  // projects (schemaVersion 1). New code must not produce them.
  branchId?: string;
  branchLabel?: string;
  branchIndex?: number;
  branchBaseStackIndex?: number;
  branchBaseTimestamp?: number;
  branchLength?: number;
}

export interface HistoryTimelineEvent {
  id: string;
  type: HistoryEventType;
  label: string;
  timestamp: number;
}

/** Legacy (schemaVersion 1) branch record — read for migration only. */
export interface ProjectHistoryBranchState {
  id: string;
  label: string;
  createdAt: number;
  baseSnapshot: unknown | null;
  baseUndoStack: unknown[];
  snapshots: unknown[];
}

/** Legacy (schemaVersion 1) persisted shape — read for migration only. */
export interface ProjectHistoryStateV1 {
  schemaVersion: 1;
  undoStack: unknown[];
  redoStack: unknown[];
  currentSnapshot: unknown | null;
  eventLog?: HistoryTimelineEvent[];
  visibleEntries?: HistoryListEntry[];
  branches?: ProjectHistoryBranchState[];
  maxHistorySize?: number;
}

/** One persisted tree node. `snapshot` is validated on hydration. */
export interface ProjectHistoryNodeState {
  id: string;
  parentId: string | null;
  snapshot: unknown;
}

/**
 * Tree-based persisted shape. Every state is stored exactly once; the shared
 * past lives in the parent pointers instead of per-branch stack copies.
 */
export interface ProjectHistoryStateV2 {
  schemaVersion: 2;
  nodes: ProjectHistoryNodeState[];
  activeNodeId: string | null;
  /** Redo direction: which child to re-enter when redoing from a node. */
  lastVisitedChildByNodeId?: Record<string, string>;
  eventLog?: HistoryTimelineEvent[];
}

export type ProjectHistoryState = ProjectHistoryStateV1 | ProjectHistoryStateV2;
