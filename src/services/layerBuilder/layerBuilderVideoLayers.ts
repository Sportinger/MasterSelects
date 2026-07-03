import type { BlendMode, Layer, TimelineClip } from '../../types';
import { canUseSharedPreviewRuntimeSession } from '../mediaRuntime/runtimePlayback';
import type { NativeDecoder } from '../nativeHelper/NativeDecoder';
import { getClipTimeInfo, getMediaFileForClip } from './FrameContext';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import {
  buildLayerBuilderProxyImageLayer,
} from './layerBuilder2dSources';
import {
  resolveLayerBuilderVideoSource,
} from './layerBuilderVideoSources';
import { addLayerBuilderMaskProperties, withLayerBuilderMaskProperties } from './layerBuilderLayerPostProcessing';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

type LayerSourceMetadata = {
  mediaFileId?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};

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

function getPositiveDimension(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getLayerSourceMetadata(
  clip: TimelineClip,
  mediaFile?: { id?: string; width?: number; height?: number },
  fallback?: { width?: number; height?: number },
): LayerSourceMetadata {
  return {
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    intrinsicWidth: getPositiveDimension(mediaFile?.width) ?? getPositiveDimension(fallback?.width),
    intrinsicHeight: getPositiveDimension(mediaFile?.height) ?? getPositiveDimension(fallback?.height),
  };
}

function getFinalOpacity(transformOpacity: number, opacityOverride?: number): number {
  return opacityOverride !== undefined
    ? transformOpacity * opacityOverride
    : transformOpacity;
}

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
      return withLayerBuilderMaskProperties(buildLayerBuilderProxyImageLayer({
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
    }
  }

  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    ctx.getInterpolatedTransform(clip.id, visualClipLocalTime),
  );
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: getFinalOpacity(transform.opacity, opacityOverride),
    blendMode: transform.blendMode as BlendMode,
    source: {
      ...videoSource.source,
      ...sourceMetadata,
    },
    effects: ctx.getInterpolatedEffects(clip.id, visualClipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, visualClipLocalTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
  };

  addLayerBuilderMaskProperties(layer, clip, visualClipLocalTime, ctx.getClipKeyframes?.(clip.id));
  return layer;
}
