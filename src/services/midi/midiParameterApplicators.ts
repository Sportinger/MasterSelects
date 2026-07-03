import {
  CAMERA_POSE_TRANSFORM_PROPERTIES,
  buildCameraTransformPatchFromUpdates,
  getCameraLookRotationAxis,
  resolveCameraLookAtFixedEyeUpdates,
} from '../../engine/scene/CameraClipControlUtils';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../engine/gaussian/types';
import { useEngineStore } from '../../stores/engineStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../stores/timeline/constants';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import type { AnimatableProperty } from '../../types/animationProperties';
import type { Text3DProperties } from '../../types/text';
import type { TimelineClip } from '../../types/timeline';
import type { MIDIParameterBinding } from '../../types/midi';
import { renderHostPort } from '../render/renderHostPort';
import { roundIntegerParameter } from './midiParameterUtils';

type ClipSource = NonNullable<TimelineClip['source']>;

function updateClipSource(
  clipId: string,
  updater: (source: ClipSource) => ClipSource | null
): boolean {
  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (!clip?.source) {
    return false;
  }

  const nextSource = updater(clip.source as ClipSource);
  if (!nextSource) {
    return false;
  }

  timelineStore.updateClip(clipId, { source: nextSource });
  timelineStore.invalidateCache();
  return true;
}

function applyCameraParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('camera.')) {
    return false;
  }

  const key = property.slice('camera.'.length);
  if (key !== 'fov' && key !== 'near' && key !== 'far' && key !== 'resolutionWidth' && key !== 'resolutionHeight') {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (clip?.source?.type !== 'camera') {
    return false;
  }

  timelineStore.setPropertyValue(clipId, property as AnimatableProperty, value);
  return true;
}

function applyCameraLookTransformParameter(clip: TimelineClip, property: string, value: number): boolean {
  if (clip.source?.type !== 'camera') {
    return false;
  }

  const rotationAxis = getCameraLookRotationAxis(property);
  if (!rotationAxis) {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const engineState = useEngineStore.getState();
  if (engineState.sceneNavNoKeyframes) {
    engineState.setSceneCameraLiveOverride(clip.id, {
      rotation: { [rotationAxis]: value },
    });
    renderHostPort.requestRender();
    return true;
  }

  const mediaStore = useMediaStore.getState();
  const activeComp = mediaStore.getActiveComposition?.()
    ?? (mediaStore.compositions ?? []).find((composition) => composition.id === mediaStore.activeCompositionId);
  const clipLocalTime = timelineStore.playheadPosition - (clip.startTime ?? 0);
  const currentTransform = timelineStore.getInterpolatedTransform(clip.id, clipLocalTime);
  const updates = resolveCameraLookAtFixedEyeUpdates(
    clip,
    currentTransform,
    { [rotationAxis]: value },
    {
      width: activeComp?.width ?? 1920,
      height: activeComp?.height ?? 1080,
    },
  );

  if (!updates) {
    return false;
  }

  const needsKeyframePath = updates.some(({ property: updateProperty }) =>
    timelineStore.hasKeyframes(clip.id, updateProperty) ||
    timelineStore.isRecording(clip.id, updateProperty),
  ) || CAMERA_POSE_TRANSFORM_PROPERTIES.some((poseProperty) =>
    timelineStore.hasKeyframes(clip.id, poseProperty) ||
    timelineStore.isRecording(clip.id, poseProperty),
  );

  if (needsKeyframePath) {
    updates.forEach(({ property: updateProperty, value: updateValue }) => {
      timelineStore.addKeyframe(clip.id, updateProperty, updateValue);
    });
  } else {
    timelineStore.updateClipTransform(
      clip.id,
      buildCameraTransformPatchFromUpdates(currentTransform, updates),
    );
  }

  return true;
}

function applyGaussianSplatParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('gaussian.render.')) {
    return false;
  }

  const key = property.slice('gaussian.render.'.length);
  if (
    key !== 'splatScale' &&
    key !== 'maxSplats' &&
    key !== 'sortFrequency' &&
    key !== 'nearPlane' &&
    key !== 'farPlane'
  ) {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'gaussian-splat') {
      return null;
    }

    const currentSettings = source.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
    return {
      ...source,
      gaussianSplatSettings: {
        ...currentSettings,
        render: {
          ...currentSettings.render,
          [key]: roundIntegerParameter(property, value),
        },
      },
    };
  });
}

function applySplatEffectorParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('splatEffector.')) {
    return false;
  }

  const key = property.slice('splatEffector.'.length);
  if (key !== 'strength' && key !== 'falloff' && key !== 'speed' && key !== 'seed') {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'splat-effector') {
      return null;
    }

    return {
      ...source,
      splatEffectorSettings: {
        ...(source.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS),
        [key]: roundIntegerParameter(property, value),
      },
    };
  });
}

function applyText3DParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('text3d.')) {
    return false;
  }

  const key = property.slice('text3d.'.length) as keyof Text3DProperties;
  const numericKeys = new Set<keyof Text3DProperties>([
    'size',
    'depth',
    'letterSpacing',
    'lineHeight',
    'curveSegments',
    'bevelThickness',
    'bevelSize',
    'bevelSegments',
  ]);

  if (!numericKeys.has(key)) {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return false;
  }

  const currentText3D = clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES;
  timelineStore.updateText3DProperties(clipId, {
    [key]: roundIntegerParameter(property, value),
  } as Partial<Text3DProperties>);

  return currentText3D !== null;
}

function applyBlendshapeParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('blendshape.')) {
    return false;
  }

  const blendshapeName = property.slice('blendshape.'.length);
  if (!blendshapeName) {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'gaussian-avatar') {
      return null;
    }

    const clampedValue = Math.max(0, Math.min(1, value));
    const nextBlendshapes = {
      ...(source.gaussianBlendshapes ?? {}),
      [blendshapeName]: clampedValue,
    };
    if (clampedValue === 0) {
      delete nextBlendshapes[blendshapeName];
    }

    return {
      ...source,
      gaussianBlendshapes: nextBlendshapes,
    };
  });
}

function applyMaskParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('mask.')) {
    return false;
  }

  const [, maskId, ...keyParts] = property.split('.');
  const key = keyParts.join('.');
  if (!maskId) {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  const mask = clip?.masks?.find((candidate) => candidate.id === maskId);
  if (!mask) {
    return false;
  }

  if (key === 'opacity') {
    timelineStore.updateMask(clipId, maskId, { opacity: value });
    return true;
  }

  if (key === 'feather') {
    timelineStore.updateMask(clipId, maskId, { feather: value });
    return true;
  }

  if (key === 'featherQuality') {
    timelineStore.updateMask(clipId, maskId, { featherQuality: roundIntegerParameter(property, value) });
    return true;
  }

  if (key === 'position.x') {
    timelineStore.updateMask(clipId, maskId, { position: { ...mask.position, x: value } });
    return true;
  }

  if (key === 'position.y') {
    timelineStore.updateMask(clipId, maskId, { position: { ...mask.position, y: value } });
    return true;
  }

  if (key.startsWith('edge.') && key.endsWith('.feather')) {
    timelineStore.setPropertyValue(clipId, property as AnimatableProperty, value);
    return true;
  }

  return false;
}

function applyCustomMIDIParameter(clip: TimelineClip, property: string, value: number): boolean {
  return (
    applyCameraLookTransformParameter(clip, property, value) ||
    applyCameraParameter(clip.id, property, value) ||
    applyGaussianSplatParameter(clip.id, property, value) ||
    applySplatEffectorParameter(clip.id, property, value) ||
    applyText3DParameter(clip.id, property, value) ||
    applyBlendshapeParameter(clip.id, property, value) ||
    applyMaskParameter(clip.id, property, value)
  );
}

export function applyMIDIParameterBindingValue(binding: MIDIParameterBinding, value: number): boolean {
  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === binding.clipId);
  if (!clip) {
    return false;
  }

  const properties = binding.properties && binding.properties.length > 0
    ? binding.properties
    : [binding.property];

  properties.forEach((property) => {
    if (applyCustomMIDIParameter(clip, property, value)) {
      return;
    }

    timelineStore.setPropertyValue(binding.clipId, property as AnimatableProperty, value);
  });

  return true;
}
