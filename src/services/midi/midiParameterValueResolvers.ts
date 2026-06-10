import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../engine/gaussian/types';
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_3D_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { getInterpolatedClipTransform, interpolateKeyframes } from '../../utils/keyframeInterpolation';
import type { AnimatableProperty } from '../../types/animationProperties';
import type { Text3DProperties } from '../../types/text';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import type { MIDIParameterBinding } from '../../types/midi';
import { getFiniteNumber } from './midiParameterUtils';

function getClipBaseTransform(clip: TimelineClip): ClipTransform {
  return {
    opacity: clip.transform?.opacity ?? DEFAULT_TRANSFORM.opacity,
    blendMode: clip.transform?.blendMode ?? DEFAULT_TRANSFORM.blendMode,
    position: {
      x: clip.transform?.position?.x ?? DEFAULT_TRANSFORM.position.x,
      y: clip.transform?.position?.y ?? DEFAULT_TRANSFORM.position.y,
      z: clip.transform?.position?.z ?? DEFAULT_TRANSFORM.position.z,
    },
    scale: {
      ...(clip.transform?.scale?.all !== undefined ? { all: clip.transform.scale.all } : {}),
      x: clip.transform?.scale?.x ?? DEFAULT_TRANSFORM.scale.x,
      y: clip.transform?.scale?.y ?? DEFAULT_TRANSFORM.scale.y,
      ...(clip.transform?.scale?.z !== undefined ? { z: clip.transform.scale.z } : {}),
    },
    rotation: {
      x: clip.transform?.rotation?.x ?? DEFAULT_TRANSFORM.rotation.x,
      y: clip.transform?.rotation?.y ?? DEFAULT_TRANSFORM.rotation.y,
      z: clip.transform?.rotation?.z ?? DEFAULT_TRANSFORM.rotation.z,
    },
  };
}

function getTransformParameterValue(transform: ClipTransform, property: string): number | null {
  if (property === 'opacity') {
    return getFiniteNumber(transform.opacity);
  }

  if (property.startsWith('position.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    return getFiniteNumber(transform.position?.[axis]);
  }

  if (property.startsWith('scale.')) {
    const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
    if (axis === 'all') {
      return getFiniteNumber(transform.scale?.all ?? 1);
    }
    return getFiniteNumber(transform.scale?.[axis]);
  }

  if (property.startsWith('rotation.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    return getFiniteNumber(transform.rotation?.[axis]);
  }

  return null;
}

function resolveTransformParameterValue(clip: TimelineClip, property: string): number | null {
  const timelineStore = useTimelineStore.getState();

  if (property.startsWith('rotation.') && clip.source?.type === 'camera' && useEngineStore.getState().sceneNavNoKeyframes) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    const liveOverride = useEngineStore.getState().sceneCameraLiveOverrides[clip.id]?.rotation?.[axis];
    const liveValue = getFiniteNumber(liveOverride);
    if (liveValue !== null) {
      return liveValue;
    }
  }

  if (
    property === 'opacity' ||
    property.startsWith('position.') ||
    property.startsWith('scale.') ||
    property.startsWith('rotation.')
  ) {
    const animatableProperty = property as AnimatableProperty;
    if (
      timelineStore.hasKeyframes(clip.id, animatableProperty) ||
      timelineStore.isRecording(clip.id, animatableProperty)
    ) {
      const keyframes = timelineStore.clipKeyframes.get(clip.id) ?? [];
      const clipLocalTime = timelineStore.playheadPosition - (clip.startTime ?? 0);
      const baseTransform = getClipBaseTransform(clip);
      const interpolatedTransform = getInterpolatedClipTransform(
        keyframes,
        clipLocalTime,
        baseTransform,
        {
          rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear',
        },
      );

      return getTransformParameterValue(interpolatedTransform, property);
    }
  }

  if (property === 'opacity') {
    return getFiniteNumber(clip.transform?.opacity);
  }

  if (property.startsWith('position.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    return getFiniteNumber(clip.transform?.position?.[axis]);
  }

  if (property.startsWith('scale.')) {
    const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
    if (axis === 'all') {
      return getFiniteNumber(clip.transform?.scale?.all ?? 1);
    }
    return getFiniteNumber(clip.transform?.scale?.[axis]);
  }

  if (property.startsWith('rotation.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    if (clip.source?.type === 'camera' && useEngineStore.getState().sceneNavNoKeyframes) {
      const liveOverride = useEngineStore.getState().sceneCameraLiveOverrides[clip.id]?.rotation?.[axis];
      const liveValue = getFiniteNumber(liveOverride);
      if (liveValue !== null) {
        return liveValue;
      }
    }

    return getFiniteNumber(clip.transform?.rotation?.[axis]);
  }

  return null;
}

function resolveEffectParameterValue(clip: TimelineClip, property: string): number | null {
  if (!property.startsWith('effect.')) {
    return null;
  }

  const [, effectId, paramName] = property.split('.');
  if (!effectId || !paramName) {
    return null;
  }

  const effect = clip.effects?.find((candidate) => candidate.id === effectId);
  const baseValue = getFiniteNumber(effect?.params?.[paramName]);
  if (baseValue === null) {
    return null;
  }

  const timelineStore = useTimelineStore.getState();
  const animatableProperty = property as AnimatableProperty;
  if (
    timelineStore.hasKeyframes(clip.id, animatableProperty) ||
    timelineStore.isRecording(clip.id, animatableProperty)
  ) {
    const keyframes = timelineStore.clipKeyframes.get(clip.id) ?? [];
    const clipLocalTime = timelineStore.playheadPosition - (clip.startTime ?? 0);
    return interpolateKeyframes(keyframes, animatableProperty, clipLocalTime, baseValue);
  }

  return baseValue;
}

function resolveCustomMIDIParameterValue(clip: TimelineClip, property: string): number | null {
  if (property === 'speed') {
    const timelineStore = useTimelineStore.getState();
    if (
      timelineStore.hasKeyframes(clip.id, 'speed') ||
      timelineStore.isRecording(clip.id, 'speed')
    ) {
      return timelineStore.getInterpolatedSpeed(clip.id, timelineStore.playheadPosition - (clip.startTime ?? 0));
    }

    return getFiniteNumber(clip.speed);
  }

  if (property.startsWith('camera.') && clip.source?.type === 'camera') {
    const key = property.slice('camera.'.length);
    if (key === 'fov' || key === 'near' || key === 'far' || key === 'resolutionWidth' || key === 'resolutionHeight') {
      const timelineStore = useTimelineStore.getState();
      return getFiniteNumber(timelineStore.getInterpolatedCameraSettings(
        clip.id,
        timelineStore.playheadPosition - (clip.startTime ?? 0),
      )[key]);
    }
  }

  if (property.startsWith('gaussian.render.') && clip.source?.type === 'gaussian-splat') {
    const key = property.slice('gaussian.render.'.length) as keyof typeof DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
    const settings = clip.source.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
    return getFiniteNumber(settings.render[key]);
  }

  if (property.startsWith('splatEffector.') && clip.source?.type === 'splat-effector') {
    const key = property.slice('splatEffector.'.length) as keyof typeof DEFAULT_SPLAT_EFFECTOR_SETTINGS;
    const settings = clip.source.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS;
    return getFiniteNumber(settings[key]);
  }

  if (property.startsWith('text3d.')) {
    const key = property.slice('text3d.'.length) as keyof Text3DProperties;
    const text3DProperties = clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES;
    return getFiniteNumber(text3DProperties[key]);
  }

  if (property.startsWith('blendshape.') && clip.source?.type === 'gaussian-avatar') {
    const blendshapeName = property.slice('blendshape.'.length);
    return getFiniteNumber(clip.source.gaussianBlendshapes?.[blendshapeName]) ?? 0;
  }

  if (property.startsWith('mask.')) {
    const [, maskId, ...keyParts] = property.split('.');
    const key = keyParts.join('.');
    const mask = clip.masks?.find((candidate) => candidate.id === maskId);

    if (!mask) {
      return null;
    }

    if (key === 'opacity') {
      return getFiniteNumber(mask.opacity);
    }

    if (key === 'feather') {
      return getFiniteNumber(mask.feather);
    }

    if (key === 'featherQuality') {
      return getFiniteNumber(mask.featherQuality);
    }

    if (key === 'position.x') {
      return getFiniteNumber(mask.position?.x);
    }

    if (key === 'position.y') {
      return getFiniteNumber(mask.position?.y);
    }
  }

  return null;
}

export function resolveMIDIParameterCurrentValue(binding: MIDIParameterBinding, fallbackValue: number): number {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === binding.clipId);
  if (!clip) {
    return fallbackValue;
  }

  const value =
    resolveTransformParameterValue(clip, binding.property) ??
    resolveEffectParameterValue(clip, binding.property) ??
    resolveCustomMIDIParameterValue(clip, binding.property) ??
    getFiniteNumber(binding.currentValue);

  return value ?? fallbackValue;
}
