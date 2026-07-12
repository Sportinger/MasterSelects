import type { BlendMode } from '../../types/blendMode';
import type { Layer, NestedCompositionData } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { evaluateTransitionMappedAnimation } from '../compositionRender/transitionMappedAnimation';
import { resolveTransitionRecipeBlendMode } from '../timeline/transitionRecipeBlendWindows';
import { addLayerBuilderMaskProperties } from './layerBuilderLayerPostProcessing';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import type { TransformCache } from './TransformCache';
import type { ClipTimeInfo, FrameContext } from './types';

export type BuildNestedCompLayerParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  proxyFrames: LayerBuilderProxyFrames;
  opacityOverride?: number;
};

export function buildLayerBuilderNestedCompositionLayer(input: BuildNestedCompLayerParams & {
  timeInfo: ClipTimeInfo;
  nestedLayers: Layer[];
  mappedAnimation: ReturnType<typeof evaluateTransitionMappedAnimation> | undefined;
}): Layer {
  const {
    clip,
    layerIndex,
    ctx,
    transformCache,
    opacityOverride,
    timeInfo,
    nestedLayers,
    mappedAnimation,
  } = input;
  const compositionLocalTime = timeInfo.visualClipLocalTime;
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}`,
    mappedAnimation?.transform ?? ctx.getInterpolatedTransform(clip.id, timeInfo.clipTime),
  );
  const composition = ctx.compositionById.get(clip.compositionId || '');
  const nestedCompData: NestedCompositionData = {
    compositionId: clip.compositionId || clip.id,
    layers: nestedLayers,
    width: composition?.width || 1920,
    height: composition?.height || 1080,
    currentTime: timeInfo.clipTime,
    sceneClips: clip.nestedClips,
    sceneTracks: clip.nestedTracks,
  };
  const layer: Layer = {
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: opacityOverride !== undefined
      ? transform.opacity * opacityOverride
      : transform.opacity,
    blendMode: mappedAnimation
      ? resolveTransitionRecipeBlendMode(
          clip.transitionRecipeBlendWindows,
          clip.startTime + compositionLocalTime,
          transform.blendMode as BlendMode,
        )
      : transform.blendMode as BlendMode,
    source: { type: 'image', mediaTime: timeInfo.clipTime, nestedComposition: nestedCompData },
    effects: mappedAnimation?.effects ?? ctx.getInterpolatedEffects(clip.id, timeInfo.clipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, timeInfo.clipTime),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    ...(mappedAnimation?.masks?.some(mask => mask.enabled !== false)
      ? { maskClipId: clip.id, maskInvert: false, masks: mappedAnimation.masks }
      : {}),
  };

  addLayerBuilderMaskProperties(layer, clip, timeInfo.clipTime);
  return layer;
}
