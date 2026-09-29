import type { BlendMode, Keyframe, Layer, TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { buildStrandsLayerSources, renderingWeaveEffects } from '../operators/geometry/strandsLayerSource';
import { getClipTimeInfo } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

type BuildStrandsLayersParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
};

/** Weave effects draw their strands as 3D layers above the clip, with the clip's transform. */
export function buildLayerBuilderStrandsLayers({ clip, layerIndex, ctx, transformCache }: BuildStrandsLayersParams): Layer[] {
  if (!renderingWeaveEffects(clip).length) return [];
  const timeInfo = getClipTimeInfo(ctx, clip);
  const sources = buildStrandsLayerSources(clip, timeInfo.clipLocalTime, useTimelineStore.getState().clipKeyframes.get(clip.id));
  if (!sources.length) return [];
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}_${clip.id}_strands`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );
  return sources.map(({ effectId, source }) => ({
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}_strands_${effectId}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: transform.opacity,
    blendMode: transform.blendMode as BlendMode,
    source,
    effects: [],
    position: transform.position,
    anchor: transform.anchor,
    scale: transform.scale,
    rotation: transform.rotation,
    is3D: true,
  }));
}

/** Nested and export strands reuse the transform of the clip's own layer. */
export function buildStrandsOverlayLayers(baseLayer: Layer, clip: TimelineClip, clipLocalTime: number,
  keyframes: readonly Keyframe[] | undefined): Layer[] {
  if (baseLayer.source?.type === 'strands') return [];
  return buildStrandsLayerSources(clip, clipLocalTime, keyframes)
    .map(({ effectId, source }) => ({ ...baseLayer, id: `${baseLayer.id}_strands_${effectId}`, source, effects: [], is3D: true }));
}
