import type { ClipMask } from '../../../types';
import type { AnimatableProperty, KeyframeActions, SliceCreator } from '../types';
import { createMaskEdgeFeatherProperty, createMaskPathProperty, createTextBoundsPathProperty, parseMaskProperty } from '../../../types';
import {
  applyTextBoundsPathValue,
  cloneTextBoundsPath,
  getTextBoundsPathValue,
} from '../../../services/textLayout';
import { getMaskEdgeFeather, setMaskEdgeFeatherValue } from '../../../utils/maskEdgeFeathers';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import {
  getVectorAnimationStateNameAtIndex,
  isVectorAnimationSourceType,
  mergeVectorAnimationSettings,
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';
import {
  applyMaskPathValue,
  getClipTextBounds,
  getInterpolatedMaskPathValue,
  getMaskPathValue,
} from './pathKeyframeValues';
import {
  getSteppedKeyframeValue,
  getVectorAnimationDataBindingBaseValue,
  getVectorAnimationInputBaseValue,
  getVectorAnimationStateBaseValue,
  getVectorAnimationStateNames,
} from './vectorAnimationKeyframeValues';
import { findClipById } from './keyframeClipLookup';

type KeyframeAssetInterpolationActions = Pick<
  KeyframeActions,
  | 'getInterpolatedVectorAnimationSettings'
  | 'getInterpolatedMasks'
  | 'getInterpolatedTextBounds'
>;

export const createKeyframeAssetInterpolationActions: SliceCreator<KeyframeAssetInterpolationActions> = (_set, get) => ({
  getInterpolatedVectorAnimationSettings: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    const baseSettings = mergeVectorAnimationSettings(clip?.source?.vectorAnimationSettings);
    if (!clip || !isVectorAnimationSourceType(clip.source?.type)) {
      return baseSettings;
    }

    const activeStateMachineName = baseSettings.stateMachineName;
    const keyframes = clipKeyframes.get(clipId) || [];
    let stateMachineState = baseSettings.stateMachineState;
    let stateMachineStateCues = baseSettings.stateMachineStateCues;
    let stateMachineInputValues = baseSettings.stateMachineInputValues;

    if (activeStateMachineName) {
      const statePropertyKey = keyframes
        .map((keyframe) => keyframe.property)
        .find((property) => parseVectorAnimationStateProperty(property)?.stateMachineName === activeStateMachineName);

      if (statePropertyKey) {
        const stateNames = getVectorAnimationStateNames(clip, activeStateMachineName);
        const stateValue = getSteppedKeyframeValue(
          keyframes,
          statePropertyKey,
          clipLocalTime,
          getVectorAnimationStateBaseValue(clip, baseSettings, activeStateMachineName),
        );
        stateMachineState = getVectorAnimationStateNameAtIndex(stateNames, stateValue) ?? stateMachineState;
        stateMachineStateCues = undefined;
      }

      const inputKeyframes = keyframes.filter((keyframe) => {
        const parsed = parseVectorAnimationInputProperty(keyframe.property);
        return parsed?.stateMachineName === activeStateMachineName;
      });

      if (inputKeyframes.length > 0) {
        const inputValues = { ...(baseSettings.stateMachineInputValues ?? {}) };
        const inputNames = new Set<string>();
        inputKeyframes.forEach((keyframe) => {
          const parsed = parseVectorAnimationInputProperty(keyframe.property);
          if (parsed) {
            inputNames.add(parsed.inputName);
          }
        });

        inputNames.forEach((inputName) => {
          const property = [...inputKeyframes]
            .map((keyframe) => keyframe.property)
            .find((candidate) => parseVectorAnimationInputProperty(candidate)?.inputName === inputName);
          if (!property) {
            return;
          }

          const baseValue = getVectorAnimationInputBaseValue(
            clip,
            baseSettings,
            activeStateMachineName,
            inputName,
          );
          inputValues[inputName] = interpolateKeyframes(
            keyframes,
            property,
            clipLocalTime,
            baseValue,
          );
        });
        stateMachineInputValues = inputValues;
      }
    }

    const dataBindingKeyframes = keyframes.filter((keyframe) => parseVectorAnimationDataBindingProperty(keyframe.property));
    let dataBindingValues = baseSettings.dataBindingValues;

    if (dataBindingKeyframes.length > 0) {
      const nextDataBindingValues = { ...(baseSettings.dataBindingValues ?? {}) };
      const propertyNames = new Set<string>();
      dataBindingKeyframes.forEach((keyframe) => {
        const parsed = parseVectorAnimationDataBindingProperty(keyframe.property);
        if (parsed) {
          propertyNames.add(parsed.propertyName);
        }
      });

      propertyNames.forEach((propertyName) => {
        const property = [...dataBindingKeyframes]
          .map((keyframe) => keyframe.property)
          .find((candidate) => parseVectorAnimationDataBindingProperty(candidate)?.propertyName === propertyName);
        if (!property) {
          return;
        }

        nextDataBindingValues[propertyName] = interpolateKeyframes(
          keyframes,
          property,
          clipLocalTime,
          getVectorAnimationDataBindingBaseValue(clip, baseSettings, propertyName),
        );
      });
      dataBindingValues = nextDataBindingValues;
    }

    return {
      ...baseSettings,
      stateMachineState,
      stateMachineStateCues,
      stateMachineInputValues,
      dataBindingValues,
    };
  },

  getInterpolatedMasks: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    if (!clip?.masks || clip.masks.length === 0) {
      return clip?.masks;
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) {
      return clip.masks;
    }

    const maskKeyframes = keyframes.filter(keyframe => keyframe.property.startsWith('mask.'));
    if (maskKeyframes.length === 0) {
      return clip.masks;
    }

    return clip.masks.map(mask => {
      let nextMask: ClipMask = {
        ...mask,
        edgeFeathers: mask.edgeFeathers ? { ...mask.edgeFeathers } : undefined,
        position: { ...mask.position },
        vertices: mask.vertices.map(vertex => ({
          ...vertex,
          handleIn: { ...vertex.handleIn },
          handleOut: { ...vertex.handleOut },
        })),
      };

      const pathProperty = createMaskPathProperty(mask.id);
      if (maskKeyframes.some(keyframe => keyframe.property === pathProperty && keyframe.pathValue)) {
        nextMask = applyMaskPathValue(
          nextMask,
          getInterpolatedMaskPathValue(maskKeyframes, pathProperty, clipLocalTime, getMaskPathValue(mask)),
        );
      }

      const positionXProperty = `mask.${mask.id}.position.x` as AnimatableProperty;
      const positionYProperty = `mask.${mask.id}.position.y` as AnimatableProperty;
      const featherProperty = `mask.${mask.id}.feather` as AnimatableProperty;
      const featherQualityProperty = `mask.${mask.id}.featherQuality` as AnimatableProperty;

      if (maskKeyframes.some(keyframe => keyframe.property === positionXProperty)) {
        nextMask.position.x = interpolateKeyframes(maskKeyframes, positionXProperty, clipLocalTime, mask.position.x);
      }
      if (maskKeyframes.some(keyframe => keyframe.property === positionYProperty)) {
        nextMask.position.y = interpolateKeyframes(maskKeyframes, positionYProperty, clipLocalTime, mask.position.y);
      }
      if (maskKeyframes.some(keyframe => keyframe.property === featherProperty)) {
        nextMask.feather = Math.max(0, interpolateKeyframes(maskKeyframes, featherProperty, clipLocalTime, mask.feather));
      }
      if (maskKeyframes.some(keyframe => keyframe.property === featherQualityProperty)) {
        nextMask.featherQuality = Math.min(100, Math.max(1, Math.round(
          interpolateKeyframes(maskKeyframes, featherQualityProperty, clipLocalTime, mask.featherQuality ?? 50),
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
        const edgeFeatherProperty = createMaskEdgeFeatherProperty(mask.id, edgeId) as AnimatableProperty;
        if (!maskKeyframes.some(keyframe => keyframe.property === edgeFeatherProperty)) return;
        nextMask.edgeFeathers = setMaskEdgeFeatherValue(
          nextMask.edgeFeathers,
          edgeId,
          interpolateKeyframes(
            maskKeyframes,
            edgeFeatherProperty,
            clipLocalTime,
            getMaskEdgeFeather(mask, edgeId),
          ),
        );
      });

      return nextMask;
    });
  },

  getInterpolatedTextBounds: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    const textBounds = clip ? getClipTextBounds(clip) : undefined;
    if (!clip || !textBounds) {
      return undefined;
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) {
      return textBounds;
    }

    const textBoundsKeyframes = keyframes.filter(keyframe => keyframe.property.startsWith('textBounds.'));
    if (textBoundsKeyframes.length === 0) {
      return textBounds;
    }

    let nextBounds = cloneTextBoundsPath(textBounds);
    const pathProperty = createTextBoundsPathProperty();
    if (textBoundsKeyframes.some(keyframe => keyframe.property === pathProperty && keyframe.pathValue)) {
      nextBounds = applyTextBoundsPathValue(
        nextBounds,
        getInterpolatedMaskPathValue(textBoundsKeyframes, pathProperty, clipLocalTime, getTextBoundsPathValue(textBounds)),
      );
    }

    const positionXProperty = 'textBounds.position.x' as AnimatableProperty;
    const positionYProperty = 'textBounds.position.y' as AnimatableProperty;
    if (textBoundsKeyframes.some(keyframe => keyframe.property === positionXProperty)) {
      nextBounds.position.x = interpolateKeyframes(textBoundsKeyframes, positionXProperty, clipLocalTime, textBounds.position.x);
    }
    if (textBoundsKeyframes.some(keyframe => keyframe.property === positionYProperty)) {
      nextBounds.position.y = interpolateKeyframes(textBoundsKeyframes, positionYProperty, clipLocalTime, textBounds.position.y);
    }

    return nextBounds;
  },
});
