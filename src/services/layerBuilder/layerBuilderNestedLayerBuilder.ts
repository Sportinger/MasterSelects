import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { MAX_NESTING_DEPTH } from '../../stores/timeline/constants';
import { Logger } from '../logger';
import { getClipTimeInfo, getMediaFileForClip } from './FrameContext';
import { buildNestedImageSourceLayer, buildNestedProxyImageSourceLayer, getLayerBuilderRenderableImageElement } from './layerBuilder2dSources';
import { buildNestedLayerBuilder3dSourceLayer } from './layerBuilder3dLayers';
import { buildNestedLayerBuilderCanvasBackedSourceLayer } from './layerBuilderCanvasSources';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import { buildNestedCompositionSourceLayer, buildNestedLayerBase, buildNestedMotionSourceLayer, getNestedClipSourceTime } from './layerBuilderNestedLayers';
import {
  getLayerBuilderVideoSourceDebugInfo,
  hasLayerBuilderRenderableVideoSource,
  resolveLayerBuilderVideoSource,
} from './layerBuilderVideoSources';
import type { FrameContext } from './types';
import { buildLayerBuilderNestedTransitionLayer } from './layerBuilderNestedTransitionLayer';
import { evaluateTransitionMappedAnimation } from '../compositionRender/transitionMappedAnimation';
import {
  buildLayerBuilderNestedCompositionLayer,
  type BuildNestedCompLayerParams,
} from './layerBuilderNestedCompositionLayer';

const log = Logger.create('LayerBuilderNestedLayers');

type BuildNestedLayersParams = {
  clip: TimelineClip;
  clipTime: number;
  ctx: FrameContext;
  proxyFrames: LayerBuilderProxyFrames;
  depth?: number;
};

function buildNestedClipLayer(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  params: BuildNestedLayersParams,
): Layer | null {
  const { ctx, proxyFrames, depth = 0 } = params;
  const nestedLayerBase = buildNestedLayerBase(nestedClip, nestedClipLocalTime);
  if (!nestedLayerBase) return null;
  const { baseLayer, keyframes } = nestedLayerBase;
  let nestedCanvasLayer: Layer | null = null;
  let nested3dLayer: Layer | null = null;

  if (nestedClip.isComposition && nestedClip.nestedClips && nestedClip.nestedClips.length > 0) {
    const subCompTime = getNestedClipSourceTime(nestedClip, nestedClipLocalTime);
    const subLayers = buildLayerBuilderNestedLayers({
      clip: nestedClip,
      clipTime: subCompTime,
      ctx,
      proxyFrames,
      depth: depth + 1,
    });
    if (subLayers.length === 0) return null;

    return buildNestedCompositionSourceLayer(baseLayer, nestedClip, subCompTime, subLayers, ctx);
  }

  if (nestedClip.isLoading) {
    return null;
  }

  if (hasLayerBuilderRenderableVideoSource(nestedClip.source, nestedClip, getMediaFileForClip(ctx, nestedClip))) {
    const nestedClipTime = getNestedClipSourceTime(nestedClip, nestedClipLocalTime);

    if (ctx.proxyEnabled) {
      const mediaFile = getMediaFileForClip(ctx, nestedClip);
      if (mediaFile?.proxyFps) {
        const proxyFrame = proxyFrames.selectProxyFrame({
          clipId: nestedClip.id,
          mediaFile,
          targetMediaTime: nestedClipTime,
          isDraggingPlayhead: ctx.isDraggingPlayhead,
          previewPathBase: 'nested-proxy-image-frame',
        });
        if (proxyFrame) {
          return buildNestedProxyImageSourceLayer(baseLayer, proxyFrame, mediaFile.id);
        }
      }
    }

    const videoSource = resolveLayerBuilderVideoSource({
      clip: nestedClip,
      ctx,
      targetTime: nestedClipTime,
      allowSharedPreviewSession: true,
      workerGpuMediaFile: getMediaFileForClip(ctx, nestedClip),
    });
    return videoSource
      ? ({ ...baseLayer, source: videoSource.source } as Layer)
      : null;
  }

  if (nestedClip.source?.type === 'image') {
    const imageElement = getLayerBuilderRenderableImageElement(nestedClip, ctx);
    return imageElement ? buildNestedImageSourceLayer(baseLayer, imageElement) : null;
  }

  if ((nestedCanvasLayer = buildNestedLayerBuilderCanvasBackedSourceLayer(baseLayer, nestedClip, nestedClipLocalTime, ctx))) {
    return nestedCanvasLayer;
  }

  if (nestedClip.source?.type === 'motion-shape' && nestedClip.motion?.kind === 'shape') {
    return buildNestedMotionSourceLayer(baseLayer, nestedClip, keyframes, nestedClipLocalTime);
  }

  if (
    nestedClip.source?.type === 'motion-null' ||
    nestedClip.source?.type === 'motion-adjustment'
  ) {
    return null;
  }

  if ((nested3dLayer = buildNestedLayerBuilder3dSourceLayer(baseLayer, nestedClip, nestedClipLocalTime, ctx))) {
    return nested3dLayer;
  }

  return null;
}

export function buildLayerBuilderNestedLayers(params: BuildNestedLayersParams): Layer[] {
  const { clip, clipTime, ctx, depth = 0 } = params;
  if (!clip.nestedClips || !clip.nestedTracks) return [];
  if (depth >= MAX_NESTING_DEPTH) return [];

  const nestedVideoTracks = clip.nestedTracks.filter(t => t.type === 'video' && t.visible !== false);
  const layers: Layer[] = [];

  for (let i = 0; i < nestedVideoTracks.length; i++) {
    const nestedTrack = nestedVideoTracks[i];
    const transitionLayer = buildLayerBuilderNestedTransitionLayer({
      parentClip: clip,
      nestedTrack,
      layerIndex: i,
      clipTime,
      ctx,
    });
    if (transitionLayer) {
      layers.push(transitionLayer);
      continue;
    }

    const nestedClip = clip.nestedClips.find(
      nc =>
        nc.trackId === nestedTrack.id &&
        clipTime >= nc.startTime &&
        clipTime < nc.startTime + nc.duration,
    );

    if (!nestedClip) {
      const clipsOnTrack = clip.nestedClips.filter(nc => nc.trackId === nestedTrack.id);
      if (clipsOnTrack.length > 0) {
        log.debug('No active clip on track at time', {
          trackId: nestedTrack.id,
          clipTime,
          clipsOnTrack: clipsOnTrack.map(nc => ({
            name: nc.name,
            startTime: nc.startTime,
            endTime: nc.startTime + nc.duration,
          })),
        });
      }
      continue;
    }

    const nestedLocalTime = clipTime - nestedClip.startTime;
    const nestedLayer = buildNestedClipLayer(nestedClip, nestedLocalTime, params);
    if (nestedLayer) {
      layers.push(nestedLayer);
    } else {
      log.debug('Failed to build nested layer', {
        clipId: nestedClip.id,
        name: nestedClip.name,
        isLoading: nestedClip.isLoading,
        ...getLayerBuilderVideoSourceDebugInfo(nestedClip),
        hasImageElement: !!nestedClip.source?.imageElement,
      });
    }
  }

  return layers;
}

export function buildLayerBuilderNestedCompLayer(params: BuildNestedCompLayerParams): Layer | null {
  const { clip, ctx } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const mappedAnimation = clip.transitionSourceMap?.version === 2
    ? evaluateTransitionMappedAnimation(clip, ctx.getClipKeyframes?.(clip.id), timeInfo.visualClipLocalTime)
    : undefined;
  if (mappedAnimation === null) return null;
  const nestedLayers = buildLayerBuilderNestedLayers({
    clip,
    clipTime: timeInfo.clipTime,
    ctx,
    proxyFrames: params.proxyFrames,
  });
  if (nestedLayers.length === 0) return null;

  return buildLayerBuilderNestedCompositionLayer({
    ...params,
    timeInfo,
    nestedLayers,
    mappedAnimation,
  });
}
