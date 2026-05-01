import type { LayerRenderData } from '../core/types';
import type {
  SceneLayer3DData,
  ScenePrimitiveLayer,
  SceneVector3,
  SceneWorldTransform,
} from './types';
import { buildSceneWorldMatrix, getSplatOrientationMatrix, multiplyMat4 } from './SceneTransformUtils';

function getStableSourceDimensions(
  data: LayerRenderData,
  width: number,
  height: number,
): { sourceWidth: number; sourceHeight: number } {
  const fallbackWidth =
    typeof data.sourceWidth === 'number' && Number.isFinite(data.sourceWidth) && data.sourceWidth > 0
      ? data.sourceWidth
      : width;
  const fallbackHeight =
    typeof data.sourceHeight === 'number' && Number.isFinite(data.sourceHeight) && data.sourceHeight > 0
      ? data.sourceHeight
      : height;

  const intrinsicWidth = data.layer.source?.intrinsicWidth;
  const intrinsicHeight = data.layer.source?.intrinsicHeight;

  return {
    sourceWidth:
      typeof intrinsicWidth === 'number' && Number.isFinite(intrinsicWidth) && intrinsicWidth > 0
        ? intrinsicWidth
        : fallbackWidth,
    sourceHeight:
      typeof intrinsicHeight === 'number' && Number.isFinite(intrinsicHeight) && intrinsicHeight > 0
        ? intrinsicHeight
        : fallbackHeight,
  };
}

function normalizeRotationRadians(
  rotation: LayerRenderData['layer']['rotation'],
): SceneVector3 {
  if (typeof rotation === 'number') {
    return { x: 0, y: 0, z: rotation };
  }
  return {
    x: rotation.x,
    y: rotation.y,
    z: rotation.z,
  };
}

function toDegrees(value: number): number {
  return value * (180 / Math.PI);
}

function buildWorldTransform(data: LayerRenderData): SceneWorldTransform {
  const rotationRadians = normalizeRotationRadians(data.layer.rotation);
  return {
    position: {
      x: data.layer.position.x,
      y: data.layer.position.y,
      z: data.layer.position.z,
    },
    rotationRadians,
    rotationDegrees: {
      x: toDegrees(rotationRadians.x),
      y: toDegrees(rotationRadians.y),
      z: toDegrees(rotationRadians.z),
    },
    scale: {
      x: data.layer.scale.x,
      y: data.layer.scale.y,
      z: data.layer.scale.z ?? 1,
    },
  };
}

function resolveSceneLayerKind(data: LayerRenderData): SceneLayer3DData['kind'] {
  const source = data.layer.source;
  if (source?.type === 'gaussian-splat') {
    return 'splat';
  }
  if (source?.type === 'model') {
    if ((source.meshType ?? undefined) === 'text3d' || source.text3DProperties) {
      return 'text3d';
    }
    if (source.meshType) {
      return 'primitive';
    }
    return 'model';
  }
  return 'plane';
}

function isPrimitiveMeshType(
  meshType: ScenePrimitiveLayer['meshType'] | 'text3d' | undefined,
): meshType is ScenePrimitiveLayer['meshType'] {
  return !!meshType && meshType !== 'text3d';
}

export interface CollectScene3DLayerOptions {
  width: number;
  height: number;
  preciseVideoSampling?: boolean;
  preciseSplatSorting?: boolean;
  includeLayer?: (data: LayerRenderData) => boolean;
}

export function collectScene3DLayers(
  layerData: LayerRenderData[],
  options: CollectScene3DLayerOptions,
): SceneLayer3DData[] {
  const result: SceneLayer3DData[] = [];

  for (const data of layerData) {
    const layer = data.layer;
    if (!layer.is3D || layer.source?.type === 'gaussian-avatar') {
      continue;
    }
    if (options.includeLayer && !options.includeLayer(data)) {
      continue;
    }

    const source = layer.source;
    const worldTransform = buildWorldTransform(data);
    const worldMatrix = buildSceneWorldMatrix(worldTransform);
    const base = {
      kind: resolveSceneLayerKind(data),
      layerId: layer.id,
      clipId: layer.sourceClipId || layer.id,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      ...getStableSourceDimensions(data, options.width, options.height),
      threeDEffectorsEnabled: source?.threeDEffectorsEnabled,
      worldMatrix,
      worldTransform,
    };

    if (base.kind === 'splat') {
      const orientationMatrix = getSplatOrientationMatrix(
        source?.gaussianSplatSettings?.render.orientationPreset,
      );
      result.push({
        ...base,
        kind: 'splat',
        mediaTime: source?.mediaTime ?? undefined,
        worldMatrix: orientationMatrix ? multiplyMat4(worldMatrix, orientationMatrix) : worldMatrix,
        gaussianSplatFile: source?.file ?? undefined,
        gaussianSplatUrl: source?.gaussianSplatUrl ?? undefined,
        gaussianSplatFileName: source?.gaussianSplatFileName ?? undefined,
        gaussianSplatFileHash: source?.gaussianSplatFileHash ?? undefined,
        gaussianSplatRuntimeKey: source?.gaussianSplatRuntimeKey ?? undefined,
        gaussianSplatIsSequence: !!source?.gaussianSplatSequence,
        gaussianSplatSequence: source?.gaussianSplatSequence ?? undefined,
        gaussianSplatMediaFileId: source?.mediaFileId ?? undefined,
        gaussianSplatSettings: source?.gaussianSplatSettings ?? undefined,
        preciseSplatSorting: options.preciseSplatSorting,
      });
      continue;
    }

    if (base.kind === 'plane') {
      result.push({
        ...base,
        kind: 'plane',
        alphaMode: source?.videoElement
          ? 'opaque'
          : source?.imageElement
            ? 'straight'
            : source?.textCanvas
              ? 'premultiplied'
              : undefined,
        doubleSided: true,
        castsDepth: !!source?.videoElement,
        receivesDepth: true,
        videoElement: source?.videoElement ?? undefined,
        preciseVideoSampling: options.preciseVideoSampling,
        imageElement: source?.imageElement ?? undefined,
        canvas: source?.textCanvas ?? undefined,
      });
      continue;
    }

    if (base.kind === 'text3d') {
      result.push({
        ...base,
        kind: 'text3d',
        text3DProperties: source?.text3DProperties ?? undefined,
        wireframe: layer.wireframe,
      });
      continue;
    }

    if (base.kind === 'primitive' && isPrimitiveMeshType(source?.meshType)) {
      result.push({
        ...base,
        kind: 'primitive',
        meshType: source.meshType,
        wireframe: layer.wireframe,
      });
      continue;
    }

    result.push({
      ...base,
      kind: 'model',
      modelUrl: source?.modelUrl ?? undefined,
      modelFileName: source?.modelFileName ?? source?.file?.name ?? layer.name,
      modelSequence: source?.modelSequence ?? undefined,
      wireframe: layer.wireframe,
    });
  }

  return result;
}
