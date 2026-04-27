import type { BlendMode, GaussianSplatSequenceData, ModelSequenceData, Text3DProperties } from '../../types';
import type { GaussianSplatSettings } from '../gaussian/types';
import type { MeshPrimitiveType } from '../../stores/mediaStore/types';
import type { SplatEffectorMode } from '../../types/splatEffector';

export interface SceneVector3 {
  x: number;
  y: number;
  z: number;
}

export interface SceneViewport {
  width: number;
  height: number;
}

export interface SceneWorldTransform {
  position: SceneVector3;
  rotationRadians: SceneVector3;
  rotationDegrees: SceneVector3;
  scale: SceneVector3;
}

export interface SceneLayerBase {
  kind: 'splat' | 'plane' | 'primitive' | 'text3d' | 'model';
  layerId: string;
  clipId: string;
  opacity: number;
  blendMode: BlendMode;
  sourceWidth: number;
  sourceHeight: number;
  threeDEffectorsEnabled?: boolean;
  worldMatrix: Float32Array;
  worldTransform?: SceneWorldTransform;
  alphaMode?: 'opaque' | 'premultiplied' | 'straight';
  doubleSided?: boolean;
  castsDepth?: boolean;
  receivesDepth?: boolean;
}

export interface ScenePlaneLayer extends SceneLayerBase {
  kind: 'plane';
  videoElement?: HTMLVideoElement;
  preciseVideoSampling?: boolean;
  imageElement?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
}

export interface ScenePrimitiveLayer extends SceneLayerBase {
  kind: 'primitive';
  meshType: Exclude<MeshPrimitiveType, 'text3d'>;
  wireframe?: boolean;
}

export interface SceneText3DLayer extends SceneLayerBase {
  kind: 'text3d';
  text3DProperties?: Text3DProperties;
  wireframe?: boolean;
}

export interface SceneModelLayer extends SceneLayerBase {
  kind: 'model';
  modelUrl?: string;
  modelFileName?: string;
  modelSequence?: ModelSequenceData;
  wireframe?: boolean;
}

export interface SceneSplatLayer extends SceneLayerBase {
  kind: 'splat';
  mediaTime?: number;
  gaussianSplatFile?: File;
  gaussianSplatUrl?: string;
  gaussianSplatFileName?: string;
  gaussianSplatFileHash?: string;
  gaussianSplatRuntimeKey?: string;
  gaussianSplatIsSequence?: boolean;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  gaussianSplatMediaFileId?: string;
  gaussianSplatSettings?: GaussianSplatSettings;
  preciseSplatSorting?: boolean;
}

export type SceneLayer3DData =
  | ScenePlaneLayer
  | ScenePrimitiveLayer
  | SceneText3DLayer
  | SceneModelLayer
  | SceneSplatLayer;

export interface SceneCameraConfig {
  position: SceneVector3;
  target: SceneVector3;
  up: SceneVector3;
  fov: number;
  near: number;
  far: number;
  applyDefaultDistance?: boolean;
  projection?: 'perspective' | 'orthographic';
  orthographicScale?: number;
}

export interface SceneCamera {
  viewMatrix: Float32Array;
  projectionMatrix: Float32Array;
  cameraPosition: SceneVector3;
  cameraTarget: SceneVector3;
  cameraUp: SceneVector3;
  fov: number;
  near: number;
  far: number;
  viewport: SceneViewport;
  applyDefaultDistance?: boolean;
  projection: 'perspective' | 'orthographic';
  orthographicScale?: number;
}

export type SceneGizmoAxis = 'x' | 'y' | 'z';
export type SceneGizmoMode = 'move' | 'rotate' | 'scale';

export interface SceneGizmoRenderOptions {
  clipId: string;
  mode: SceneGizmoMode;
  hoveredAxis?: SceneGizmoAxis | null;
  worldMatrix?: Float32Array;
  worldTransform?: SceneWorldTransform;
}

export interface SceneSplatEffectorRuntimeData {
  clipId: string;
  position: SceneVector3;
  rotation: SceneVector3;
  scale: SceneVector3;
  radius: number;
  mode: SplatEffectorMode;
  strength: number;
  falloff: number;
  speed: number;
  seed: number;
  time: number;
}
