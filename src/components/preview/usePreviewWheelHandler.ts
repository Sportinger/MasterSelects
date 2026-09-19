import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
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
import {
  getPreviewPinchTranslation,
  isPreviewPinchWheelEvent,
  PREVIEW_PINCH_WHEEL_SENSITIVITY,
} from './usePreviewPinchZoom';
import {
  resolveSceneDollyAnimationStep,
  resolveSceneDollyImpulse,
} from './previewSceneDolly';

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

interface SceneDollyAnimation {
  clipId: string;
  lastFrameTime: number | null;
  remainingDistance: number;
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
  effectOrbitActive: boolean;
  gaussianFpsLookStart: MutableRefObject<{ clipId: string | null; x: number; y: number }>;
  gaussianKeyboardMoveCodesRef: MutableRefObject<Set<CameraMoveCode>>;
  getFreshSceneNavTransform: (clip: TimelineClip | null) => ClipTransform | null;
  handleEffectOrbitWheel: (event: PreviewWheelEvent) => boolean;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  minimumViewZoom: number;
  navigationSceneNavClip: TimelineClip | null;
  sceneNavEnabled: boolean;
  scheduleGaussianWheelBatchEnd: () => void;
  setEditCameraOrthoFrame: Dispatch<SetStateAction<EditCameraOrthoFrame | null>>;
  setSceneNavFpsMoveSpeed: (value: number) => void;
  setViewPan: Dispatch<SetStateAction<PreviewPoint>>;
  setViewZoom: Dispatch<SetStateAction<number>>;
  viewPan: PreviewPoint;
  viewNavigationEnabled: boolean;
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
  effectOrbitActive,
  gaussianFpsLookStart,
  gaussianKeyboardMoveCodesRef,
  getFreshSceneNavTransform,
  handleEffectOrbitWheel,
  isCanvasInteractionTarget,
  minimumViewZoom,
  navigationSceneNavClip,
  sceneNavEnabled,
  scheduleGaussianWheelBatchEnd,
  setEditCameraOrthoFrame,
  setSceneNavFpsMoveSpeed,
  setViewPan,
  setViewZoom,
  viewPan,
  viewNavigationEnabled,
  viewZoom,
}: UsePreviewWheelHandlerOptions): (event: PreviewWheelEvent) => void {
  const sceneDollyAnimationRef = useRef<SceneDollyAnimation | null>(null);
  const sceneDollyFrameRef = useRef<number | null>(null);
  const sceneDollyAnimationStepRef = useRef<(time: number) => void>(() => undefined);

  const stopSceneDollyAnimation = useCallback(() => {
    if (sceneDollyFrameRef.current !== null) {
      window.cancelAnimationFrame(sceneDollyFrameRef.current);
      sceneDollyFrameRef.current = null;
    }
    sceneDollyAnimationRef.current = null;
  }, []);

  const animateSceneDolly = useCallback((time: number) => {
    sceneDollyFrameRef.current = null;
    const animation = sceneDollyAnimationRef.current;
    if (!animation || navigationSceneNavClip?.id !== animation.clipId || !sceneNavEnabled) {
      stopSceneDollyAnimation();
      return;
    }

    const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
    if (!freshTransform) {
      stopSceneDollyAnimation();
      return;
    }

    const elapsedMs = animation.lastFrameTime === null
      ? 1000 / 60
      : time - animation.lastFrameTime;
    animation.lastFrameTime = time;
    const step = resolveSceneDollyAnimationStep(animation.remainingDistance, elapsedMs);
    animation.remainingDistance -= step;

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
    const positionDelta = scaleSceneVector(frame.forward, step);
    applyNavigationCameraValues(navigationSceneNavClip, {
      positionX: freshTransform.position.x + positionDelta.x,
      positionY: freshTransform.position.y + positionDelta.y,
      positionZ: freshTransform.position.z + positionDelta.z,
    });
    scheduleGaussianWheelBatchEnd();

    if (Math.abs(animation.remainingDistance) <= Number.EPSILON) {
      sceneDollyAnimationRef.current = null;
      return;
    }
    sceneDollyFrameRef.current = window.requestAnimationFrame(
      nextTime => sceneDollyAnimationStepRef.current(nextTime),
    );
  }, [
    applyNavigationCameraValues,
    editCameraClipIdRef,
    editCameraModeActive,
    editCameraSettingsRef,
    effectiveResolution.height,
    effectiveResolution.width,
    getFreshSceneNavTransform,
    navigationSceneNavClip,
    sceneNavEnabled,
    scheduleGaussianWheelBatchEnd,
    stopSceneDollyAnimation,
  ]);

  useEffect(() => {
    sceneDollyAnimationStepRef.current = animateSceneDolly;
  }, [animateSceneDolly]);

  useEffect(() => {
    stopSceneDollyAnimation();
  }, [navigationSceneNavClip?.id, sceneNavEnabled, stopSceneDollyAnimation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    container.addEventListener('pointerdown', stopSceneDollyAnimation, true);
    return () => {
      container.removeEventListener('pointerdown', stopSceneDollyAnimation, true);
      stopSceneDollyAnimation();
    };
  }, [containerRef, stopSceneDollyAnimation]);

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
    const zoomFactor = Math.exp(event.deltaY * PREVIEW_PINCH_WHEEL_SENSITIVITY);
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
    if (isSourceMonitorTarget(event.target)) {
      stopSceneDollyAnimation();
      return;
    }
    if (zoomEditCameraOrthoView(event)) {
      stopSceneDollyAnimation();
      return;
    }

    if (sceneNavEnabled && navigationSceneNavClip && isCanvasInteractionTarget(event.target)) {
      const engineState = useEngineStore.getState();
      const shouldAdjustFpsSpeed = (
        gaussianKeyboardMoveCodesRef.current.size > 0 ||
        gaussianFpsLookStart.current.clipId !== null
      );
      if (shouldAdjustFpsSpeed) {
        stopSceneDollyAnimation();
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
        if (direction !== 0) {
          setSceneNavFpsMoveSpeed(stepSceneNavFpsMoveSpeed(
            engineState.sceneNavFpsMoveSpeed,
            direction,
          ));
        }
        return;
      }

      event.preventDefault();

      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      if (!freshTransform) return;

      if (event.deltaY !== 0) {
        engineState.setSceneNavOrbitTarget(null);
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
        const existingAnimation = sceneDollyAnimationRef.current?.clipId === navigationSceneNavClip.id
          ? sceneDollyAnimationRef.current
          : null;
        const pendingDistance = existingAnimation?.remainingDistance ?? 0;
        const impulse = resolveSceneDollyImpulse(
          frame.distance,
          pendingDistance,
          event.deltaY,
          event.deltaMode,
        );
        if (impulse === 0) return;

        sceneDollyAnimationRef.current = existingAnimation
          ? { ...existingAnimation, remainingDistance: pendingDistance + impulse }
          : {
              clipId: navigationSceneNavClip.id,
              lastFrameTime: null,
              remainingDistance: impulse,
            };
        scheduleGaussianWheelBatchEnd();
        if (sceneDollyFrameRef.current === null) {
          sceneDollyFrameRef.current = window.requestAnimationFrame(
            time => sceneDollyAnimationStepRef.current(time),
          );
        }
      }
      return;
    }

    if (!event.altKey && effectOrbitActive && isCanvasInteractionTarget(event.target)) {
      stopSceneDollyAnimation();
      event.preventDefault();
      handleEffectOrbitWheel(event);
      return;
    }

    if (
      !viewNavigationEnabled
      || !containerRef.current
      || !isCanvasInteractionTarget(event.target)
    ) {
      stopSceneDollyAnimation();
      return;
    }

    stopSceneDollyAnimation();
    event.preventDefault();

    if (event.altKey) {
      setViewPan(prev => ({ x: prev.x - event.deltaY, y: prev.y }));
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const isPinch = isPreviewPinchWheelEvent(event as WheelEvent);
    const zoomFactor = isPinch
      ? Math.exp(-event.deltaY * PREVIEW_PINCH_WHEEL_SENSITIVITY)
      : event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(minimumViewZoom, Math.min(150, viewZoom * zoomFactor));
    if (minimumViewZoom >= 1 && newZoom === minimumViewZoom) {
      setViewZoom(minimumViewZoom);
      setViewPan({ x: 0, y: 0 });
      return;
    }
    const containerCenterX = containerSize.width / 2;
    const containerCenterY = containerSize.height / 2;
    const worldX = (mouseX - containerCenterX - viewPan.x) / viewZoom;
    const worldY = (mouseY - containerCenterY - viewPan.y) / viewZoom;
    const pinchTranslation = isPinch
      ? getPreviewPinchTranslation(event as WheelEvent)
      : { x: 0, y: 0 };
    const appliedZoomFactor = newZoom / viewZoom;
    const newPanX = mouseX - worldX * newZoom - containerCenterX
      + pinchTranslation.x * appliedZoomFactor;
    const newPanY = mouseY - worldY * newZoom - containerCenterY
      + pinchTranslation.y * appliedZoomFactor;

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
    effectOrbitActive,
    gaussianFpsLookStart,
    gaussianKeyboardMoveCodesRef,
    getFreshSceneNavTransform,
    handleEffectOrbitWheel,
    isCanvasInteractionTarget,
    minimumViewZoom,
    navigationSceneNavClip,
    sceneNavEnabled,
    scheduleGaussianWheelBatchEnd,
    setSceneNavFpsMoveSpeed,
    setViewPan,
    setViewZoom,
    stopSceneDollyAnimation,
    viewPan,
    viewNavigationEnabled,
    viewZoom,
    zoomEditCameraOrthoView,
  ]);
}
