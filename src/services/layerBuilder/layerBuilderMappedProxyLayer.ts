import type { BlendMode } from '../../types/blendMode';
import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { evaluateTransitionRenderState } from '../../utils/transitionRenderInterpolation';
import type { TransitionMappedAnimation } from '../compositionRender/transitionMappedAnimation';
import { resolveTransitionRecipeBlendMode } from '../timeline/transitionRecipeBlendWindows';
import { getFinalOpacity } from './layerBuilderVideoSourceMetadata';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

interface ApplyMappedProxyLayerParams {
  layer: Layer;
  clip: TimelineClip;
  layerIndex: number;
  localTime: number;
  opacityOverride?: number;
  transform: ClipTransform;
  animation: TransitionMappedAnimation;
  transformCache: TransformCache;
  ctx: FrameContext;
}

export function applyMappedProxyLayer(params: ApplyMappedProxyLayerParams): Layer {
  const { layer, clip, layerIndex, localTime, opacityOverride, animation, ctx } = params;
  const transform = params.transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    params.transform,
  );
  layer.opacity = getFinalOpacity(transform.opacity, opacityOverride);
  layer.blendMode = resolveTransitionRecipeBlendMode(
    clip.transitionRecipeBlendWindows,
    clip.startTime + localTime,
    transform.blendMode as BlendMode,
  );
  layer.effects = animation.effects;
  layer.position = transform.position;
  layer.scale = transform.scale;
  layer.rotation = transform.rotation;
  delete layer.maskClipId;
  delete layer.maskInvert;
  delete layer.masks;
  if (animation.masks?.some((mask) => mask.enabled !== false)) {
    layer.maskClipId = clip.id;
    layer.maskInvert = false;
    layer.masks = animation.masks;
  }
  const transitionRender = evaluateTransitionRenderState(
    clip.transitionRender,
    ctx.getClipKeyframes?.(clip.id),
    localTime,
  );
  if (transitionRender) layer.transitionRender = transitionRender;
  return layer;
}
