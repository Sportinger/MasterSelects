import type { Layer, TimelineClip } from '../../types';
import { getMediaFileForClip } from './FrameContext';
import { buildNestedProxyImageSourceLayer } from './layerBuilder2dSources';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import {
  hasLayerBuilderRenderableVideoSource,
  resolveLayerBuilderVideoSource,
} from './layerBuilderVideoSources';
import type { FrameContext } from './types';
import type { NestedPreviewContinuationResolver } from './nestedPreviewContinuity';
import { getNestedPreviewSourceKey } from './nestedPreviewContinuity';

export function buildNestedVideoSourceLayer(params: {
  baseLayer: Omit<Layer, 'source'>;
  nestedClip: TimelineClip;
  nestedClipTime: number;
  ctx: FrameContext;
  proxyFrames: LayerBuilderProxyFrames;
  previewContinuationResolver?: NestedPreviewContinuationResolver;
  trackKey: string;
  continuityKey: string;
}): Layer | null | undefined {
  const { nestedClip, nestedClipTime, ctx, proxyFrames, baseLayer } = params;
  const mediaFile = getMediaFileForClip(ctx, nestedClip);
  if (!hasLayerBuilderRenderableVideoSource(nestedClip.source, nestedClip, mediaFile)) {
    return undefined;
  }
  const sourceKey = getNestedPreviewSourceKey(params.trackKey, params.continuityKey);
  const videoBaseLayer = { ...baseLayer, sourceClipId: sourceKey };

  if (ctx.proxyEnabled && mediaFile?.proxyFps) {
    const proxyFrame = proxyFrames.selectProxyFrame({
      clipId: nestedClip.id,
      mediaFile,
      targetMediaTime: nestedClipTime,
      isDraggingPlayhead: ctx.isDraggingPlayhead,
      previewPathBase: 'nested-proxy-image-frame',
    });
    if (proxyFrame) return buildNestedProxyImageSourceLayer(videoBaseLayer, proxyFrame, mediaFile.id);
  }

  const videoSource = resolveLayerBuilderVideoSource({
    clip: nestedClip,
    ctx,
    targetTime: nestedClipTime,
    allowSharedPreviewSession: true,
    continuationVideo: params.previewContinuationResolver?.getPreviewContinuationVideoElement(
      nestedClip,
      nestedClipTime,
      { trackKey: params.trackKey, continuityKey: params.continuityKey },
    ),
    workerGpuMediaFile: mediaFile,
  });
  return videoSource ? ({ ...videoBaseLayer, source: videoSource.source } as Layer) : null;
}
