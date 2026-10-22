import { applyStickFigureActions } from '../rig/stickFigureActionRuntime';
import type { ClipMask } from '../../types/masks';
import type { ClipTransform } from '../../types/timelineCore';
import type { Keyframe } from '../../types/keyframes';
import type { Effect } from '../../types/effects';
import { applyParameterSourcesToEffects, applyParameterSourcesToTransform } from '../parameterSources/parameterSourceRendering';
import type { ParameterSourceClip } from '../parameterSources/parameterSourceTargets';
import { bindCableRenderTime } from '../faceCables/cableRenderTime';
import { pauseIncompleteOperatorEffects } from '../operators/editableOperatorGraph';
import { appendSurfaceEffects, type SurfaceClip } from '../planarTracking/surfaceEffects';
import { createMaskEdgeFeatherProperty, createMaskPathProperty, parseMaskProperty } from '../../types/animationProperties';
import { evaluateEffectKeyframes } from '../../stores/timeline/keyframes/effectKeyframeEvaluation';
import {
  getInterpolatedMaskPathValue,
  getMaskPathValue,
} from '../../stores/timeline/keyframes/pathKeyframeValues';
import { getMaskEdgeFeather, setMaskEdgeFeatherValue } from '../../utils/maskEdgeFeathers';
import {
  getInterpolatedClipTransform,
  interpolateKeyframes,
} from '../../utils/keyframeInterpolation';

export function evaluateCompositionClipTransform(
  baseTransform: ClipTransform,
  keyframes: readonly Keyframe[] | undefined,
  localTime: number,
  stabilizationEnabled?: boolean,
  sourceClip?: Partial<ParameterSourceClip>,
): ClipTransform {
  // Pass the clip's own array: the keyframe property index is cached per array (a copy re-sorts every key).
  const interpolated = keyframes?.length
    ? getInterpolatedClipTransform(keyframes as Keyframe[], localTime, baseTransform, { stabilizationEnabled })
    : baseTransform;
  return sourceClip?.nodeGraph?.parameterSources && typeof sourceClip.startTime === 'number'
    ? applyParameterSourcesToTransform({ ...sourceClip, startTime: sourceClip.startTime, effects: sourceClip.effects ?? [],
      transform: baseTransform }, keyframes ?? [], localTime, interpolated)
    : interpolated;
}

/**
 * Effects of a clip inside a composition at `localTime`, with the same keyframe evaluation as the
 * timeline (evaluateEffectKeyframes). `rateClockStart` is where the clip starts on the clock its
 * effects are rendered with (the composition time), so keyed and unkeyed rates agree; it defaults to
 * the clip's start time.
 */
export function evaluateCompositionClipEffects(
  effects: Effect[] | undefined,
  keyframes: readonly Keyframe[] | undefined,
  localTime: number,
  surfaceClip?: SurfaceClip & Partial<ParameterSourceClip>,
  rateClockStart = surfaceClip?.startTime ?? 0,
): Effect[] {
  const withSurfaces = (result: Effect[]) => {
    // Stick Figure action lanes sit between keyframes and node sources, as on the timeline.
    result = applyStickFigureActions(surfaceClip, result, localTime, keyframes);
    if (surfaceClip?.nodeGraph?.parameterSources && typeof surfaceClip.startTime === 'number') {
      result = applyParameterSourcesToEffects({ ...surfaceClip, startTime: surfaceClip.startTime, effects: effects ?? [] }, keyframes ?? [], localTime, result);
    }
    const timed = bindCableRenderTime(pauseIncompleteOperatorEffects(result), localTime, surfaceClip?.videoInspectorSections?.stabilization);
    return surfaceClip ? appendSurfaceEffects(timed, surfaceClip, localTime, keyframes) : timed;
  };
  return withSurfaces(evaluateEffectKeyframes(effects ?? [], keyframes ?? [], localTime, rateClockStart));
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
    const rotationProperty = `mask.${mask.id}.rotation` as Keyframe['property'];
    const featherProperty = `mask.${mask.id}.feather` as Keyframe['property'];
    const featherQualityProperty = `mask.${mask.id}.featherQuality` as Keyframe['property'];
    for (const name of ['featherOffset', 'featherBalance'] as const) {
      const property = `mask.${mask.id}.${name}` as Keyframe['property'];
      if (maskKeyframes.some(keyframe => keyframe.property === property)) {
        const value = interpolateKeyframes(maskKeyframes, property, localTime, mask[name] ?? (0));
        nextMask[name] = name === 'featherBalance' ? Math.max(-100, Math.min(100, value)) : value;
      }
    }

    if (maskKeyframes.some((keyframe) => keyframe.property === positionXProperty)) {
      nextMask.position.x = interpolateKeyframes(maskKeyframes, positionXProperty, localTime, mask.position.x);
    }
    if (maskKeyframes.some((keyframe) => keyframe.property === positionYProperty)) {
      nextMask.position.y = interpolateKeyframes(maskKeyframes, positionYProperty, localTime, mask.position.y);
    }
    if (maskKeyframes.some((keyframe) => keyframe.property === rotationProperty)) {
      nextMask.rotation = interpolateKeyframes(maskKeyframes, rotationProperty, localTime, mask.rotation ?? 0);
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
    if (maskKeyframes.some((keyframe) => keyframe.property === pathProperty && keyframe.pathValue)) {
      const pathValue = getInterpolatedMaskPathValue(
        [...maskKeyframes],
        pathProperty,
        localTime,
        getMaskPathValue(mask),
      );
      nextMask.closed = pathValue.closed;
      nextMask.vertices = pathValue.vertices;
    }

    return nextMask;
  });
}
