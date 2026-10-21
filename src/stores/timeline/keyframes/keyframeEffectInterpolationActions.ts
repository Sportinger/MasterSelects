import type { AnimatableProperty, KeyframeActions, SliceCreator } from '../types';
import { applyParameterSourcesToEffects, evaluateParameterSourceColorGrade } from '../../../services/parameterSources/parameterSourceRendering';
import { getHexColorChannel, rgbColorToHex } from '../../../utils/colorParam';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { evaluateEffectKeyframes } from './effectKeyframeEvaluation';
import {
  getCustomNodeDefinition,
  getCustomNodeParamDefaults,
} from './nodeCameraKeyframeValues';
import { findClipById } from './keyframeClipLookup';
import { appendSurfaceEffects } from '../../../services/planarTracking/surfaceEffects';
import { bindCableRenderTime } from '../../../services/faceCables/cableRenderTime';
import { pauseIncompleteOperatorEffects } from '../../../services/operators/editableOperatorGraph';
import { applyStickFigureActions } from '../../../services/rig/stickFigureActionRuntime';

type KeyframeEffectInterpolationActions = Pick<
  KeyframeActions,
  | 'getInterpolatedEffects'
  | 'getInterpolatedNodeGraphParams'
  | 'getInterpolatedColorCorrection'
>;

export const createKeyframeEffectInterpolationActions: SliceCreator<KeyframeEffectInterpolationActions> = (_set, get) => ({
  getInterpolatedEffects: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !clip.effects) {
      return [];
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    const withSurfaces = (effects: typeof clip.effects) => appendSurfaceEffects(bindCableRenderTime(pauseIncompleteOperatorEffects(
      applyParameterSourcesToEffects(clip, keyframes, clipLocalTime, applyStickFigureActions(clip, effects, clipLocalTime))), clipLocalTime, clip.videoInspectorSections?.stabilization), clip, clipLocalTime, keyframes);
    // Keyframes, then the distance keyed rates have travelled on the timeline clock (shared with compositions).
    return withSurfaces(evaluateEffectKeyframes(clip.effects, keyframes, clipLocalTime, clip.startTime));
  },

  getInterpolatedNodeGraphParams: (clipId, nodeId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    if (!clip) {
      return {};
    }

    const params = getCustomNodeParamDefaults(clip, nodeId);
    const definition = getCustomNodeDefinition(clip, nodeId);
    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) {
      return params;
    }

    for (const param of definition?.parameterSchema ?? []) {
      if (param.type !== 'color') {
        continue;
      }

      const fallback = String(param.default);
      const baseColor = params[param.id] ?? fallback;
      const channels = {
        r: getHexColorChannel(baseColor, 'r', fallback),
        g: getHexColorChannel(baseColor, 'g', fallback),
        b: getHexColorChannel(baseColor, 'b', fallback),
      };

      (['r', 'g', 'b'] as const).forEach((channel) => {
        const propertyKey = `node.${nodeId}.${param.id}.${channel}` as AnimatableProperty;
        if (!keyframes.some((keyframe) => keyframe.property === propertyKey)) {
          return;
        }
        channels[channel] = interpolateKeyframes(keyframes, propertyKey, clipLocalTime, channels[channel]);
      });

      params[param.id] = rgbColorToHex(channels);
    }

    for (const [paramName, baseValue] of Object.entries(params)) {
      if (typeof baseValue !== 'number') {
        continue;
      }

      const propertyKey = `node.${nodeId}.${paramName}` as AnimatableProperty;
      if (!keyframes.some((keyframe) => keyframe.property === propertyKey)) {
        continue;
      }

      params[paramName] = interpolateKeyframes(keyframes, propertyKey, clipLocalTime, baseValue);
    }

    return params;
  },

  getInterpolatedColorCorrection: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip?.colorCorrection) {
      return undefined;
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    return evaluateParameterSourceColorGrade(clip, keyframes, clipLocalTime);
  },
});
