// MediaStore types - extracted from mediaStore.ts

import type {
  AnalysisStatus,
  CompositionTimelineData,
  GaussianSplatSequenceData,
  ModelSequenceData,
  TranscriptStatus,
  TranscriptWord,
} from '../../types';
import type { SplatEffectorSettings } from '../../types/splatEffector';
import type { VectorAnimationMetadata, VectorAnimationProvider } from '../../types/vectorAnimation';

// Media item types
export type ImportedMediaType =
  | 'video'
  | 'audio'
  | 'image'
  | 'model'
  | 'gaussian-avatar'
  | 'gaussian-splat'
  | VectorAnimationProvider;

export type MediaType =
  | ImportedMediaType
  | 'composition'
  | 'text'
  | 'solid'
  | 'camera'
  | 'splat-effector';

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

export type SlotClipEndBehavior = 'loop' | 'hold' | 'clear';

export interface SlotClipSettings {
  trimIn: number;
  trimOut: number;
  endBehavior: SlotClipEndBehavior;
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
  type: ImportedMediaType;
  file?: File;
  url: string;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  importProgress?: number;
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
  vectorAnimation?: VectorAnimationMetadata;
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

// 3D mesh primitive types
export type MeshPrimitiveType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'torus' | 'cone' | 'text3d';

// 3D mesh item (for Media Panel - can be dragged to timeline)
export interface MeshItem extends MediaItem {
  type: 'model';
  meshType: MeshPrimitiveType;
  color: string;      // Mesh material color
  duration: number;   // Default duration when added to timeline
}

export interface SceneCameraSettings {
  fov: number;
  near: number;
  far: number;
}

export const DEFAULT_SCENE_CAMERA_SETTINGS: SceneCameraSettings = {
  fov: 60,
  near: 0.1,
  far: 1000,
};

export interface CameraItem extends MediaItem {
  type: 'camera';
  duration: number;
  cameraSettings: SceneCameraSettings;
}

export interface SplatEffectorItem extends MediaItem {
  type: 'splat-effector';
  duration: number;
  splatEffectorSettings: SplatEffectorSettings;
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
export type ProjectItem = MediaFile | Composition | MediaFolder | TextItem | SolidItem | MeshItem | CameraItem | SplatEffectorItem;

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
  meshItems: MeshItem[];
  cameraItems: CameraItem[];
  splatEffectorItems: SplatEffectorItem[];

  // Active composition
  activeCompositionId: string | null;
  openCompositionIds: string[];

  // Slot grid
  slotAssignments: Record<string, number>;  // compId → slotIndex
  slotDeckStates?: Record<number, SlotDeckState>;
  slotClipSettings: Record<string, SlotClipSettings>;
  selectedSlotCompositionId: string | null;
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
