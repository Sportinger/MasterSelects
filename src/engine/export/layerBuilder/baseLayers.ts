import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import type { BlendMode } from '../../../types/blendMode';
import { compileRuntimeColorGrade } from '../../../types/colorCorrection';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipTransform } from '../../../types/timelineCore';
import { getInterpolatedClipTransform } from '../../../utils/keyframeInterpolation';
import { getEffectiveScale } from '../../../utils/transformScale';
import { evaluateTransitionRenderState } from '../../../utils/transitionRenderInterpolation';
import { evaluateCompositionClipEffects, evaluateCompositionClipMasks } from '../../../services/compositionRender/keyframeEvaluation';
import { evaluateTransitionMappedAnimation } from '../../../services/compositionRender/transitionMappedAnimation';
import { resolveTransitionRecipeBlendMode } from '../../../services/timeline/transitionRecipeBlendWindows';
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
  const mappedAnimation = clip.transitionSourceMap?.version === 2
    ? evaluateTransitionMappedAnimation(clip, keyframes, clipLocalTime)
    : undefined;
  if (mappedAnimation === null) return null;

  let transform;
  if (mappedAnimation) {
    transform = mappedAnimation.transform;
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

export function buildNestedBaseLayer(nestedClip: TimelineClip, nestedClipLocalTime: number): BaseLayerPropsLike | null {
  const keyframes = getClipKeyframes(nestedClip);

  const baseTransform: ClipTransform = {
    opacity: nestedClip.transform?.opacity ?? DEFAULT_TRANSFORM.opacity,
    blendMode: nestedClip.transform?.blendMode ?? DEFAULT_TRANSFORM.blendMode,
    position: {
      x: nestedClip.transform?.position?.x ?? DEFAULT_TRANSFORM.position.x,
      y: nestedClip.transform?.position?.y ?? DEFAULT_TRANSFORM.position.y,
      z: nestedClip.transform?.position?.z ?? DEFAULT_TRANSFORM.position.z,
    },
    scale: {
      ...(nestedClip.transform?.scale?.all !== undefined ? { all: nestedClip.transform.scale.all } : {}),
      x: nestedClip.transform?.scale?.x ?? DEFAULT_TRANSFORM.scale.x,
      y: nestedClip.transform?.scale?.y ?? DEFAULT_TRANSFORM.scale.y,
      ...(nestedClip.transform?.scale?.z !== undefined ? { z: nestedClip.transform.scale.z } : {}),
    },
    rotation: {
      x: nestedClip.transform?.rotation?.x ?? DEFAULT_TRANSFORM.rotation.x,
      y: nestedClip.transform?.rotation?.y ?? DEFAULT_TRANSFORM.rotation.y,
      z: nestedClip.transform?.rotation?.z ?? DEFAULT_TRANSFORM.rotation.z,
    },
  };

  const isV2SourceMap = nestedClip.transitionSourceMap?.version === 2;
  const mappedAnimation = isV2SourceMap
    ? evaluateTransitionMappedAnimation(nestedClip, keyframes, nestedClipLocalTime)
    : null;
  if (isV2SourceMap && !mappedAnimation) return null;

  const transform = mappedAnimation?.transform ?? (keyframes.length > 0
    ? getInterpolatedClipTransform(keyframes, nestedClipLocalTime, baseTransform, {
        rotationMode: nestedClip.source?.type === 'camera' ? 'shortest' : 'linear',
      })
    : baseTransform);

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
