// Project-level types

import type { ProjectMediaFile } from './media.types';
import type { ProjectComposition } from './composition.types';
import type { ProjectFolder } from './folder.types';
import type { DockLayout } from '../../../types/dock';
import type { ProjectAudioState } from '../../../types/audio';
import type { ProjectHistoryState } from '../../../types/history';
import type {
  SignalArtifact,
  SignalAsset,
  SignalGraph,
  SignalOperatorDescriptor,
} from '../../../signals';
import type {
  ProjectCameraItem,
  ProjectLabelColor,
  ProjectMathSceneItem,
  ProjectMediaBoardGroupOffsets,
  ProjectMediaBoardNodeLayout,
  ProjectMediaBoardOrder,
  ProjectMediaBoardViewport,
  ProjectMeshItem,
  ProjectMotionShapeItem,
  ProjectSolidItem,
  ProjectSplatEffectorItem,
  ProjectTextItem,
  ProjectTimelineAudioDisplayMode,
  ProjectTimelineTrackFocusMode,
} from './schema.types';
import type { ProjectExportStoreData } from './export.types';
import type { ProjectFlashBoardState } from './flashboard.types';

export type {
  ProjectMediaBoardGroupOffsets,
  ProjectMediaBoardNodeLayout,
  ProjectMediaBoardOrder,
  ProjectMediaBoardViewport,
} from './schema.types';

export interface ProjectSettings {
  width: number;
  height: number;
  frameRate: number;
  sampleRate: number;
}

export interface ProjectMIDIState {
  isEnabled?: boolean;
  transportBindings?: {
    playPause?: import('../../../types/midi').MIDINoteBinding | null;
    stop?: import('../../../types/midi').MIDINoteBinding | null;
  };
  slotBindings?: Record<number, import('../../../types/midi').MIDINoteBinding | null>;
  parameterBindings?: import('../../../types/midi').MIDIParameterBindings;
}

export interface ProjectSignalState {
  schemaVersion: 1;
  assets: SignalAsset[];
  artifacts: SignalArtifact[];
  graphs: SignalGraph[];
  operators: SignalOperatorDescriptor[];
  assetItems?: ProjectSignalAssetItemState[];
  updatedAt?: string;
}

export interface ProjectSignalAssetItemState {
  id: string;
  parentId: string | null;
  createdAt: number;
  labelColor?: ProjectLabelColor;
}

// UI state that gets persisted with the project
export interface ProjectUIState {
  // Dock/panel layout
  dockLayout?: DockLayout;
  // Timeline view state per composition (keyed by composition ID)
  compositionViewState?: Record<string, {
    playheadPosition?: number;
    zoom?: number;
    scrollX?: number;
    inPoint?: number | null;
    outPoint?: number | null;
  }>;
  // Media panel settings
  mediaPanelColumns?: string[];
  mediaPanelNameWidth?: number;
  mediaPanelViewMode?: 'classic' | 'icons' | 'board';
  mediaPanelBoardViewport?: ProjectMediaBoardViewport;
  mediaPanelBoardOrder?: ProjectMediaBoardOrder;
  mediaPanelBoardGroupOffsets?: ProjectMediaBoardGroupOffsets;
  mediaPanelBoardLayouts?: Record<string, ProjectMediaBoardNodeLayout>;
  // Transcript settings
  transcriptLanguage?: string;
  // View toggles
  thumbnailsEnabled?: boolean;
  waveformsEnabled?: boolean;
  audioDisplayMode?: ProjectTimelineAudioDisplayMode;
  audioFocusMode?: boolean;
  trackFocusMode?: ProjectTimelineTrackFocusMode;
  trackHeaderWidth?: number;
  timelineSplitRatio?: number | null;
  proxyEnabled?: boolean;
  showTranscriptMarkers?: boolean;
  showChangelogOnStartup?: boolean;
  lastSeenChangelogVersion?: string | null;
  midi?: ProjectMIDIState;
  exportState?: ProjectExportStoreData;
  history?: ProjectHistoryState;
}

export interface ProjectFile {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;

  // Project settings
  settings: ProjectSettings;

  // Media references (paths relative to project folder or absolute)
  media: ProjectMediaFile[];

  // Universal Signal IR state for non-legacy import/runtime artifacts
  signals?: ProjectSignalState;

  // Advanced audio workstation state and artifact indexes
  audio?: ProjectAudioState;

  // Compositions (timelines)
  compositions: ProjectComposition[];

  // Folders for organization
  folders: ProjectFolder[];

  // Active state
  activeCompositionId: string | null;
  openCompositionIds: string[];
  expandedFolderIds: string[];

  // Slot grid assignments (compId → slotIndex)
  slotAssignments?: Record<string, number>;
  slotClipSettings?: Record<string, {
    trimIn: number;
    trimOut: number;
    endBehavior: 'loop' | 'hold' | 'clear';
  }>;

  // Media source folders (for relinking after cache clear)
  mediaSourceFolders?: string[];

  // UI state (dock layout, view positions, etc.)
  uiState?: ProjectUIState;

  // FlashBoard AI workspace state
  flashboard?: ProjectFlashBoardState;

  // Generated media items
  textItems?: ProjectTextItem[];
  solidItems?: ProjectSolidItem[];
  meshItems?: ProjectMeshItem[];
  cameraItems?: ProjectCameraItem[];
  splatEffectorItems?: ProjectSplatEffectorItem[];
  mathSceneItems?: ProjectMathSceneItem[];
  motionShapeItems?: ProjectMotionShapeItem[];
}
