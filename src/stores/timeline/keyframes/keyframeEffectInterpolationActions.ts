import type { AnimatableProperty, KeyframeActions, SliceCreator } from '../types';
import {
  compileRuntimeColorGrade,
  ensureColorCorrectionState,
  setColorNodeParamValue,
} from '../../../types';
import { getHexColorChannel, rgbColorToHex } from '../../../utils/colorParam';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import {
  getLegacyEffectKeyframeBaseValue,
  mergeLegacyEffectParamPatch,
  parseEffectKeyframeProperty,
} from './audioEffectKeyframeValues';
import {
  getCustomNodeDefinition,
  getCustomNodeParamDefaults,
} from './nodeCameraKeyframeValues';
import { findClipById } from './keyframeClipLookup';
import { appendSurfaceEffects } from '../../../services/planarTracking/surfaceEffects';
import { bindCableRenderTime } from '../../../services/faceCables/cableRenderTime';

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
    const withSurfaces = (effects: typeof clip.effects) => appendSurfaceEffects(bindCableRenderTime(effects, clipLocalTime), clip, clipLocalTime, keyframes);
    if (keyframes.length === 0) {
      return withSurfaces(clip.effects);
    }

    const effectKeyframes = keyframes.filter(k => k.property.startsWith('effect.'));
    if (effectKeyframes.length === 0) {
      return withSurfaces(clip.effects);
    }

    return withSurfaces(clip.effects.map(effect => {
      let newParams = { ...effect.params };
      const paramNames = new Set<string>();

      Object.keys(effect.params).forEach(paramName => {
        if (typeof effect.params[paramName] === 'number') {
          paramNames.add(paramName);
        }
      });

      effectKeyframes.forEach(keyframe => {
        const effectProperty = parseEffectKeyframeProperty(keyframe.property);
        if (effectProperty?.effectId === effect.id) {
          paramNames.add(effectProperty.paramName);
        }
      });

      paramNames.forEach(paramName => {
        const propertyKey = `effect.${effect.id}.${paramName}`;
        const paramKeyframes = effectKeyframes.filter(k => k.property === propertyKey);
        if (paramKeyframes.length === 0) {
          return;
        }

        const baseValue = getLegacyEffectKeyframeBaseValue(effect, paramName);
        if (baseValue === undefined) {
          return;
        }

        const interpolatedValue = interpolateKeyframes(
          keyframes,
          propertyKey as AnimatableProperty,
          clipLocalTime,
          baseValue,
        );
        newParams = mergeLegacyEffectParamPatch(
          { ...effect, params: newParams },
          { [paramName]: interpolatedValue },
        );
      });

      return { ...effect, params: newParams };
    }));
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

    let colorState = ensureColorCorrectionState(clip.colorCorrection);
    const keyframes = clipKeyframes.get(clipId) || [];
    const colorKeyframes = keyframes.filter(k => k.property.startsWith('color.'));

    if (colorKeyframes.length > 0) {
      for (const version of colorState.versions) {
        for (const node of version.nodes) {
          for (const [paramName, baseValue] of Object.entries(node.params)) {
            if (typeof baseValue !== 'number') continue;
            const propertyKey = `color.${version.id}.${node.id}.${paramName}` as AnimatableProperty;
            if (!colorKeyframes.some(k => k.property === propertyKey)) continue;
            const value = interpolateKeyframes(keyframes, propertyKey, clipLocalTime, baseValue);
            colorState = setColorNodeParamValue(colorState, version.id, node.id, paramName, value);
          }
        }
      }
    }

    return compileRuntimeColorGrade(colorState);
  },
});
