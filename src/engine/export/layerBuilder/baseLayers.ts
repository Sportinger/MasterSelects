import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { BlendMode } from '../../../types/blendMode';
import { compileRuntimeColorGrade } from '../../../types/colorCorrection';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import { getEffectiveScale } from '../../../utils/transformScale';
import { evaluateTransitionRenderState } from '../../../utils/transitionRenderInterpolation';
import { evaluateCompositionClipEffects, evaluateCompositionClipMasks } from '../../../services/compositionRender/keyframeEvaluation';
import { resolveTransitionRecipeBlendMode } from '../../../services/timeline/transitionRecipeBlendWindows';
import { evaluateParentedClipTransform } from '../../../services/layerBuilder/parentTransformEvaluation';
import type { BaseLayerPropsLike, FrameContextLike } from './contracts';

const log = Logger.create('ExportLayerBuilder');

export function getClipKeyframes(clip: TimelineClip): Keyframe[] {
  const storeKeyframes = useTimelineStore.getState().getClipKeyframes(clip.id);
  return storeKeyframes.length
    ? storeKeyframes
    : [...((clip as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes ?? [])];
}

export function buildBaseLayerProps(
  clip: TimelineClip,
  clipLocalTime: number,
  trackIndex: number,
  ctx: FrameContextLike,
): BaseLayerPropsLike | null {
  const { getInterpolatedTransform, getInterpolatedEffects, getInterpolatedColorCorrection } = ctx;
  const keyframes = getClipKeyframes(clip);
  const parentEvaluation = clip.parentClipId || clip.transitionSourceMap?.version === 2
    ? evaluateParentedClipTransform({
        clip,
        clips: ctx.compositionClips ?? ctx.renderClipsAtTime ?? ctx.clipsAtTime,
        clipLocalTime,
        parentTimelineTime: ctx.time,
        getKeyframes: getClipKeyframes,
      })
    : undefined;
  if (parentEvaluation && !parentEvaluation.ok) return null;
  const mappedAnimation = parentEvaluation?.mappedAnimation;

  let transform;
  if (parentEvaluation) {
    transform = parentEvaluation.transform;
  } else {
    try {
      transform = getInterpolatedTransform(clip.id, clipLocalTime);
    } catch (e) {
      log.warn(`Transform interpolation failed for clip ${clip.id}`, e);
      transform = {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal' as BlendMode,
      };
    }
  }

  let effects: Effect[] = mappedAnimation?.effects ?? [];
  if (!mappedAnimation) {
    try {
      effects = getInterpolatedEffects(clip.id, clipLocalTime);
    } catch (e) {
      log.warn(`Effects interpolation failed for clip ${clip.id}`, e);
    }
  }

  let colorCorrection;
  try {
    colorCorrection = typeof getInterpolatedColorCorrection === 'function'
      ? getInterpolatedColorCorrection(clip.id, clipLocalTime)
      : undefined;
  } catch (e) {
    log.warn(`Color interpolation failed for clip ${clip.id}`, e);
  }

  const renderScale = getEffectiveScale(transform.scale);
  const transitionRender = evaluateTransitionRenderState(
    clip.transitionRender,
    keyframes,
    clipLocalTime,
  );

  return {
    id: `export_layer_${trackIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: resolveTransitionRecipeBlendMode(
      clip.transitionRecipeBlendWindows,
      ctx.time,
      (transform.blendMode || 'normal') as BlendMode,
    ),
    effects,
    colorCorrection,
    position: {
      x: transform.position?.x ?? 0,
      y: transform.position?.y ?? 0,
      z: transform.position?.z ?? 0,
    },
    scale: renderScale,
    rotation: {
      x: ((transform.rotation?.x ?? 0) * Math.PI) / 180,
      y: ((transform.rotation?.y ?? 0) * Math.PI) / 180,
      z: ((transform.rotation?.z ?? 0) * Math.PI) / 180,
    },
    sourceRect: clip.sourceRect ? { ...clip.sourceRect } : undefined,
    ...(mappedAnimation?.masks?.some(mask => mask.enabled !== false)
      ? { maskClipId: clip.id, maskInvert: false, masks: mappedAnimation.masks }
      : clip.masks?.some(mask => mask.enabled !== false) ? { maskClipId: clip.id, maskInvert: false } : {}),
    ...(transitionRender ? { transitionRender } : {}),
    ...(clip.is3D ? { is3D: true } : {}),
  };
}

export function buildNestedBaseLayer(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  parentContext: {
    clips: readonly TimelineClip[];
    timelineTime: number;
  } = {
    clips: [nestedClip],
    timelineTime: nestedClip.startTime + nestedClipLocalTime,
  },
): BaseLayerPropsLike | null {
  const evaluated = evaluateParentedClipTransform({
    clip: nestedClip,
    clips: parentContext.clips,
    clipLocalTime: nestedClipLocalTime,
    parentTimelineTime: parentContext.timelineTime,
    getKeyframes: getClipKeyframes,
  });
  if (!evaluated.ok) return null;
  const { keyframes, mappedAnimation, transform } = evaluated;

  const effects = mappedAnimation
    ? mappedAnimation.effects
    : evaluateCompositionClipEffects(nestedClip.effects, keyframes, nestedClipLocalTime);
  const masks = mappedAnimation
    ? mappedAnimation.masks
    : evaluateCompositionClipMasks(nestedClip.masks, keyframes, nestedClipLocalTime);

  const renderScale = getEffectiveScale(transform.scale);
  const transitionRender = evaluateTransitionRenderState(
    nestedClip.transitionRender,
    keyframes,
    nestedClipLocalTime,
  );

  return {
    id: `nested-export-${nestedClip.id}`,
    name: nestedClip.name,
    sourceClipId: nestedClip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: resolveTransitionRecipeBlendMode(
      nestedClip.transitionRecipeBlendWindows,
      nestedClip.startTime + nestedClipLocalTime,
      (transform.blendMode || 'normal') as BlendMode,
    ),
    effects,
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
    ...(masks?.some(mask => mask.enabled !== false)
      ? { maskClipId: nestedClip.id, maskInvert: false, masks }
      : {}),
    ...(transitionRender ? { transitionRender } : {}),
    ...(nestedClip.is3D ? { is3D: true } : {}),
  };
}
