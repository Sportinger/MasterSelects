import {
  compileRuntimeColorGrade,
} from '../../types/colorCorrection';
import type { BlendMode } from '../../types/blendMode';
import type { Keyframe } from '../../types/keyframes';
import type { Layer, NestedCompositionData } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { useTimelineStore } from '../../stores/timeline';
import { getInterpolatedMotionLayer } from '../../utils/motionInterpolation';
import { getEffectiveScale } from '../../utils/transformScale';
import { evaluateTransitionRenderState } from '../../utils/transitionRenderInterpolation';
import { evaluateCompositionClipEffects, evaluateCompositionClipMasks } from '../compositionRender/keyframeEvaluation';
import { resolveTransitionRecipeBlendMode } from '../timeline/transitionRecipeBlendWindows';
import { evaluateParentedClipTransform } from './parentTransformEvaluation';
import type { FrameContext } from './types';

export {
  getNestedClipSourceTime,
  getNestedClipSourceTiming,
  type NestedClipSourceTiming,
} from './layerBuilderNestedSourceTiming';

export type NestedLayerBase = {
  baseLayer: Omit<Layer, 'source'>;
  keyframes: Keyframe[];
};

export function getNestedClipKeyframes(nestedClip: TimelineClip): Keyframe[] {
  const storeKeyframes = useTimelineStore.getState().clipKeyframes.get(nestedClip.id);
  if (storeKeyframes?.length) return storeKeyframes;
  const embeddedKeyframes = (nestedClip as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes;
  return embeddedKeyframes ? [...embeddedKeyframes] : storeKeyframes ?? [];
}

export function buildNestedLayerBase(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  parentContext: {
    clips: readonly TimelineClip[];
    timelineTime: number;
  } = {
    clips: [nestedClip],
    timelineTime: nestedClip.startTime + nestedClipLocalTime,
  },
): NestedLayerBase | null {
  const evaluated = evaluateParentedClipTransform({
    clip: nestedClip,
    clips: parentContext.clips,
    clipLocalTime: nestedClipLocalTime,
    parentTimelineTime: parentContext.timelineTime,
    getKeyframes: getNestedClipKeyframes,
  });
  if (!evaluated.ok) return null;
  const { keyframes, mappedAnimation, transform } = evaluated;
  const renderScale = getEffectiveScale(transform.scale);
  const transitionRender = evaluateTransitionRenderState(
    nestedClip.transitionRender,
    keyframes,
    nestedClipLocalTime,
  );

  const baseLayer: Omit<Layer, 'source'> = {
    id: `nested-layer-${nestedClip.id}`,
    name: nestedClip.name,
    sourceClipId: nestedClip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: resolveTransitionRecipeBlendMode(
      nestedClip.transitionRecipeBlendWindows,
      nestedClip.startTime + nestedClipLocalTime,
      (transform.blendMode || 'normal') as BlendMode,
    ),
    effects: mappedAnimation?.effects ?? evaluateCompositionClipEffects(nestedClip.effects, keyframes, nestedClipLocalTime),
    colorCorrection: compileRuntimeColorGrade(nestedClip.colorCorrection),
    position: {
      x: transform.position?.x || 0,
      y: transform.position?.y || 0,
      z: transform.position?.z || 0,
    },
    scale: renderScale,
    rotation: {
      x: ((transform.rotation?.x || 0) * Math.PI) / 180,
      y: ((transform.rotation?.y || 0) * Math.PI) / 180,
      z: ((transform.rotation?.z || 0) * Math.PI) / 180,
    },
    sourceRect: nestedClip.sourceRect ? { ...nestedClip.sourceRect } : undefined,
    ...(transitionRender ? { transitionRender } : {}),
    ...(nestedClip.is3D ? { is3D: true } : {}),
  };

  const masks = mappedAnimation?.masks ?? evaluateCompositionClipMasks(nestedClip.masks, keyframes, nestedClipLocalTime);
  if (masks?.some(m => m.enabled !== false)) {
    baseLayer.maskClipId = nestedClip.id;
    baseLayer.maskInvert = false;
    baseLayer.masks = masks;
  }

  return { baseLayer, keyframes };
}

export function buildNestedCompositionSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  nestedClip: TimelineClip,
  nestedClipTime: number,
  subLayers: Layer[],
  ctx: FrameContext,
): Layer {
  const subComp = ctx.compositionById.get(nestedClip.compositionId || '');
  const nestedCompData: NestedCompositionData = {
    compositionId: nestedClip.compositionId || nestedClip.id,
    layers: subLayers,
    width: subComp?.width || 1920,
    height: subComp?.height || 1080,
    currentTime: nestedClipTime,
    sceneClips: nestedClip.nestedClips,
    sceneTracks: nestedClip.nestedTracks,
  };

  return {
    ...baseLayer,
    source: { type: 'image', mediaTime: nestedClipTime, nestedComposition: nestedCompData },
  };
}

export function buildNestedMotionSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  nestedClip: TimelineClip,
  keyframes: Keyframe[],
  nestedClipLocalTime: number,
): Layer {
  return {
    ...baseLayer,
    source: {
      type: 'motion',
      motion: getInterpolatedMotionLayer(nestedClip, keyframes, nestedClipLocalTime) ?? nestedClip.motion,
    },
  };
}
