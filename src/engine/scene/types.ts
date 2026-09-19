import type { BlendMode, GaussianSplatSequenceData, ModelSequenceData, Text3DProperties } from '../../types';
import type { LightClipSettings } from '../../types/light';
import type { ModelMaterialSettings } from '../../types/modelMaterial';
import type { GaussianSplatSettings } from '../gaussian/types';
import type { MeshPrimitiveType } from '../../stores/mediaStore/types';
import type { SplatEffectorMode } from '../../types/splatEffector';
import type { Effect } from '../../types/effects';

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
  anchor?: SceneVector3;
  rotationRadians: SceneVector3;
  rotationDegrees: SceneVector3;
  scale: SceneVector3;
}

export interface SceneLayerBase {
  kind: 'splat' | 'plane' | 'primitive' | 'text3d' | 'model' | 'light' | 'voxel' | 'flock' | 'face-cables';
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
  maskClipId?: string;
  maskInvert?: boolean;
  /** Effects evaluated on the source texture before its 3D world transform. */
  layerSpaceEffects?: Effect[];
  mediaTime?: number;
}

export interface ScenePlaneLayer extends SceneLayerBase {
  kind: 'plane';
  videoElement?: HTMLVideoElement;
  videoFrame?: VideoFrame;
  preciseVideoSampling?: boolean;
  imageElement?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
}
export interface SceneFaceCableLayer extends Omit<ScenePlaneLayer, 'kind'> {
  kind: 'face-cables';
  videoRotation?: number;
  cableParams: Record<string, unknown>;
}

/**
 * A clip with an enabled voxel-relief effect promoted to 3D: rendered as a
 * true instanced block field instead of a flat textured plane. Occupies the
 * exact footprint the plane would (WORLD_HEIGHT convention), extruding along
 * local +Z. `voxelParams` carries the clip's interpolated voxel-relief effect
 * params for the current frame; the effect's virtual-camera params (tilt/yaw/
 * perspective/distance/center) are ignored here — the scene camera rules.
 */
export interface SceneVoxelLayer extends SceneLayerBase {
  kind: 'voxel';
  videoElement?: HTMLVideoElement;
  videoFrame?: VideoFrame;
  preciseVideoSampling?: boolean;
  imageElement?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
  voxelParams: Record<string, number | boolean | string>;
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
  modelPrimitiveIndex?: number;
  modelMaterialSettings?: ModelMaterialSettings;
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

export interface SceneLightLayer extends SceneLayerBase {
  kind: 'light';
  lightSettings: LightClipSettings;
}

/** A flock clip: simulated particles and technical lines drawn by native flock passes. */
export interface SceneFlockLayer extends SceneLayerBase {
  kind: 'flock';
  flock: import('../../services/flock/flockLayerSource').FlockLayerSourceData;
}

export type SceneLayer3DData =
  | ScenePlaneLayer
  | SceneVoxelLayer
  | ScenePrimitiveLayer
  | SceneText3DLayer
  | SceneModelLayer
  | SceneLightLayer
  | SceneSplatLayer
  | SceneFlockLayer
  | SceneFaceCableLayer;

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
  /** Composition-space size against which stored plane/voxel scales are defined. */
  referenceSize?: SceneViewport;
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
