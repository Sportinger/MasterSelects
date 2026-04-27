import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore';
import type { AnimatableProperty, ClipTransform, TimelineClip } from '../../types';
import { resolveOrbitCameraTranslationForFixedEye } from '../gaussian/core/SplatCameraUtils';
import { getSharedSceneDefaultCameraDistance } from './SceneCameraUtils';
import type { SceneViewport } from './types';

export type CameraLookRotationAxis = 'x' | 'y' | 'z';
export type CameraLookRotationProperty = 'rotation.x' | 'rotation.y' | 'rotation.z';

export const CAMERA_LOOK_ROTATION_PROPERTIES: CameraLookRotationProperty[] = [
  'rotation.x',
  'rotation.y',
  'rotation.z',
];

export const CAMERA_POSE_TRANSFORM_PROPERTIES: AnimatableProperty[] = [
  'position.x',
  'position.y',
  'position.z',
  'scale.x',
  'scale.y',
  'scale.z',
  ...CAMERA_LOOK_ROTATION_PROPERTIES,
];

export interface CameraTransformPropertyUpdate {
  property: AnimatableProperty;
  value: number;
}

export function getCameraLookRotationAxis(property: string): CameraLookRotationAxis | null {
  if (property === 'rotation.x') return 'x';
  if (property === 'rotation.y') return 'y';
  if (property === 'rotation.z') return 'z';
  return null;
}

export function resolveCameraLookAtFixedEyeUpdates(
  clip: TimelineClip,
  transform: ClipTransform,
  rotationUpdate: Partial<Record<CameraLookRotationAxis, number>>,
  viewport: SceneViewport,
): CameraTransformPropertyUpdate[] | null {
  if (clip.source?.type !== 'camera') {
    return null;
  }

  const cameraSettings = clip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
  const nextRotation = {
    x: rotationUpdate.x ?? transform.rotation.x,
    y: rotationUpdate.y ?? transform.rotation.y,
    z: rotationUpdate.z ?? transform.rotation.z,
  };
  const translation = resolveOrbitCameraTranslationForFixedEye(
    {
      position: transform.position,
      scale: {
        ...transform.scale,
        z: transform.scale.z ?? 0,
      },
      rotation: transform.rotation,
    },
    nextRotation,
    {
      nearPlane: cameraSettings.near,
      farPlane: cameraSettings.far,
      fov: cameraSettings.fov,
      minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
    },
    viewport,
  );

  const updates: CameraTransformPropertyUpdate[] = [
    { property: 'position.x', value: translation.positionX },
    { property: 'position.y', value: translation.positionY },
    { property: 'scale.z', value: translation.forwardOffset },
  ];

  if (rotationUpdate.x !== undefined) {
    updates.push({ property: 'rotation.x', value: nextRotation.x });
  }
  if (rotationUpdate.y !== undefined) {
    updates.push({ property: 'rotation.y', value: nextRotation.y });
  }
  if (rotationUpdate.z !== undefined) {
    updates.push({ property: 'rotation.z', value: nextRotation.z });
  }

  return updates;
}

export function buildCameraTransformPatchFromUpdates(
  transform: ClipTransform,
  updates: CameraTransformPropertyUpdate[],
): Pick<ClipTransform, 'position' | 'scale' | 'rotation'> {
  const nextPosition = { ...transform.position };
  const nextScale = { ...transform.scale };
  const nextRotation = { ...transform.rotation };

  updates.forEach(({ property, value }) => {
    if (property === 'position.x') nextPosition.x = value;
    if (property === 'position.y') nextPosition.y = value;
    if (property === 'position.z') nextPosition.z = value;
    if (property === 'scale.x') nextScale.x = value;
    if (property === 'scale.y') nextScale.y = value;
    if (property === 'scale.z') nextScale.z = value;
    if (property === 'rotation.x') nextRotation.x = value;
    if (property === 'rotation.y') nextRotation.y = value;
    if (property === 'rotation.z') nextRotation.z = value;
  });

  return {
    position: nextPosition,
    scale: nextScale,
    rotation: nextRotation,
  };
}
