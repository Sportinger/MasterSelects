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
import { evaluateTransitionRenderState } from '../../utils/transitionRenderInterpolation';
import { evaluateCompositionClipEffects, evaluateCompositionClipMasks } from '../compositionRender/keyframeEvaluation';
import { evaluateTransitionMappedAnimation } from '../compositionRender/transitionMappedAnimation';
import { resolveTransitionRecipeBlendMode } from '../timeline/transitionRecipeBlendWindows';
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

export function buildNestedLayerBase(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
): NestedLayerBase | null {
  const keyframes = getNestedClipKeyframes(nestedClip);
  const mappedAnimation = nestedClip.transitionSourceMap?.version === 2
    ? evaluateTransitionMappedAnimation(nestedClip, keyframes, nestedClipLocalTime)
    : undefined;
  if (mappedAnimation === null) return null;
  const baseTransform = buildNestedBaseTransform(nestedClip);
  const transform = mappedAnimation?.transform ?? (keyframes.length > 0
    ? getInterpolatedClipTransform(keyframes, nestedClipLocalTime, baseTransform, {
        rotationMode: nestedClip.source?.type === 'camera' ? 'shortest' : 'linear',
      })
    : baseTransform);
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
