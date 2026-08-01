import type { BlendMode, Layer, TimelineClip } from '../../types';
import { canUseSharedPreviewRuntimeSession } from '../mediaRuntime/runtimePlayback';
import { resolveTransitionRecipeBlendMode } from '../timeline/transitionRecipeBlendWindows';
import { evaluateTransitionRenderState } from '../../utils/transitionRenderInterpolation';
import type { NativeDecoder } from '../nativeHelper/NativeDecoder';
import { getClipTimeInfo, getMediaFileForClip } from './FrameContext';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import {
  buildLayerBuilderProxyImageLayer,
} from './layerBuilder2dSources';
import {
  resolveLayerBuilderVideoSource,
} from './layerBuilderVideoSources';
import { getFinalOpacity, getLayerSourceMetadata } from './layerBuilderVideoSourceMetadata';
import { addLayerBuilderMaskProperties, withLayerBuilderMaskProperties } from './layerBuilderLayerPostProcessing';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';
import { getNestedClipKeyframes } from './layerBuilderNestedLayers';
import { evaluateParentedClipTransform } from './parentTransformEvaluation';

type BuildVideoLayerParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
};

type BuildNativeDecoderLayerParams = BuildVideoLayerParams & {
  nativeDecoder: NativeDecoder;
};

type BuildTimelineVideoLayerParams = BuildVideoLayerParams & {
  proxyFrames: LayerBuilderProxyFrames;
  previewContinuationResolver?: {
    getPreviewContinuationVideoElement(clip: TimelineClip, clipTime: number): HTMLVideoElement | null;
  };
};

export function buildLayerBuilderNativeDecoderLayer(params: BuildNativeDecoderLayerParams): Layer {
  const { clip, nativeDecoder, layerIndex, ctx, transformCache, opacityOverride } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const mediaFile = getMediaFileForClip(ctx, clip);
  const sourceMetadata = getLayerSourceMetadata(clip, mediaFile, {
    width: nativeDecoder.width,
    height: nativeDecoder.height,
  });
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.visualClipLocalTime),
  );
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: getFinalOpacity(transform.opacity, opacityOverride),
    blendMode: transform.blendMode as BlendMode,
    source: {
      type: 'video',
      nativeDecoder,
      mediaTime: timeInfo.visualClipTime,
      targetMediaTime: timeInfo.visualClipTime,
      ...sourceMetadata,
    },
    effects: ctx.getInterpolatedEffects(clip.id, timeInfo.visualClipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, timeInfo.visualClipLocalTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
  };

  addLayerBuilderMaskProperties(layer, clip, timeInfo.visualClipLocalTime, ctx.getClipKeyframes?.(clip.id));
  return layer;
}

export function buildLayerBuilderVideoLayer(params: BuildTimelineVideoLayerParams): Layer | null {
  const { clip, layerIndex, ctx, transformCache, opacityOverride, proxyFrames } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const visualClipTime = timeInfo.visualClipTime;
  const visualClipLocalTime = timeInfo.visualClipLocalTime;
  const mappedEvaluation = clip.transitionSourceMap?.version === 2
    ? evaluateParentedClipTransform({
        clip,
        clips: ctx.clips ?? [clip],
        clipLocalTime: visualClipLocalTime,
        parentTimelineTime: clip.startTime + visualClipLocalTime,
        getKeyframes: candidate => {
          const contextKeyframes = ctx.getClipKeyframes?.(candidate.id);
          return contextKeyframes?.length ? contextKeyframes : getNestedClipKeyframes(candidate);
        },
      })
    : undefined;
  if (mappedEvaluation && !mappedEvaluation.ok) return null;
  const mappedAnimation = mappedEvaluation?.mappedAnimation;
  const mediaFile = getMediaFileForClip(ctx, clip);
  const videoSource = resolveLayerBuilderVideoSource({
    clip,
    ctx,
    targetTime: visualClipTime,
    allowSharedPreviewSession: canUseSharedPreviewRuntimeSession(clip, ctx.clipsAtTime),
    workerGpuMediaFile: mediaFile,
    continuationVideo: params.previewContinuationResolver?.getPreviewContinuationVideoElement(
      clip,
      visualClipTime,
    ),
  });
  if (!videoSource) return null;

  const sourceMetadata = getLayerSourceMetadata(clip, mediaFile, videoSource.intrinsicSize);
  const useProxyLayer =
    ctx.proxyEnabled &&
    mediaFile?.proxyFps &&
    (ctx.isDraggingPlayhead || ctx.hasClipDragPreview);
  if (useProxyLayer) {
    const proxyFrame = proxyFrames.selectProxyFrame({
      clipId: clip.id,
      mediaFile,
      targetMediaTime: visualClipTime,
      isDraggingPlayhead: ctx.isDraggingPlayhead,
      previewPathBase: 'proxy-image-frame',
    });
    if (proxyFrame) {
      const proxyLayer = withLayerBuilderMaskProperties(buildLayerBuilderProxyImageLayer({
        clip,
        layerIndex,
        ctx,
        transformCache,
        opacityOverride,
        image: proxyFrame.image,
        localTime: visualClipLocalTime,
        sourceMetadata: getLayerSourceMetadata(clip, mediaFile, {
          width: proxyFrame.image.naturalWidth || proxyFrame.image.width,
          height: proxyFrame.image.naturalHeight || proxyFrame.image.height,
        }),
        timing: proxyFrame,
      }), clip, visualClipLocalTime, ctx.getClipKeyframes?.(clip.id));
      if (!mappedEvaluation || !mappedAnimation) return proxyLayer;

      const mappedTransform = transformCache.getTransform(
        `${ctx.activeCompId}_${layerIndex}`,
        mappedEvaluation.transform,
      );
      proxyLayer.opacity = getFinalOpacity(mappedTransform.opacity, opacityOverride);
      proxyLayer.blendMode = resolveTransitionRecipeBlendMode(
        clip.transitionRecipeBlendWindows,
        clip.startTime + visualClipLocalTime,
        mappedTransform.blendMode as BlendMode,
      );
      proxyLayer.effects = mappedAnimation.effects;
      proxyLayer.position = mappedTransform.position;
      proxyLayer.scale = mappedTransform.scale;
      proxyLayer.rotation = mappedTransform.rotation;
      delete proxyLayer.maskClipId;
      delete proxyLayer.maskInvert;
      delete proxyLayer.masks;
      if (mappedAnimation.masks?.some(mask => mask.enabled !== false)) {
        proxyLayer.maskClipId = clip.id;
        proxyLayer.maskInvert = false;
        proxyLayer.masks = mappedAnimation.masks;
      }
      const proxyTransitionRender = evaluateTransitionRenderState(
        clip.transitionRender,
        ctx.getClipKeyframes?.(clip.id),
        visualClipLocalTime,
      );
      if (proxyTransitionRender) proxyLayer.transitionRender = proxyTransitionRender;
      return proxyLayer;
    }
  }

  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    mappedEvaluation?.transform ?? ctx.getInterpolatedTransform(clip.id, visualClipLocalTime),
  );
  const transitionRender = mappedAnimation
    ? evaluateTransitionRenderState(
        clip.transitionRender,
        ctx.getClipKeyframes?.(clip.id),
        visualClipLocalTime,
      )
    : undefined;
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: getFinalOpacity(transform.opacity, opacityOverride),
    blendMode: mappedAnimation
      ? resolveTransitionRecipeBlendMode(
          clip.transitionRecipeBlendWindows,
          clip.startTime + visualClipLocalTime,
          transform.blendMode as BlendMode,
        )
      : transform.blendMode as BlendMode,
    source: {
      ...videoSource.source,
      ...sourceMetadata,
    },
    effects: mappedAnimation?.effects ?? ctx.getInterpolatedEffects(clip.id, visualClipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, visualClipLocalTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    ...(transitionRender ? { transitionRender } : {}),
  };

  if (mappedAnimation?.masks?.some(mask => mask.enabled !== false)) {
    layer.maskClipId = clip.id;
    layer.maskInvert = false;
    layer.masks = mappedAnimation.masks;
  } else {
    addLayerBuilderMaskProperties(layer, clip, visualClipLocalTime, ctx.getClipKeyframes?.(clip.id));
  }
  return layer;
}
