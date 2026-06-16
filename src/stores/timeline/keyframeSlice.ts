// Keyframe-related actions slice

import type {
  KeyframeActions,
  SliceCreator,
  ClipTransform,
} from './types';
import { renderHostPort } from '../../services/render/renderHostPort';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../mediaStore/types';
import {
  parseCameraProperty,
  parseColorProperty,
  parseMaskProperty,
  parseNodeGraphParamProperty,
  parseTextBoundsProperty,
} from '../../types';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  coerceVectorAnimationDataBindingValue,
  getVectorAnimationStateNameAtIndex,
  isVectorAnimationSourceType,
  mergeVectorAnimationSettings,
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../types/vectorAnimation';
import { isMotionProperty } from '../../types/motionDesign';
import { propertyRegistry } from '../../services/properties';
import { calculateTimelineDuration } from '../../utils/speedIntegration';
import { dispatchKeyframeRecordingFeedback } from '../../utils/keyframeRecordingFeedback';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import { getClipTextBounds } from './keyframes/pathKeyframeValues';
import { parseEffectKeyframeProperty } from './keyframes/audioEffectKeyframeValues';
import {
  getVectorAnimationDataBindingProperty,
  getVectorAnimationStateNames,
  normalizeVectorAnimationStateKeyframeValue,
} from './keyframes/vectorAnimationKeyframeValues';
import {
  buildCameraSettingsPatch,
  normalizeCameraSettingValue,
  setCustomNodeParamValue,
} from './keyframes/nodeCameraKeyframeValues';
import { createKeyframeAssetInterpolationActions } from './keyframes/keyframeAssetInterpolationActions';
import { createKeyframeBasicActions } from './keyframes/keyframeBasicActions';
import { createKeyframeEffectInterpolationActions } from './keyframes/keyframeEffectInterpolationActions';
import { createKeyframePathActions } from './keyframes/keyframePathActions';
import { createKeyframeTransformInterpolationActions } from './keyframes/keyframeTransformInterpolationActions';
import { isClipOnLockedTrack } from './keyframes/keyframeClipLookup';
import { createKeyframeViewStateActions } from './keyframes/keyframeViewStateActions';

export const createKeyframeSlice: SliceCreator<KeyframeActions> = (set, get) => ({
  ...createKeyframeBasicActions(set, get),
  ...createKeyframePathActions(set, get),
  ...createKeyframeTransformInterpolationActions(set, get),
  ...createKeyframeEffectInterpolationActions(set, get),
  ...createKeyframeAssetInterpolationActions(set, get),

  setPropertyValue: (clipId, property, value) => {
    const { isRecording, addKeyframe, updateClipTransform, updateClipEffect, updateClipAudioEffectInstance, updateColorNodeParam, updateMask, updateTextProperties, clips, tracks, hasKeyframes, isPlaying } = get();
    if (isClipOnLockedTrack(clips, tracks, clipId)) return;
    const currentClip = clips.find(c => c.id === clipId);
    const cameraPropertyForValue = parseCameraProperty(property);
    const valueForStorage = cameraPropertyForValue && currentClip?.source?.type === 'camera'
      ? normalizeCameraSettingValue(
          cameraPropertyForValue,
          value,
          { ...DEFAULT_SCENE_CAMERA_SETTINGS, ...currentClip.source.cameraSettings },
        )
      : value;

    // Check if this property has keyframes (whether recording or not)
    const propertyHasKeyframes = hasKeyframes(clipId, property);

    if (isRecording(clipId, property) || propertyHasKeyframes) {
      // Recording mode OR property already has keyframes - create/update keyframe
      addKeyframe(clipId, property, valueForStorage);
      if (parseNodeGraphParamProperty(property)) {
        get().invalidateCache();
        renderHostPort.requestRender();
      }
      if (isPlaying && clips.some(c => c.id === clipId)) {
        dispatchKeyframeRecordingFeedback(clipId, property);
      }
      // Also update clip.speed and recalculate duration
      if (property === 'speed') {
        const { invalidateCache, clipKeyframes, updateDuration } = get();
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
          const keyframes = clipKeyframes.get(clipId) || [];
          const sourceDuration = clip.outPoint - clip.inPoint;
          const newDuration = calculateTimelineDuration(keyframes, sourceDuration, value);
          set({
            clips: clips.map(c => c.id === clipId
              ? clearProcessedAudioAnalysisRefs({ ...c, speed: value, duration: newDuration })
              : c)
          });
          updateDuration(); // Update timeline duration
        }
        invalidateCache();
      }
      const textBoundsProperty = parseTextBoundsProperty(property);
      if (textBoundsProperty && textBoundsProperty !== 'path') {
        const clip = clips.find(c => c.id === clipId);
        const textBounds = clip ? getClipTextBounds(clip) : undefined;
        if (textBounds) {
          updateTextProperties(clipId, {
            boxEnabled: true,
            textBounds: {
              ...textBounds,
              position: {
                ...textBounds.position,
                [textBoundsProperty === 'position.x' ? 'x' : 'y']: valueForStorage,
              },
            },
          });
        }
      }
    } else {
      // Not recording and no keyframes - update static value
      const clip = clips.find(c => c.id === clipId);
      if (!clip) return;

      const vectorAnimationState = parseVectorAnimationStateProperty(property);
      if (vectorAnimationState && isVectorAnimationSourceType(clip.source?.type)) {
        const currentSettings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
        const normalizedValue = normalizeVectorAnimationStateKeyframeValue(
          clip,
          vectorAnimationState.stateMachineName,
          value,
        );
        const stateName = getVectorAnimationStateNameAtIndex(
          getVectorAnimationStateNames(clip, vectorAnimationState.stateMachineName),
          normalizedValue,
        );
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...c.source.vectorAnimationSettings,
                stateMachineName: currentSettings.stateMachineName ?? vectorAnimationState.stateMachineName,
                stateMachineState: stateName ?? currentSettings.stateMachineState,
                stateMachineStateCues: undefined,
              },
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      const vectorAnimationInput = parseVectorAnimationInputProperty(property);
      if (vectorAnimationInput && isVectorAnimationSourceType(clip.source?.type)) {
        const currentSettings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
        const inputValues = {
          ...(currentSettings.stateMachineInputValues ?? {}),
          [vectorAnimationInput.inputName]: value,
        };
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...c.source.vectorAnimationSettings,
                stateMachineName: currentSettings.stateMachineName ?? vectorAnimationInput.stateMachineName,
                stateMachineInputValues: inputValues,
              },
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      const vectorAnimationDataBinding = parseVectorAnimationDataBindingProperty(property);
      if (vectorAnimationDataBinding && isVectorAnimationSourceType(clip.source?.type)) {
        const currentSettings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
        const metadataProperty = getVectorAnimationDataBindingProperty(
          clip,
          vectorAnimationDataBinding.propertyName,
        );
        const nextValue = metadataProperty
          ? coerceVectorAnimationDataBindingValue(metadataProperty, value)
          : value;
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...c.source.vectorAnimationSettings,
                dataBindingValues: {
                  ...(currentSettings.dataBindingValues ?? {}),
                  [vectorAnimationDataBinding.propertyName]: nextValue,
                },
              },
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      const maskProperty = parseMaskProperty(property);
      if (maskProperty && maskProperty.property !== 'path') {
        const mask = clip.masks?.find(candidate => candidate.id === maskProperty.maskId);
        if (!mask) return;

        if (maskProperty.property === 'position.x') {
          updateMask(clipId, mask.id, { position: { ...mask.position, x: value } });
        } else if (maskProperty.property === 'position.y') {
          updateMask(clipId, mask.id, { position: { ...mask.position, y: value } });
        } else if (maskProperty.property === 'feather') {
          updateMask(clipId, mask.id, { feather: Math.max(0, value) });
        } else if (maskProperty.property === 'featherQuality') {
          updateMask(clipId, mask.id, { featherQuality: Math.min(100, Math.max(1, Math.round(value))) });
        }
        return;
      }

      const textBoundsProperty = parseTextBoundsProperty(property);
      if (textBoundsProperty && textBoundsProperty !== 'path' && clip.textProperties) {
        const textBounds = getClipTextBounds(clip);
        if (!textBounds) return;
        updateTextProperties(clipId, {
          boxEnabled: true,
          textBounds: {
            ...textBounds,
            position: {
              ...textBounds.position,
              [textBoundsProperty === 'position.x' ? 'x' : 'y']: value,
            },
          },
        });
        return;
      }

      const cameraProperty = parseCameraProperty(property);
      if (cameraProperty && clip.source?.type === 'camera') {
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              cameraSettings: buildCameraSettingsPatch(c.source.cameraSettings, cameraProperty, valueForStorage),
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      const nodeGraphParamProperty = parseNodeGraphParamProperty(property);
      if (nodeGraphParamProperty) {
        set({
          clips: clips.map(c => c.id === clipId
            ? setCustomNodeParamValue(c, nodeGraphParamProperty.nodeId, nodeGraphParamProperty.paramName, value)
            : c),
        });
        get().invalidateCache();
        renderHostPort.requestRender();
        return;
      }

      // Handle effect properties (format: effect.{effectId}.{paramName})
      if (property.startsWith('effect.')) {
        const effectProperty = parseEffectKeyframeProperty(property);
        if (effectProperty) {
          const { effectId, paramName } = effectProperty;
          const audioEffect = clip.audioState?.effectStack?.find(effect => effect.id === effectId);
          if (audioEffect) {
            updateClipAudioEffectInstance(clipId, effectId, { [paramName]: value });
          } else {
            updateClipEffect(clipId, effectId, { [paramName]: value });
          }
        }
        return;
      }

      const colorProperty = parseColorProperty(property);
      if (colorProperty) {
        updateColorNodeParam(
          clipId,
          colorProperty.versionId,
          colorProperty.nodeId,
          colorProperty.paramName,
          value
        );
        return;
      }

      if (isMotionProperty(property)) {
        const descriptor = propertyRegistry.getDescriptor(property, clip);
        if (descriptor?.write) {
          const nextClip = propertyRegistry.writeValue(clip, property, value);
          set({
            clips: clips.map(c => c.id === clipId ? nextClip : c),
          });
          get().invalidateCache();
        }
        return;
      }

      // Handle speed property (directly on clip, not transform)
      if (property === 'speed') {
        const { invalidateCache, updateDuration } = get();
        const sourceDuration = clip.outPoint - clip.inPoint;
        // For constant speed (no keyframes): duration = sourceDuration / |speed|
        const absSpeed = Math.abs(value) || 0.01; // Avoid division by zero
        const newDuration = sourceDuration / absSpeed;
        set({
          clips: clips.map(c => c.id === clipId
            ? clearProcessedAudioAnalysisRefs({ ...c, speed: value, duration: newDuration })
            : c)
        });
        updateDuration(); // Update timeline duration
        invalidateCache();
        return;
      }

      // Build partial transform update from property path
      const transformUpdate: Partial<ClipTransform> = {};

      if (property === 'opacity') {
        transformUpdate.opacity = value;
      } else if (property.startsWith('position.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        transformUpdate.position = { ...clip.transform.position, [axis]: value };
      } else if (property.startsWith('scale.')) {
        const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
        transformUpdate.scale = { ...clip.transform.scale, [axis]: value };
      } else if (property.startsWith('rotation.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        transformUpdate.rotation = { ...clip.transform.rotation, [axis]: value };
      }

      updateClipTransform(clipId, transformUpdate);
    }
  },

  ...createKeyframeViewStateActions(set, get),

  // Disable keyframes for a property: save current value as static, remove all keyframes, disable recording
  disablePropertyKeyframes: (clipId, property, currentValue) => {
    const {
      clips,
      clipKeyframes,
      keyframeRecordingEnabled,
      invalidateCache,
      updateClipTransform,
      updateClipEffect,
      updateClipAudioEffectInstance,
      updateColorNodeParam,
      updateMask,
    } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    // 1. Write current value to base clip value (same logic as setPropertyValue static path)
    const vectorAnimationState = parseVectorAnimationStateProperty(property);
    if (vectorAnimationState && isVectorAnimationSourceType(clip.source?.type)) {
      const stateName = getVectorAnimationStateNameAtIndex(
        getVectorAnimationStateNames(clip, vectorAnimationState.stateMachineName),
        currentValue,
      );
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            vectorAnimationSettings: {
              ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
              ...c.source.vectorAnimationSettings,
              stateMachineName: c.source.vectorAnimationSettings?.stateMachineName ?? vectorAnimationState.stateMachineName,
              stateMachineState: stateName ?? c.source.vectorAnimationSettings?.stateMachineState,
              stateMachineStateCues: undefined,
            },
          } : c.source,
        } : c),
      });
    } else {
      const vectorAnimationInput = parseVectorAnimationInputProperty(property);
      if (vectorAnimationInput && isVectorAnimationSourceType(clip.source?.type)) {
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            vectorAnimationSettings: {
              ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
              ...c.source.vectorAnimationSettings,
              stateMachineInputValues: {
                ...(c.source.vectorAnimationSettings?.stateMachineInputValues ?? {}),
                [vectorAnimationInput.inputName]: currentValue,
              },
            },
          } : c.source,
        } : c),
      });
      } else if (parseVectorAnimationDataBindingProperty(property) && isVectorAnimationSourceType(clip.source?.type)) {
      const vectorAnimationDataBinding = parseVectorAnimationDataBindingProperty(property)!;
      const metadataProperty = getVectorAnimationDataBindingProperty(
        clip,
        vectorAnimationDataBinding.propertyName,
      );
      const nextValue = metadataProperty
        ? coerceVectorAnimationDataBindingValue(metadataProperty, currentValue)
        : currentValue;
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            vectorAnimationSettings: {
              ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
              ...c.source.vectorAnimationSettings,
              dataBindingValues: {
                ...(c.source.vectorAnimationSettings?.dataBindingValues ?? {}),
                [vectorAnimationDataBinding.propertyName]: nextValue,
              },
            },
          } : c.source,
        } : c),
      });
      } else if (parseCameraProperty(property) && clip.source?.type === 'camera') {
      const cameraProperty = parseCameraProperty(property)!;
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            cameraSettings: buildCameraSettingsPatch(c.source.cameraSettings, cameraProperty, currentValue),
          } : c.source,
        } : c),
      });
      } else if (parseNodeGraphParamProperty(property)) {
      const nodeGraphParamProperty = parseNodeGraphParamProperty(property)!;
      set({
        clips: get().clips.map(c => c.id === clipId
          ? setCustomNodeParamValue(c, nodeGraphParamProperty.nodeId, nodeGraphParamProperty.paramName, currentValue)
          : c),
      });
      } else if (property.startsWith('effect.')) {
      const effectProperty = parseEffectKeyframeProperty(property);
      if (effectProperty) {
        const { effectId, paramName } = effectProperty;
        const audioEffect = clip.audioState?.effectStack?.find(effect => effect.id === effectId);
        if (audioEffect) {
          updateClipAudioEffectInstance(clipId, effectId, { [paramName]: currentValue });
        } else {
          updateClipEffect(clipId, effectId, { [paramName]: currentValue });
        }
      }
    } else if (parseMaskProperty(property)) {
      const maskProperty = parseMaskProperty(property)!;
      const mask = clip.masks?.find(candidate => candidate.id === maskProperty.maskId);
      if (mask && maskProperty.property !== 'path') {
        if (maskProperty.property === 'position.x') {
          updateMask(clipId, mask.id, { position: { ...mask.position, x: currentValue } });
        } else if (maskProperty.property === 'position.y') {
          updateMask(clipId, mask.id, { position: { ...mask.position, y: currentValue } });
        } else if (maskProperty.property === 'feather') {
          updateMask(clipId, mask.id, { feather: Math.max(0, currentValue) });
        } else if (maskProperty.property === 'featherQuality') {
          updateMask(clipId, mask.id, { featherQuality: Math.min(100, Math.max(1, Math.round(currentValue))) });
        }
      }
    } else if (parseTextBoundsProperty(property)) {
      const textBoundsProperty = parseTextBoundsProperty(property)!;
      const textBounds = getClipTextBounds(clip);
      if (textBounds && textBoundsProperty !== 'path') {
        get().updateTextProperties(clipId, {
          boxEnabled: true,
          textBounds: {
            ...textBounds,
            position: {
              ...textBounds.position,
              [textBoundsProperty === 'position.x' ? 'x' : 'y']: currentValue,
            },
          },
        });
      }
    } else if (parseColorProperty(property)) {
      const colorProperty = parseColorProperty(property)!;
      updateColorNodeParam(
        clipId,
        colorProperty.versionId,
        colorProperty.nodeId,
        colorProperty.paramName,
        currentValue
      );
    } else if (isMotionProperty(property)) {
      const descriptor = propertyRegistry.getDescriptor(property, clip);
      if (descriptor?.write) {
        const nextClip = propertyRegistry.writeValue(clip, property, currentValue);
        set({
          clips: get().clips.map(c => c.id === clipId ? nextClip : c),
        });
      }
    } else if (property === 'speed') {
      const { updateDuration } = get();
      const sourceDuration = clip.outPoint - clip.inPoint;
      const absSpeed = Math.abs(currentValue) || 0.01;
      const newDuration = sourceDuration / absSpeed;
      set({
        clips: get().clips.map(c => c.id === clipId
          ? clearProcessedAudioAnalysisRefs({ ...c, speed: currentValue, duration: newDuration })
          : c)
      });
      updateDuration();
    } else if (property === 'opacity') {
      updateClipTransform(clipId, { opacity: currentValue });
    } else if (property.startsWith('position.')) {
      const axis = property.split('.')[1] as 'x' | 'y' | 'z';
      updateClipTransform(clipId, { position: { ...clip.transform.position, [axis]: currentValue } });
    } else if (property.startsWith('scale.')) {
      const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
      updateClipTransform(clipId, { scale: { ...clip.transform.scale, [axis]: currentValue } });
    } else if (property.startsWith('rotation.')) {
      const axis = property.split('.')[1] as 'x' | 'y' | 'z';
      updateClipTransform(clipId, { rotation: { ...clip.transform.rotation, [axis]: currentValue } });
      }
    }

    // 2. Remove all keyframes for this property
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const filtered = existingKeyframes.filter(k => k.property !== property);
    const newMap = new Map(clipKeyframes);
    if (filtered.length > 0) {
      newMap.set(clipId, filtered);
    } else {
      newMap.delete(clipId);
    }

    // 3. Disable recording
    const newRecording = new Set(keyframeRecordingEnabled);
    newRecording.delete(`${clipId}:${property}`);

    set({ clipKeyframes: newMap, keyframeRecordingEnabled: newRecording });
    invalidateCache();
  },

});
