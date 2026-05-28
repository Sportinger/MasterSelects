// Global undo/redo history store
// Captures snapshots of all undoable state across stores

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Logger } from '../services/logger';
import { flashBoardMediaBridge } from '../services/flashboard/FlashBoardMediaBridge';
import { clonePersistedClipAudioState } from '../services/audio/clipAudioStatePersistence';
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
  HistoryEventType,
  HistoryListEntry,
  HistoryTimelineEvent,
  ProjectHistoryBranchState,
  ProjectHistoryState,
} from '../types/history';
import type {
  FlashBoard,
  FlashBoardComposerState,
  FlashBoardGenerationMetadata,
} from './flashboardStore/types';
import { createDefaultFlashBoardComposer } from './flashboardStore/defaults';
import type { ExportStoreData } from './exportStore';
import { createDefaultExportStoreData, getExportStoreData } from './exportStore';

const log = Logger.create('History');
const MAX_HISTORY_EVENT_LOG_SIZE = 500;
const MAX_HISTORY_BRANCHES = 24;
const MAX_PERSISTED_HISTORY_SNAPSHOTS = 32;
const PERSIST_HISTORY_SNAPSHOTS = false;
const HISTORY_CAPTURE_WARN_MS = 24;

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
  eventLog: HistoryTimelineEvent[];
  branches: HistoryBranch[];
  navigationEntries: HistoryListEntry[] | null;
  navigationSnapshotsByEntryId: Record<string, StateSnapshot>;
  activeEntryId: string | null;

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
  undo: () => HistoryOperationResult | null;
  redo: () => HistoryOperationResult | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getHistoryEntries: () => HistoryListEntry[];
  recordEvent: (type: HistoryEventType, label: string) => void;
  restoreEntry: (entry: HistoryListEntry) => HistoryRestoreResult | null;
  restoreBranch: (branchId: string, snapshotIndex?: number) => HistoryRestoreResult | null;

  // Batch operations
  startBatch: (label: string) => void;
  endBatch: () => void;

  // Internal
  setIsApplying: (value: boolean) => void;
  clearHistory: () => void;
  serializeForProject: () => ProjectHistoryState;
  hydrateFromProject: (history: ProjectHistoryState | null | undefined) => void;
}

export interface HistoryOperationResult {
  operation: 'undo' | 'redo';
  label: string;
}

export interface HistoryRestoreResult {
  operation: 'restore-branch';
  label: string;
}

interface HistoryBranch {
  id: string;
  label: string;
  createdAt: number;
  baseSnapshot: StateSnapshot | null;
  baseUndoStack: StateSnapshot[];
  snapshots: StateSnapshot[];
}

interface HistoryNavigationState {
  entries: HistoryListEntry[];
  snapshotsByEntryId: Record<string, StateSnapshot>;
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
  isExporting?: boolean;
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
    normalized === 'waveform' ||
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
  const cloned = clonePersistedClipAudioState(cloneJsonSafeAudioValue(audioState) as ClipAudioState | undefined);
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
  const {
    audioState,
    waveform: _waveform,
    waveformChannels: _waveformChannels,
    ...rest
  } = clip as T & {
    waveform?: unknown;
    waveformChannels?: unknown;
  };
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
  const {
    audioAnalysisRefs,
    waveform: _waveform,
    waveformChannels: _waveformChannels,
    ...rest
  } = file;
  const cloned = deepClone(rest) as MediaFile;
  const clonedAudioAnalysisRefs = cloneAudioAnalysisRefs(audioAnalysisRefs);
  if (clonedAudioAnalysisRefs !== undefined) {
    cloned.audioAnalysisRefs = clonedAudioAnalysisRefs;
  }
  return cloned;
}

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

function createHistoryEntries(
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

function createHistoryNavigationState(
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

function markActiveHistoryEntry(entries: HistoryListEntry[], activeEntryId: string | null): HistoryListEntry[] {
  return entries.map((entry) => ({
    ...entry,
    active: entry.id === activeEntryId || (!activeEntryId && entry.kind === 'current'),
  }));
}

function cloneSnapshotStack(snapshots: StateSnapshot[]): StateSnapshot[] {
  return snapshots.map((snapshot) => deepClone(snapshot));
}

function createBranchId(type: string): string {
  return `branch:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createBranchLabel(snapshots: StateSnapshot[], fallback = 'Alternative branch'): string {
  const tip = snapshots[snapshots.length - 1];
  return tip?.label ? `Branch: ${tip.label}` : fallback;
}

function createBranchFromRedoPath(
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

function appendHistoryBranch(branches: HistoryBranch[], branch: HistoryBranch | null): HistoryBranch[] {
  if (!branch || branch.snapshots.length === 0) return branches;
  return [...branches, branch].slice(-MAX_HISTORY_BRANCHES);
}

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

function sanitizeHistoryValueForProject(key: string, value: unknown): unknown {
  if (key === 'file') return undefined;
  if (
    (key === 'url' || key === 'thumbnailUrl' || key === 'proxyVideoUrl') &&
    typeof value === 'string' &&
    value.startsWith('blob:')
  ) {
    return undefined;
  }
  if (typeof File !== 'undefined' && value instanceof File) return undefined;
  if (typeof Element !== 'undefined' && value instanceof Element) return undefined;
  if (typeof HTMLMediaElement !== 'undefined' && value instanceof HTMLMediaElement) return undefined;
  if (isBinaryPayload(value)) return undefined;
  return value;
}

function cloneHistoryForProject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, sanitizeHistoryValueForProject)) as T;
}

function normalizePersistedSnapshot(value: unknown): StateSnapshot | null {
  if (!isStateSnapshot(value)) return null;
  return deepClone(value);
}

function normalizePersistedSnapshotStack(values: unknown[], maxHistorySize: number): StateSnapshot[] {
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

function normalizePersistedEventLog(values: unknown): HistoryTimelineEvent[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter(isHistoryTimelineEvent)
    .filter((event) => event.type !== 'autosave')
    .slice(-MAX_HISTORY_EVENT_LOG_SIZE);
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

function normalizePersistedVisibleEntries(values: unknown): HistoryListEntry[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter(isHistoryListEntry)
    .filter((entry) => entry.eventType !== 'autosave')
    .slice(-MAX_HISTORY_EVENT_LOG_SIZE);
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

function normalizePersistedBranches(values: unknown, maxHistorySize: number): HistoryBranch[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizePersistedBranch(value, maxHistorySize))
    .filter((branch): branch is HistoryBranch => branch !== null)
    .slice(-MAX_HISTORY_BRANCHES);
}

function limitSnapshotStackForProject(snapshots: StateSnapshot[], maxHistorySize: number): StateSnapshot[] {
  return snapshots.slice(-Math.min(maxHistorySize, MAX_PERSISTED_HISTORY_SNAPSHOTS));
}

function limitBranchForProject(branch: HistoryBranch, maxHistorySize: number): HistoryBranch {
  return {
    ...branch,
    baseSnapshot: branch.baseSnapshot,
    baseUndoStack: limitSnapshotStackForProject(branch.baseUndoStack, maxHistorySize),
    snapshots: limitSnapshotStackForProject(branch.snapshots, maxHistorySize),
  };
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
    activeBoardId: null,
    boards: [],
    selectedNodeIds: [],
    composer: createDefaultFlashBoardComposer(),
  };

  return {
    activeBoardId: flashboard.activeBoardId ?? null,
    boards: deepClone(flashboard.boards || []),
    composer: deepClone(flashboard.composer || createDefaultFlashBoardComposer()),
    generationMetadataByMediaId: deepClone(flashBoardMediaBridge.serializeMetadata()),
  };
}

function createExportSnapshot(): ExportStoreData {
  return deepClone(getExportStoreData(getExportState?.() || createDefaultExportStoreData()));
}

// Create snapshot from current state
function createSnapshot(label: string, _previousSnapshot?: StateSnapshot | null): StateSnapshot {
  return {
    timestamp: Date.now(),
    label,
    timeline: createTimelineSnapshot(),
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
          branches: appendHistoryBranch(branches, branch),
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

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,
    getHistoryEntries: () => {
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
          branches: appendHistoryBranch(branches, branch),
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
        undoStack: limitSnapshotStackForProject(undoStack, maxHistorySize),
        redoStack: limitSnapshotStackForProject(redoStack, maxHistorySize),
        currentSnapshot,
        eventLog: persistentEventLog.slice(-MAX_HISTORY_EVENT_LOG_SIZE),
        visibleEntries,
        branches: branches
          .slice(-MAX_HISTORY_BRANCHES)
          .map((branch) => limitBranchForProject(branch, maxHistorySize)),
        maxHistorySize: persistedMaxHistorySize,
      });
    },

    hydrateFromProject: (history) => {
      const maxHistorySize = Math.max(1, Math.floor(history?.maxHistorySize ?? get().maxHistorySize));

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
        const visibleEntries = normalizePersistedVisibleEntries(history.visibleEntries);
        const activeEntry = visibleEntries.find((entry) => entry.active);

        set({
          undoStack: [],
          redoStack: [],
          eventLog: normalizePersistedEventLog(history.eventLog),
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
        eventLog: normalizePersistedEventLog(history.eventLog),
        branches: normalizePersistedBranches(history.branches, maxHistorySize),
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
