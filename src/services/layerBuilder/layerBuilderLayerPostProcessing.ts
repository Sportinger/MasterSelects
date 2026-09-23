import type { Layer, TimelineClip } from '../../types';
import type { Keyframe } from '../../types/keyframes';
import { renderClipAINodesToCanvas } from '../nodeGraph';
import { getClipTimeInfo } from './FrameContext';
import type { FrameContext } from './types';
import { evaluateCompositionClipMasks } from '../compositionRender/keyframeEvaluation';
import { temporalClipSource } from '../../effects/time/temporalClipSource';
import { applyMaskEditPreview, type TimelineMaskEditPreview } from '../../stores/timeline/maskEditPreview';

/** Apply evaluated drag geometry after the cache, without changing cached layers. */
export function applyLayerBuilderMaskEditPreview(
  layers: Layer[],
  preview: TimelineMaskEditPreview | null | undefined,
): Layer[] {
  if (!preview) return layers;
  return layers.map(layer => {
    if (layer.sourceClipId !== preview.clipId) return layer;
    const masks = applyMaskEditPreview(preview.clipId, layer.masks, preview);
    return masks === layer.masks ? layer : { ...layer, masks };
  });
}

function findLinkedClip(clip: TimelineClip, ctx: FrameContext): TimelineClip | null {
  if (clip.linkedClipId) {
    return ctx.clips.find(candidate => candidate.id === clip.linkedClipId) ?? null;
  }
  return ctx.clips.find(candidate => candidate.linkedClipId === clip.id) ?? null;
}

export function addLayerBuilderMaskProperties(
  layer: Layer,
  clip: TimelineClip,
  localTime = 0,
  keyframes: readonly Keyframe[] = [],
): void {
  layer.temporalSource = temporalClipSource(clip, localTime, keyframes);
  layer.masks ??= evaluateCompositionClipMasks(clip.masks, keyframes, localTime);
  if (clip.masks?.some(mask => mask.enabled !== false)) {
    layer.maskClipId = clip.id;
    layer.maskInvert = false;
  }
  if (clip.sourceRect) layer.sourceRect = { ...clip.sourceRect };
}

export function withLayerBuilderMaskProperties(
  layer: Layer,
  clip: TimelineClip,
  localTime?: number,
  keyframes?: readonly Keyframe[],
): Layer {
  addLayerBuilderMaskProperties(layer, clip, localTime, keyframes);
  return layer;
}

export function applyLayerBuilderAINodesToLayer(
  clip: TimelineClip,
  layer: Layer,
  ctx: FrameContext,
): Layer {
  if (!layer.source) {
    return layer;
  }

  const timeInfo = getClipTimeInfo(ctx, clip);
  const track = ctx.tracks.find(candidate => candidate.id === clip.trackId);
  const linkedClip = findLinkedClip(clip, ctx);
  const linkedTrack = linkedClip
    ? ctx.tracks.find(candidate => candidate.id === linkedClip.trackId)
    : undefined;
  const canvas = renderClipAINodesToCanvas(
    clip,
    layer.source,
    layer.id,
    timeInfo.clipLocalTime,
    (nodeId) => ctx.getInterpolatedNodeGraphParams(clip.id, nodeId, timeInfo.clipLocalTime),
    {
      track,
      linkedClip,
      linkedTrack,
      masterAudioState: ctx.masterAudioState,
    },
  );
  if (!canvas) {
    return layer;
  }

  return {
    ...layer,
    source: {
      type: 'text',
      textCanvas: canvas,
      intrinsicWidth: canvas.width,
      intrinsicHeight: canvas.height,
      mediaTime: layer.source.mediaTime,
      targetMediaTime: layer.source.targetMediaTime,
      previewPath: 'ai-node-runtime',
    },
  };
}
