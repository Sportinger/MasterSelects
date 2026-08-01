import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { MAX_NESTING_DEPTH } from '../../stores/timeline/constants';
import { Logger } from '../logger';
import { getClipTimeInfo } from './FrameContext';
import { buildNestedImageSourceLayer, getLayerBuilderRenderableImageElement } from './layerBuilder2dSources';
import { buildNestedLayerBuilder3dSourceLayer } from './layerBuilder3dLayers';
import { buildNestedLayerBuilderCanvasBackedSourceLayer } from './layerBuilderCanvasSources';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import {
  buildNestedCompositionSourceLayer,
  buildNestedLayerBase,
  buildNestedMotionSourceLayer,
  getNestedClipKeyframes,
  getNestedClipSourceTime,
} from './layerBuilderNestedLayers';
import { getLayerBuilderVideoSourceDebugInfo } from './layerBuilderVideoSources';
import type { FrameContext } from './types';
import { buildLayerBuilderNestedTransitionLayer } from './layerBuilderNestedTransitionLayer';
import {
  buildLayerBuilderNestedCompositionLayer,
  type BuildNestedCompLayerParams,
} from './layerBuilderNestedCompositionLayer';
import { buildMotionAdjustmentLayerFromBase } from './layerBuilderMotionAdjustment';
import { evaluateParentedClipTransform } from './parentTransformEvaluation';
import {
  getNestedClipContinuityKey,
  getNestedPreviewRootTrackKey,
  getNestedPreviewTrackKey,
  type NestedPreviewContinuationResolver,
} from './nestedPreviewContinuity';
import { buildNestedVideoSourceLayer } from './layerBuilderNestedVideoSource';

const log = Logger.create('LayerBuilderNestedLayers');

type BuildNestedLayersParams = {
  clip: TimelineClip;
  clipTime: number;
  ctx: FrameContext;
  proxyFrames: LayerBuilderProxyFrames;
  depth?: number;
  parentTransformClips?: readonly TimelineClip[];
  parentTransformTimelineTime?: number;
  previewContinuationResolver?: NestedPreviewContinuationResolver;
  previewTrackKey?: string;
};

function buildNestedClipLayer(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  params: BuildNestedLayersParams,
): Layer | null {
  const { ctx, proxyFrames, depth = 0 } = params;
  const nestedLayerBase = buildNestedLayerBase(nestedClip, nestedClipLocalTime, {
    clips: params.parentTransformClips ?? params.clip.nestedClips ?? [],
    timelineTime: params.parentTransformTimelineTime ?? params.clipTime,
  });
  if (!nestedLayerBase) return null;
  const { baseLayer, keyframes } = nestedLayerBase;
  const parentTrackKey = params.previewTrackKey ?? getNestedPreviewRootTrackKey(params.clip);
  const trackKey = getNestedPreviewTrackKey(parentTrackKey, params.clip, nestedClip);
  const continuityKey = getNestedClipContinuityKey(params.clip, nestedClip);
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
      previewContinuationResolver: params.previewContinuationResolver,
      previewTrackKey: trackKey,
    });
    if (subLayers.length === 0) return null;

    return buildNestedCompositionSourceLayer(baseLayer, nestedClip, subCompTime, subLayers, ctx);
  }

  if (nestedClip.isLoading) {
    return null;
  }

  const nestedVideoLayer = buildNestedVideoSourceLayer({
    baseLayer,
    nestedClip,
    nestedClipTime: getNestedClipSourceTime(nestedClip, nestedClipLocalTime),
    ctx,
    proxyFrames,
    previewContinuationResolver: params.previewContinuationResolver,
    trackKey,
    continuityKey,
  });
  if (nestedVideoLayer !== undefined) return nestedVideoLayer;

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

  if (nestedClip.source?.type === 'motion-adjustment') {
    const composition = ctx.compositionById.get(params.clip.compositionId || '');
    return buildMotionAdjustmentLayerFromBase({
      clip: nestedClip,
      baseLayer,
      compositionSize: {
        width: composition?.width ?? 1920,
        height: composition?.height ?? 1080,
      },
      surface: 'nested-preview',
    });
  }

  if (nestedClip.source?.type === 'motion-null') {
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

export function buildLayerBuilderNestedCompLayer(
  params: BuildNestedCompLayerParams & { previewContinuationResolver?: NestedPreviewContinuationResolver },
): Layer | null {
  const { clip, ctx } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const mappedEvaluation = clip.transitionSourceMap?.version === 2
    ? evaluateParentedClipTransform({
        clip,
        clips: ctx.clips ?? [clip],
        clipLocalTime: timeInfo.visualClipLocalTime,
        parentTimelineTime: clip.startTime + timeInfo.visualClipLocalTime,
        getKeyframes: candidate => {
          const contextKeyframes = ctx.getClipKeyframes?.(candidate.id);
          return contextKeyframes?.length ? contextKeyframes : getNestedClipKeyframes(candidate);
        },
      })
    : undefined;
  if (mappedEvaluation && !mappedEvaluation.ok) return null;
  const mappedAnimation = mappedEvaluation?.mappedAnimation;
  const nestedLayers = buildLayerBuilderNestedLayers({
    clip,
    clipTime: timeInfo.clipTime,
    ctx,
    proxyFrames: params.proxyFrames,
    previewContinuationResolver: params.previewContinuationResolver,
  });
  if (nestedLayers.length === 0) return null;

  return buildLayerBuilderNestedCompositionLayer({
    ...params,
    timeInfo,
    nestedLayers,
    mappedAnimation,
    transformOverride: mappedEvaluation?.transform,
  });
}
