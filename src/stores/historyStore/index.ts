// Global undo/redo history store
// Captures snapshots of all undoable state across stores

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Logger } from '../../services/logger';
import type { HistoryTimelineEvent } from '../../types/history';
import type {
  DockStoreSnapshot,
  ExportStoreSnapshot,
  FlashBoardStoreSnapshot,
  HistoryState,
  HistoryStoreInitRefs,
  HistoryStoreRefs,
  MediaStoreState,
  StateSnapshot,
  TimelineStoreState,
} from './historyStoreTypes';
export type {
  HistoryOperationResult,
  HistoryRestoreResult,
} from './historyStoreTypes';
import {
  appendHistoryBranch,
  createBranchFromRedoPath,
  createHistoryEntries,
  markActiveHistoryEntry,
} from './historyNavigation';
import {
  HISTORY_DEBUG_DISABLE_STORAGE_KEY,
  isHistoryDisabledForDebug,
  setHistoryDisabledForDebug,
} from './historyDebug';
import {
  createHistorySnapshot,
  createInitialHistorySnapshot as createInitialHistorySnapshotFromRefs,
} from './snapshotCapture';
import { applyHistorySnapshot } from './snapshotApply';
import { createHistoryFacade } from './historyFacade';
import {
  restoreHistoryBranchAction,
  restoreHistoryEntryAction,
  type HistoryRestoreActionContext,
} from './historyRestoreActions';
import {
  createHistoryProjectHydrationState,
  serializeHistoryForProject,
} from './historyProjectState';

export {
  HISTORY_DEBUG_DISABLE_STORAGE_KEY,
  isHistoryDisabledForDebug,
  setHistoryDisabledForDebug,
};

const log = Logger.create('History');
const MAX_HISTORY_EVENT_LOG_SIZE = 500;
const MAX_HISTORY_BRANCHES = 24;
const MAX_PERSISTED_HISTORY_SNAPSHOTS = 32;
const PERSIST_HISTORY_SNAPSHOTS = false;
const HISTORY_CAPTURE_WARN_MS = 24;

// Callback to flush pending debounced captures before undo/redo (set by useGlobalHistory)
// Flush = execute the pending capture immediately so its state isn't lost
let flushPendingCaptureCallback: (() => void) | null = null;
let suppressCapturesCallback: (() => void) | null = null;
// Called after a snapshot is applied (undo/redo/jump/restore) so the preview can
// be rebuilt - restoring deleted clips otherwise leaves a stale canvas.
let afterApplyCallback: (() => void) | null = null;
export function setHistoryCallbacks(callbacks: {
  flushPendingCapture: () => void;
  suppressCaptures: () => void;
  afterApply?: () => void;
}) {
  flushPendingCaptureCallback = callbacks.flushPendingCapture;
  suppressCapturesCallback = callbacks.suppressCaptures;
  afterApplyCallback = callbacks.afterApply ?? null;
}

// Import stores dynamically to avoid circular dependencies
let getTimelineState: (() => TimelineStoreState) | undefined;
let setTimelineState: ((state: Partial<TimelineStoreState>) => void) | undefined;
let getMediaState: (() => MediaStoreState) | undefined;
let setMediaState: ((state: Partial<MediaStoreState>) => void) | undefined;
let getDockState: (() => DockStoreSnapshot) | undefined;
let setDockState: ((state: Partial<DockStoreSnapshot>) => void) | undefined;
let getFlashBoardState: (() => FlashBoardStoreSnapshot) | undefined;
let setFlashBoardState: ((state: Partial<FlashBoardStoreSnapshot>) => void) | undefined;
let getExportState: (() => ExportStoreSnapshot) | undefined;
let setExportState: ((state: Partial<ExportStoreSnapshot>) => void) | undefined;

// Initialize store references (called from useGlobalHistory)
export function initHistoryStoreRefs(stores: HistoryStoreInitRefs) {
  getTimelineState = stores.timeline.getState;
  setTimelineState = stores.timeline.setState;
  getMediaState = stores.media.getState;
  setMediaState = stores.media.setState;
  getDockState = stores.dock.getState;
  setDockState = stores.dock.setState;
  getFlashBoardState = stores.flashboard?.getState;
  setFlashBoardState = stores.flashboard?.setState;
  getExportState = stores.export?.getState;
  setExportState = stores.export?.setState;
}

function getHistoryStoreRefs(): HistoryStoreRefs {
  return {
    getTimelineState,
    setTimelineState,
    getMediaState,
    setMediaState,
    getDockState,
    setDockState,
    getFlashBoardState,
    setFlashBoardState,
    getExportState,
    setExportState,
  };
}

function createSnapshot(label: string, previousSnapshot?: StateSnapshot | null): StateSnapshot {
  return createHistorySnapshot(label, getHistoryStoreRefs(), previousSnapshot);
}

function createInitialHistorySnapshot(): StateSnapshot | null {
  return createInitialHistorySnapshotFromRefs(getHistoryStoreRefs());
}

function applySnapshot(snapshot: StateSnapshot): void {
  applyHistorySnapshot(snapshot, getHistoryStoreRefs(), {
    afterApply: afterApplyCallback ?? undefined,
    onTimelineEditStateRestored: (diagnostics) => {
      log.debug('Restored timeline from HistoryTimelineEditState', diagnostics);
    },
  });
}

function isTimelineHistoryLocked(): boolean {
  return getTimelineState?.().isExporting === true;
}

function flushPendingCapture(): void {
  flushPendingCaptureCallback?.();
}

function suppressCaptures(): void {
  suppressCapturesCallback?.();
}

function createRestoreContext(
  set: (state: Partial<HistoryState>) => void,
  get: () => HistoryState
): HistoryRestoreActionContext {
  return {
    get,
    set,
    applySnapshot,
    isHistoryDisabledForDebug,
    isTimelineHistoryLocked,
    flushPendingCapture,
    suppressCaptures,
    log,
  };
}

export const useHistoryStore = create<HistoryState>()(
  subscribeWithSelector((set, get) => ({
    undoStack: [],
    redoStack: [],
    eventLog: [],
    branches: [],
    navigationEntries: null,
    navigationSnapshotsByEntryId: {},
    activeEntryId: null,
    currentSnapshot: null,
    maxHistorySize: 50,
    isApplying: false,
    batchId: null,
    batchLabel: null,

    captureSnapshot: (label: string, options?: { isAutoCapture?: boolean }) => {
      if (isHistoryDisabledForDebug()) return;

      const { isApplying, undoStack, currentSnapshot, redoStack, branches, maxHistorySize, batchId } = get();

      // Don't capture during undo/redo application
      if (isApplying) return;

      // If batching, don't create new snapshots until batch ends
      if (batchId !== null) return;

      // An EXPLICIT capture (a slice action calling this directly) is the
      // authoritative undo step for its edit. The change-subscription in
      // useGlobalHistory will ALSO see this edit's store mutation and schedule a
      // debounced fallback capture (~150ms later); left alone that produces a
      // redundant second, no-op undo step (the user has to press Ctrl+Z twice).
      // Reuse the post-undo suppression window to drop that trailing fallback.
      // The fallback path itself passes isAutoCapture:true so it never self-suppresses.
      if (!options?.isAutoCapture) {
        suppressCaptures();
      }

      const captureStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const newSnapshot = createSnapshot(label, currentSnapshot);
      const captureDurationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - captureStartedAt;
      if (captureDurationMs > HISTORY_CAPTURE_WARN_MS) {
        log.warn('Slow history snapshot capture', {
          label,
          durationMs: Math.round(captureDurationMs),
        });
      }

      // Push current state to undo stack (if exists)
      if (currentSnapshot) {
        const branch = createBranchFromRedoPath(undoStack, currentSnapshot, redoStack);
        const newUndoStack = [...undoStack, currentSnapshot];
        // Limit history size
        if (newUndoStack.length > maxHistorySize) {
          newUndoStack.shift();
        }
        set({
          undoStack: newUndoStack,
          redoStack: [], // Clear redo stack on new action
          branches: appendHistoryBranch(branches, branch, MAX_HISTORY_BRANCHES),
          currentSnapshot: newSnapshot,
          navigationEntries: null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: null,
        });
      } else {
        set({
          undoStack: [],
          redoStack: [],
          branches: [],
          currentSnapshot: newSnapshot,
          navigationEntries: null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: null,
        });
      }
    },

    undo: () => {
      if (isHistoryDisabledForDebug()) return null;

      if (isTimelineHistoryLocked()) {
        log.warn('Blocked undo during timeline export');
        return null;
      }

      // End any stuck batch first (safety: lost mouseup etc.)
      if (get().batchId !== null) {
        get().endBatch();
      }

      // Flush pending debounced capture so we don't lose the latest state
      flushPendingCapture();

      // Re-read stacks after flush may have pushed new entries
      const { undoStack, currentSnapshot, redoStack } = get();
      if (undoStack.length === 0) return null;

      set({ isApplying: true });

      // Pop from undo stack
      const newUndoStack = [...undoStack];
      const previousSnapshot = newUndoStack.pop()!;
      const undoneLabel = currentSnapshot?.label || previousSnapshot.label;

      // Push current to redo stack
      const newRedoStack = currentSnapshot
        ? [...redoStack, currentSnapshot]
        : redoStack;

      // Apply previous state
      applySnapshot(previousSnapshot);

      set({
        undoStack: newUndoStack,
        redoStack: newRedoStack,
        currentSnapshot: previousSnapshot,
        navigationEntries: null,
        navigationSnapshotsByEntryId: {},
        activeEntryId: null,
        isApplying: false,
      });

      // Suppress auto-captures for 200ms to prevent cascading state changes from re-capturing
      suppressCaptures();

      log.debug(`Undo: ${undoneLabel} (stack: ${newUndoStack.length})`);
      return { operation: 'undo', label: undoneLabel };
    },

    redo: () => {
      if (isHistoryDisabledForDebug()) return null;

      if (isTimelineHistoryLocked()) {
        log.warn('Blocked redo during timeline export');
        return null;
      }

      // End any stuck batch first
      if (get().batchId !== null) {
        get().endBatch();
      }

      // Flush pending debounced capture
      flushPendingCapture();

      // Re-read stacks after flush
      const { redoStack, currentSnapshot, undoStack } = get();
      if (redoStack.length === 0) return null;

      set({ isApplying: true });

      // Pop from redo stack
      const newRedoStack = [...redoStack];
      const nextSnapshot = newRedoStack.pop()!;

      // Push current to undo stack
      const newUndoStack = currentSnapshot
        ? [...undoStack, currentSnapshot]
        : undoStack;

      // Apply next state
      applySnapshot(nextSnapshot);

      set({
        undoStack: newUndoStack,
        redoStack: newRedoStack,
        currentSnapshot: nextSnapshot,
        navigationEntries: null,
        navigationSnapshotsByEntryId: {},
        activeEntryId: null,
        isApplying: false,
      });

      // Suppress auto-captures for 200ms
      suppressCaptures();

      log.debug(`Redo: ${nextSnapshot.label} (stack: ${newRedoStack.length})`);
      return { operation: 'redo', label: nextSnapshot.label };
    },

    canUndo: () => !isHistoryDisabledForDebug() && get().undoStack.length > 0,
    canRedo: () => !isHistoryDisabledForDebug() && get().redoStack.length > 0,
    getHistoryEntries: () => {
      if (isHistoryDisabledForDebug()) return [];

      const {
        undoStack,
        currentSnapshot,
        redoStack,
        eventLog,
        branches,
        navigationEntries,
        activeEntryId,
      } = get();
      if (navigationEntries) {
        return markActiveHistoryEntry(navigationEntries, activeEntryId);
      }
      return markActiveHistoryEntry(
        createHistoryEntries(undoStack, currentSnapshot, redoStack, eventLog, branches),
        activeEntryId
      );
    },

    recordEvent: (type, label) => {
      if (isHistoryDisabledForDebug()) return;

      if (type === 'autosave') return;

      const timestamp = Date.now();
      const trimmedLabel = label.trim();
      const event: HistoryTimelineEvent = {
        id: `event:${type}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`,
        type,
        label: trimmedLabel.length > 0 ? trimmedLabel : 'History event',
        timestamp,
      };

      set((state) => ({
        eventLog: [...state.eventLog, event].slice(-MAX_HISTORY_EVENT_LOG_SIZE),
      }));
    },

    restoreEntry: (entry) => restoreHistoryEntryAction(entry, createRestoreContext(set, get)),

    restoreBranch: (branchId, snapshotIndex) => (
      restoreHistoryBranchAction(branchId, snapshotIndex, createRestoreContext(set, get))
    ),

    startBatch: (label: string) => {
      if (isHistoryDisabledForDebug()) return;

      const { batchId, currentSnapshot } = get();
      if (batchId !== null) return; // Already batching

      // Capture initial state before batch
      if (!currentSnapshot) {
        set({ currentSnapshot: createSnapshot('initial') });
      }

      set({
        batchId: Date.now(),
        batchLabel: label,
      });
    },

    endBatch: () => {
      const { batchId, batchLabel, undoStack, currentSnapshot, redoStack, branches, maxHistorySize } = get();
      if (batchId === null) return;
      if (isHistoryDisabledForDebug()) {
        set({ batchId: null, batchLabel: null });
        return;
      }

      // Create final snapshot with batch label
      const captureStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const finalSnapshot = createSnapshot(batchLabel || 'batch', currentSnapshot);
      const captureDurationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - captureStartedAt;
      if (captureDurationMs > HISTORY_CAPTURE_WARN_MS) {
        log.warn('Slow history batch capture', {
          label: batchLabel || 'batch',
          durationMs: Math.round(captureDurationMs),
        });
      }

      // Push previous state to undo stack
      if (currentSnapshot) {
        const branch = createBranchFromRedoPath(undoStack, currentSnapshot, redoStack);
        const newUndoStack = [...undoStack, currentSnapshot];
        if (newUndoStack.length > maxHistorySize) {
          newUndoStack.shift();
        }
        set({
          undoStack: newUndoStack,
          redoStack: [],
          branches: appendHistoryBranch(branches, branch, MAX_HISTORY_BRANCHES),
          currentSnapshot: finalSnapshot,
          navigationEntries: null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: null,
          batchId: null,
          batchLabel: null,
        });
      } else {
        set({
          currentSnapshot: finalSnapshot,
          navigationEntries: null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: null,
          batchId: null,
          batchLabel: null,
        });
      }
    },

    setIsApplying: (value: boolean) => set({ isApplying: value }),

    clearHistory: () => set({
      undoStack: [],
      redoStack: [],
      branches: [],
      navigationEntries: null,
      navigationSnapshotsByEntryId: {},
      activeEntryId: null,
      currentSnapshot: null,
    }),

    serializeForProject: () => {
      const state = get();
      return serializeHistoryForProject({
        undoStack: state.undoStack,
        redoStack: state.redoStack,
        currentSnapshot: state.currentSnapshot,
        eventLog: state.eventLog,
        branches: state.branches,
        maxHistorySize: state.maxHistorySize,
        navigationEntries: state.navigationEntries,
        activeEntryId: state.activeEntryId,
        isHistoryDisabled: isHistoryDisabledForDebug(),
        maxEventLogSize: MAX_HISTORY_EVENT_LOG_SIZE,
        maxHistoryBranches: MAX_HISTORY_BRANCHES,
        maxPersistedHistorySnapshots: MAX_PERSISTED_HISTORY_SNAPSHOTS,
        persistHistorySnapshots: PERSIST_HISTORY_SNAPSHOTS,
      });
    },

    hydrateFromProject: (history) => {
      set(createHistoryProjectHydrationState({
        history,
        currentMaxHistorySize: get().maxHistorySize,
        isHistoryDisabled: isHistoryDisabledForDebug(),
        createInitialHistorySnapshot,
        maxEventLogSize: MAX_HISTORY_EVENT_LOG_SIZE,
        maxHistoryBranches: MAX_HISTORY_BRANCHES,
        persistHistorySnapshots: PERSIST_HISTORY_SNAPSHOTS,
      }));
    },
  }))
);

const historyFacade = createHistoryFacade(useHistoryStore);

export const captureSnapshot = historyFacade.captureSnapshot;
export const undo = historyFacade.undo;
export const redo = historyFacade.redo;
export const startBatch = historyFacade.startBatch;
export const endBatch = historyFacade.endBatch;
export const recordHistoryEvent = historyFacade.recordHistoryEvent;
export const restoreHistoryEntry = historyFacade.restoreHistoryEntry;
export const restoreHistoryBranch = historyFacade.restoreHistoryBranch;
export const serializeHistoryStateForProject = historyFacade.serializeHistoryStateForProject;
export const hydrateHistoryStateFromProject = historyFacade.hydrateHistoryStateFromProject;
