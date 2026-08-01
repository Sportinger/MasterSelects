import type { MasterAudioState } from '../../types/audio';
import type { Keyframe } from '../../types/keyframes';
import type { Layer } from '../../types/layers';
import type { TempoMap, TimelineClip, TimelineTrack } from '../../types/timeline';
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
import type { StoryboardProjectState } from '../../services/storyboard/contracts';

export interface StateSnapshot {
  timestamp: number;
  label: string;
  timeline: {
    clips: TimelineClip[];
    tracks: TimelineTrack[];
    selectedClipIds: string[];
    selectedKeyframeIds?: string[];
    zoom: number;
    scrollX: number;
    layers: Layer[];
    selectedLayerId: string | null;
    clipKeyframes: Record<string, Keyframe[]>;
    markers: TimelineMarker[];
    // Tempo map is CONTENT and participates in undo (#299); ruler lanes and
    // the active lane stay out as view state.
    tempoMap?: TempoMap;
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
  storyboard?: StoryboardProjectState;
  export: ExportStoreData;
}

export interface HistoryBatchStartResult {
  opened: boolean;
  batchId: number | null;
}

export interface HistoryNode {
  id: string;
  parentId: string | null;
  snapshot: StateSnapshot;
}

export interface HistoryState {
  nodes: Record<string, HistoryNode>;
  rootId: string | null;
  activeNodeId: string | null;
  lastVisitedChildByNodeId: Record<string, string>;
  eventLog: HistoryTimelineEvent[];
  maxHistoryNodes: number;
  isApplying: boolean;
  batchId: number | null;
  batchLabel: string | null;
  // `options.isAutoCapture` marks the change-subscription fallback path (see
  // useGlobalHistory). An explicit (non-auto) capture additionally suppresses the
  // trailing debounced auto-capture that the SAME edit's store mutation schedules
  // — otherwise one explicit edit yields TWO undo steps (immediate + fallback).
  captureSnapshot: (label: string, options?: { isAutoCapture?: boolean }) => void;
  undo: () => HistoryRestoreResult | null;
  redo: () => HistoryRestoreResult | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getHistoryEntries: () => HistoryListEntry[];
  getActiveSnapshot: () => StateSnapshot | null;
  recordEvent: (type: HistoryEventType, label: string) => void;
  restoreEntry: (entry: HistoryListEntry) => HistoryRestoreResult | null;
  restoreBranch: (branchId: string, snapshotIndex?: number) => HistoryRestoreResult | null;
  startBatch: (label: string) => HistoryBatchStartResult;
  endBatch: () => void;
  cancelBatch: () => void;
  setIsApplying: (value: boolean) => void;
  clearHistory: () => void;
  serializeForProject: () => ProjectHistoryState | null;
  hydrateFromProject: (history: ProjectHistoryState | null | undefined) => void;
}

export interface HistoryRestoreResult {
  operation: 'undo' | 'redo' | 'restore-branch';
  label: string;
}

export interface TimelineStoreState {
  duration?: number;
  durationLocked?: boolean;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  selectedKeyframeIds?: Set<string>;
  zoom: number;
  scrollX: number;
  layers: Layer[];
  selectedLayerId: string | null;
  clipKeyframes: Map<string, Keyframe[]>;
  markers: TimelineMarker[];
  tempoMap?: TempoMap;
  masterAudioState?: MasterAudioState;
  isExporting?: boolean;
}

export interface MediaStoreState {
  activeCompositionId?: string | null;
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
export type StoryboardStoreSnapshot = StoryboardProjectState;

export interface HistoryStoreRefs {
  getTimelineState?: () => TimelineStoreState;
  setTimelineState?: (state: Partial<TimelineStoreState>) => void;
  getMediaState?: () => MediaStoreState;
  setMediaState?: (state: Partial<MediaStoreState>) => void;
  getDockState?: () => DockStoreSnapshot;
  setDockState?: (state: Partial<DockStoreSnapshot>) => void;
  getFlashBoardState?: () => FlashBoardStoreSnapshot;
  setFlashBoardState?: (state: Partial<FlashBoardStoreSnapshot>) => void;
  getStoryboardState?: () => StoryboardStoreSnapshot;
  setStoryboardState?: (state: StoryboardStoreSnapshot) => void;
  getExportState?: () => ExportStoreSnapshot;
  setExportState?: (state: Partial<ExportStoreSnapshot>) => void;
}

export interface HistoryStoreInitRefs {
  timeline: {
    getState: () => TimelineStoreState;
    setState: (state: Partial<TimelineStoreState>) => void;
  };
  media: {
    getState: () => MediaStoreState;
    setState: (state: Partial<MediaStoreState>) => void;
  };
  dock: {
    getState: () => DockStoreSnapshot;
    setState: (state: Partial<DockStoreSnapshot>) => void;
  };
  flashboard?: {
    getState: () => FlashBoardStoreSnapshot;
    setState: (state: Partial<FlashBoardStoreSnapshot>) => void;
  };
  storyboard?: {
    getState: () => StoryboardStoreSnapshot;
    setState: (state: StoryboardStoreSnapshot) => void;
  };
  export?: {
    getState: () => ExportStoreSnapshot;
    setState: (state: Partial<ExportStoreSnapshot>) => void;
  };
}
