import type { BlendMode, Layer, TimelineClip } from '../../types';
import { resolveSceneEffectorsEnabled } from '../../engine/scene/SceneEffectorUtils';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../stores/timeline/constants';
import { useMediaStore } from '../../stores/mediaStore';
import { getClipTimeInfo, getMediaFileForClip } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';
import {
  buildGaussianSplatSourcePayload,
  getClipModelSequence,
  getRenderableLayerFile,
  resolveClipModelFrame,
  resolveClipModelUrl,
} from './layerBuilder3dSources';
import { addLayerBuilderMaskProperties } from './layerBuilderLayerPostProcessing';

type BuildLayer3dParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
};

function getClipMeshType(clip: TimelineClip) {
  return clip.meshType ?? clip.source?.meshType;
}

function getClipText3DProperties(clip: TimelineClip) {
  const meshType = getClipMeshType(clip);
  return meshType === 'text3d'
    ? (clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES)
    : (clip.text3DProperties ?? clip.source?.text3DProperties);
}

function getFinalOpacity(transformOpacity: number, opacityOverride?: number): number {
  return opacityOverride !== undefined
    ? transformOpacity * opacityOverride
    : transformOpacity;
}

function buildPrimaryModelSource(
  clip: TimelineClip,
  sourceTime: number,
  mediaFile?: { id?: string; name?: string; file?: File },
): NonNullable<Layer['source']> {
  const modelSequence = getClipModelSequence(clip);
  const modelFrame = resolveClipModelFrame(clip, sourceTime);
  const file = getRenderableLayerFile(mediaFile?.file) ?? getRenderableLayerFile(clip.file);

  return {
    type: 'model',
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    modelUrl: resolveClipModelUrl(clip, sourceTime),
    modelFileName: modelFrame?.name ?? clip.source?.modelFileName ?? file?.name ?? mediaFile?.name ?? clip.name,
    modelPrimitiveIndex: clip.source?.modelPrimitiveIndex,
    modelMaterialSettings: clip.source?.modelMaterialSettings,
    ...(modelSequence ? { modelSequence } : {}),
    file,
    threeDEffectorsEnabled: resolveSceneEffectorsEnabled(clip.source?.threeDEffectorsEnabled),
    meshType: getClipMeshType(clip),
    text3DProperties: getClipText3DProperties(clip),
  };
}

function buildNestedModelSource(clip: TimelineClip, sourceTime: number): NonNullable<Layer['source']> {
  return {
    type: 'model',
    modelUrl: resolveClipModelUrl(clip, sourceTime),
    modelPrimitiveIndex: clip.source?.modelPrimitiveIndex,
    modelMaterialSettings: clip.source?.modelMaterialSettings,
    file: clip.file,
    threeDEffectorsEnabled: resolveSceneEffectorsEnabled(clip.source?.threeDEffectorsEnabled),
    meshType: getClipMeshType(clip),
    text3DProperties: getClipText3DProperties(clip),
  };
}

export function buildLayerBuilderModelLayer(params: BuildLayer3dParams): Layer {
  const { clip, layerIndex, ctx, transformCache, opacityOverride } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: getFinalOpacity(transform.opacity, opacityOverride),
    blendMode: transform.blendMode as BlendMode,
    source: buildPrimaryModelSource(clip, timeInfo.clipTime, getMediaFileForClip(ctx, clip)),
    effects: ctx.getInterpolatedEffects(clip.id, timeInfo.clipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, timeInfo.clipLocalTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    is3D: true,
    wireframe: clip.wireframe,
  };

  addLayerBuilderMaskProperties(layer, clip, timeInfo.clipLocalTime);
  return layer;
}

export function buildLayerBuilderGaussianSplatLayer(params: BuildLayer3dParams): Layer {
  const { clip, layerIndex, ctx, transformCache, opacityOverride } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: getFinalOpacity(transform.opacity, opacityOverride),
    blendMode: transform.blendMode as BlendMode,
    source: buildGaussianSplatSourcePayload(
      clip,
      timeInfo.clipLocalTime,
      getMediaFileForClip(ctx, clip),
    ),
    effects: ctx.getInterpolatedEffects(clip.id, timeInfo.clipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, timeInfo.clipLocalTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    is3D: true,
  };

  addLayerBuilderMaskProperties(layer, clip, timeInfo.clipLocalTime);
  return layer;
}

export function buildNestedLayerBuilder3dSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  ctx: FrameContext,
): Layer | null {
  if (nestedClip.source?.type === 'model') {
    const nestedSourceTime = nestedClip.reversed
      ? nestedClip.outPoint - nestedClipLocalTime
      : nestedClipLocalTime + nestedClip.inPoint;
    return {
      ...baseLayer,
      source: buildNestedModelSource(nestedClip, nestedSourceTime),
      is3D: true,
    } as Layer;
  }

  if (nestedClip.source?.type !== 'gaussian-splat') {
    return null;
  }

  const mediaFile =
    getMediaFileForClip(ctx, nestedClip) ??
    useMediaStore.getState().files.find((file) =>
      file.id === nestedClip.mediaFileId || file.id === nestedClip.source?.mediaFileId,
    );
  return {
    ...baseLayer,
    source: buildGaussianSplatSourcePayload(
      nestedClip,
      nestedClipLocalTime,
      mediaFile,
    ),
    is3D: true,
  } as Layer;
}
