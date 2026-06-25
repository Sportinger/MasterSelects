import type { Layer, TimelineClip } from '../../types';
import type { Keyframe } from '../../types/keyframes';
import { renderClipAINodesToCanvas } from '../nodeGraph';
import { getClipTimeInfo } from './FrameContext';
import type { FrameContext } from './types';

function findLinkedClip(clip: TimelineClip, ctx: FrameContext): TimelineClip | null {
  if (clip.linkedClipId) {
    return ctx.clips.find(candidate => candidate.id === clip.linkedClipId) ?? null;
  }
  return ctx.clips.find(candidate => candidate.linkedClipId === clip.id) ?? null;
}

export function addLayerBuilderMaskProperties(
  layer: Layer,
  clip: TimelineClip,
  _localTime?: number,
  _keyframes?: readonly Keyframe[],
): void {
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
