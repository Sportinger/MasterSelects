// Composition-related types

import type { ProjectKeyframe, ProjectMarker, ProjectEffect, ProjectMask, ProjectTransform, ProjectTempoMap, ProjectRulerLane } from './timeline.types';
import type {
  ClipAudioState,
  MasterAudioState,
  TrackAudioState,
} from '../../../types/audio';
import type { ColorCorrectionState } from '../../../types/colorCorrection';
import type { ClipNodeGraph } from '../../../types/nodeGraph';
import type { MotionLayerDefinition } from '../../../types/motionDesign';
import type { LayerSourceRect, TransitionRenderState } from '../../../types/layers';
import type { TransitionOverlayClipDefinition } from '../../../types/timeline';
import type { TimelineTransition, TransitionCompositionLink } from '../../../types/timelineCore';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';
import type { MidiClipData, MidiInstrument } from '../../../types/midiClip';
import type {
  ProjectClipAnalysis,
  ProjectClipVideoState,
  ProjectMathSceneDefinition,
  ProjectSceneSegment,
  ProjectText3DProperties,
  ProjectTextClipProperties,
  ProjectTranscriptWord,
  ProjectVideoBakeRegion,
} from './clip-payload.types';
import type {
  ProjectGaussianSplatSequenceData,
  ProjectGaussianSplatSettings,
  ProjectLabelColor,
  ProjectMeshPrimitiveType,
  ProjectModelSequenceData,
  ProjectSceneCameraSettings,
  ProjectSplatEffectorSettings,
} from './schema.types';

export interface ProjectTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'midi';
  height: number;
  labelColor?: ProjectLabelColor;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  audioState?: TrackAudioState;
  // MIDI track instrument (issue #182)
  midiInstrument?: MidiInstrument;
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
  sourceRect?: LayerSourceRect;
  transitionRender?: TransitionRenderState;

  // Effects
  effects: ProjectEffect[];
  transitionIn?: TimelineTransition;
  transitionOut?: TimelineTransition;
  transitionSourceTimeOverride?: number;
  transitionSourceHold?: boolean;
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: ClipNodeGraph;

  // Masks
  masks: ProjectMask[];

  // Keyframes
  keyframes: ProjectKeyframe[];

  // Audio
  volume: number;
  audioEnabled: boolean;
  videoState?: ProjectClipVideoState;
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
  sourceType?: 'video' | 'audio' | 'image' | 'text' | 'solid' | 'model' | 'camera' | 'gaussian-avatar' | 'gaussian-splat' | 'splat-effector' | 'math-scene' | 'transition-overlay' | 'motion-shape' | 'motion-null' | 'motion-adjustment' | 'lottie' | 'rive' | 'midi';
  // MIDI clip note data (issue #182); wired into save/load in the persistence phase
  midiData?: MidiClipData;
  naturalDuration?: number;
  linkedClipId?: string;
  linkedGroupId?: string;
  thumbnails?: string[];
  waveform?: number[];
  waveformChannels?: number[][];
  meshType?: ProjectMeshPrimitiveType;
  cameraSettings?: ProjectSceneCameraSettings;
  splatEffectorSettings?: ProjectSplatEffectorSettings;
  gaussianBlendshapes?: Record<string, number>;
  gaussianSplatSettings?: ProjectGaussianSplatSettings;
  is3D?: boolean;
  modelSequence?: ProjectModelSequenceData;
  gaussianSplatSequence?: ProjectGaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;

  // Text clip support
  textProperties?: ProjectTextClipProperties;
  text3DProperties?: ProjectText3DProperties;

  // Solid clip support
  solidColor?: string;

  // Generated transition overlay clip support
  transitionOverlay?: TransitionOverlayClipDefinition;

  // Math scene clip support
  mathScene?: ProjectMathSceneDefinition;

  // Motion design clip support
  motion?: MotionLayerDefinition;

  vectorAnimationSettings?: VectorAnimationClipSettings;

  // Transcript data
  transcript?: ProjectTranscriptWord[];
  transcriptStatus?: string;

  // Analysis data
  analysis?: ProjectClipAnalysis;
  analysisStatus?: string;

  // AI scene description data
  sceneDescriptions?: ProjectSceneSegment[];
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
  transitionComp?: TransitionCompositionLink;

  // Tracks and clips
  tracks: ProjectTrack[];
  clips: ProjectClip[];
  videoBakeRegions?: ProjectVideoBakeRegion[];
  masterAudioState?: MasterAudioState;

  // Markers
  markers: ProjectMarker[];

  // Multi-ruler infrastructure (issue #257). Optional for back-compat: projects
  // authored before this feature lack them and are normalized to defaults on load.
  tempoMap?: ProjectTempoMap;
  rulerLanes?: ProjectRulerLane[];
  activeRulerLaneId?: string | null;
}
