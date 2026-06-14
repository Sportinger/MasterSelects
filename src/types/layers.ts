import type { BlendMode } from './blendMode';
import type { RuntimeColorGrade } from './colorCorrection';
import type { Effect } from './effects';
import type {
  GaussianSplatSequenceData,
  ModelSequenceData,
} from './mediaSequences';
import type { MotionLayerDefinition } from './motionDesign';
import type { Text3DProperties, TextClipProperties } from './text';
import type { TimelineClip, TimelineTrack } from './timeline';

export interface Layer {
  id: string;
  name: string;
  sourceClipId?: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  source: LayerSource | null;
  effects: Effect[];
  colorCorrection?: RuntimeColorGrade;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z?: number };
  rotation: number | { x: number; y: number; z: number };  // Single value (z only) or full 3D rotation
  is3D?: boolean;  // When true, layer participates in the shared 3D scene
  wireframe?: boolean;  // Debug: show as wireframe
  // Mask properties (passed from timeline clip masks for GPU processing)
  maskFeather?: number;  // Blur radius in pixels (0-50), handled in GPU shader
  maskFeatherQuality?: number;  // Blur quality: 0=low (9 samples), 1=medium (17), 2=high (25)
  maskInvert?: boolean;  // Whether to invert the mask, handled in GPU shader
  maskClipId?: string;  // Clip ID for looking up mask texture (consistent across systems)
  transitionRender?: TransitionRenderState;
}

export type TransitionRenderState =
  | {
      kind: 'wipe';
      direction: 'left' | 'right';
      progress: number;
    };

export interface LayerSource {
  type: 'video' | 'image' | 'camera' | 'color' | 'text' | 'solid' | 'model' | 'gaussian-avatar' | 'gaussian-splat' | 'motion';
  modelUrl?: string;  // Blob URL to 3D model file (OBJ/glTF/GLB)
  modelFileName?: string;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;  // Whether shared-scene 3D effectors can affect this layer
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;  // Primitive mesh type (cube, sphere, etc.)
  file?: File;
  videoElement?: HTMLVideoElement;
  mediaTime?: number;
  targetMediaTime?: number;
  previewPath?: string;
  proxyFrameIndex?: number;
  mediaFileId?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  imageElement?: HTMLImageElement;
  color?: string;
  texture?: GPUTexture;
  // WebCodecs support for hardware-accelerated video decode
  webCodecsPlayer?:
    | import('../engine/WebCodecsPlayer').WebCodecsPlayer
    | import('../services/mediaRuntime/types').RuntimeFrameProvider;
  videoFrame?: VideoFrame;
  // Native Helper decoder for ProRes/DNxHD (turbo mode)
  nativeDecoder?: import('../services/nativeHelper').NativeDecoder;
  // Path to original file (for native helper to access directly)
  filePath?: string;
  // Shared media runtime binding
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  // Gaussian avatar support
  gaussianAvatarUrl?: string;
  gaussianBlendshapes?: Record<string, number>;
  // Gaussian splat clip support
  gaussianSplatUrl?: string;
  gaussianSplatFileName?: string;
  gaussianSplatFileHash?: string;
  gaussianSplatRuntimeKey?: string;
  gaussianSplatSettings?: import('../engine/gaussian/types').GaussianSplatSettings;
  cameraSettings?: import('../stores/mediaStore/types').SceneCameraSettings;
  // Nested composition support - pre-rendered layers from nested comp
  nestedComposition?: NestedCompositionData;
  // Text clip support
  textCanvas?: HTMLCanvasElement;
  textProperties?: TextClipProperties;
  text3DProperties?: Text3DProperties;
  // Motion design support
  motion?: MotionLayerDefinition;
}

// Data for pre-rendering nested compositions
export interface NestedCompositionData {
  compositionId: string;
  layers: Layer[];  // Layers from the nested composition to be pre-rendered
  width: number;
  height: number;
  currentTime?: number;  // Current time for frame caching
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
}
