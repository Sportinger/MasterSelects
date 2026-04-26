// Project-level types

import type { ProjectMediaFile } from './media.types';
import type { ProjectComposition } from './composition.types';
import type { ProjectFolder } from './folder.types';
import type { DockLayout } from '../../../types/dock';
import type { ProjectFlashBoardState } from '../../../stores/flashboardStore/types';
import type { ExportStoreData } from '../../../stores/exportStore';
import type {
  CameraItem,
  MeshItem,
  SolidItem,
  SplatEffectorItem,
  TextItem,
} from '../../../stores/mediaStore/types';

export interface ProjectYouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: string;
}

export interface ProjectYouTubeState {
  videos: ProjectYouTubeVideo[];
  lastQuery: string;
}

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
  // Transcript settings
  transcriptLanguage?: string;
  // View toggles
  thumbnailsEnabled?: boolean;
  waveformsEnabled?: boolean;
  proxyEnabled?: boolean;
  showTranscriptMarkers?: boolean;
  showChangelogOnStartup?: boolean;
  lastSeenChangelogVersion?: string | null;
  midi?: ProjectMIDIState;
  exportState?: ExportStoreData;
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

  // YouTube panel state
  youtube?: ProjectYouTubeState;

  // UI state (dock layout, view positions, etc.)
  uiState?: ProjectUIState;

  // FlashBoard AI workspace state
  flashboard?: ProjectFlashBoardState;

  // Generated media items
  textItems?: TextItem[];
  solidItems?: SolidItem[];
  meshItems?: MeshItem[];
  cameraItems?: CameraItem[];
  splatEffectorItems?: SplatEffectorItem[];
}
