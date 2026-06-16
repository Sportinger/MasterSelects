import { useCallback, type MutableRefObject } from 'react';

import { renderHostPort } from '../../services/render/renderHostPort';
import { useEngineStore } from '../../stores/engineStore';
import type { SceneCameraSettings } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { SceneVector3 } from '../../engine/scene/types';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { getSharedSceneDefaultCameraDistance } from './previewSceneCameraMath';
import {
  applySceneCameraLiveOverrideToTransform,
  buildEditCameraOrbitSceneBounds,
  cloneClipTransform,
  type CameraProperty,
  type SceneNavCameraValues,
} from './usePreviewEditCameraConfig';

interface UsePreviewSceneCameraActionsOptions {
  addKeyframe: (clipId: string, property: CameraProperty, value: number) => void;
  editCameraClipIdRef: MutableRefObject<string | null>;
  editCameraModeActive: boolean;
  editCameraModeActiveRef: MutableRefObject<boolean>;
  editCameraOrbitCenterRef: MutableRefObject<SceneVector3 | null>;
  editCameraSettingsRef: MutableRefObject<SceneCameraSettings>;
  editCameraTransformRef: MutableRefObject<ClipTransform | null>;
  hasKeyframes: (clipId: string, property: CameraProperty) => boolean;
  isRecording: (clipId: string, property: CameraProperty) => boolean;
  sceneNavNoKeyframes: boolean;
  updateClipTransform: (clipId: string, transform: Partial<ClipTransform>) => void;
}

export function usePreviewSceneCameraActions({
  addKeyframe,
  editCameraClipIdRef,
  editCameraModeActive,
  editCameraModeActiveRef,
  editCameraOrbitCenterRef,
  editCameraSettingsRef,
  editCameraTransformRef,
  hasKeyframes,
  isRecording,
  sceneNavNoKeyframes,
  updateClipTransform,
}: UsePreviewSceneCameraActionsOptions) {
  const resolveCameraClipTransformAtPlayhead = useCallback((clip: TimelineClip): ClipTransform => {
    const { playheadPosition: ph, getInterpolatedTransform } = useTimelineStore.getState();
    return cloneClipTransform(getInterpolatedTransform(clip.id, ph - clip.startTime));
  }, []);

  const getFreshSceneNavTransform = useCallback((clip: TimelineClip | null) => {
    if (!clip) return null;
    if (editCameraModeActive && editCameraTransformRef.current && clip.id === editCameraClipIdRef.current) {
      return cloneClipTransform(editCameraTransformRef.current);
    }
    const { playheadPosition: ph, getInterpolatedTransform } = useTimelineStore.getState();
    const transform = getInterpolatedTransform(clip.id, ph - clip.startTime);
    return sceneNavNoKeyframes
      ? applySceneCameraLiveOverrideToTransform(transform, useEngineStore.getState().sceneCameraLiveOverrides[clip.id])
      : transform;
  }, [editCameraClipIdRef, editCameraModeActive, editCameraTransformRef, sceneNavNoKeyframes]);

  const applySceneCameraValues = useCallback((clipId: string, values: SceneNavCameraValues) => {
    const engineState = useEngineStore.getState();
    const timelineState = useTimelineStore.getState();
    const clip = timelineState.clips.find((candidate) => candidate.id === clipId);
    if (engineState.sceneNavNoKeyframes && clip?.source?.type === 'camera') {
      const baseTransform = timelineState.getInterpolatedTransform(clipId, timelineState.playheadPosition - clip.startTime);
      engineState.setSceneCameraLiveOverride(clipId, {
        ...(values.positionX !== undefined || values.positionY !== undefined || values.positionZ !== undefined
          ? {
              position: {
                ...(values.positionX !== undefined ? { x: values.positionX - baseTransform.position.x } : {}),
                ...(values.positionY !== undefined ? { y: values.positionY - baseTransform.position.y } : {}),
                ...(values.positionZ !== undefined ? { z: values.positionZ - baseTransform.position.z } : {}),
              },
            }
          : {}),
        ...(values.rotationX !== undefined || values.rotationY !== undefined
          ? {
              rotation: {
                ...(values.rotationX !== undefined ? { x: values.rotationX - baseTransform.rotation.x } : {}),
                ...(values.rotationY !== undefined ? { y: values.rotationY - baseTransform.rotation.y } : {}),
              },
            }
          : {}),
      });
      renderHostPort.requestRender();
      return;
    }

    const propertyUpdates: Array<readonly [CameraProperty, number]> = [];
    if (values.positionX !== undefined) propertyUpdates.push(['position.x', values.positionX]);
    if (values.positionY !== undefined) propertyUpdates.push(['position.y', values.positionY]);
    if (values.positionZ !== undefined) propertyUpdates.push(['position.z', values.positionZ]);
    if (values.rotationX !== undefined) propertyUpdates.push(['rotation.x', values.rotationX]);
    if (values.rotationY !== undefined) propertyUpdates.push(['rotation.y', values.rotationY]);

    if (propertyUpdates.some(([property]) => hasKeyframes(clipId, property) || isRecording(clipId, property))) {
      for (const [property, value] of propertyUpdates) addKeyframe(clipId, property, value);
    } else {
      const currentTransform = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)?.transform;
      updateClipTransform(clipId, {
        ...(values.positionX !== undefined || values.positionY !== undefined || values.positionZ !== undefined
          ? {
              position: {
                x: values.positionX ?? currentTransform?.position.x ?? 0,
                y: values.positionY ?? currentTransform?.position.y ?? 0,
                z: values.positionZ ?? currentTransform?.position.z ?? 0,
              },
            }
          : {}),
        ...(values.rotationX !== undefined || values.rotationY !== undefined
          ? {
              rotation: {
                x: values.rotationX ?? currentTransform?.rotation.x ?? 0,
                y: values.rotationY ?? currentTransform?.rotation.y ?? 0,
                z: currentTransform?.rotation.z ?? 0,
              },
            }
          : {}),
      });
    }
    renderHostPort.requestRender();
  }, [addKeyframe, hasKeyframes, isRecording, updateClipTransform]);

  const getSceneNavSolveSettings = useCallback((clip: TimelineClip | null) => {
    if (clip?.source?.type !== 'camera') return null;
    const timelineState = useTimelineStore.getState();
    const cameraSettings = editCameraModeActiveRef.current && clip.id === editCameraClipIdRef.current
      ? editCameraSettingsRef.current
      : timelineState.getInterpolatedCameraSettings(clip.id, timelineState.playheadPosition - clip.startTime);
    return {
      settings: {
        nearPlane: cameraSettings.near,
        farPlane: cameraSettings.far,
        fov: cameraSettings.fov,
        minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
      },
      sceneBounds: editCameraModeActiveRef.current && clip.id === editCameraClipIdRef.current
        ? buildEditCameraOrbitSceneBounds(editCameraOrbitCenterRef.current)
        : undefined,
    };
  }, [editCameraClipIdRef, editCameraModeActiveRef, editCameraOrbitCenterRef, editCameraSettingsRef]);

  return {
    applySceneCameraValues,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    resolveCameraClipTransformAtPlayhead,
  };
}
