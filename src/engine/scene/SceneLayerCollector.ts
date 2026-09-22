import { splatEffectScene } from './splatEffectScene';
import type { LayerRenderData } from '../core/types';
import type {
  SceneLayer3DData,
  ScenePrimitiveLayer,
  SceneVector3,
  SceneVoxelLayer,
  SceneWorldTransform,
} from './types';
import { buildSceneWorldMatrix, getSplatOrientationMatrix, multiplyMat4 } from './SceneTransformUtils';
import { mergeLightClipSettings } from '../../types/light';
import { isMobileAppleWebKit } from '../../utils/mobileAppleWebKit';
import { expandSceneOperatorGraph } from './sceneGraphRuntime';
import { compileVoxelGraph } from '../../services/operators/voxelGraph';
import { effectOperatorCompileParams } from '../../services/operators/effectGraphOwner';

function getStableSourceDimensions(
  data: LayerRenderData,
  width: number,
  height: number,
): { sourceWidth: number; sourceHeight: number } {
  const liveInputCanvas = data.layer.source?.isLiveInput
    ? data.layer.source.canvasElement
    : undefined;
  if (liveInputCanvas && liveInputCanvas.width > 0 && liveInputCanvas.height > 0) {
    return {
      sourceWidth: liveInputCanvas.width,
      sourceHeight: liveInputCanvas.height,
    };
  }

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
    anchor: {
      x: data.layer.anchor?.x ?? 0,
      y: data.layer.anchor?.y ?? 0,
      z: data.layer.anchor?.z ?? 0,
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
  if (source?.type === 'light') {
    return 'light';
  }
  if (source?.type === 'flock') {
    return 'flock';
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
  if (data.layer.effects?.some((effect) => effect.enabled && effect.type === 'voxel-relief')) {
    return 'voxel';
  }
  return 'plane';
}

export function isLayerSpaceSceneEffect(type: string): boolean {
  return type === 'analog-signal-lab';
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
      maskClipId: layer.maskClipId,
      maskInvert: layer.maskInvert,
    };
    const cableEffect = layer.effects?.find(e => e.enabled && e.type === 'face-cables' && e.params.scene3D && e.params.sceneData);
    if (cableEffect) {
      result.push({ ...base, kind: 'face-cables', cableParams: cableEffect.params,
        layerSpaceEffects: (layer.effects ?? []).filter((effect, index) => effect.enabled && effect !== cableEffect
          && (index < layer.effects!.indexOf(cableEffect) || isLayerSpaceSceneEffect(effect.type))),
        videoRotation: source?.videoFrame ? source.videoRotation ?? 0 : 0,
        videoElement: source?.videoElement ?? undefined, videoFrame: source?.videoFrame ?? undefined,
        imageElement: source?.imageElement ?? undefined, canvas: source?.textCanvas ?? undefined,
        preciseVideoSampling: options.preciseVideoSampling || !!source?.videoElement,
        mediaTime: source?.mediaTime, alphaMode: 'opaque' });
      continue;
    }

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

    if (base.kind === 'light') {
      result.push({
        ...base,
        kind: 'light',
        lightSettings: mergeLightClipSettings(source?.lightSettings),
      });
      continue;
    }

    if (base.kind === 'flock') {
      if (source?.flock) {
        result.push({ ...base, kind: 'flock', flock: source.flock });
      }
      continue;
    }

    if (base.kind === 'plane' || base.kind === 'voxel') {
      const liveInputCanvas = source?.isLiveInput && isMobileAppleWebKit()
        ? source.canvasElement
        : undefined;
      const layerSpaceEffects = (layer.effects ?? []).filter((effect) => (
        effect.enabled && isLayerSpaceSceneEffect(effect.type)
      ));
      const voxelEffect = base.kind === 'voxel'
        ? layer.effects?.find((effect) => effect.enabled && effect.type === 'voxel-relief')
        : undefined;
      if (base.kind === 'voxel' && voxelEffect) {
        const voxelGraphPlan = compileVoxelGraph(effectOperatorCompileParams(voxelEffect));
        if (!voxelGraphPlan.visible || voxelGraphPlan.opacity <= 0) continue;
        result.push({
          ...base,
          kind: 'voxel',
          alphaMode: 'opaque',
          doubleSided: true,
          castsDepth: true,
          receivesDepth: true,
          // Mobile Safari can keep the visible Media Panel video advancing
          // while a second hidden video-to-canvas consumer turns black after
          // an idle period. Reuse the runtime's continuously staged canvas,
          // just like the regular live-input plane path below.
          videoElement: liveInputCanvas ? undefined : source?.videoElement ?? undefined,
          videoFrame: source?.videoFrame ?? undefined,
          // Always sample video through the 2D-canvas copy: the voxel field
          // reads per-cell texels in the vertex stage, and the direct
          // copyExternalImageToTexture path yields black frames while the
          // interactive preview holds the same <video> element.
          preciseVideoSampling: !liveInputCanvas && (options.preciseVideoSampling || !!source?.videoElement),
          imageElement: source?.imageElement ?? undefined,
          canvas: liveInputCanvas ?? source?.textCanvas ?? undefined,
          layerSpaceEffects,
          mediaTime: source?.mediaTime,
          voxelParams: voxelEffect.params as SceneVoxelLayer['voxelParams'],
          voxelGraphPlan,
        });
        continue;
      }

      result.push({
        ...base,
        kind: 'plane',
        alphaMode: source?.videoElement
          || source?.videoFrame
          || liveInputCanvas
          ? 'opaque'
          : source?.imageElement
            ? 'straight'
            : source?.textCanvas
              ? 'premultiplied'
              : undefined,
        doubleSided: true,
        castsDepth: !!(source?.videoElement || source?.videoFrame || liveInputCanvas),
        receivesDepth: true,
        videoElement: liveInputCanvas ? undefined : source?.videoElement ?? undefined,
        videoFrame: source?.videoFrame ?? undefined,
        preciseVideoSampling: options.preciseVideoSampling,
        imageElement: source?.imageElement ?? undefined,
        canvas: liveInputCanvas ?? source?.textCanvas ?? undefined,
        layerSpaceEffects,
        mediaTime: source?.mediaTime,
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
      modelPrimitiveIndex: source?.modelPrimitiveIndex,
      modelMaterialSettings: source?.modelMaterialSettings,
      wireframe: layer.wireframe,
    });
  }

  const definitions = new Map(layerData.map(data => [data.layer.id, data.layer.source?.type === 'gaussian-splat' ? splatEffectScene(data.layer.effects, data.layer.sceneGraph) : data.layer.sceneGraph]));
  return result.flatMap(layer => expandSceneOperatorGraph(layer, definitions.get(layer.layerId)));
}
