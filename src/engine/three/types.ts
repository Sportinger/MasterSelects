// Types for Three.js 3D layer integration

import type { BlendMode, GaussianSplatSequenceData, Text3DProperties } from '../../types';
import type { GaussianSplatSettings } from '../gaussian/types';
import type { SplatEffectorMode } from '../../types/splatEffector';

/** Data for a single 3D layer to be rendered by Three.js */
export interface Layer3DData {
  layerId: string;
  clipId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };  // degrees
  scale: { x: number; y: number; z: number };
  threeDEffectorsEnabled?: boolean;
  opacity: number;
  blendMode: BlendMode;
  sourceWidth: number;
  sourceHeight: number;
  // Texture source — one of these will be set
  videoElement?: HTMLVideoElement;
  preciseVideoSampling?: boolean;
  imageElement?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
  // 3D model source
  modelUrl?: string;  // Blob URL to OBJ/glTF/GLB file
  modelFileName?: string;  // Original filename (for format detection from blob URLs)
  meshType?: import('../../stores/mediaStore/types').MeshPrimitiveType;  // Primitive mesh type
  text3DProperties?: Text3DProperties;
  wireframe?: boolean;  // Debug: show as wireframe
  // Gaussian splat source
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

export interface SplatEffectorRuntimeData {
  clipId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };  // degrees
  scale: { x: number; y: number; z: number };
  radius: number;
  mode: SplatEffectorMode;
  strength: number;
  falloff: number;
  speed: number;
  seed: number;
  time: number;
}

/** Camera configuration from Composition */
export interface CameraConfig {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  up?: { x: number; y: number; z: number };
  fov: number;
  near: number;
  far: number;
  applyDefaultDistance?: boolean;
}

/** Default camera values.
 *  position.z = 0 means "default distance" — renderScene adds the
 *  calculated fill distance automatically. Positive z = zoom out.
 */
export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  position: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov: 50,
  near: 0.1,
  far: 1000,
  applyDefaultDistance: true,
};
