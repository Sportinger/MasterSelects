// Composition-related types

import type { ProjectKeyframe, ProjectMarker, ProjectEffect, ProjectMask, ProjectTransform } from './timeline.types';
import type { MeshPrimitiveType, SceneCameraSettings } from '../../../stores/mediaStore/types';
import type { GaussianSplatSettings } from '../../../engine/gaussian/types';
import type { SplatEffectorSettings } from '../../../types/splatEffector';
import type { Text3DProperties } from '../../../types';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';

export interface ProjectTrack {
  id: string;
  name: string;
  type: 'video' | 'audio';
  height: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
}

export interface ProjectClip {
  id: string;
  trackId: string;
  name?: string;
  mediaId: string; // Reference to ProjectMediaFile.id (empty for composition clips)

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

  // Masks
  masks: ProjectMask[];

  // Keyframes
  keyframes: ProjectKeyframe[];

  // Audio
  volume: number;
  audioEnabled: boolean;

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
  sourceType?: 'video' | 'audio' | 'image' | 'text' | 'solid' | 'model' | 'camera' | 'gaussian-avatar' | 'gaussian-splat' | 'splat-effector' | 'lottie' | 'rive';
  naturalDuration?: number;
  linkedClipId?: string;
  linkedGroupId?: string;
  thumbnails?: string[];
  waveform?: number[];
  meshType?: MeshPrimitiveType;
  cameraSettings?: SceneCameraSettings;
  splatEffectorSettings?: SplatEffectorSettings;
  gaussianBlendshapes?: Record<string, number>;
  gaussianSplatSettings?: GaussianSplatSettings;
  is3D?: boolean;

  // Text clip support
  textProperties?: any;
  text3DProperties?: Text3DProperties;

  // Solid clip support
  solidColor?: string;

  vectorAnimationSettings?: VectorAnimationClipSettings;

  // Transcript data
  transcript?: any[];
  transcriptStatus?: string;

  // Analysis data
  analysis?: any;
  analysisStatus?: string;

  // AI scene description data
  sceneDescriptions?: any[];
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

  // Markers
  markers: ProjectMarker[];
}
