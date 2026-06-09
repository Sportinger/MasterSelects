// Global undo/redo history store
// Captures snapshots of all undoable state across stores

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Logger } from '../../services/logger';
import { flashBoardMediaBridge } from '../../services/flashboard/FlashBoardMediaBridge';
import type { Keyframe } from '../../types';
import type {
  HistoryEventType,
  HistoryListEntry,
  HistoryTimelineEvent,
  ProjectHistoryState,
} from '../../types/history';
import { createDefaultFlashBoardComposer } from '../flashboardStore/defaults';
import type { ExportStoreData } from '../exportStore';
import { createDefaultExportStoreData, getExportStoreData } from '../exportStore';
import {
  createHistoryTimelineEditState,
  type HistoryTimelineEditState,
} from '../timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../timeline/historyTimelineRestoreState';
import { syncHistoryRehydratedTimelineRuntimeResources } from '../../services/timeline/historyRuntimeRehydration';
import { clearAINodeRuntimeCache } from '../../services/nodeGraph';
import { stopTimelineAudioPlayback } from '../../services/audio/timelineAudioPlaybackStopper';
import type {
  DockStoreSnapshot,
  ExportStoreSnapshot,
  FlashBoardStoreSnapshot,
  HistoryState,
  MediaStoreState,
  StateSnapshot,
  TimelineStoreState,
} from './historyStoreTypes';
export type {
  HistoryOperationResult,
  HistoryRestoreResult,
} from './historyStoreTypes';
import {
  cloneClipForHistory,
  cloneCompositionForHistory,
  cloneHistoryForProject,
  cloneMasterAudioState,
  cloneMediaFileForHistory,
  cloneSnapshotStack,
  cloneTrackForHistory,
  deepClone,
} from './snapshotCloning';
import {
  appendHistoryBranch,
  createBranchFromRedoPath,
  createHistoryEntries,
  createHistoryNavigationState,
  markActiveHistoryEntry,
} from './historyNavigation';
import {
  limitBranchForProject,
  limitSnapshotStackForProject,
  normalizePersistedBranches,
  normalizePersistedEventLog,
  normalizePersistedSnapshot,
  normalizePersistedSnapshotStack,
  normalizePersistedVisibleEntries,
} from './projectHistoryPersistence';

const log = Logger.create('History');
const MAX_HISTORY_EVENT_LOG_SIZE = 500;
const MAX_HISTORY_BRANCHES = 24;
const MAX_PERSISTED_HISTORY_SNAPSHOTS = 32;
const PERSIST_HISTORY_SNAPSHOTS = false;
const HISTORY_CAPTURE_WARN_MS = 24;
export const HISTORY_DEBUG_DISABLE_STORAGE_KEY = 'masterselects.debug.disableHistory';

type HistoryDebugWindow = Window & {
  __MS_DISABLE_HISTORY__?: boolean;
  __MS_HISTORY_DEBUG__?: {
    disable: () => void;
    enable: () => void;
    isDisabled: () => boolean;
    storageKey: string;
  };
};

function readHistoryDebugStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage?.getItem(HISTORY_DEBUG_DISABLE_STORAGE_KEY);
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
}

export function isHistoryDisabledForDebug(): boolean {
  if (typeof window === 'undefined') return false;
  const debugWindow = window as HistoryDebugWindow;
  return debugWindow.__MS_DISABLE_HISTORY__ === true || readHistoryDebugStorage();
}

export function setHistoryDisabledForDebug(disabled: boolean): void {
  if (typeof window === 'undefined') return;
  const debugWindow = window as HistoryDebugWindow;
  debugWindow.__MS_DISABLE_HISTORY__ = disabled;
  try {
    if (disabled) {
      window.localStorage?.setItem(HISTORY_DEBUG_DISABLE_STORAGE_KEY, '1');
    } else {
      window.localStorage?.removeItem(HISTORY_DEBUG_DISABLE_STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function installHistoryDebugControls(): void {
  if (typeof window === 'undefined') return;
  const debugWindow = window as HistoryDebugWindow;
  debugWindow.__MS_HISTORY_DEBUG__ = {
    disable: () => setHistoryDisabledForDebug(true),
    enable: () => setHistoryDisabledForDebug(false),
    isDisabled: isHistoryDisabledForDebug,
    storageKey: HISTORY_DEBUG_DISABLE_STORAGE_KEY,
  };
}

installHistoryDebugControls();

// Callback to flush pending debounced captures before undo/redo (set by useGlobalHistory)
// Flush = execute the pending capture immediately so its state isn't lost
let flushPendingCaptureCallback: (() => void) | null = null;
let suppressCapturesCallback: (() => void) | null = null;
// Called after a snapshot is applied (undo/redo/jump/restore) so the preview can
// be rebuilt — restoring deleted clips otherwise leaves a stale canvas.
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
export function initHistoryStoreRefs(stores: {
  timeline: { getState: () => TimelineStoreState; setState: (state: Partial<TimelineStoreState>) => void };
  media: { getState: () => MediaStoreState; setState: (state: Partial<MediaStoreState>) => void };
  dock: { getState: () => DockStoreSnapshot; setState: (state: Partial<DockStoreSnapshot>) => void };
  flashboard?: { getState: () => FlashBoardStoreSnapshot; setState: (state: Partial<FlashBoardStoreSnapshot>) => void };
  export?: { getState: () => ExportStoreSnapshot; setState: (state: Partial<ExportStoreSnapshot>) => void };
}) {
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


function createInitialHistorySnapshot(): StateSnapshot | null {
  if (!getTimelineState || !getMediaState || !getDockState) return null;
  return createSnapshot('initial');
}

function createTimelineSnapshot(): StateSnapshot['timeline'] {
  const timeline = getTimelineState?.() || null;

  const keyframesObj: Record<string, Keyframe[]> = {};
  if (timeline?.clipKeyframes instanceof Map) {
    timeline.clipKeyframes.forEach((kfs: Keyframe[], clipId: string) => {
      keyframesObj[clipId] = deepClone(kfs);
    });
  }

  return {
    clips: (timeline?.clips || []).map(cloneClipForHistory),
    tracks: (timeline?.tracks || []).map(cloneTrackForHistory),
    selectedClipIds: timeline?.selectedClipIds ? [...timeline.selectedClipIds] : [],
    zoom: timeline?.zoom || 50,
    scrollX: timeline?.scrollX || 0,
    layers: deepClone((timeline?.layers || []).filter(Boolean)),
    selectedLayerId: timeline?.selectedLayerId || null,
    clipKeyframes: keyframesObj,
    markers: deepClone(timeline?.markers || []),
    masterAudioState: cloneMasterAudioState(timeline?.masterAudioState),
  };
}

function createTimelineEditStateSnapshot(
  label: string,
  timestamp: number,
): HistoryTimelineEditState | undefined {
  const timeline = getTimelineState?.() || null;
  if (!timeline) return undefined;

  return createHistoryTimelineEditState({
    id: `history:${timestamp}:${label}`,
    label,
    timestamp,
    tracks: timeline.tracks || [],
    clips: timeline.clips || [],
    selectedClipIds: timeline.selectedClipIds || new Set<string>(),
    zoom: timeline.zoom || 50,
    scrollX: timeline.scrollX || 0,
    layers: (timeline.layers || []).filter(Boolean),
    selectedLayerId: timeline.selectedLayerId || null,
    clipKeyframes: timeline.clipKeyframes,
    markers: timeline.markers || [],
    masterAudioState: timeline.masterAudioState,
  });
}

function createTimelineSnapshotFromEditState(
  timelineEditState: HistoryTimelineEditState,
): StateSnapshot['timeline'] {
  const restored = createHistoryTimelineRestoreState(timelineEditState, {}, {
    placeholderFileMode: 'plain-data',
  }).state;
  return {
    clips: restored.clips.map(cloneClipForHistory),
    tracks: restored.tracks.map(cloneTrackForHistory),
    selectedClipIds: [...restored.selectedClipIds],
    zoom: restored.zoom,
    scrollX: restored.scrollX,
    layers: deepClone(restored.layers),
    selectedLayerId: restored.selectedLayerId,
    clipKeyframes: Object.fromEntries(
      Array.from(restored.clipKeyframes.entries()).map(([clipId, keyframes]) => [
        clipId,
        deepClone(keyframes),
      ])
    ),
    markers: deepClone(restored.markers),
    masterAudioState: cloneMasterAudioState(restored.masterAudioState),
  };
}

function createMediaSnapshot(): StateSnapshot['media'] {
  const media = getMediaState?.() || null;

  return {
    files: (media?.files || []).map(cloneMediaFileForHistory),
    compositions: (media?.compositions || []).map(cloneCompositionForHistory),
    folders: deepClone(media?.folders || []),
    selectedIds: [...(media?.selectedIds || [])],
    expandedFolderIds: [...(media?.expandedFolderIds || [])],
    textItems: deepClone(media?.textItems || []),
    solidItems: deepClone(media?.solidItems || []),
    mathSceneItems: deepClone(media?.mathSceneItems || []),
    motionShapeItems: deepClone(media?.motionShapeItems || []),
    signalAssets: deepClone(media?.signalAssets || []),
    signalArtifacts: deepClone(media?.signalArtifacts || []),
    signalGraphs: deepClone(media?.signalGraphs || []),
    signalOperators: deepClone(media?.signalOperators || []),
  };
}

function createDockSnapshot(): StateSnapshot['dock'] {
  const dock = getDockState?.();
  return {
    layout: deepClone(dock?.layout ?? null),
  };
}

function createFlashBoardSnapshot(): StateSnapshot['flashboard'] {
  const flashboard = getFlashBoardState?.() || {
    activeGenerationRecords: [],
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
  };

  return {
    activeGenerationRecords: deepClone(flashboard.activeGenerationRecords || []),
    composer: deepClone(flashboard.composer || createDefaultFlashBoardComposer()),
    generationMetadataByMediaId: deepClone(flashBoardMediaBridge.serializeMetadata()),
  };
}

function createExportSnapshot(): ExportStoreData {
  return deepClone(getExportStoreData(getExportState?.() || createDefaultExportStoreData()));
}

// Create snapshot from current state
function createSnapshot(label: string, _previousSnapshot?: StateSnapshot | null): StateSnapshot {
  const timestamp = Date.now();
  const timelineEditState = createTimelineEditStateSnapshot(label, timestamp);
  return {
    timestamp,
    label,
    timeline: timelineEditState
      ? createTimelineSnapshotFromEditState(timelineEditState)
      : createTimelineSnapshot(),
    timelineEditState,
    media: createMediaSnapshot(),
    dock: createDockSnapshot(),
    flashboard: createFlashBoardSnapshot(),
    export: createExportSnapshot(),
  };
}

// Apply a snapshot to all stores
function applySnapshot(snapshot: StateSnapshot) {
  if (!snapshot) return;

  // Apply timeline state (including layers)
  if (setTimelineState && getTimelineState) {
    const currentTimeline = getTimelineState();
    let timelineState: Partial<TimelineStoreState>;

    if (snapshot.timelineEditState) {
      const restored = createHistoryTimelineRestoreState(snapshot.timelineEditState, currentTimeline);
      timelineState = restored.state;
      log.debug('Restored timeline from HistoryTimelineEditState', restored.diagnostics);
    } else {
      // Preserve source references for layers (filter out undefined entries from snapshots)
      const restoredLayers = (snapshot.timeline.layers || []).filter(Boolean).map((layer) => {
        const currentLayer = (currentTimeline.layers || []).find((l) => l?.id === layer.id);
        return {
          ...deepClone(layer),
          source: currentLayer?.source || layer.source,
        };
      });

      // Convert plain object back to Map<string, Keyframe[]>
      const restoredKeyframes = new Map<string, Keyframe[]>();
      if (snapshot.timeline.clipKeyframes) {
        for (const [clipId, kfs] of Object.entries(snapshot.timeline.clipKeyframes)) {
          restoredKeyframes.set(clipId, deepClone(kfs));
        }
      }

      timelineState = {
        clips: snapshot.timeline.clips.map(cloneClipForHistory),
        tracks: snapshot.timeline.tracks.map(cloneTrackForHistory),
        selectedClipIds: new Set(snapshot.timeline.selectedClipIds || []),
        zoom: snapshot.timeline.zoom,
        scrollX: snapshot.timeline.scrollX,
        layers: restoredLayers,
        selectedLayerId: snapshot.timeline.selectedLayerId,
        clipKeyframes: restoredKeyframes,
        markers: deepClone(snapshot.timeline.markers || []),
      };
    }

    if ('masterAudioState' in currentTimeline || snapshot.timeline.masterAudioState !== undefined) {
      timelineState.masterAudioState = snapshot.timelineEditState
        ? cloneMasterAudioState(snapshot.timelineEditState.timeline.masterAudioState)
        : cloneMasterAudioState(snapshot.timeline.masterAudioState);
    }

    stopTimelineAudioPlayback();
    clearAINodeRuntimeCache();
    setTimelineState(timelineState);
    syncHistoryRehydratedTimelineRuntimeResources(timelineState.clips ?? []);
  }

  // Apply media state (preserve file references)
  if (setMediaState && getMediaState) {
    const currentMedia = getMediaState();
    const restoredFiles = (snapshot.media.files || []).filter(Boolean).map((file) => {
      const currentFile = (currentMedia.files || []).find((f) => f?.id === file.id);
      const clonedFile = cloneMediaFileForHistory(file);
      return {
        ...clonedFile,
        file: currentFile?.file || file.file, // Preserve File reference
        url: currentFile?.url || clonedFile.url || '',
        thumbnailUrl: currentFile?.thumbnailUrl || clonedFile.thumbnailUrl,
        proxyVideoUrl: currentFile?.proxyVideoUrl || clonedFile.proxyVideoUrl,
      };
    });

    setMediaState({
      files: restoredFiles,
      compositions: snapshot.media.compositions.map(cloneCompositionForHistory),
      folders: deepClone(snapshot.media.folders),
      selectedIds: [...snapshot.media.selectedIds],
      expandedFolderIds: [...snapshot.media.expandedFolderIds],
      textItems: deepClone(snapshot.media.textItems || []),
      solidItems: deepClone(snapshot.media.solidItems || []),
      mathSceneItems: deepClone(snapshot.media.mathSceneItems || []),
      motionShapeItems: deepClone(snapshot.media.motionShapeItems || []),
      signalAssets: deepClone(snapshot.media.signalAssets || []),
      signalArtifacts: deepClone(snapshot.media.signalArtifacts || []),
      signalGraphs: deepClone(snapshot.media.signalGraphs || []),
      signalOperators: deepClone(snapshot.media.signalOperators || []),
    });
  }

  // Apply dock state
  if (setDockState && snapshot.dock.layout) {
    setDockState({
      layout: deepClone(snapshot.dock.layout),
    });
  }

  if (setFlashBoardState) {
    setFlashBoardState({
      activeGenerationRecords: deepClone(snapshot.flashboard?.activeGenerationRecords || []),
      selectedActiveGenerationRecordIds: [],
      composer: deepClone(snapshot.flashboard?.composer || createDefaultFlashBoardComposer()),
    });
  }

  flashBoardMediaBridge.hydrateMetadata(
    deepClone(snapshot.flashboard?.generationMetadataByMediaId || {})
  );

  if (setExportState) {
    setExportState(deepClone(snapshot.export));
  }

  // Rebuild the preview from the restored state. Without this, restoring deleted
  // clips (or any layer-affecting undo/redo) leaves the canvas showing the old
  // frame until the next interaction.
  afterApplyCallback?.();
}

function isTimelineHistoryLocked(): boolean {
  return getTimelineState?.().isExporting === true;
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

    captureSnapshot: (label: string) => {
      if (isHistoryDisabledForDebug()) return;

      const { isApplying, undoStack, currentSnapshot, redoStack, branches, maxHistorySize, batchId } = get();

      // Don't capture during undo/redo application
      if (isApplying) return;

      // If batching, don't create new snapshots until batch ends
      if (batchId !== null) return;

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
      flushPendingCaptureCallback?.();

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
      suppressCapturesCallback?.();

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
      flushPendingCaptureCallback?.();

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
      suppressCapturesCallback?.();

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

    restoreEntry: (entry) => {
      if (isHistoryDisabledForDebug()) return null;

      if (entry.kind === 'branch' && entry.branchId) {
        return get().restoreBranch(entry.branchId, entry.stackIndex);
      }
      if (entry.kind === 'event' || entry.kind === 'current') {
        return null;
      }
      if (typeof entry.stackIndex !== 'number') {
        return null;
      }
      if (isTimelineHistoryLocked()) {
        log.warn('Blocked history jump during timeline export');
        return null;
      }

      if (get().batchId !== null) {
        get().endBatch();
      }

      flushPendingCaptureCallback?.();

      const {
        undoStack,
        currentSnapshot,
        redoStack,
        eventLog,
        branches,
        navigationEntries,
        navigationSnapshotsByEntryId,
      } = get();
      const navigationState = navigationEntries
        ? { entries: navigationEntries, snapshotsByEntryId: navigationSnapshotsByEntryId }
        : createHistoryNavigationState(undoStack, currentSnapshot, redoStack, eventLog, branches);
      let targetSnapshot: StateSnapshot | undefined;
      let nextUndoStack: StateSnapshot[] = [];
      let nextRedoStack: StateSnapshot[] = [];

      if (entry.kind === 'undoable') {
        targetSnapshot = undoStack[entry.stackIndex];
        nextUndoStack = undoStack.slice(0, entry.stackIndex);
        nextRedoStack = [
          ...undoStack.slice(entry.stackIndex + 1),
          ...(currentSnapshot ? [currentSnapshot] : []),
          ...redoStack.slice().reverse(),
        ].reverse();
      } else if (entry.kind === 'redoable') {
        const redoPath = redoStack.slice().reverse();
        targetSnapshot = redoPath[entry.stackIndex];
        nextUndoStack = [
          ...undoStack,
          ...(currentSnapshot ? [currentSnapshot] : []),
          ...redoPath.slice(0, entry.stackIndex),
        ];
        nextRedoStack = redoPath.slice(entry.stackIndex + 1).reverse();
      }

      if (!targetSnapshot) return null;

      set({ isApplying: true });
      applySnapshot(targetSnapshot);
      set({
        undoStack: cloneSnapshotStack(nextUndoStack),
        redoStack: cloneSnapshotStack(nextRedoStack),
        currentSnapshot: deepClone(targetSnapshot),
        navigationEntries: navigationState.entries,
        navigationSnapshotsByEntryId: navigationState.snapshotsByEntryId,
        activeEntryId: entry.id,
        isApplying: false,
      });

      suppressCapturesCallback?.();

      log.debug(`Jump to history entry: ${entry.label}`);
      return { operation: 'restore-branch', label: entry.label };
    },

    restoreBranch: (branchId, snapshotIndex) => {
      if (isHistoryDisabledForDebug()) return null;

      if (isTimelineHistoryLocked()) {
        log.warn('Blocked branch restore during timeline export');
        return null;
      }

      if (get().batchId !== null) {
        get().endBatch();
      }

      flushPendingCaptureCallback?.();

      const {
        undoStack,
        currentSnapshot,
        redoStack,
        eventLog,
        branches,
        navigationEntries,
        navigationSnapshotsByEntryId,
      } = get();
      const branch = branches.find((candidate) => candidate.id === branchId);
      if (!branch) return null;

      const targetSnapshotIndex = Math.max(
        0,
        Math.min(
          branch.snapshots.length - 1,
          typeof snapshotIndex === 'number' ? Math.floor(snapshotIndex) : branch.snapshots.length - 1
        )
      );
      const branchPath = [
        ...branch.baseUndoStack,
        ...(branch.baseSnapshot ? [branch.baseSnapshot] : []),
        ...branch.snapshots.slice(0, targetSnapshotIndex + 1),
      ];
      const branchTip = branchPath[branchPath.length - 1];
      if (!branchTip) return null;

      const nextRedoStack = branch.snapshots.slice(targetSnapshotIndex + 1).reverse();
      const navigationState = navigationEntries
        ? { entries: navigationEntries, snapshotsByEntryId: navigationSnapshotsByEntryId }
        : createHistoryNavigationState(undoStack, currentSnapshot, redoStack, eventLog, branches);
      const activeEntryId = navigationState.entries.find((candidate) => (
        candidate.kind === 'branch' &&
        candidate.branchId === branchId &&
        candidate.stackIndex === targetSnapshotIndex
      ))?.id ?? null;

      set({ isApplying: true });
      applySnapshot(branchTip);
      set({
        undoStack: cloneSnapshotStack(branchPath.slice(0, -1)),
        redoStack: cloneSnapshotStack(nextRedoStack),
        currentSnapshot: deepClone(branchTip),
        navigationEntries: navigationState.entries,
        navigationSnapshotsByEntryId: navigationState.snapshotsByEntryId,
        activeEntryId,
        isApplying: false,
      });

      suppressCapturesCallback?.();

      log.debug(`Restore branch: ${branch.label}`);
      return { operation: 'restore-branch', label: branch.label };
    },

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
      if (isHistoryDisabledForDebug()) {
        return {
          schemaVersion: 1,
          undoStack: [],
          redoStack: [],
          currentSnapshot: null,
          eventLog: [],
          visibleEntries: [],
          branches: [],
          maxHistorySize: get().maxHistorySize,
        };
      }

      const {
        undoStack,
        redoStack,
        currentSnapshot,
        eventLog,
        branches,
        maxHistorySize,
        navigationEntries,
        activeEntryId,
      } = get();
      const persistentEventLog = eventLog.filter((event) => event.type !== 'autosave');
      const visibleEntries = markActiveHistoryEntry(
        navigationEntries ?? createHistoryEntries(undoStack, currentSnapshot, redoStack, eventLog, branches),
        activeEntryId
      ).slice(-MAX_HISTORY_EVENT_LOG_SIZE);

      if (!PERSIST_HISTORY_SNAPSHOTS) {
        return {
          schemaVersion: 1,
          undoStack: [],
          redoStack: [],
          currentSnapshot: null,
          eventLog: persistentEventLog.slice(-MAX_HISTORY_EVENT_LOG_SIZE),
          visibleEntries,
          branches: [],
          maxHistorySize,
        };
      }

      const persistedMaxHistorySize = Math.min(maxHistorySize, MAX_PERSISTED_HISTORY_SNAPSHOTS);

      return cloneHistoryForProject({
        schemaVersion: 1,
        undoStack: limitSnapshotStackForProject(
          undoStack,
          maxHistorySize,
          MAX_PERSISTED_HISTORY_SNAPSHOTS
        ),
        redoStack: limitSnapshotStackForProject(
          redoStack,
          maxHistorySize,
          MAX_PERSISTED_HISTORY_SNAPSHOTS
        ),
        currentSnapshot,
        eventLog: persistentEventLog.slice(-MAX_HISTORY_EVENT_LOG_SIZE),
        visibleEntries,
        branches: branches
          .slice(-MAX_HISTORY_BRANCHES)
          .map((branch) => limitBranchForProject(
            branch,
            maxHistorySize,
            MAX_PERSISTED_HISTORY_SNAPSHOTS
          )),
        maxHistorySize: persistedMaxHistorySize,
      });
    },

    hydrateFromProject: (history) => {
      const maxHistorySize = Math.max(1, Math.floor(history?.maxHistorySize ?? get().maxHistorySize));

      if (isHistoryDisabledForDebug()) {
        set({
          undoStack: [],
          redoStack: [],
          eventLog: [],
          branches: [],
          currentSnapshot: null,
          maxHistorySize,
          navigationEntries: null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: null,
          isApplying: false,
          batchId: null,
          batchLabel: null,
        });
        return;
      }

      if (!history || history.schemaVersion !== 1) {
        set({
          undoStack: [],
          redoStack: [],
          eventLog: [],
          branches: [],
          currentSnapshot: createInitialHistorySnapshot(),
          maxHistorySize,
          navigationEntries: null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: null,
          isApplying: false,
          batchId: null,
          batchLabel: null,
        });
        return;
      }

      if (!PERSIST_HISTORY_SNAPSHOTS) {
        const visibleEntries = normalizePersistedVisibleEntries(
          history.visibleEntries,
          MAX_HISTORY_EVENT_LOG_SIZE
        );
        const activeEntry = visibleEntries.find((entry) => entry.active);

        set({
          undoStack: [],
          redoStack: [],
          eventLog: normalizePersistedEventLog(history.eventLog, MAX_HISTORY_EVENT_LOG_SIZE),
          branches: [],
          currentSnapshot: createInitialHistorySnapshot(),
          maxHistorySize,
          navigationEntries: visibleEntries.length > 0 ? visibleEntries : null,
          navigationSnapshotsByEntryId: {},
          activeEntryId: activeEntry?.id ?? null,
          isApplying: false,
          batchId: null,
          batchLabel: null,
        });
        return;
      }

      set({
        undoStack: normalizePersistedSnapshotStack(history.undoStack, maxHistorySize),
        redoStack: normalizePersistedSnapshotStack(history.redoStack, maxHistorySize),
        eventLog: normalizePersistedEventLog(history.eventLog, MAX_HISTORY_EVENT_LOG_SIZE),
        branches: normalizePersistedBranches(history.branches, maxHistorySize, MAX_HISTORY_BRANCHES),
        currentSnapshot: normalizePersistedSnapshot(history.currentSnapshot) ?? createInitialHistorySnapshot(),
        maxHistorySize,
        navigationEntries: null,
        navigationSnapshotsByEntryId: {},
        activeEntryId: null,
        isApplying: false,
        batchId: null,
        batchLabel: null,
      });
    },
  }))
);

// Export convenience functions
export const captureSnapshot = (label: string) => useHistoryStore.getState().captureSnapshot(label);
export const undo = () => useHistoryStore.getState().undo();
export const redo = () => useHistoryStore.getState().redo();
export const startBatch = (label: string) => useHistoryStore.getState().startBatch(label);
export const endBatch = () => useHistoryStore.getState().endBatch();
export const recordHistoryEvent = (type: HistoryEventType, label: string) => {
  useHistoryStore.getState().recordEvent(type, label);
};
export const restoreHistoryEntry = (entry: HistoryListEntry) => useHistoryStore.getState().restoreEntry(entry);
export const restoreHistoryBranch = (branchId: string, snapshotIndex?: number) => useHistoryStore.getState().restoreBranch(branchId, snapshotIndex);
export const serializeHistoryStateForProject = () => useHistoryStore.getState().serializeForProject();
export const hydrateHistoryStateFromProject = (history: ProjectHistoryState | null | undefined) => {
  useHistoryStore.getState().hydrateFromProject(history);
};
