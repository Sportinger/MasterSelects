import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

import { resolveSharedSceneCameraConfig } from '../../engine/scene/SceneCameraUtils';
import type { SceneCameraConfig, SceneVector3 } from '../../engine/scene/types';
import { renderHostPort } from '../../services/render/renderHostPort';
import { useEngineStore } from '../../stores/engineStore';
import type { SceneCameraSettings } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { cloneSceneVector, type EditCameraOrthoViewMode, type EditCameraViewMode } from './previewSceneCameraMath';
import {
  DEFAULT_EDIT_CAMERA_SETTINGS,
  EDIT_CAMERA_BLEND_MS,
  EDIT_CAMERA_VIEW_LABELS,
  buildEditCameraOrthographicConfig,
  buildPreviewCameraConfigFromTransform,
  cloneSceneCameraConfig,
  createDefaultEditCameraOrthoFrame,
  lerpSceneCameraConfig,
  type CameraProperty,
  type EditCameraOrthoFrame,
  type SceneNavCameraValues,
} from './usePreviewEditCameraConfig';
import { usePreviewSceneCameraActions } from './usePreviewSceneCameraActions';

interface PreviewSize { width: number; height: number }

interface UsePreviewEditCameraControllerOptions {
  activeCameraClipAtPlayhead: TimelineClip | null;
  addKeyframe: (clipId: string, property: CameraProperty, value: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  displayedCompId: string | null;
  editCameraModeActive: boolean;
  effectiveResolution: PreviewSize;
  endGaussianWheelBatch: () => void;
  endSceneNavHistoryBatch: () => void;
  gaussianOrbitStart: MutableRefObject<{ clipId: string | null }>;
  gaussianPanStart: MutableRefObject<{ clipId: string | null }>;
  hasKeyframes: (clipId: string, property: CameraProperty) => boolean;
  isRecording: (clipId: string, property: CameraProperty) => boolean;
  sceneNavNoKeyframes: boolean;
  setIsGaussianOrbiting: (value: boolean) => void;
  setIsGaussianPanning: (value: boolean) => void;
  setPreviewCameraOverride: (override: SceneCameraConfig | null) => void;
  stopGaussianFpsLook: () => void;
  stopGaussianKeyboardMovement: () => void;
  updateClipTransform: (clipId: string, transform: Partial<ClipTransform>) => void;
}

export function usePreviewEditCameraController({
  activeCameraClipAtPlayhead,
  addKeyframe,
  containerRef,
  displayedCompId,
  editCameraModeActive,
  effectiveResolution,
  endGaussianWheelBatch,
  endSceneNavHistoryBatch,
  gaussianOrbitStart: gaussianOrbitStartRef,
  gaussianPanStart: gaussianPanStartRef,
  hasKeyframes,
  isRecording,
  sceneNavNoKeyframes,
  setIsGaussianOrbiting,
  setIsGaussianPanning,
  setPreviewCameraOverride,
  stopGaussianFpsLook,
  stopGaussianKeyboardMovement,
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
  const editCameraOrthoPanStart = useRef({ x: 0, y: 0, center: { x: 0, y: 0, z: 0 } as SceneVector3, scale: 1, mode: 'front' as EditCameraOrthoViewMode });
  const editCameraOrthoMode: EditCameraOrthoViewMode | null = editCameraViewMode === 'camera' ? null : editCameraViewMode;
  const editCameraOrthoViewActive = editCameraModeActive && editCameraOrthoMode !== null;
  const activeEditCameraOrthoFrame = editCameraOrthoMode && activeCameraClipAtPlayhead && editCameraOrthoFrame?.clipId === activeCameraClipAtPlayhead.id && editCameraOrthoFrame.mode === editCameraOrthoMode
    ? editCameraOrthoFrame
    : null;
  const { applySceneCameraValues, getFreshSceneNavTransform, getSceneNavSolveSettings, resolveCameraClipTransformAtPlayhead } = usePreviewSceneCameraActions({
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

  const getEditSceneCameraConfig = useCallback((clip: TimelineClip | null = activeCameraClipAtPlayhead): SceneCameraConfig | null => {
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
  }, [activeCameraClipAtPlayhead, editCameraOrthoFrame, editCameraOrthoMode, effectiveResolution.height, effectiveResolution.width]);

  const stopEditCameraAnimation = useCallback(() => {
    if (editCameraAnimationRef.current === null) return;
    window.cancelAnimationFrame(editCameraAnimationRef.current);
    editCameraAnimationRef.current = null;
  }, []);

  const animatePreviewCameraOverride = useCallback((fromConfig: SceneCameraConfig, toConfig: SceneCameraConfig, clearAtEnd: boolean) => {
    stopEditCameraAnimation();
    const from = cloneSceneCameraConfig(fromConfig);
    const to = cloneSceneCameraConfig(toConfig);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const rawT = Math.min(1, (now - startedAt) / EDIT_CAMERA_BLEND_MS);
      setPreviewCameraOverride(lerpSceneCameraConfig(from, to, rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2));
      renderHostPort.requestRender();
      if (rawT < 1) {
        editCameraAnimationRef.current = window.requestAnimationFrame(tick);
        return;
      }
      editCameraAnimationRef.current = null;
      setPreviewCameraOverride(clearAtEnd ? null : cloneSceneCameraConfig(to));
      renderHostPort.requestRender();
    };
    setPreviewCameraOverride(cloneSceneCameraConfig(from));
    renderHostPort.requestRender();
    editCameraAnimationRef.current = window.requestAnimationFrame(tick);
  }, [setPreviewCameraOverride, stopEditCameraAnimation]);

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
      setPreviewCameraOverride(nextCameraConfig);
      renderHostPort.requestRender();
    }
  }, [
    applySceneCameraValues,
    editCameraModeActive,
    effectiveResolution.height,
    effectiveResolution.width,
    setPreviewCameraOverride,
    stopEditCameraAnimation,
  ]);

  const setEditCameraView = useCallback((mode: EditCameraViewMode) => {
    if (!activeCameraClipAtPlayhead || !editCameraTransformRef.current || mode === editCameraViewMode) return;
    const cameraConfig = buildPreviewCameraConfigFromTransform(
      activeCameraClipAtPlayhead,
      editCameraTransformRef.current,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
    );
    if (!cameraConfig) return;
    const fromConfig = useEngineStore.getState().previewCameraOverride ?? getEditSceneCameraConfig(activeCameraClipAtPlayhead);
    if (!fromConfig) return;
    let toConfig = cameraConfig;
    let nextFrame: EditCameraOrthoFrame | null = null;
    if (mode !== 'camera') {
      nextFrame = editCameraOrthoFrame?.clipId === activeCameraClipAtPlayhead.id
        ? { ...editCameraOrthoFrame, mode }
        : createDefaultEditCameraOrthoFrame(mode, activeCameraClipAtPlayhead.id, cameraConfig);
      toConfig = buildEditCameraOrthographicConfig(mode, nextFrame, cameraConfig);
    }
    editCameraViewTransitionRef.current = true;
    setEditCameraViewMode(mode);
    setEditCameraOrthoFrame(nextFrame);
    animatePreviewCameraOverride(fromConfig, toConfig, false);
  }, [
    activeCameraClipAtPlayhead,
    animatePreviewCameraOverride,
    editCameraOrthoFrame,
    editCameraViewMode,
    effectiveResolution.height,
    effectiveResolution.width,
    getEditSceneCameraConfig,
  ]);

  const focusEditCameraOnSceneObject = useCallback((object: {
    clipId: string;
    kind: string;
    worldPosition: SceneVector3;
  }): boolean => {
    if (
      !editCameraModeActive ||
      !activeCameraClipAtPlayhead ||
      !editCameraTransformRef.current ||
      object.kind === 'camera' ||
      object.clipId === activeCameraClipAtPlayhead.id
    ) {
      return false;
    }
    const currentTransform = editCameraTransformRef.current;
    const fromConfig = useEngineStore.getState().previewCameraOverride ?? getEditSceneCameraConfig(activeCameraClipAtPlayhead);
    const nextOrbitCenter = cloneSceneVector(object.worldPosition);
    const nextTransform: ClipTransform = {
      ...currentTransform,
      position: { ...currentTransform.position, x: 0, y: 0 },
      scale: { ...currentTransform.scale, z: 0 },
    };
    const nextCameraConfig = buildPreviewCameraConfigFromTransform(
      activeCameraClipAtPlayhead,
      nextTransform,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      nextOrbitCenter,
      editCameraSettingsRef.current,
    );
    if (!fromConfig || !nextCameraConfig) return false;
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
    endGaussianWheelBatch();
    if (gaussianOrbitStartRef.current.clipId) {
      gaussianOrbitStartRef.current.clipId = null;
      setIsGaussianOrbiting(false);
      endSceneNavHistoryBatch();
    }
    if (gaussianPanStartRef.current.clipId) {
      gaussianPanStartRef.current.clipId = null;
      setIsGaussianPanning(false);
      endSceneNavHistoryBatch();
    }
    setIsEditCameraOrthoPanning(false);
    containerRef.current?.focus({ preventScroll: true });
    editCameraOrbitCenterRef.current = nextOrbitCenter;
    editCameraTransformRef.current = nextTransform;
    let toConfig: SceneCameraConfig = nextCameraConfig;
    if (editCameraOrthoMode) {
      const baseFrame = activeEditCameraOrthoFrame
        ?? createDefaultEditCameraOrthoFrame(editCameraOrthoMode, activeCameraClipAtPlayhead.id, nextCameraConfig);
      const nextFrame: EditCameraOrthoFrame = { ...baseFrame, clipId: activeCameraClipAtPlayhead.id, mode: editCameraOrthoMode, center: cloneSceneVector(nextOrbitCenter) };
      editCameraViewTransitionRef.current = true;
      setEditCameraOrthoFrame(nextFrame);
      toConfig = buildEditCameraOrthographicConfig(editCameraOrthoMode, nextFrame, nextCameraConfig);
    }
    animatePreviewCameraOverride(fromConfig, toConfig, false);
    renderHostPort.requestRender();
    return true;
  }, [
    activeCameraClipAtPlayhead,
    activeEditCameraOrthoFrame,
    animatePreviewCameraOverride,
    containerRef,
    editCameraModeActive,
    editCameraOrthoMode,
    effectiveResolution.height,
    effectiveResolution.width,
    endGaussianWheelBatch,
    endSceneNavHistoryBatch,
    gaussianOrbitStartRef,
    gaussianPanStartRef,
    getEditSceneCameraConfig,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  ]);

  const activeEditCameraClipId = editCameraModeActive ? activeCameraClipAtPlayhead?.id ?? null : null;
  useEffect(() => {
    editCameraSettingsRef.current = { ...DEFAULT_EDIT_CAMERA_SETTINGS };
    editCameraOrbitCenterRef.current = null;
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
    if (editCameraModeActive && activeCameraClipAtPlayhead) {
      const clipChanged = editCameraClipIdRef.current !== activeCameraClipAtPlayhead.id;
      if (clipChanged || !editCameraTransformRef.current) {
        editCameraClipIdRef.current = activeCameraClipAtPlayhead.id;
        editCameraTransformRef.current = resolveCameraClipTransformAtPlayhead(activeCameraClipAtPlayhead);
      }
      const editCameraConfig = getEditSceneCameraConfig(activeCameraClipAtPlayhead);
      if (!editCameraConfig) return;
      editCameraModeActiveRef.current = true;
      if (!wasEditCameraModeActive || clipChanged) {
        const fromConfig = useEngineStore.getState().previewCameraOverride ?? getActualSceneCameraConfig();
        animatePreviewCameraOverride(fromConfig, editCameraConfig, false);
      } else if (editCameraViewTransitionRef.current) {
        editCameraViewTransitionRef.current = false;
      } else {
        setPreviewCameraOverride(editCameraConfig);
        renderHostPort.requestRender();
      }
      return;
    }
    editCameraModeActiveRef.current = false;
    if (wasEditCameraModeActive) {
      const fromConfig = useEngineStore.getState().previewCameraOverride ?? getActualSceneCameraConfig();
      animatePreviewCameraOverride(fromConfig, getActualSceneCameraConfig(), true);
    }
  }, [
    activeCameraClipAtPlayhead,
    animatePreviewCameraOverride,
    editCameraModeActive,
    getActualSceneCameraConfig,
    getEditSceneCameraConfig,
    resolveCameraClipTransformAtPlayhead,
    setPreviewCameraOverride,
  ]);

  useEffect(() => () => {
    stopEditCameraAnimation();
    setPreviewCameraOverride(null);
    renderHostPort.requestRender();
  }, [setPreviewCameraOverride, stopEditCameraAnimation]);

  const editCameraGizmoTransform = editCameraModeActive && activeCameraClipAtPlayhead ? resolveCameraClipTransformAtPlayhead(activeCameraClipAtPlayhead) : null;
  const editCameraOrthoHint = editCameraOrthoViewActive && activeEditCameraOrthoFrame ? `${EDIT_CAMERA_VIEW_LABELS[activeEditCameraOrthoFrame.mode]} Ortho | 1 Front | 2 Side | 3 Top | 4 Camera | Wheel Zoom | Shift+Drag/MMB Pan` : null;
  const sceneObjectWorldGridPlane: 'xy' | 'yz' | 'xz' = editCameraModeActive && editCameraViewMode === 'front'
    ? 'xy'
    : editCameraModeActive && editCameraViewMode === 'side'
      ? 'yz'
      : 'xz';

  return {
    activeEditCameraOrthoFrame,
    applyNavigationCameraValues,
    editCameraClipIdRef,
    editCameraGizmoTransform,
    editCameraModeActiveRef,
    editCameraOrthoFrame,
    editCameraOrthoHint,
    editCameraOrthoMode,
    editCameraOrthoPanStart,
    editCameraOrthoViewActive,
    editCameraSettingsRef,
    editCameraViewMode,
    focusEditCameraOnSceneObject,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    isEditCameraOrthoPanning,
    sceneObjectWorldGridPlane,
    setEditCameraOrthoFrame,
    setEditCameraView,
    setIsEditCameraOrthoPanning,
  };
}
