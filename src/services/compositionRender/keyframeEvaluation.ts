import type { ClipMask } from '../../types/masks';
import type { ClipTransform } from '../../types/timelineCore';
import type { Keyframe } from '../../types/keyframes';
import { createMaskEdgeFeatherProperty, createMaskPathProperty, parseMaskProperty } from '../../types/animationProperties';
import { getMaskEdgeFeather, setMaskEdgeFeatherValue } from '../../utils/maskEdgeFeathers';
import {
  getInterpolatedClipTransform,
  interpolateKeyframes,
} from '../../utils/keyframeInterpolation';

export function evaluateCompositionClipTransform(
  baseTransform: ClipTransform,
  keyframes: readonly Keyframe[] | undefined,
  localTime: number,
): ClipTransform {
  if (!keyframes?.length) return baseTransform;
  return getInterpolatedClipTransform([...keyframes], localTime, baseTransform);
}

export function evaluateCompositionClipMasks(
  masks: readonly ClipMask[] | undefined,
  keyframes: readonly Keyframe[] | undefined,
  localTime: number,
): ClipMask[] | undefined {
  if (!masks?.length) return masks ? [...masks] : undefined;
  const maskKeyframes = keyframes?.filter((keyframe) => keyframe.property.startsWith('mask.')) ?? [];
  if (maskKeyframes.length === 0) return masks.map((mask) => structuredClone(mask));

  return masks.map((mask) => {
    const nextMask = structuredClone(mask);
    const positionXProperty = `mask.${mask.id}.position.x` as Keyframe['property'];
    const positionYProperty = `mask.${mask.id}.position.y` as Keyframe['property'];
    const featherProperty = `mask.${mask.id}.feather` as Keyframe['property'];
    const featherQualityProperty = `mask.${mask.id}.featherQuality` as Keyframe['property'];

    if (maskKeyframes.some((keyframe) => keyframe.property === positionXProperty)) {
      nextMask.position.x = interpolateKeyframes(maskKeyframes, positionXProperty, localTime, mask.position.x);
    }
    if (maskKeyframes.some((keyframe) => keyframe.property === positionYProperty)) {
      nextMask.position.y = interpolateKeyframes(maskKeyframes, positionYProperty, localTime, mask.position.y);
    }
    if (maskKeyframes.some((keyframe) => keyframe.property === featherProperty)) {
      nextMask.feather = Math.max(0, interpolateKeyframes(maskKeyframes, featherProperty, localTime, mask.feather));
    }
    if (maskKeyframes.some((keyframe) => keyframe.property === featherQualityProperty)) {
      nextMask.featherQuality = Math.min(100, Math.max(1, Math.round(
        interpolateKeyframes(maskKeyframes, featherQualityProperty, localTime, mask.featherQuality ?? 50),
      )));
    }

    const edgeFeatherIds = new Set(Object.keys(mask.edgeFeathers ?? {}));
    maskKeyframes.forEach((keyframe) => {
      const parsed = parseMaskProperty(keyframe.property);
      if (parsed?.property === 'edgeFeather' && parsed.maskId === mask.id) {
        edgeFeatherIds.add(parsed.edgeId);
      }
    });
    edgeFeatherIds.forEach((edgeId) => {
      const edgeFeatherProperty = createMaskEdgeFeatherProperty(mask.id, edgeId) as Keyframe['property'];
      if (!maskKeyframes.some((keyframe) => keyframe.property === edgeFeatherProperty)) return;
      nextMask.edgeFeathers = setMaskEdgeFeatherValue(
        nextMask.edgeFeathers,
        edgeId,
        interpolateKeyframes(maskKeyframes, edgeFeatherProperty, localTime, getMaskEdgeFeather(mask, edgeId)),
      );
    });

    const pathProperty = createMaskPathProperty(mask.id);
    const pathKeyframe = [...maskKeyframes]
      .filter((keyframe) => keyframe.property === pathProperty && keyframe.pathValue)
      .sort((a, b) => b.time - a.time)
      .find((keyframe) => keyframe.time <= localTime);
    if (pathKeyframe?.pathValue) {
      nextMask.closed = pathKeyframe.pathValue.closed;
      nextMask.vertices = structuredClone(pathKeyframe.pathValue.vertices);
    }

    return nextMask;
  });
}
