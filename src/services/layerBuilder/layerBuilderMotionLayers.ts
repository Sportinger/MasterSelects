import type { BlendMode, Layer, TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { getInterpolatedMotionLayer } from '../../utils/motionInterpolation';
import { getClipTimeInfo } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';
import { addLayerBuilderMaskProperties } from './layerBuilderLayerPostProcessing';

type BuildMotionLayerParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
};

export function buildLayerBuilderMotionShapeLayer(params: BuildMotionLayerParams): Layer | null {
  const { clip, layerIndex, ctx, transformCache, opacityOverride } = params;
  if (!clip.motion || clip.motion.kind !== 'shape') {
    return null;
  }

  const timeInfo = getClipTimeInfo(ctx, clip);
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}_${clip.id}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );
  const keyframes = useTimelineStore.getState().clipKeyframes.get(clip.id) ?? [];
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: opacityOverride !== undefined
      ? transform.opacity * opacityOverride
      : transform.opacity,
    blendMode: transform.blendMode as BlendMode,
    source: {
      type: 'motion',
      motion: getInterpolatedMotionLayer(clip, keyframes, timeInfo.clipLocalTime) ?? clip.motion,
    },
    effects: ctx.getInterpolatedEffects(clip.id, timeInfo.clipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, timeInfo.clipLocalTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
  };

  addLayerBuilderMaskProperties(layer, clip, timeInfo.clipLocalTime, keyframes);
  return layer;
}
