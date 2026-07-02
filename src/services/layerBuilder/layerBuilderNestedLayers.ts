import type {
  BlendMode,
  ClipTransform,
  Keyframe,
  Layer,
  NestedCompositionData,
  TimelineClip,
} from '../../types';
import { compileRuntimeColorGrade } from '../../types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { useTimelineStore } from '../../stores/timeline';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { getInterpolatedMotionLayer } from '../../utils/motionInterpolation';
import { getEffectiveScale } from '../../utils/transformScale';
import { evaluateCompositionClipMasks } from '../compositionRender/keyframeEvaluation';
import type { FrameContext } from './types';

export type NestedLayerBase = {
  baseLayer: Omit<Layer, 'source'>;
  keyframes: Keyframe[];
};

function getNestedClipKeyframes(nestedClip: TimelineClip): Keyframe[] {
  const storeKeyframes = useTimelineStore.getState().clipKeyframes.get(nestedClip.id);
  if (storeKeyframes?.length) return storeKeyframes;
  const embeddedKeyframes = (nestedClip as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes;
  return embeddedKeyframes ? [...embeddedKeyframes] : storeKeyframes ?? [];
}

function buildNestedBaseTransform(nestedClip: TimelineClip): ClipTransform {
  return {
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
}

function interpolateNestedEffects(
  nestedClip: TimelineClip,
  keyframes: Keyframe[],
  nestedClipLocalTime: number,
): TimelineClip['effects'] {
  const effectKeyframes = keyframes.filter(k => k.property.startsWith('effect.'));
  let effects = nestedClip.effects || [];
  if (effectKeyframes.length === 0 || effects.length === 0) return effects;

  effects = effects.map(effect => {
    const newParams = { ...effect.params };
    Object.keys(effect.params).forEach(paramName => {
      if (typeof effect.params[paramName] !== 'number') return;
      const propertyKey = `effect.${effect.id}.${paramName}`;
      const paramKeyframes = effectKeyframes.filter(k => k.property === propertyKey);
      if (paramKeyframes.length === 0) return;

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
    });
    return { ...effect, params: newParams };
  });

  return effects;
}

export function buildNestedLayerBase(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
): NestedLayerBase {
  const keyframes = getNestedClipKeyframes(nestedClip);
  const baseTransform = buildNestedBaseTransform(nestedClip);
  const transform = keyframes.length > 0
    ? getInterpolatedClipTransform(keyframes, nestedClipLocalTime, baseTransform, {
        rotationMode: nestedClip.source?.type === 'camera' ? 'shortest' : 'linear',
      })
    : baseTransform;
  const renderScale = getEffectiveScale(transform.scale);

  const baseLayer: Omit<Layer, 'source'> = {
    id: `nested-layer-${nestedClip.id}`,
    name: nestedClip.name,
    sourceClipId: nestedClip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: (transform.blendMode || 'normal') as BlendMode,
    effects: interpolateNestedEffects(nestedClip, keyframes, nestedClipLocalTime),
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
  };

  const masks = evaluateCompositionClipMasks(nestedClip.masks, keyframes, nestedClipLocalTime);
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
  nestedClipLocalTime: number,
  subLayers: Layer[],
  ctx: FrameContext,
): Layer {
  const subComp = ctx.compositionById.get(nestedClip.compositionId || '');
  const nestedCompData: NestedCompositionData = {
    compositionId: nestedClip.compositionId || nestedClip.id,
    layers: subLayers,
    width: subComp?.width || 1920,
    height: subComp?.height || 1080,
    currentTime: nestedClipLocalTime,
    sceneClips: nestedClip.nestedClips,
    sceneTracks: nestedClip.nestedTracks,
  };

  return {
    ...baseLayer,
    source: { type: 'image', mediaTime: nestedClipLocalTime, nestedComposition: nestedCompData },
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

export function getNestedClipSourceTime(nestedClip: TimelineClip, nestedClipLocalTime: number): number {
  const inPoint = nestedClip.inPoint ?? 0;
  const outPoint = nestedClip.outPoint ?? nestedClip.duration;
  const sourceOverride = nestedClip.transitionSourceTimeOverride;
  if (Number.isFinite(sourceOverride)) return sourceOverride!;
  if (nestedClip.transitionSourceHold) return inPoint;
  return nestedClip.reversed
    ? outPoint - nestedClipLocalTime
    : nestedClipLocalTime + inPoint;
}
