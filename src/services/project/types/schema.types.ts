export type ProjectJsonPrimitive = string | number | boolean | null;
export type ProjectJsonValue =
  | ProjectJsonPrimitive
  | ProjectJsonValue[]
  | { [key: string]: ProjectJsonValue };
export type ProjectJsonObject = Record<string, ProjectJsonValue>;

export type ProjectLabelColor =
  | 'none'
  | 'red'
  | 'yellow'
  | 'blue'
  | 'green'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'cyan'
  | 'brown'
  | 'lavender'
  | 'peach'
  | 'seafoam'
  | 'fuchsia'
  | 'tan'
  | 'aqua';

export type ProjectTimelineAudioDisplayMode = 'compact' | 'detailed' | 'spectral';
export type ProjectTimelineTrackFocusMode = 'balanced' | 'audio' | 'video';

export interface ProjectMediaBoardViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ProjectMediaBoardNodeLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export type ProjectMediaBoardOrder = Record<string, string[]>;
export type ProjectMediaBoardGroupOffsets = Record<string, { x: number; y: number }>;

export type ProjectMeshPrimitiveType =
  | 'cube'
  | 'sphere'
  | 'plane'
  | 'cylinder'
  | 'torus'
  | 'cone'
  | 'text3d';

export interface ProjectSceneCameraSettings {
  fov: number;
  near: number;
  far: number;
  resolutionWidth?: number;
  resolutionHeight?: number;
}

export type ProjectSplatEffectorMode = 'repel' | 'attract' | 'swirl' | 'noise';

export interface ProjectSplatEffectorSettings {
  mode: ProjectSplatEffectorMode;
  strength: number;
  falloff: number;
  speed: number;
  seed: number;
}

export interface ProjectMediaItemBase {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  labelColor?: ProjectLabelColor;
}

export interface ProjectTextItem extends ProjectMediaItemBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  duration: number;
}

export interface ProjectSolidItem extends ProjectMediaItemBase {
  type: 'solid';
  color: string;
  width: number;
  height: number;
  duration: number;
}

export interface ProjectMeshItem extends ProjectMediaItemBase {
  type: 'model';
  meshType: ProjectMeshPrimitiveType;
  color: string;
  duration: number;
}

export interface ProjectCameraItem extends ProjectMediaItemBase {
  type: 'camera';
  duration: number;
  cameraSettings: ProjectSceneCameraSettings;
}

export interface ProjectSplatEffectorItem extends ProjectMediaItemBase {
  type: 'splat-effector';
  duration: number;
  splatEffectorSettings: ProjectSplatEffectorSettings;
}

export interface ProjectMathSceneItem extends ProjectMediaItemBase {
  type: 'math-scene';
  duration: number;
}

export type ProjectShapePrimitive = 'rectangle' | 'ellipse' | 'polygon' | 'star';

export interface ProjectMotionShapeItem extends ProjectMediaItemBase {
  type: 'motion-shape';
  primitive: ProjectShapePrimitive;
  duration: number;
}

export type ProjectModelSequencePlaybackMode = 'clamp' | 'loop';

export interface ProjectModelSequenceFrame {
  name: string;
  projectPath?: string;
  sourcePath?: string;
  absolutePath?: string;
}

export interface ProjectModelSequenceData {
  fps: number;
  frameCount: number;
  playbackMode?: ProjectModelSequencePlaybackMode;
  sequenceName?: string;
  frames: ProjectModelSequenceFrame[];
}

export interface ProjectGaussianSplatSequenceFrame {
  name: string;
  projectPath?: string;
  sourcePath?: string;
  absolutePath?: string;
  splatCount?: number;
  fileSize?: number;
  container?: string;
  codec?: string;
}

export interface ProjectGaussianSplatBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ProjectGaussianSplatSequenceData {
  fps: number;
  frameCount: number;
  playbackMode?: ProjectModelSequencePlaybackMode;
  sequenceName?: string;
  sharedBounds?: ProjectGaussianSplatBounds;
  totalSplatCount?: number;
  minSplatCount?: number;
  maxSplatCount?: number;
  totalFileSize?: number;
  container?: string;
  codec?: string;
  frames: ProjectGaussianSplatSequenceFrame[];
}

export interface ProjectGaussianSplatRenderSettings {
  useNativeRenderer: boolean;
  maxSplats: number;
  splatScale: number;
  orientationPreset?: 'default' | 'flip-x-180';
  nearPlane: number;
  farPlane: number;
  backgroundColor: string;
  sortFrequency: number;
}

export interface ProjectGaussianSplatTemporalSettings {
  enabled: boolean;
  playbackMode: 'loop' | 'clamp' | 'pingpong';
  sequenceFps: number;
  frameBlend: number;
}

export interface ProjectGaussianSplatParticleSettings {
  enabled: boolean;
  effectType: 'none' | 'explode' | 'drift' | 'swirl' | 'dissolve';
  intensity: number;
  speed: number;
  seed: number;
}

export interface ProjectGaussianSplatSettings {
  render: ProjectGaussianSplatRenderSettings;
  temporal: ProjectGaussianSplatTemporalSettings;
  particle: ProjectGaussianSplatParticleSettings;
}
