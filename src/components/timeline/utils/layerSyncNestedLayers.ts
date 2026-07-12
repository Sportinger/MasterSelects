import type {
  ClipTransform,
  Keyframe,
  Layer,
  TimelineClip,
} from '../../../types';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';
import { DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import { vectorAnimationRuntimeManager } from '../../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { evaluateCompositionClipEffects } from '../../../services/compositionRender/keyframeEvaluation';
import { evaluateTransitionMappedAnimation } from '../../../services/compositionRender/transitionMappedAnimation';
import { resolveTransitionRecipeBlendMode } from '../../../services/timeline/transitionRecipeBlendWindows';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { getInterpolatedClipTransform } from '../../../utils/keyframeInterpolation';
import { getEffectiveScale } from '../../../utils/transformScale';
import { evaluateTransitionRenderState } from '../../../utils/transitionRenderInterpolation';
import {
  getLazyImageElementForClip,
  type LazyImageLookupContext,
} from '../../../services/timeline/lazyImageElements';

interface BuildLayerSyncNestedLayersParams {
  clip: TimelineClip;
  clipKeyframes: Map<string, Keyframe[]>;
  clipTime: number;
  getInterpolatedVectorAnimationSettings: (
    clipId: string,
    localTime: number,
  ) => VectorAnimationClipSettings;
  imageLookupContext: LazyImageLookupContext;
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

function buildNestedLayerBase(
  nestedClip: TimelineClip,
  transform: ClipTransform,
  effects: TimelineClip['effects'],
  parentCompositionTime: number,
): Omit<Layer, 'source'> {
  return {
    id: `nested-layer-${nestedClip.id}`,
    name: nestedClip.name,
    sourceClipId: nestedClip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: resolveTransitionRecipeBlendMode(
      nestedClip.transitionRecipeBlendWindows,
      parentCompositionTime,
      transform.blendMode || 'normal',
    ),
    effects,
    position: {
      x: transform.position?.x || 0,
      y: transform.position?.y || 0,
      z: transform.position?.z || 0,
    },
    scale: getEffectiveScale(transform.scale),
    rotation: {
      x: ((transform.rotation?.x || 0) * Math.PI) / 180,
      y: ((transform.rotation?.y || 0) * Math.PI) / 180,
      z: ((transform.rotation?.z || 0) * Math.PI) / 180,
    },
  };
}

export function buildLayerSyncNestedLayers({
  clip,
  clipKeyframes,
  clipTime,
  getInterpolatedVectorAnimationSettings,
  imageLookupContext,
}: BuildLayerSyncNestedLayersParams): Layer[] {
  if (!clip.nestedClips || !clip.nestedTracks) return [];

  const nestedVideoTracks = clip.nestedTracks.filter(
    (track) => track.type === 'video' && track.visible,
  );
  const layers: Layer[] = [];

  for (const nestedTrack of nestedVideoTracks) {
    const nestedClip = clip.nestedClips.find(
      (candidate) =>
        candidate.trackId === nestedTrack.id &&
        clipTime >= candidate.startTime &&
        clipTime < candidate.startTime + candidate.duration,
    );

    if (!nestedClip) continue;

    const nestedLocalTime = clipTime - nestedClip.startTime;
    const keyframes = clipKeyframes.get(nestedClip.id) || [];
    const baseTransform = buildNestedBaseTransform(nestedClip);
    const mappedAnimation = nestedClip.transitionSourceMap?.version === 2
      ? evaluateTransitionMappedAnimation(nestedClip, keyframes, nestedLocalTime)
      : undefined;
    if (nestedClip.transitionSourceMap?.version === 2 && !mappedAnimation) continue;
    const transform = mappedAnimation?.transform ?? (keyframes.length > 0
      ? getInterpolatedClipTransform(keyframes, nestedLocalTime, baseTransform, {
          rotationMode: nestedClip.source?.type === 'camera' ? 'shortest' : 'linear',
        })
      : baseTransform);
    const effects = mappedAnimation?.effects ?? evaluateCompositionClipEffects(
      nestedClip.effects,
      keyframes,
      nestedLocalTime,
    );
    const baseLayer = buildNestedLayerBase(nestedClip, transform, effects, clipTime);
    const transitionRender = evaluateTransitionRenderState(
      nestedClip.transitionRender,
      keyframes,
      nestedLocalTime,
    );
    if (mappedAnimation?.masks?.some((mask) => mask.enabled !== false)) {
      baseLayer.maskClipId = nestedClip.id;
      baseLayer.maskInvert = false;
      baseLayer.masks = mappedAnimation.masks;
    }
    if (transitionRender) baseLayer.transitionRender = transitionRender;
    if (nestedClip.is3D) baseLayer.is3D = true;

    if (nestedClip.source?.videoElement) {
      layers.push({
        ...baseLayer,
        source: {
          type: 'video',
          videoElement: nestedClip.source.videoElement,
          webCodecsPlayer: nestedClip.source.webCodecsPlayer,
        },
      });
    } else if (nestedClip.source?.type === 'image') {
      const imageElement = getLazyImageElementForClip(imageLookupContext, nestedClip);
      if (!imageElement) continue;

      layers.push({
        ...baseLayer,
        source: {
          type: 'image',
          imageElement,
        },
      });
    } else if (nestedClip.source?.textCanvas) {
      if (isVectorAnimationSourceType(nestedClip.source.type)) {
        vectorAnimationRuntimeManager.renderClipAtTime(
          nestedClip,
          nestedClip.startTime + nestedLocalTime,
          getInterpolatedVectorAnimationSettings(nestedClip.id, nestedLocalTime),
        );
      }

      layers.push({
        ...baseLayer,
        source: {
          type: 'text',
          textCanvas: nestedClip.source.textCanvas,
        },
      });
    }
  }

  return layers;
}
