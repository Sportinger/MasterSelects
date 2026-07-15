import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveSharedSceneCameraConfig } from '../../engine/scene/SceneCameraUtils';
import type { SceneCameraConfig, SceneVector3 } from '../../engine/scene/types';
import { renderHostPort } from '../../services/render/renderHostPort';
import type { SceneCameraSettings } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { type EditCameraOrthoViewMode, type EditCameraViewMode } from './previewSceneCameraMath';
import {
  DEFAULT_EDIT_CAMERA_SETTINGS,
  EDIT_CAMERA_BLEND_MS,
  EDIT_CAMERA_VIEW_LABELS,
  buildEditCameraOrthographicConfig,
  buildPreviewCameraConfigFromTransform,
  cloneSceneCameraConfig,
  createDefaultEditorCameraTransform,
  createDefaultEditCameraOrthoFrame,
  lerpSceneCameraConfig,
  type CameraProperty,
  type EditCameraOrthoFrame,
  type SceneNavCameraValues,
} from './usePreviewEditCameraConfig';
import { usePreviewSceneCameraActions } from './usePreviewSceneCameraActions';

interface PreviewSize { width: number; height: number }

interface UsePreviewEditCameraControllerOptions {
  editCameraClip: TimelineClip;
  addKeyframe: (clipId: string, property: CameraProperty, value: number) => void;
  displayedCompId: string | null;
  editCameraModeActive: boolean;
  effectiveResolution: PreviewSize;
  hasKeyframes: (clipId: string, property: CameraProperty) => boolean;
  isRecording: (clipId: string, property: CameraProperty) => boolean;
  previewCameraOverride: SceneCameraConfig | null;
  sceneNavNoKeyframes: boolean;
  setPreviewCameraOverride: (override: SceneCameraConfig | null) => void;
  updateClipTransform: (clipId: string, transform: Partial<ClipTransform>) => void;
}

export function usePreviewEditCameraController({
  editCameraClip,
  addKeyframe,
  displayedCompId,
  editCameraModeActive,
  effectiveResolution,
  hasKeyframes,
  isRecording,
  previewCameraOverride,
  sceneNavNoKeyframes,
  setPreviewCameraOverride,
  updateClipTransform,
}: UsePreviewEditCameraControllerOptions) {
  const [editCameraViewMode, setEditCameraViewMode] = useState<EditCameraViewMode>('camera');
  const [editCameraOrthoFrame, setEditCameraOrthoFrame] = useState<EditCameraOrthoFrame | null>(null);
  const [isEditCameraOrthoPanning, setIsEditCameraOrthoPanning] = useState(false);
  const editCameraTransformRef = useRef<ClipTransform | null>(null);
  const editCameraClipIdRef = useRef<string | null>(null);
  const editCameraSettingsRef = useRef<SceneCameraSettings>({ ...DEFAULT_EDIT_CAMERA_SETTINGS });
  const editCameraOrbitCenterRef = useRef<SceneVector3 | null>(null);
  const editCameraAnimationRef = useRef<number | null>(null);
  const editCameraViewTransitionRef = useRef(false);
  const editCameraModeActiveRef = useRef(false);
  const previewCameraOverrideRef = useRef<SceneCameraConfig | null>(previewCameraOverride);
  useEffect(() => {
    previewCameraOverrideRef.current = previewCameraOverride;
  }, [previewCameraOverride]);
  const editCameraOrthoPanStart = useRef({ x: 0, y: 0, center: { x: 0, y: 0, z: 0 } as SceneVector3, scale: 1, mode: 'front' as EditCameraOrthoViewMode });
  const editCameraOrthoMode: EditCameraOrthoViewMode | null = editCameraViewMode === 'camera' ? null : editCameraViewMode;
  const editCameraOrthoViewActive = editCameraModeActive && editCameraOrthoMode !== null;
  const activeEditCameraOrthoFrame = editCameraOrthoMode && editCameraOrthoFrame?.clipId === editCameraClip.id && editCameraOrthoFrame.mode === editCameraOrthoMode
    ? editCameraOrthoFrame
    : null;
  const { applySceneCameraValues, getFreshSceneNavTransform, getSceneNavSolveSettings } = usePreviewSceneCameraActions({
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
  });

  const getActualSceneCameraConfig = useCallback((): SceneCameraConfig => resolveSharedSceneCameraConfig(
    { width: effectiveResolution.width, height: effectiveResolution.height },
    useTimelineStore.getState().playheadPosition,
    {
      clips: useTimelineStore.getState().clips,
      tracks: useTimelineStore.getState().tracks,
      clipKeyframes: useTimelineStore.getState().clipKeyframes,
      compositionId: displayedCompId,
      sceneNavClipId: null,
      previewCameraOverride: null,
    },
  ), [displayedCompId, effectiveResolution.height, effectiveResolution.width]);

  const getEditSceneCameraConfig = useCallback((clip: TimelineClip = editCameraClip): SceneCameraConfig | null => {
    if (!clip || !editCameraTransformRef.current) return null;
    const cameraConfig = buildPreviewCameraConfigFromTransform(
      clip,
      editCameraTransformRef.current,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
    );
    if (!cameraConfig) return null;
    return editCameraOrthoMode && editCameraOrthoFrame?.clipId === clip.id && editCameraOrthoFrame.mode === editCameraOrthoMode
      ? buildEditCameraOrthographicConfig(editCameraOrthoMode, editCameraOrthoFrame, cameraConfig)
      : cameraConfig;
  }, [editCameraClip, editCameraOrthoFrame, editCameraOrthoMode, effectiveResolution.height, effectiveResolution.width]);

  const stopEditCameraAnimation = useCallback(() => {
    if (editCameraAnimationRef.current === null) return;
    window.cancelAnimationFrame(editCameraAnimationRef.current);
    editCameraAnimationRef.current = null;
  }, []);

  const updatePreviewCameraOverride = useCallback((camera: SceneCameraConfig | null) => {
    previewCameraOverrideRef.current = camera;
    setPreviewCameraOverride(camera);
  }, [setPreviewCameraOverride]);

  const animatePreviewCameraOverride = useCallback((
    fromConfig: SceneCameraConfig,
    toConfig: SceneCameraConfig,
    clearAtEnd: boolean,
    durationMs = EDIT_CAMERA_BLEND_MS,
  ) => {
    stopEditCameraAnimation();
    const from = cloneSceneCameraConfig(fromConfig);
    const to = cloneSceneCameraConfig(toConfig);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const rawT = Math.min(1, (now - startedAt) / durationMs);
      updatePreviewCameraOverride(lerpSceneCameraConfig(from, to, rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2));
      renderHostPort.requestRender();
      if (rawT < 1) {
        editCameraAnimationRef.current = window.requestAnimationFrame(tick);
        return;
      }
      editCameraAnimationRef.current = null;
      updatePreviewCameraOverride(clearAtEnd ? null : cloneSceneCameraConfig(to));
      renderHostPort.requestRender();
    };
    updatePreviewCameraOverride(cloneSceneCameraConfig(from));
    renderHostPort.requestRender();
    editCameraAnimationRef.current = window.requestAnimationFrame(tick);
  }, [stopEditCameraAnimation, updatePreviewCameraOverride]);

  const applyNavigationCameraValues = useCallback((clip: TimelineClip, values: SceneNavCameraValues) => {
    if (!editCameraModeActive || clip.id !== editCameraClipIdRef.current || !editCameraTransformRef.current) {
      applySceneCameraValues(clip.id, values);
      return;
    }
    stopEditCameraAnimation();
    const current = editCameraTransformRef.current;
    const next: ClipTransform = {
      ...current,
      position: {
        x: values.positionX ?? current.position.x,
        y: values.positionY ?? current.position.y,
        z: values.positionZ ?? current.position.z,
      },
      scale: {
        all: current.scale.all ?? 1,
        x: current.scale.x,
        y: current.scale.y,
        ...(current.scale.z !== undefined ? { z: current.scale.z } : {}),
      },
      rotation: {
        x: values.rotationX ?? current.rotation.x,
        y: values.rotationY ?? current.rotation.y,
        z: current.rotation.z,
      },
    };
    editCameraTransformRef.current = next;
    const nextCameraConfig = buildPreviewCameraConfigFromTransform(
      clip,
      next,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
    );
    if (nextCameraConfig) {
      updatePreviewCameraOverride(nextCameraConfig);
      renderHostPort.requestRender();
    }
  }, [
    applySceneCameraValues,
    editCameraModeActive,
    effectiveResolution.height,
    effectiveResolution.width,
    stopEditCameraAnimation,
    updatePreviewCameraOverride,
  ]);

  const setEditCameraView = useCallback((mode: EditCameraViewMode) => {
    if (!editCameraTransformRef.current) return;
    const cameraConfig = buildPreviewCameraConfigFromTransform(
      editCameraClip,
      editCameraTransformRef.current,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
    );
    if (!cameraConfig) return;
    const fromConfig = previewCameraOverrideRef.current ?? getEditSceneCameraConfig(editCameraClip);
    if (!fromConfig) return;
    let toConfig = cameraConfig;
    let nextFrame: EditCameraOrthoFrame | null = null;
    if (mode !== 'camera') {
      nextFrame = editCameraOrthoFrame?.clipId === editCameraClip.id
        ? { ...editCameraOrthoFrame, mode }
        : createDefaultEditCameraOrthoFrame(mode, editCameraClip.id, cameraConfig);
      toConfig = buildEditCameraOrthographicConfig(mode, nextFrame, cameraConfig);
    }
    editCameraViewTransitionRef.current = true;
    setEditCameraViewMode(mode);
    setEditCameraOrthoFrame(nextFrame);
    animatePreviewCameraOverride(fromConfig, toConfig, false);
  }, [
    animatePreviewCameraOverride,
    editCameraClip,
    editCameraOrthoFrame,
    effectiveResolution.height,
    effectiveResolution.width,
    getEditSceneCameraConfig,
  ]);

  const activeEditCameraClipId = editCameraModeActive ? editCameraClip.id : null;
  useEffect(() => {
    editCameraSettingsRef.current = { ...DEFAULT_EDIT_CAMERA_SETTINGS };
    editCameraOrbitCenterRef.current = null;
    if (activeEditCameraClipId) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      setEditCameraViewMode('camera');
      setEditCameraOrthoFrame(null);
      setIsEditCameraOrthoPanning(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeEditCameraClipId]);

  useEffect(() => {
    const wasEditCameraModeActive = editCameraModeActiveRef.current;
    if (editCameraModeActive) {
      const clipChanged = editCameraClipIdRef.current !== editCameraClip.id;
      if (clipChanged || !editCameraTransformRef.current) {
        editCameraClipIdRef.current = editCameraClip.id;
        const sceneCamera = getActualSceneCameraConfig();
        editCameraTransformRef.current = createDefaultEditorCameraTransform(
          sceneCamera,
          editCameraClip.transform,
        );
        editCameraOrbitCenterRef.current = { x: 0, y: 0, z: 0 };
      }
      const editCameraConfig = getEditSceneCameraConfig(editCameraClip);
      if (!editCameraConfig) return;
      editCameraModeActiveRef.current = true;
      if (!wasEditCameraModeActive || clipChanged) {
        const fromConfig = previewCameraOverrideRef.current ?? getActualSceneCameraConfig();
        animatePreviewCameraOverride(fromConfig, editCameraConfig, false);
      } else if (editCameraViewTransitionRef.current) {
        editCameraViewTransitionRef.current = false;
      } else {
        updatePreviewCameraOverride(editCameraConfig);
        renderHostPort.requestRender();
      }
      return;
    }
    editCameraModeActiveRef.current = false;
    if (wasEditCameraModeActive) {
      const fromConfig = previewCameraOverrideRef.current ?? getActualSceneCameraConfig();
      animatePreviewCameraOverride(fromConfig, getActualSceneCameraConfig(), true);
    }
  }, [
    animatePreviewCameraOverride,
    editCameraClip,
    editCameraModeActive,
    getActualSceneCameraConfig,
    getEditSceneCameraConfig,
    updatePreviewCameraOverride,
  ]);

  useEffect(() => () => {
    stopEditCameraAnimation();
    updatePreviewCameraOverride(null);
    renderHostPort.requestRender();
  }, [stopEditCameraAnimation, updatePreviewCameraOverride]);

  const editCameraOrthoHint = editCameraOrthoViewActive && activeEditCameraOrthoFrame ? `${EDIT_CAMERA_VIEW_LABELS[activeEditCameraOrthoFrame.mode]} Ortho | 1 Front | 2 Side | 3 Top | 4 Perspective | Wheel Zoom | Shift+Drag/MMB Pan` : null;
  const sceneObjectWorldGridPlane: 'xy' | 'yz' | 'xz' = editCameraModeActive && editCameraViewMode === 'front'
    ? 'xy'
    : editCameraModeActive && editCameraViewMode === 'side'
      ? 'yz'
      : 'xz';

  return {
    activeEditCameraOrthoFrame,
    applyNavigationCameraValues,
    editCameraClipIdRef,
    editCameraModeActiveRef,
    editCameraOrthoFrame,
    editCameraOrthoHint,
    editCameraOrthoMode,
    editCameraOrthoPanStart,
    editCameraOrthoViewActive,
    editCameraSettingsRef,
    editCameraViewMode,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    isEditCameraOrthoPanning,
    sceneObjectWorldGridPlane,
    setEditCameraOrthoFrame,
    setEditCameraView,
    setIsEditCameraOrthoPanning,
  };
}
