import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type React from 'react';

import { renderHostPort } from '../../services/render/renderHostPort';
import type { SceneVector3 } from '../../engine/scene/types';
import { useEngineStore } from '../../stores/engineStore';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import {
  addSceneVectors,
  cloneSceneVector,
  getEditCameraOrthoBasis,
  resolveSceneNavigationOrbit,
  scaleSceneVector,
  type EditCameraOrthoViewMode,
} from './previewSceneCameraMath';

interface PreviewSize {
  width: number;
  height: number;
}

interface PreviewPoint {
  x: number;
  y: number;
}

interface EditCameraOrthoFrame {
  clipId: string;
  mode: EditCameraOrthoViewMode;
  center: SceneVector3;
  scale: number;
}

interface SceneNavSolveSettings {
  settings: {
    nearPlane: number;
    farPlane: number;
    fov: number;
    minimumDistance: number;
  };
  sceneBounds?: { min: [number, number, number]; max: [number, number, number] };
}

interface UsePreviewMouseRoutingOptions {
  activeEditCameraOrthoFrame: EditCameraOrthoFrame | null;
  canvasSize: PreviewSize;
  containerRef: React.RefObject<HTMLDivElement | null>;
  editCameraOrthoMode: EditCameraOrthoViewMode | null;
  editCameraOrthoPanStart: MutableRefObject<{
    x: number;
    y: number;
    center: SceneVector3;
    scale: number;
    mode: EditCameraOrthoViewMode;
  }>;
  editCameraOrthoViewActive: boolean;
  effectOrbitActive: boolean;
  beginEffectOrbitDrag: (event: React.MouseEvent, mode: 'orbit' | 'pan') => void;
  endGaussianWheelBatch: () => void;
  gaussianFpsLookStart: MutableRefObject<{ clipId: string | null; x: number; y: number }>;
  gaussianOrbitStart: MutableRefObject<{
    clipId: string | null;
    x: number;
    y: number;
    pitch: number;
    yaw: number;
    roll: number;
    startPosX: number;
    startPosY: number;
    startPosZ: number;
    pivotX: number;
    pivotY: number;
    pivotZ: number;
    radius: number;
    localOffsetX?: number;
    localOffsetY?: number;
    localOffsetZ?: number;
  }>;
  gaussianPanStart: MutableRefObject<{ clipId: string | null; x: number; y: number; panX: number; panY: number; panZ: number }>;
  getFreshSceneNavTransform: (clip: TimelineClip | null) => ClipTransform | null;
  getSceneNavPointerLockTarget: () => HTMLElement | null;
  getSceneNavSolveSettings: (clip: TimelineClip | null) => SceneNavSolveSettings | null;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  isEditCameraOrthoPanning: boolean;
  isPanning: boolean;
  isSceneObjectInteractionTarget: (target: EventTarget | null) => boolean;
  navigationSceneNavClip: TimelineClip | null;
  panStart: MutableRefObject<{ x: number; y: number; panX: number; panY: number }>;
  sceneNavEnabled: boolean;
  setEditCameraOrthoFrame: Dispatch<SetStateAction<EditCameraOrthoFrame | null>>;
  setIsEditCameraOrthoPanning: Dispatch<SetStateAction<boolean>>;
  setIsGaussianFpsLooking: Dispatch<SetStateAction<boolean>>;
  setIsGaussianOrbiting: Dispatch<SetStateAction<boolean>>;
  setIsGaussianPanning: Dispatch<SetStateAction<boolean>>;
  setIsPanning: Dispatch<SetStateAction<boolean>>;
  setViewPan: Dispatch<SetStateAction<PreviewPoint>>;
  setViewZoom: Dispatch<SetStateAction<number>>;
  startSceneNavHistoryBatch: (label: string) => void;
  stopGaussianFpsLook: (exitPointerLock?: boolean) => void;
  stopGaussianKeyboardMovement: () => void;
  viewPan: PreviewPoint;
  viewNavigationEnabled: boolean;
}

interface PreviewMouseRoutingHandlers {
  handleMouseDown: (event: React.MouseEvent) => void;
  handleMouseMove: (event: React.MouseEvent) => void;
  handleMouseUp: () => void;
  resetView: () => void;
}

export function usePreviewMouseRouting({
  activeEditCameraOrthoFrame,
  canvasSize,
  containerRef,
  editCameraOrthoMode,
  editCameraOrthoPanStart: editCameraOrthoPanStartRef,
  editCameraOrthoViewActive,
  effectOrbitActive,
  beginEffectOrbitDrag,
  endGaussianWheelBatch,
  gaussianFpsLookStart: gaussianFpsLookStartRef,
  gaussianOrbitStart: gaussianOrbitStartRef,
  gaussianPanStart: gaussianPanStartRef,
  getFreshSceneNavTransform,
  getSceneNavPointerLockTarget,
  getSceneNavSolveSettings,
  isCanvasInteractionTarget,
  isEditCameraOrthoPanning,
  isPanning,
  isSceneObjectInteractionTarget,
  navigationSceneNavClip,
  panStart: panStartRef,
  sceneNavEnabled,
  setEditCameraOrthoFrame,
  setIsEditCameraOrthoPanning,
  setIsGaussianFpsLooking,
  setIsGaussianOrbiting,
  setIsGaussianPanning,
  setIsPanning,
  setViewPan,
  setViewZoom,
  startSceneNavHistoryBatch,
  stopGaussianFpsLook,
  stopGaussianKeyboardMovement,
  viewPan,
  viewNavigationEnabled,
}: UsePreviewMouseRoutingOptions): PreviewMouseRoutingHandlers {
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<PreviewPoint | null>(null);

  const flushPendingPan = useCallback(() => {
    if (panFrameRef.current !== null) {
      window.cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
    const pendingPan = pendingPanRef.current;
    pendingPanRef.current = null;
    if (pendingPan) {
      setViewPan(pendingPan);
    }
  }, [setViewPan]);

  useEffect(() => () => {
    if (panFrameRef.current !== null) {
      window.cancelAnimationFrame(panFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isEditCameraOrthoPanning) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const { x, y, center, scale, mode } = editCameraOrthoPanStartRef.current;
      const basis = getEditCameraOrthoBasis(mode);
      const worldPerPixel = scale / Math.max(1, canvasSize.height);
      const dx = event.clientX - x;
      const dy = event.clientY - y;
      const nextCenter = addSceneVectors(
        addSceneVectors(center, scaleSceneVector(basis.right, -dx * worldPerPixel)),
        scaleSceneVector(basis.up, dy * worldPerPixel),
      );

      setEditCameraOrthoFrame((current) => (
        current?.mode === mode ? { ...current, center: nextCenter } : current
      ));
      renderHostPort.requestRender();
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      setIsEditCameraOrthoPanning(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [canvasSize.height, editCameraOrthoPanStartRef, isEditCameraOrthoPanning, setEditCameraOrthoFrame, setIsEditCameraOrthoPanning]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (isCanvasInteractionTarget(event.target)) {
      containerRef.current?.focus({ preventScroll: true });
    }
    if (isSceneObjectInteractionTarget(event.target)) return;

    if (
      editCameraOrthoViewActive &&
      activeEditCameraOrthoFrame &&
      editCameraOrthoMode &&
      isCanvasInteractionTarget(event.target) &&
      (event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey))
    ) {
      event.preventDefault();
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
      editCameraOrthoPanStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        center: cloneSceneVector(activeEditCameraOrthoFrame.center),
        scale: activeEditCameraOrthoFrame.scale,
        mode: editCameraOrthoMode,
      };
      setIsEditCameraOrthoPanning(true);
      return;
    }

    if (sceneNavEnabled && navigationSceneNavClip && isCanvasInteractionTarget(event.target)) {
      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      if (!freshTransform) return;

      if (event.button === 0) {
        if (event.shiftKey) {
          event.preventDefault();
          useEngineStore.getState().setSceneNavOrbitTarget(null);
          endGaussianWheelBatch();
          startSceneNavHistoryBatch('Scene pan');
          gaussianPanStartRef.current = {
            clipId: navigationSceneNavClip.id,
            x: event.clientX,
            y: event.clientY,
            panX: freshTransform.position.x,
            panY: freshTransform.position.y,
            panZ: freshTransform.position.z,
          };
          setIsGaussianPanning(true);
          return;
        }
        event.preventDefault();
        endGaussianWheelBatch();
        const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
        if (!solveSettings) return;
        startSceneNavHistoryBatch('Scene orbit');
        const orbitTarget = useEngineStore.getState().sceneNavOrbitTarget;
        const { pivot, radius, localOffset } = resolveSceneNavigationOrbit(
          freshTransform,
          solveSettings.settings,
          { width: canvasSize.width, height: canvasSize.height },
          solveSettings.sceneBounds,
          orbitTarget?.pivot,
        );
        gaussianOrbitStartRef.current = {
          clipId: navigationSceneNavClip.id,
          x: event.clientX,
          y: event.clientY,
          pitch: freshTransform.rotation.x,
          yaw: freshTransform.rotation.y,
          roll: freshTransform.rotation.z,
          startPosX: freshTransform.position.x,
          startPosY: freshTransform.position.y,
          startPosZ: freshTransform.position.z,
          pivotX: pivot.x,
          pivotY: pivot.y,
          pivotZ: pivot.z,
          radius,
          localOffsetX: localOffset.x,
          localOffsetY: localOffset.y,
          localOffsetZ: localOffset.z,
        };
        setIsGaussianOrbiting(true);
        return;
      }

      if (event.button === 1) {
        event.preventDefault();
        useEngineStore.getState().setSceneNavOrbitTarget(null);
        endGaussianWheelBatch();
        startSceneNavHistoryBatch('Scene pan');
        gaussianPanStartRef.current = {
          clipId: navigationSceneNavClip.id,
          x: event.clientX,
          y: event.clientY,
          panX: freshTransform.position.x,
          panY: freshTransform.position.y,
          panZ: freshTransform.position.z,
        };
        setIsGaussianPanning(true);
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        endGaussianWheelBatch();
        startSceneNavHistoryBatch('Scene look');
        gaussianFpsLookStartRef.current = {
          clipId: navigationSceneNavClip.id,
          x: event.clientX,
          y: event.clientY,
        };
        getSceneNavPointerLockTarget()?.requestPointerLock?.();
        setIsGaussianFpsLooking(true);
        return;
      }
    }

    if (effectOrbitActive && event.button === 0 && isCanvasInteractionTarget(event.target)) {
      event.preventDefault();
      beginEffectOrbitDrag(event, event.shiftKey ? 'pan' : 'orbit');
      return;
    }

    if (!viewNavigationEnabled || !isCanvasInteractionTarget(event.target)) return;

    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      setIsPanning(true);
      panStartRef.current = { x: event.clientX, y: event.clientY, panX: viewPan.x, panY: viewPan.y };
    }
  }, [
    activeEditCameraOrthoFrame,
    beginEffectOrbitDrag,
    canvasSize.height,
    canvasSize.width,
    containerRef,
    editCameraOrthoMode,
    editCameraOrthoPanStartRef,
    editCameraOrthoViewActive,
    effectOrbitActive,
    endGaussianWheelBatch,
    gaussianFpsLookStartRef,
    gaussianOrbitStartRef,
    gaussianPanStartRef,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    getSceneNavSolveSettings,
    isCanvasInteractionTarget,
    isSceneObjectInteractionTarget,
    navigationSceneNavClip,
    panStartRef,
    sceneNavEnabled,
    setIsEditCameraOrthoPanning,
    setIsGaussianFpsLooking,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    setIsPanning,
    startSceneNavHistoryBatch,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
    viewPan.x,
    viewPan.y,
    viewNavigationEnabled,
  ]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;
    pendingPanRef.current = { x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy };
    if (panFrameRef.current !== null) return;
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null;
      const pendingPan = pendingPanRef.current;
      pendingPanRef.current = null;
      if (pendingPan) {
        setViewPan(pendingPan);
      }
    });
  }, [isPanning, panStartRef, setViewPan]);

  const handleMouseUp = useCallback(() => {
    flushPendingPan();
    setIsPanning(false);
    setIsEditCameraOrthoPanning(false);
  }, [flushPendingPan, setIsEditCameraOrthoPanning, setIsPanning]);

  const resetView = useCallback(() => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }, [setViewPan, setViewZoom]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    resetView,
  };
}
