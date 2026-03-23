// MediaStore types - extracted from mediaStore.ts

import type { CompositionTimelineData, TranscriptWord, TranscriptStatus, AnalysisStatus } from '../../types';

// Media item types
export type MediaType = 'video' | 'audio' | 'image' | 'composition' | 'text' | 'solid' | 'model';

// Proxy status for video files
export type ProxyStatus = 'none' | 'generating' | 'ready' | 'error';

export type SlotDeckStatus =
  | 'cold'
  | 'warming'
  | 'warm'
  | 'hot'
  | 'failed'
  | 'disposed';

export interface SlotDeckState {
  slotIndex: number;
  compositionId: string | null;
  status: SlotDeckStatus;
  preparedClipCount: number;
  readyClipCount: number;
  firstFrameReady: boolean;
  decoderMode: 'html' | 'webcodecs' | 'native' | 'mixed' | 'unknown';
  lastPreparedAt: number | null;
  lastActivatedAt: number | null;
  lastError: string | null;
  pinnedLayerIndex: number | null;
}

// Label colors (AE-style)
export type LabelColor = 'none' | 'red' | 'yellow' | 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'cyan' | 'brown' | 'lavender' | 'peach' | 'seafoam' | 'fuchsia' | 'tan' | 'aqua';

// Base media item
export interface MediaItem {
  id: string;
  name: string;
  type: MediaType;
  parentId: string | null;
  createdAt: number;
  labelColor?: LabelColor;
}

// Imported file
export interface MediaFile extends MediaItem {
  type: 'video' | 'audio' | 'image' | 'model';
  file?: File;
  url: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  audioCodec?: string;
  container?: string;
  fileSize?: number;
  bitrate?: number;      // bits per second
  hasAudio?: boolean;    // Does video have audio tracks?
  fileHash?: string;
  thumbnailUrl?: string;
  // Proxy support
  proxyStatus?: ProxyStatus;
  proxyProgress?: number;
  proxyFrameCount?: number;
  proxyFps?: number;
  hasProxyAudio?: boolean;
  proxyVideoUrl?: string;
  // Transcript support
  transcriptStatus?: TranscriptStatus;
  transcript?: TranscriptWord[];
  transcriptCoverage?: number;  // 0-1, how much of total duration is transcribed
  transcribedRanges?: [number, number][];  // Time ranges that have been transcribed
  // Analysis support (CV or AI describe)
  analysisStatus?: AnalysisStatus;
  analysisCoverage?: number;    // 0-1, how much of total duration is analyzed
  // File System Access API
  hasFileHandle?: boolean;
  filePath?: string;
  absolutePath?: string;
  projectPath?: string;
  // Import loading state
  isImporting?: boolean;
}

// Text item (for Media Panel - can be dragged to timeline)
export interface TextItem extends MediaItem {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  duration: number; // Default duration when added to timeline
}

// Solid color item (for Media Panel - can be dragged to timeline)
export interface SolidItem extends MediaItem {
  type: 'solid';
  color: string;
  width: number;
  height: number;
  duration: number; // Default duration when added to timeline
}

// 3D camera configuration for compositions
export interface CompositionCamera {
  enabled: boolean;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;    // degrees
  near: number;
  far: number;
}

export const DEFAULT_CAMERA: CompositionCamera = {
  enabled: false,
  position: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  fov: 50,
  near: 0.1,
  far: 1000,
};

// Composition
export interface Composition extends MediaItem {
  type: 'composition';
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  backgroundColor: string;
  timelineData?: CompositionTimelineData;
  camera?: CompositionCamera;
}

// Folder for organization
export interface MediaFolder {
  id: string;
  name: string;
  parentId: string | null;
  isExpanded: boolean;
  createdAt: number;
  labelColor?: LabelColor;
}

// Union type for all items
export type ProjectItem = MediaFile | Composition | MediaFolder | TextItem | SolidItem;

// Slice creator type for mediaStore
export type MediaSliceCreator<T> = (
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState
) => T;

// Full state interface
export interface MediaState {
  // Items
  files: MediaFile[];
  compositions: Composition[];
  folders: MediaFolder[];
  textItems: TextItem[];
  solidItems: SolidItem[];

  // Active composition
  activeCompositionId: string | null;
  openCompositionIds: string[];

  // Slot grid
  slotAssignments: Record<string, number>;  // compId → slotIndex
  slotDeckStates?: Record<number, SlotDeckState>;
  previewCompositionId: string | null;
  sourceMonitorFileId: string | null;

  // Multi-layer playback (Resolume-style)
  activeLayerSlots: Record<number, string | null>;  // layerIndex (0=A..3=D) → compositionId
  layerOpacities: Record<number, number>;            // layerIndex (0=A..3=D) → opacity (0-1)

  // Selection
  selectedIds: string[];
  expandedFolderIds: string[];

  // Project
  currentProjectId: string | null;
  currentProjectName: string;
  isLoading: boolean;

  // Proxy system
  proxyEnabled: boolean;
  proxyGenerationQueue: string[];
  currentlyGeneratingProxyId: string | null;

  // File System Access API
  fileSystemSupported: boolean;
  proxyFolderName: string | null;

  // Actions are added by slices
  [key: string]: unknown;
}

// Import result for unified pipeline
export interface ImportResult {
  mediaFile: MediaFile;
  handle?: FileSystemFileHandle;
}
