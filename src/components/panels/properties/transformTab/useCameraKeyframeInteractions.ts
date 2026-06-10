import { useCallback } from 'react';

import {
  CAMERA_POSE_TRANSFORM_PROPERTIES,
  buildCameraTransformPatchFromUpdates,
  resolveCameraLookAtFixedEyeUpdates,
  type CameraLookRotationAxis,
  type CameraTransformPropertyUpdate,
} from '../../../../engine/scene/CameraClipControlUtils';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import type { SceneCameraSettings } from '../../../../stores/mediaStore/types';

type TransformKeyframeProperty =
  | CameraTransformPropertyUpdate['property']
  | 'camera.fov'
  | 'camera.near'
  | 'camera.far'
  | 'camera.resolutionWidth'
  | 'camera.resolutionHeight'
  | 'scale.all'
  | 'scale.x'
  | 'scale.y'
  | 'scale.z';

const CAMERA_TRANSFORM_KEYFRAME_PROPERTIES: TransformKeyframeProperty[] = [
  'camera.fov',
  'camera.near',
  'camera.far',
  'camera.resolutionWidth',
  'camera.resolutionHeight',
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
];

const CAMERA_RESET_KEYFRAME_PROPERTIES: TransformKeyframeProperty[] = [
  ...CAMERA_TRANSFORM_KEYFRAME_PROPERTIES,
  'scale.all',
  'scale.x',
  'scale.y',
  'scale.z',
];

interface UseCameraKeyframeInteractionsOptions {
  clip: Parameters<typeof resolveCameraLookAtFixedEyeUpdates>[0] | undefined;
  clipId: string;
  compWidth: number;
  compHeight: number;
  transform: Parameters<typeof buildCameraTransformPatchFromUpdates>[0];
  cameraSettings: SceneCameraSettings;
  cameraResolutionWidth: number;
  cameraResolutionHeight: number;
  usesCameraControls: boolean;
  hasKeyframes: (clipId: string, property: TransformKeyframeProperty) => boolean;
  isRecording: (clipId: string, property: TransformKeyframeProperty) => boolean;
  addKeyframe: (clipId: string, property: TransformKeyframeProperty, value: number) => void;
  removeKeyframe: (keyframeId: string) => void;
  getClipKeyframes: (clipId: string) => Array<{ id: string; property: TransformKeyframeProperty }>;
  toggleKeyframeRecording: (clipId: string, property: TransformKeyframeProperty) => void;
  onPropertyChange: (property: TransformKeyframeProperty, value: number) => void;
  updateCameraTransform: (patch: ReturnType<typeof buildCameraTransformPatchFromUpdates>) => void;
}

export function useCameraKeyframeInteractions({
  clip,
  clipId,
  compWidth,
  compHeight,
  transform,
  cameraSettings,
  cameraResolutionWidth,
  cameraResolutionHeight,
  usesCameraControls,
  hasKeyframes,
  isRecording,
  addKeyframe,
  removeKeyframe,
  getClipKeyframes,
  toggleKeyframeRecording,
  onPropertyChange,
  updateCameraTransform,
}: UseCameraKeyframeInteractionsOptions) {
  const applyCameraPropertyUpdates = useCallback((updates: CameraTransformPropertyUpdate[]) => {
    const needsKeyframePath = updates.some(({ property }) =>
      hasKeyframes(clipId, property) || isRecording(clipId, property),
    ) || CAMERA_POSE_TRANSFORM_PROPERTIES.some((property) =>
      hasKeyframes(clipId, property) || isRecording(clipId, property),
    );

    if (needsKeyframePath) {
      updates.forEach(({ property, value }) => addKeyframe(clipId, property, value));
      return;
    }

    updateCameraTransform(buildCameraTransformPatchFromUpdates(transform, updates));
  }, [
    addKeyframe,
    clipId,
    hasKeyframes,
    isRecording,
    transform,
    updateCameraTransform,
  ]);

  const handleCameraLookRotationChange = useCallback((axis: CameraLookRotationAxis, value: number) => {
    if (!clip || clip.source?.type !== 'camera') {
      onPropertyChange(`rotation.${axis}` as TransformKeyframeProperty, value);
      return;
    }

    const updates = resolveCameraLookAtFixedEyeUpdates(
      clip,
      transform,
      { [axis]: value },
      { width: compWidth, height: compHeight },
      cameraSettings,
    );
    if (!updates) {
      onPropertyChange(`rotation.${axis}` as TransformKeyframeProperty, value);
      return;
    }

    applyCameraPropertyUpdates(updates);
  }, [
    applyCameraPropertyUpdates,
    cameraSettings,
    clip,
    compHeight,
    compWidth,
    onPropertyChange,
    transform,
  ]);

  const handleSetAllCameraKeyframes = useCallback(() => {
    if (!usesCameraControls) return;

    const entries: Array<{ property: TransformKeyframeProperty; value: number }> = [
      { property: 'camera.fov', value: cameraSettings.fov },
      { property: 'camera.near', value: cameraSettings.near },
      { property: 'camera.far', value: cameraSettings.far },
      { property: 'camera.resolutionWidth', value: cameraResolutionWidth },
      { property: 'camera.resolutionHeight', value: cameraResolutionHeight },
      { property: 'position.x', value: transform.position.x },
      { property: 'position.y', value: transform.position.y },
      { property: 'position.z', value: transform.position.z },
      { property: 'rotation.x', value: transform.rotation.x },
      { property: 'rotation.y', value: transform.rotation.y },
      { property: 'rotation.z', value: transform.rotation.z },
    ];

    startBatch('Set camera keyframes');
    try {
      entries.forEach(({ property, value }) => {
        if (!isRecording(clipId, property)) {
          toggleKeyframeRecording(clipId, property);
        }
        addKeyframe(clipId, property, value);
      });
    } finally {
      endBatch();
    }
  }, [
    addKeyframe,
    cameraResolutionHeight,
    cameraResolutionWidth,
    cameraSettings.far,
    cameraSettings.fov,
    cameraSettings.near,
    clipId,
    isRecording,
    toggleKeyframeRecording,
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    usesCameraControls,
  ]);

  const clearCameraKeyframesAndStopwatches = useCallback(() => {
    const resetProperties = new Set(CAMERA_RESET_KEYFRAME_PROPERTIES);

    getClipKeyframes(clipId)
      .filter((keyframe) => resetProperties.has(keyframe.property))
      .forEach((keyframe) => removeKeyframe(keyframe.id));

    CAMERA_RESET_KEYFRAME_PROPERTIES.forEach((property) => {
      if (isRecording(clipId, property)) {
        toggleKeyframeRecording(clipId, property);
      }
    });
  }, [
    clipId,
    getClipKeyframes,
    isRecording,
    removeKeyframe,
    toggleKeyframeRecording,
  ]);

  return {
    clearCameraKeyframesAndStopwatches,
    handleCameraLookRotationChange,
    handleSetAllCameraKeyframes,
  };
}
