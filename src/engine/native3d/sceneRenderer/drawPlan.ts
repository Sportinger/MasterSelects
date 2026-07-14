import type {
  SceneCamera,
  SceneLayer3DData,
  SceneLightLayer,
  ScenePlaneLayer,
  SceneSplatLayer,
} from '../../scene/types';
import type { SceneNativeMeshLayer } from '../passes/MeshPass';

export interface MeshLayerPartitions {
  opaqueMeshes: SceneNativeMeshLayer[];
  transparentMeshes: SceneNativeMeshLayer[];
}

export interface PlaneLayerPartitions {
  opaquePlanes: ScenePlaneLayer[];
  transparentPlanes: ScenePlaneLayer[];
}

export function canRenderNativeScene(
  layers: SceneLayer3DData[],
  planeLayers: ScenePlaneLayer[],
  nativeMeshLayers: SceneNativeMeshLayer[],
  splatLayers: SceneSplatLayer[],
  lightLayers: SceneLightLayer[],
): boolean {
  return (
    layers.length > 0 &&
    layers.length === planeLayers.length + nativeMeshLayers.length + splatLayers.length + lightLayers.length
  );
}

export function sortBySceneLayerDepth<T extends { worldMatrix: Float32Array }>(
  layers: T[],
  camera: SceneCamera,
): T[] {
  return [...layers].sort((a, b) =>
    getSceneLayerDepth(a.worldMatrix, camera.viewMatrix) -
    getSceneLayerDepth(b.worldMatrix, camera.viewMatrix),
  );
}

export function splitMeshLayers(
  nativeMeshLayers: SceneNativeMeshLayer[],
  camera: SceneCamera,
  isTransparent: (layer: SceneNativeMeshLayer) => boolean,
): MeshLayerPartitions {
  return {
    opaqueMeshes: nativeMeshLayers.filter((layer) => !isTransparent(layer)),
    transparentMeshes: sortBySceneLayerDepth(
      nativeMeshLayers.filter((layer) => isTransparent(layer)),
      camera,
    ),
  };
}

export function splitPlaneLayers(
  planeLayers: ScenePlaneLayer[],
  camera: SceneCamera,
): PlaneLayerPartitions {
  return {
    opaquePlanes: planeLayers.filter((layer) => isDepthWritingPlane(layer)),
    transparentPlanes: sortBySceneLayerDepth(
      planeLayers.filter((layer) => !isDepthWritingPlane(layer)),
      camera,
    ),
  };
}

function isDepthWritingPlane(layer: ScenePlaneLayer): boolean {
  if (layer.castsDepth === false) {
    return false;
  }
  if (layer.opacity < 1) {
    return false;
  }
  if (layer.maskClipId) {
    return false;
  }
  if (layer.alphaMode === 'straight' || layer.alphaMode === 'premultiplied') {
    return false;
  }
  if (layer.alphaMode === 'opaque') {
    return true;
  }
  return !!(layer.videoElement || layer.videoFrame);
}

function getSceneLayerDepth(worldMatrix: Float32Array, viewMatrix: Float32Array): number {
  const x = worldMatrix[12] ?? 0;
  const y = worldMatrix[13] ?? 0;
  const z = worldMatrix[14] ?? 0;
  return (
    (viewMatrix[2] ?? 0) * x +
    (viewMatrix[6] ?? 0) * y +
    (viewMatrix[10] ?? 0) * z +
    (viewMatrix[14] ?? 0)
  );
}
