import type {
  BezierHandle,
  ClipAudioState,
  ClipMask,
  ClipTransform,
  ColorCorrectionState,
  EasingType,
  Effect,
  Keyframe,
  MathSceneDefinition,
  SerializableClip,
  TransitionOverlayClipDefinition,
} from '../../../types';
import type { MotionLayerDefinition } from '../../../types/motionDesign';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';
import type { MeshPrimitiveType, SceneCameraSettings } from '../../mediaStore/types';

export interface ClipboardClipData {
  id: string;
  trackId: string;
  trackType: 'video' | 'audio' | 'midi';
  name: string;
  mediaFileId?: string;
  signalAssetId?: string;
  signalRefId?: string;
  signalRenderAdapterId?: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceType: SerializableClip['sourceType'];
  naturalDuration?: number;
  transform: ClipTransform;
  effects: Effect[];
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: import('../../../types').ClipNodeGraph;
  masks?: ClipMask[];
  keyframes?: Keyframe[];
  linkedClipId?: string;
  reversed?: boolean;
  speed?: number;
  preservesPitch?: boolean;
  textProperties?: import('../../../types').TextClipProperties;
  text3DProperties?: import('../../../types').Text3DProperties;
  solidColor?: string;
  transitionOverlay?: TransitionOverlayClipDefinition;
  mathScene?: MathSceneDefinition;
  motion?: MotionLayerDefinition;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  cameraSettings?: SceneCameraSettings;
  meshType?: MeshPrimitiveType;
  splatEffectorSettings?: import('../../../types/splatEffector').SplatEffectorSettings;
  threeDEffectorsEnabled?: boolean;
  thumbnails?: string[];
  waveform?: number[];
  waveformChannels?: number[][];
  audioAnalysisRefs?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'>;
  isComposition?: boolean;
  compositionId?: string;
  is3D?: boolean;
  wireframe?: boolean;
}

export interface ClipboardKeyframeData {
  clipId: string;
  property: import('../../../types').AnimatableProperty;
  time: number;
  value: number;
  pathValue?: Keyframe['pathValue'];
  easing: EasingType;
  rotationInterpolation?: Keyframe['rotationInterpolation'];
  handleIn?: BezierHandle;
  handleOut?: BezierHandle;
}

export interface ClipboardClipEffectsData {
  sourceClipId: string;
  effects: Effect[];
  keyframes: Keyframe[];
}

export interface ClipboardClipColorData {
  sourceClipId: string;
  colorCorrection: ColorCorrectionState;
  keyframes: Keyframe[];
}

export interface ClipboardClipMaskData {
  sourceClipId: string;
  mask: ClipMask;
  keyframes: Keyframe[];
}

export interface ClipboardState {
  clipboardData: ClipboardClipData[] | null;
  clipboardKeyframes: ClipboardKeyframeData[] | null;
  clipboardEffects: ClipboardClipEffectsData | null;
  clipboardColor: ClipboardClipColorData | null;
  clipboardMask: ClipboardClipMaskData | null;
}

export interface ClipboardActions {
  copyClips: () => void;
  pasteClips: () => void;
  hasClipboardData: () => boolean;
  copyKeyframes: () => void;
  pasteKeyframes: () => void;
  copyClipEffects: (clipId: string) => void;
  pasteClipEffects: (targetClipIds?: string[]) => void;
  hasClipboardEffects: () => boolean;
  copyClipColor: (clipId: string) => void;
  pasteClipColor: (targetClipIds?: string[]) => void;
  hasClipboardColor: () => boolean;
}
