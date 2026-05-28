// Composition-related types

import type { ProjectKeyframe, ProjectMarker, ProjectEffect, ProjectMask, ProjectTransform } from './timeline.types';
import type { LabelColor, MeshPrimitiveType, SceneCameraSettings } from '../../../stores/mediaStore/types';
import type { GaussianSplatSettings } from '../../../engine/gaussian/types';
import type { SplatEffectorSettings } from '../../../types/splatEffector';
import type {
  ClipAudioState,
  ClipAnalysis,
  ClipVideoState,
  ColorCorrectionState,
  GaussianSplatSequenceData,
  MasterAudioState,
  ModelSequenceData,
  MathSceneDefinition,
  MotionLayerDefinition,
  ClipNodeGraph,
  SceneSegment,
  TrackAudioState,
  Text3DProperties,
  TextClipProperties,
  TranscriptWord,
  VideoBakeRegion,
} from '../../../types';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';

export interface ProjectTrack {
  id: string;
  name: string;
  type: 'video' | 'audio';
  height: number;
  labelColor?: LabelColor;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  audioState?: TrackAudioState;
}

export interface ProjectClip {
  id: string;
  trackId: string;
  name?: string;
  mediaId: string; // Reference to ProjectMediaFile.id (empty for composition clips)
  signalAssetId?: string; // Source SignalAsset id for renderer-adapter materialized clips
  signalRefId?: string; // Source SignalRef id selected by the renderer adapter
  signalRenderAdapterId?: string; // Renderer adapter id that produced the clip

  // Timeline position
  startTime: number;
  duration: number;

  // Source trimming
  inPoint: number;
  outPoint: number;

  // Transform
  transform: ProjectTransform;

  // Effects
  effects: ProjectEffect[];
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: ClipNodeGraph;

  // Masks
  masks: ProjectMask[];

  // Keyframes
  keyframes: ProjectKeyframe[];

  // Audio
  volume: number;
  audioEnabled: boolean;
  videoState?: ClipVideoState;
  audioState?: ClipAudioState;

  // Flags
  reversed: boolean;
  disabled: boolean;

  // Speed
  speed?: number;
  preservesPitch?: boolean;

  // Nested composition support
  isComposition?: boolean;
  compositionId?: string;

  // Additional clip metadata (for restoration)
  sourceType?: 'video' | 'audio' | 'image' | 'text' | 'solid' | 'model' | 'camera' | 'gaussian-avatar' | 'gaussian-splat' | 'splat-effector' | 'math-scene' | 'motion-shape' | 'motion-null' | 'motion-adjustment' | 'lottie' | 'rive';
  naturalDuration?: number;
  linkedClipId?: string;
  linkedGroupId?: string;
  thumbnails?: string[];
  waveform?: number[];
  waveformChannels?: number[][];
  meshType?: MeshPrimitiveType;
  cameraSettings?: SceneCameraSettings;
  splatEffectorSettings?: SplatEffectorSettings;
  gaussianBlendshapes?: Record<string, number>;
  gaussianSplatSettings?: GaussianSplatSettings;
  is3D?: boolean;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;

  // Text clip support
  textProperties?: TextClipProperties;
  text3DProperties?: Text3DProperties;

  // Solid clip support
  solidColor?: string;

  // Math scene clip support
  mathScene?: MathSceneDefinition;

  // Motion design clip support
  motion?: MotionLayerDefinition;

  vectorAnimationSettings?: VectorAnimationClipSettings;

  // Transcript data
  transcript?: TranscriptWord[];
  transcriptStatus?: string;

  // Analysis data
  analysis?: ClipAnalysis;
  analysisStatus?: string;

  // AI scene description data
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: string;
}

export interface ProjectComposition {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  backgroundColor: string;
  folderId: string | null;
  labelColor?: string;

  // Tracks and clips
  tracks: ProjectTrack[];
  clips: ProjectClip[];
  videoBakeRegions?: VideoBakeRegion[];
  masterAudioState?: MasterAudioState;

  // Markers
  markers: ProjectMarker[];
}
