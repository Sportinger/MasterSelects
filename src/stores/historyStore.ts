// Global undo/redo history store
// Captures snapshots of all undoable state across stores

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Logger } from '../services/logger';
import { flashBoardMediaBridge } from '../services/flashboard/FlashBoardMediaBridge';
import type {
  ClipAudioState,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
  Layer,
  Keyframe,
} from '../types';
import type {
  Composition,
  MathSceneItem,
  MediaFile,
  MediaFolder,
  MotionShapeItem,
  SignalAssetItem,
  SolidItem,
  TextItem,
} from './mediaStore/types';
import type { SignalArtifact, SignalGraph, SignalOperatorDescriptor } from '../signals';
import type { TimelineMarker } from './timeline/types';
import type { DockLayout } from '../types/dock';
import type {
  FlashBoard,
  FlashBoardComposerState,
  FlashBoardGenerationMetadata,
} from './flashboardStore/types';
import type { ExportStoreData } from './exportStore';
import { createDefaultExportStoreData, getExportStoreData } from './exportStore';

const log = Logger.create('History');

// Snapshot of undoable state from all stores
interface StateSnapshot {
  timestamp: number;
  label: string; // Description of the action (for debugging)

  // Timeline state (including layers since they moved here from mixerStore)
  timeline: {
    clips: TimelineClip[];
    tracks: TimelineTrack[];
    selectedClipIds: string[];
    zoom: number;
    scrollX: number;
    layers: Layer[];
    selectedLayerId: string | null;
    clipKeyframes: Record<string, Keyframe[]>;
    markers: TimelineMarker[];
    masterAudioState?: MasterAudioState;
  };

  // Media state
  media: {
    files: MediaFile[];
    compositions: Composition[];
    folders: MediaFolder[];
    selectedIds: string[];
    expandedFolderIds: string[];
    textItems: TextItem[];
    solidItems: SolidItem[];
    mathSceneItems: MathSceneItem[];
    motionShapeItems: MotionShapeItem[];
    signalAssets: SignalAssetItem[];
    signalArtifacts: SignalArtifact[];
    signalGraphs: SignalGraph[];
    signalOperators: SignalOperatorDescriptor[];
  };

  // Dock layout state
  dock: {
    layout: DockLayout | null;
  };

  // FlashBoard state (boards + active board + composer config + generated-media metadata)
  flashboard: {
    activeBoardId: string | null;
    boards: FlashBoard[];
    composer: FlashBoardComposerState;
    generationMetadataByMediaId: Record<string, FlashBoardGenerationMetadata>;
  };

  export: ExportStoreData;
}

interface HistoryState {
  // Undo/redo stacks
  undoStack: StateSnapshot[];
  redoStack: StateSnapshot[];

  // Current state (for comparison to avoid duplicate snapshots)
  currentSnapshot: StateSnapshot | null;

  // Maximum history size
  maxHistorySize: number;

  // Whether we're currently applying undo/redo (to prevent capturing)
  isApplying: boolean;

  // Batch tracking - for grouping multiple changes into one undo step
  batchId: number | null;
  batchLabel: string | null;

  // Actions
  captureSnapshot: (label: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Batch operations
  startBatch: (label: string) => void;
  endBatch: () => void;

  // Internal
  setIsApplying: (value: boolean) => void;
  clearHistory: () => void;
}

// Store state types for dynamic references
interface TimelineStoreState {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  zoom: number;
  scrollX: number;
  layers: Layer[];
  selectedLayerId: string | null;
  clipKeyframes: Map<string, Keyframe[]>;
  markers: TimelineMarker[];
  masterAudioState?: MasterAudioState;
}

interface MediaStoreState {
  files: MediaFile[];
  compositions: Composition[];
  folders: MediaFolder[];
  selectedIds: string[];
  expandedFolderIds: string[];
  textItems: TextItem[];
  solidItems: SolidItem[];
  mathSceneItems: MathSceneItem[];
  motionShapeItems: MotionShapeItem[];
  signalAssets: SignalAssetItem[];
  signalArtifacts: SignalArtifact[];
  signalGraphs: SignalGraph[];
  signalOperators: SignalOperatorDescriptor[];
}

interface DockStoreSnapshot {
  layout: DockLayout;
}

interface FlashBoardStoreSnapshot {
  activeBoardId: string | null;
  boards: FlashBoard[];
  selectedNodeIds: string[];
  composer: FlashBoardComposerState;
}

type ExportStoreSnapshot = ExportStoreData;

// Callback to flush pending debounced captures before undo/redo (set by useGlobalHistory)
// Flush = execute the pending capture immediately so its state isn't lost
let flushPendingCaptureCallback: (() => void) | null = null;
let suppressCapturesCallback: (() => void) | null = null;
export function setHistoryCallbacks(callbacks: {
  flushPendingCapture: () => void;
  suppressCaptures: () => void;
}) {
  flushPendingCaptureCallback = callbacks.flushPendingCapture;
  suppressCapturesCallback = callbacks.suppressCaptures;
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

// Deep clone helper (handles most objects, excluding DOM elements and functions)
// Uses a WeakSet to detect circular references and avoid infinite recursion
function deepClone<T>(obj: T, seen?: WeakSet<object>): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (isBinaryPayload(obj)) return undefined as T;

  // Skip cloning DOM elements, HTMLMediaElements, File objects, etc.
  if (obj instanceof Element || obj instanceof HTMLMediaElement || obj instanceof File) {
    return obj; // Return reference, don't clone
  }

  // Skip class instances (WebCodecsPlayer, MP4File, VideoDecoder, NativeDecoder, etc.)
  // Only deep-clone plain objects {} and arrays [] — class instances keep reference
  const proto = Object.getPrototypeOf(obj);
  if (proto && proto !== Object.prototype && proto !== Array.prototype) {
    return obj;
  }

  // Circular reference detection
  if (!seen) seen = new WeakSet();
  if (seen.has(obj as object)) return obj; // Break cycle, return reference
  seen.add(obj as object);

  if (Array.isArray(obj)) return obj.map(item => deepClone(item, seen)) as T;

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      // Skip functions, DOM elements, and binary media payloads
      if (typeof value === 'function') continue;
      if (isBinaryPayload(value)) continue;
      if (value instanceof Element || value instanceof HTMLMediaElement) {
        cloned[key] = value; // Keep reference
      } else {
        cloned[key] = deepClone(value, seen);
      }
    }
  }
  return cloned;
}

function isBinaryPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) return true;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isAudioPayloadKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, '').toLowerCase();

  // Ref/id fields intentionally stay, even when their names mention payloads.
  if (
    normalized === 'payloadrefs' ||
    normalized.endsWith('ref') ||
    normalized.endsWith('refs') ||
    normalized.endsWith('id') ||
    normalized.endsWith('ids')
  ) {
    return false;
  }

  return (
    normalized === 'payload' ||
    normalized === 'bytes' ||
    normalized === 'buffer' ||
    normalized === 'blob' ||
    normalized === 'file' ||
    normalized === 'samples' ||
    normalized === 'sampledata' ||
    normalized === 'audiobuffer' ||
    normalized === 'arraybuffer' ||
    normalized.endsWith('samples') ||
    normalized.endsWith('buffer') ||
    normalized.includes('channeldata') ||
    normalized.includes('rawaudio') ||
    normalized.includes('audiodata') ||
    normalized.includes('pcm') ||
    normalized.includes('fftdata') ||
    normalized.includes('waveformdata') ||
    normalized.includes('spectrogramdata') ||
    normalized.includes('tilebytes')
  );
}

function cloneJsonSafeAudioValue<T>(value: T, seen?: WeakSet<object>): T | undefined {
  if (value === null) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object') return undefined;
  if (isBinaryPayload(value)) return undefined;

  if (!seen) seen = new WeakSet<object>();
  if (seen.has(value as object)) return undefined;
  seen.add(value as object);

  if (Array.isArray(value)) {
    const clonedArray: unknown[] = [];
    for (const item of value) {
      const clonedItem = cloneJsonSafeAudioValue(item, seen);
      if (clonedItem !== undefined) {
        clonedArray.push(clonedItem);
      }
    }
    return clonedArray as T;
  }

  if (!isPlainObject(value)) return undefined;

  const cloned: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isAudioPayloadKey(key)) continue;
    const clonedValue = cloneJsonSafeAudioValue(nestedValue, seen);
    if (clonedValue !== undefined) {
      cloned[key] = clonedValue;
    }
  }

  return cloned as T;
}

const AUDIO_ANALYSIS_REF_KEYS: Array<keyof MediaFileAudioAnalysisRefs> = [
  'waveformPyramidId',
  'processedWaveformPyramidId',
  'spectrogramTileSetIds',
  'loudnessEnvelopeId',
  'beatGridId',
  'onsetMapId',
  'phaseCorrelationId',
  'transcriptTimingId',
  'frequencySummaryId',
];

function cloneAudioAnalysisRefs(
  refs: MediaFileAudioAnalysisRefs | undefined
): MediaFileAudioAnalysisRefs | undefined {
  if (!refs) return undefined;

  const cloned: Partial<Record<keyof MediaFileAudioAnalysisRefs, string | string[]>> = {};
  for (const key of AUDIO_ANALYSIS_REF_KEYS) {
    const value = refs[key];
    if (key === 'spectrogramTileSetIds') {
      if (Array.isArray(value)) {
        cloned[key] = value.filter((id): id is string => typeof id === 'string');
      }
    } else if (typeof value === 'string') {
      cloned[key] = value;
    }
  }

  return Object.keys(cloned).length > 0
    ? cloned as MediaFileAudioAnalysisRefs
    : undefined;
}

function cloneClipAudioState(audioState: ClipAudioState | undefined): ClipAudioState | undefined {
  const cloned = cloneJsonSafeAudioValue(audioState) as ClipAudioState | undefined;
  if (!cloned) return undefined;

  const sourceAnalysisRefs = cloneAudioAnalysisRefs(audioState?.sourceAnalysisRefs);
  const processedAnalysisRefs = cloneAudioAnalysisRefs(audioState?.processedAnalysisRefs);
  if (sourceAnalysisRefs !== undefined) {
    cloned.sourceAnalysisRefs = sourceAnalysisRefs;
  } else {
    delete cloned.sourceAnalysisRefs;
  }
  if (processedAnalysisRefs !== undefined) {
    cloned.processedAnalysisRefs = processedAnalysisRefs;
  } else {
    delete cloned.processedAnalysisRefs;
  }

  return cloned;
}

function cloneTrackAudioState(audioState: TrackAudioState | undefined): TrackAudioState | undefined {
  return cloneJsonSafeAudioValue(audioState) as TrackAudioState | undefined;
}

function cloneMasterAudioState(audioState: MasterAudioState | undefined): MasterAudioState | undefined {
  return cloneJsonSafeAudioValue(audioState) as MasterAudioState | undefined;
}

function cloneClipForHistory<T extends { audioState?: ClipAudioState }>(clip: T): T {
  const { audioState, ...rest } = clip;
  const cloned = deepClone(rest) as T;
  const clonedAudioState = cloneClipAudioState(audioState);
  if (clonedAudioState !== undefined) {
    cloned.audioState = clonedAudioState;
  }
  return cloned;
}

function cloneTrackForHistory<T extends { audioState?: TrackAudioState }>(track: T): T {
  const { audioState, ...rest } = track;
  const cloned = deepClone(rest) as T;
  const clonedAudioState = cloneTrackAudioState(audioState);
  if (clonedAudioState !== undefined) {
    cloned.audioState = clonedAudioState;
  }
  return cloned;
}

function cloneTimelineDataForHistory(
  timelineData: NonNullable<Composition['timelineData']>
): NonNullable<Composition['timelineData']> {
  const { clips, tracks, masterAudioState, ...rest } = timelineData;
  const cloned = deepClone(rest) as NonNullable<Composition['timelineData']>;
  cloned.clips = (clips || []).map(cloneClipForHistory);
  cloned.tracks = (tracks || []).map(cloneTrackForHistory);

  const clonedMasterAudioState = cloneMasterAudioState(masterAudioState);
  if (clonedMasterAudioState !== undefined) {
    cloned.masterAudioState = clonedMasterAudioState;
  }

  return cloned;
}

function cloneCompositionForHistory(composition: Composition): Composition {
  const { timelineData, ...rest } = composition;
  const cloned = deepClone(rest) as Composition;
  if (timelineData) {
    cloned.timelineData = cloneTimelineDataForHistory(timelineData);
  }
  return cloned;
}

function cloneMediaFileForHistory(file: MediaFile): MediaFile {
  const { audioAnalysisRefs, ...rest } = file;
  const cloned = deepClone(rest) as MediaFile;
  const clonedAudioAnalysisRefs = cloneAudioAnalysisRefs(audioAnalysisRefs);
  if (clonedAudioAnalysisRefs !== undefined) {
    cloned.audioAnalysisRefs = clonedAudioAnalysisRefs;
  }
  return cloned;
}

function createDefaultFlashBoardComposer(): FlashBoardComposerState {
  return {
    draftNodeId: null,
    isOpen: false,
    generateAudio: false,
    multiShots: false,
    multiPrompt: [],
    referenceMediaFileIds: [],
  };
}

// Create snapshot from current state
function createSnapshot(label: string): StateSnapshot {
  const timeline = getTimelineState?.() || null;
  const media = getMediaState?.() || null;
  const dock = getDockState?.();
  const flashboard = getFlashBoardState?.() || {
    activeBoardId: null,
    boards: [],
    selectedNodeIds: [],
    composer: createDefaultFlashBoardComposer(),
  };

  // Convert Map<string, Keyframe[]> to plain object for cloning
  const keyframesObj: Record<string, Keyframe[]> = {};
  if (timeline?.clipKeyframes instanceof Map) {
    timeline.clipKeyframes.forEach((kfs: Keyframe[], clipId: string) => {
      keyframesObj[clipId] = deepClone(kfs);
    });
  }

  return {
    timestamp: Date.now(),
    label,
    timeline: {
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
    },
    media: {
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
    },
    dock: {
      layout: deepClone(dock?.layout ?? null),
    },
    flashboard: {
      activeBoardId: flashboard.activeBoardId ?? null,
      boards: deepClone(flashboard.boards || []),
      composer: deepClone(flashboard.composer || createDefaultFlashBoardComposer()),
      generationMetadataByMediaId: deepClone(flashBoardMediaBridge.serializeMetadata()),
    },
    export: deepClone(getExportStoreData(getExportState?.() || createDefaultExportStoreData())),
  };
}

// Apply a snapshot to all stores
function applySnapshot(snapshot: StateSnapshot) {
  if (!snapshot) return;

  // Apply timeline state (including layers)
  if (setTimelineState && getTimelineState) {
    const currentTimeline = getTimelineState();
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

    const timelineState: Partial<TimelineStoreState> = {
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

    if ('masterAudioState' in currentTimeline || snapshot.timeline.masterAudioState !== undefined) {
      timelineState.masterAudioState = cloneMasterAudioState(snapshot.timeline.masterAudioState);
    }

    setTimelineState(timelineState);
  }

  // Apply media state (preserve file references)
  if (setMediaState && getMediaState) {
    const currentMedia = getMediaState();
    const restoredFiles = (snapshot.media.files || []).filter(Boolean).map((file) => {
      const currentFile = (currentMedia.files || []).find((f) => f?.id === file.id);
      return {
        ...cloneMediaFileForHistory(file),
        file: currentFile?.file || file.file, // Preserve File reference
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
      activeBoardId: snapshot.flashboard?.activeBoardId ?? null,
      boards: deepClone(snapshot.flashboard?.boards || []),
      selectedNodeIds: [],
      composer: deepClone(snapshot.flashboard?.composer || createDefaultFlashBoardComposer()),
    });
  }

  flashBoardMediaBridge.hydrateMetadata(
    deepClone(snapshot.flashboard?.generationMetadataByMediaId || {})
  );

  if (setExportState) {
    setExportState(deepClone(snapshot.export));
  }
}

export const useHistoryStore = create<HistoryState>()(
  subscribeWithSelector((set, get) => ({
    undoStack: [],
    redoStack: [],
    currentSnapshot: null,
    maxHistorySize: 50,
    isApplying: false,
    batchId: null,
    batchLabel: null,

    captureSnapshot: (label: string) => {
      const { isApplying, undoStack, currentSnapshot, maxHistorySize, batchId } = get();

      // Don't capture during undo/redo application
      if (isApplying) return;

      // If batching, don't create new snapshots until batch ends
      if (batchId !== null) return;

      const newSnapshot = createSnapshot(label);

      // Push current state to undo stack (if exists)
      if (currentSnapshot) {
        const newUndoStack = [...undoStack, currentSnapshot];
        // Limit history size
        if (newUndoStack.length > maxHistorySize) {
          newUndoStack.shift();
        }
        set({
          undoStack: newUndoStack,
          redoStack: [], // Clear redo stack on new action
          currentSnapshot: newSnapshot,
        });
      } else {
        set({ currentSnapshot: newSnapshot });
      }
    },

    undo: () => {
      // End any stuck batch first (safety: lost mouseup etc.)
      if (get().batchId !== null) {
        get().endBatch();
      }

      // Flush pending debounced capture so we don't lose the latest state
      flushPendingCaptureCallback?.();

      // Re-read stacks after flush may have pushed new entries
      const { undoStack, currentSnapshot, redoStack } = get();
      if (undoStack.length === 0) return;

      set({ isApplying: true });

      // Pop from undo stack
      const newUndoStack = [...undoStack];
      const previousSnapshot = newUndoStack.pop()!;

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
        isApplying: false,
      });

      // Suppress auto-captures for 200ms to prevent cascading state changes from re-capturing
      suppressCapturesCallback?.();

      log.debug(`Undo: ${previousSnapshot.label} (stack: ${newUndoStack.length})`);
    },

    redo: () => {
      // End any stuck batch first
      if (get().batchId !== null) {
        get().endBatch();
      }

      // Flush pending debounced capture
      flushPendingCaptureCallback?.();

      // Re-read stacks after flush
      const { redoStack, currentSnapshot, undoStack } = get();
      if (redoStack.length === 0) return;

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
        isApplying: false,
      });

      // Suppress auto-captures for 200ms
      suppressCapturesCallback?.();

      log.debug(`Redo: ${nextSnapshot.label} (stack: ${newRedoStack.length})`);
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,

    startBatch: (label: string) => {
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
      const { batchId, batchLabel, undoStack, currentSnapshot, maxHistorySize } = get();
      if (batchId === null) return;

      // Create final snapshot with batch label
      const finalSnapshot = createSnapshot(batchLabel || 'batch');

      // Push previous state to undo stack
      if (currentSnapshot) {
        const newUndoStack = [...undoStack, currentSnapshot];
        if (newUndoStack.length > maxHistorySize) {
          newUndoStack.shift();
        }
        set({
          undoStack: newUndoStack,
          redoStack: [],
          currentSnapshot: finalSnapshot,
          batchId: null,
          batchLabel: null,
        });
      } else {
        set({
          currentSnapshot: finalSnapshot,
          batchId: null,
          batchLabel: null,
        });
      }
    },

    setIsApplying: (value: boolean) => set({ isApplying: value }),

    clearHistory: () => set({
      undoStack: [],
      redoStack: [],
      currentSnapshot: null,
    }),
  }))
);

// Export convenience functions
export const captureSnapshot = (label: string) => useHistoryStore.getState().captureSnapshot(label);
export const undo = () => useHistoryStore.getState().undo();
export const redo = () => useHistoryStore.getState().redo();
export const startBatch = (label: string) => useHistoryStore.getState().startBatch(label);
export const endBatch = () => useHistoryStore.getState().endBatch();
