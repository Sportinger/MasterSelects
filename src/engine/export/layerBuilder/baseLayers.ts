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
import { evaluateCompositionClipMasks } from '../../../services/compositionRender/keyframeEvaluation';
import type { BaseLayerPropsLike, FrameContextLike } from './contracts';

const log = Logger.create('ExportLayerBuilder');

export function getNestedClipKeyframes(nestedClip: TimelineClip): Keyframe[] {
  const { clipKeyframes } = useTimelineStore.getState();
  const storeKeyframes = clipKeyframes.get(nestedClip.id);
  return storeKeyframes?.length
    ? storeKeyframes
    : [...((nestedClip as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes ?? [])];
}

export function buildBaseLayerProps(
  clip: TimelineClip,
  clipLocalTime: number,
  trackIndex: number,
  ctx: FrameContextLike,
): BaseLayerPropsLike {
  const { getInterpolatedTransform, getInterpolatedEffects, getInterpolatedColorCorrection } = ctx;

  let transform;
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

  let effects: Effect[] = [];
  try {
    effects = getInterpolatedEffects(clip.id, clipLocalTime);
  } catch (e) {
    log.warn(`Effects interpolation failed for clip ${clip.id}`, e);
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

  return {
    id: `export_layer_${trackIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: (transform.blendMode || 'normal') as BlendMode,
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
    ...(clip.masks?.some(mask => mask.enabled !== false) ? { maskClipId: clip.id, maskInvert: false } : {}),
    ...(clip.is3D ? { is3D: true } : {}),
  };
}

export function buildNestedBaseLayer(nestedClip: TimelineClip, nestedClipLocalTime: number): BaseLayerPropsLike {
  const keyframes = getNestedClipKeyframes(nestedClip);

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

  const transform = keyframes.length > 0
    ? getInterpolatedClipTransform(keyframes, nestedClipLocalTime, baseTransform, {
        rotationMode: nestedClip.source?.type === 'camera' ? 'shortest' : 'linear',
      })
    : baseTransform;

  const effectKeyframes = keyframes.filter(k => k.property.startsWith('effect.'));
  let effects = nestedClip.effects || [];
  if (effectKeyframes.length > 0 && effects.length > 0) {
    effects = effects.map(effect => {
      const newParams = { ...effect.params };
      Object.keys(effect.params).forEach(paramName => {
        if (typeof effect.params[paramName] !== 'number') return;
        const propertyKey = `effect.${effect.id}.${paramName}`;
        const paramKeyframes = effectKeyframes.filter(k => k.property === propertyKey);
        if (paramKeyframes.length > 0) {
          const sorted = [...paramKeyframes].sort((a, b) => a.time - b.time);
          if (nestedClipLocalTime <= sorted[0].time) {
            newParams[paramName] = sorted[0].value;
          } else if (nestedClipLocalTime >= sorted[sorted.length - 1].time) {
            newParams[paramName] = sorted[sorted.length - 1].value;
          } else {
            for (let i = 0; i < sorted.length - 1; i++) {
              if (nestedClipLocalTime >= sorted[i].time && nestedClipLocalTime <= sorted[i + 1].time) {
                const t = (nestedClipLocalTime - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
                newParams[paramName] = sorted[i].value + t * (sorted[i + 1].value - sorted[i].value);
                break;
              }
            }
          }
        }
      });
      return { ...effect, params: newParams };
    });
  }

  const renderScale = getEffectiveScale(transform.scale);

  return {
    id: `nested-export-${nestedClip.id}`,
    name: nestedClip.name,
    sourceClipId: nestedClip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: (transform.blendMode || 'normal') as BlendMode,
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
    ...(() => {
      const masks = evaluateCompositionClipMasks(nestedClip.masks, keyframes, nestedClipLocalTime);
      return masks?.some(mask => mask.enabled !== false)
        ? { maskClipId: nestedClip.id, maskInvert: false, masks }
        : {};
    })(),
    ...(nestedClip.is3D ? { is3D: true } : {}),
  };
}
