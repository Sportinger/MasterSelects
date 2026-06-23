import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import type React from 'react';

import { resolveOrbitCameraFrame } from '../../engine/gaussian/core/SplatCameraUtils';
import { renderHostPort } from '../../services/render/renderHostPort';
import {
  stepSceneNavFpsMoveSpeed,
  useEngineStore,
} from '../../stores/engineStore';
import type { SceneCameraSettings } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { SceneVector3 } from '../../engine/scene/types';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import {
  addSceneVectors,
  clampEditCameraOrthoScale,
  getEditCameraOrthoBasis,
  getSharedSceneDefaultCameraDistance,
  scaleSceneVector,
  type EditCameraOrthoViewMode,
} from './previewSceneCameraMath';

type PreviewWheelEvent = WheelEvent | React.WheelEvent;
type CameraMoveCode = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE';

interface PreviewSize {
  width: number;
  height: number;
}

interface PreviewPoint {
  x: number;
  y: number;
}

interface SceneNavCameraValues {
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  rotationX?: number;
  rotationY?: number;
}

interface EditCameraOrthoFrame {
  clipId: string;
  mode: EditCameraOrthoViewMode;
  center: SceneVector3;
  scale: number;
}

function isSourceMonitorTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.source-monitor') !== null;
}

interface UsePreviewWheelHandlerOptions {
  activeEditCameraOrthoFrame: EditCameraOrthoFrame | null;
  applyNavigationCameraValues: (clip: TimelineClip, values: SceneNavCameraValues) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasSize: PreviewSize;
  containerRef: RefObject<HTMLDivElement | null>;
  containerSize: PreviewSize;
  editCameraClipIdRef: MutableRefObject<string | null>;
  editCameraModeActive: boolean;
  editCameraOrthoMode: EditCameraOrthoViewMode | null;
  editCameraOrthoViewActive: boolean;
  editCameraSettingsRef: MutableRefObject<SceneCameraSettings>;
  effectiveResolution: PreviewSize;
  effectiveSceneNavFpsMode: boolean;
  freeCanvasNavigationMode: boolean;
  gaussianFpsLookStart: MutableRefObject<{ clipId: string | null; x: number; y: number }>;
  gaussianKeyboardMoveCodesRef: MutableRefObject<Set<CameraMoveCode>>;
  getFreshSceneNavTransform: (clip: TimelineClip | null) => ClipTransform | null;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  navigationSceneNavClip: TimelineClip | null;
  sceneNavEnabled: boolean;
  scheduleGaussianWheelBatchEnd: () => void;
  setEditCameraOrthoFrame: Dispatch<SetStateAction<EditCameraOrthoFrame | null>>;
  setSceneNavFpsMoveSpeed: (value: number) => void;
  setViewPan: Dispatch<SetStateAction<PreviewPoint>>;
  setViewZoom: Dispatch<SetStateAction<number>>;
  viewPan: PreviewPoint;
  viewZoom: number;
}

export function usePreviewWheelHandler({
  activeEditCameraOrthoFrame,
  applyNavigationCameraValues,
  canvasRef,
  canvasSize,
  containerRef,
  containerSize,
  editCameraClipIdRef,
  editCameraModeActive,
  editCameraOrthoMode,
  editCameraOrthoViewActive,
  editCameraSettingsRef,
  effectiveResolution,
  effectiveSceneNavFpsMode,
  freeCanvasNavigationMode,
  gaussianFpsLookStart,
  gaussianKeyboardMoveCodesRef,
  getFreshSceneNavTransform,
  isCanvasInteractionTarget,
  navigationSceneNavClip,
  sceneNavEnabled,
  scheduleGaussianWheelBatchEnd,
  setEditCameraOrthoFrame,
  setSceneNavFpsMoveSpeed,
  setViewPan,
  setViewZoom,
  viewPan,
  viewZoom,
}: UsePreviewWheelHandlerOptions): (event: PreviewWheelEvent) => void {
  const zoomEditCameraOrthoView = useCallback((event: PreviewWheelEvent): boolean => {
    if (!editCameraOrthoViewActive || !activeEditCameraOrthoFrame || !editCameraOrthoMode) return false;
    if (!isCanvasInteractionTarget(event.target)) return false;

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return false;

    event.preventDefault();
    const current = activeEditCameraOrthoFrame;
    const basis = getEditCameraOrthoBasis(editCameraOrthoMode);
    const aspect = Math.max(0.001, canvasSize.width / Math.max(1, canvasSize.height));
    const mouseX = Math.max(0, Math.min(canvasRect.width, event.clientX - canvasRect.left));
    const mouseY = Math.max(0, Math.min(canvasRect.height, event.clientY - canvasRect.top));
    const zoomFactor = Math.exp(event.deltaY * 0.0025);
    const nextScale = clampEditCameraOrthoScale(current.scale * zoomFactor);
    const currentRightOffset = (mouseX / canvasRect.width - 0.5) * current.scale * aspect;
    const currentUpOffset = (0.5 - mouseY / canvasRect.height) * current.scale;
    const nextRightOffset = (mouseX / canvasRect.width - 0.5) * nextScale * aspect;
    const nextUpOffset = (0.5 - mouseY / canvasRect.height) * nextScale;
    const worldUnderPointer = addSceneVectors(
      addSceneVectors(current.center, scaleSceneVector(basis.right, currentRightOffset)),
      scaleSceneVector(basis.up, currentUpOffset),
    );
    const nextCenter = addSceneVectors(
      addSceneVectors(worldUnderPointer, scaleSceneVector(basis.right, -nextRightOffset)),
      scaleSceneVector(basis.up, -nextUpOffset),
    );

    setEditCameraOrthoFrame({ ...current, center: nextCenter, scale: nextScale });
    renderHostPort.requestRender();
    return true;
  }, [
    activeEditCameraOrthoFrame,
    canvasRef,
    canvasSize.height,
    canvasSize.width,
    editCameraOrthoMode,
    editCameraOrthoViewActive,
    isCanvasInteractionTarget,
    setEditCameraOrthoFrame,
  ]);

  return useCallback((event: PreviewWheelEvent) => {
    if (isSourceMonitorTarget(event.target)) return;
    if (zoomEditCameraOrthoView(event)) return;

    if (sceneNavEnabled && navigationSceneNavClip && isCanvasInteractionTarget(event.target)) {
      const shouldAdjustFpsSpeed = effectiveSceneNavFpsMode && (
        gaussianKeyboardMoveCodesRef.current.size > 0 ||
        gaussianFpsLookStart.current.clipId !== null
      );
      if (shouldAdjustFpsSpeed) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
        if (direction !== 0) {
          setSceneNavFpsMoveSpeed(stepSceneNavFpsMoveSpeed(
            useEngineStore.getState().sceneNavFpsMoveSpeed,
            direction,
          ));
        }
        return;
      }

      event.preventDefault();
      scheduleGaussianWheelBatchEnd();

      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      if (!freshTransform) return;

      const direction = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
      if (direction !== 0) {
        const timelineState = useTimelineStore.getState();
        const cameraSettings = editCameraModeActive && navigationSceneNavClip.id === editCameraClipIdRef.current
          ? editCameraSettingsRef.current
          : timelineState.getInterpolatedCameraSettings(
              navigationSceneNavClip.id,
              timelineState.playheadPosition - navigationSceneNavClip.startTime,
            );
        const frame = resolveOrbitCameraFrame(
          freshTransform,
          {
            nearPlane: cameraSettings.near,
            farPlane: cameraSettings.far,
            fov: cameraSettings.fov,
            minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
          },
          { width: effectiveResolution.width, height: effectiveResolution.height },
        );
        const wheelAmount = Math.abs(event.deltaY);
        const dollyStep = Math.max(0.02, frame.distance * (Math.exp(wheelAmount * 0.0025) - 1));
        const positionDelta = scaleSceneVector(frame.forward, direction * dollyStep);
        applyNavigationCameraValues(navigationSceneNavClip, {
          positionX: freshTransform.position.x + positionDelta.x,
          positionY: freshTransform.position.y + positionDelta.y,
          positionZ: freshTransform.position.z + positionDelta.z,
        });
      }
      return;
    }

    if (!freeCanvasNavigationMode || !containerRef.current) return;

    event.preventDefault();

    if (event.altKey) {
      setViewPan(prev => ({ x: prev.x - event.deltaY, y: prev.y }));
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(150, viewZoom * zoomFactor));
    const containerCenterX = containerSize.width / 2;
    const containerCenterY = containerSize.height / 2;
    const worldX = (mouseX - containerCenterX - viewPan.x) / viewZoom;
    const worldY = (mouseY - containerCenterY - viewPan.y) / viewZoom;
    const newPanX = mouseX - worldX * newZoom - containerCenterX;
    const newPanY = mouseY - worldY * newZoom - containerCenterY;

    setViewZoom(newZoom);
    setViewPan({ x: newPanX, y: newPanY });
  }, [
    applyNavigationCameraValues,
    containerRef,
    containerSize,
    editCameraClipIdRef,
    editCameraModeActive,
    editCameraSettingsRef,
    effectiveResolution.height,
    effectiveResolution.width,
    effectiveSceneNavFpsMode,
    freeCanvasNavigationMode,
    gaussianFpsLookStart,
    gaussianKeyboardMoveCodesRef,
    getFreshSceneNavTransform,
    isCanvasInteractionTarget,
    navigationSceneNavClip,
    sceneNavEnabled,
    scheduleGaussianWheelBatchEnd,
    setSceneNavFpsMoveSpeed,
    setViewPan,
    setViewZoom,
    viewPan,
    viewZoom,
    zoomEditCameraOrthoView,
  ]);
}
