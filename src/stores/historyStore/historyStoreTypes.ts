import type {
  Keyframe,
  Layer,
  MasterAudioState,
  TimelineClip,
  TimelineTrack,
} from '../../types';
import type {
  Composition,
  MathSceneItem,
  MediaFile,
  MediaFolder,
  MotionShapeItem,
  SignalAssetItem,
  SolidItem,
  TextItem,
} from '../mediaStore/types';
import type { SignalArtifact, SignalGraph, SignalOperatorDescriptor } from '../../signals';
import type { TimelineMarker } from '../timeline/types';
import type { DockLayout } from '../../types/dock';
import type {
  HistoryEventType,
  HistoryListEntry,
  HistoryTimelineEvent,
  ProjectHistoryState,
} from '../../types/history';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardComposerState,
  FlashBoardGenerationMetadata,
} from '../flashboardStore/types';
import type { ExportStoreData } from '../exportStore';
import type { HistoryTimelineEditState } from '../timeline/historyTimelineEditState';

export interface StateSnapshot {
  timestamp: number;
  label: string;
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
  timelineEditState?: HistoryTimelineEditState;
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
  dock: {
    layout: DockLayout | null;
  };
  flashboard: {
    activeGenerationRecords: FlashBoardActiveGenerationRecord[];
    composer: FlashBoardComposerState;
    generationMetadataByMediaId: Record<string, FlashBoardGenerationMetadata>;
  };
  export: ExportStoreData;
}

export interface HistoryState {
  undoStack: StateSnapshot[];
  redoStack: StateSnapshot[];
  eventLog: HistoryTimelineEvent[];
  branches: HistoryBranch[];
  navigationEntries: HistoryListEntry[] | null;
  navigationSnapshotsByEntryId: Record<string, StateSnapshot>;
  activeEntryId: string | null;
  currentSnapshot: StateSnapshot | null;
  maxHistorySize: number;
  isApplying: boolean;
  batchId: number | null;
  batchLabel: string | null;
  captureSnapshot: (label: string) => void;
  undo: () => HistoryOperationResult | null;
  redo: () => HistoryOperationResult | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getHistoryEntries: () => HistoryListEntry[];
  recordEvent: (type: HistoryEventType, label: string) => void;
  restoreEntry: (entry: HistoryListEntry) => HistoryRestoreResult | null;
  restoreBranch: (branchId: string, snapshotIndex?: number) => HistoryRestoreResult | null;
  startBatch: (label: string) => void;
  endBatch: () => void;
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

export interface HistoryBranch {
  id: string;
  label: string;
  createdAt: number;
  baseSnapshot: StateSnapshot | null;
  baseUndoStack: StateSnapshot[];
  snapshots: StateSnapshot[];
}

export interface HistoryNavigationState {
  entries: HistoryListEntry[];
  snapshotsByEntryId: Record<string, StateSnapshot>;
}

export interface TimelineStoreState {
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

export interface MediaStoreState {
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

export interface DockStoreSnapshot {
  layout: DockLayout;
}

export interface FlashBoardStoreSnapshot {
  activeGenerationRecords: FlashBoardActiveGenerationRecord[];
  selectedActiveGenerationRecordIds: string[];
  composer: FlashBoardComposerState;
}

export type ExportStoreSnapshot = ExportStoreData;
