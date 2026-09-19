import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  resolveOrbitCameraFrame,
} from '../../engine/gaussian/core/SplatCameraUtils';
import type { SceneVector3 } from '../../engine/scene/types';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { useEngineStore } from '../../stores/engineStore';
import { usePreviewSceneNavigationPointerEffects } from './usePreviewSceneNavigationPointerEffects';

type EditCameraViewMode = 'camera' | 'front' | 'side' | 'top';
type CameraNavMoveCode = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE';

interface PreviewSize {
  width: number;
  height: number;
}

interface SceneNavCameraValues {
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  rotationX?: number;
  rotationY?: number;
}

interface OrbitStart {
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
}

interface PanStart {
  clipId: string | null;
  x: number;
  y: number;
  panX: number;
  panY: number;
  panZ: number;
}

interface FpsLookStart {
  clipId: string | null;
  x: number;
  y: number;
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

interface UsePreviewSceneNavigationOptions {
  applyNavigationCameraValues: (clip: TimelineClip, values: SceneNavCameraValues) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  editCameraModeActive: boolean;
  effectiveResolution: PreviewSize;
  endSceneNavHistoryBatch: () => void;
  finishGaussianKeyboardBatch: () => void;
  gaussianFpsLookStart: MutableRefObject<FpsLookStart>;
  gaussianWheelBatchTimerRef: MutableRefObject<number | null>;
  gaussianKeyboardBatchActiveRef: MutableRefObject<boolean>;
  gaussianKeyboardFrameRef: MutableRefObject<number | null>;
  gaussianKeyboardLastTimeRef: MutableRefObject<number | null>;
  gaussianKeyboardMoveCodesRef: MutableRefObject<Set<CameraNavMoveCode>>;
  gaussianOrbitStart: MutableRefObject<OrbitStart>;
  gaussianPanStart: MutableRefObject<PanStart>;
  getFreshSceneNavTransform: (clip: TimelineClip | null) => ClipTransform | null;
  getSceneNavPointerLockTarget: () => HTMLElement | null;
  getSceneNavSolveSettings: (clip: TimelineClip | null) => SceneNavSolveSettings | null;
  isGaussianFpsLooking: boolean;
  isGaussianOrbiting: boolean;
  isGaussianPanning: boolean;
  isPreviewShortcutTarget: () => boolean;
  navigationSceneNavClip: TimelineClip | null;
  sceneNavEnabled: boolean;
  sceneNavFpsMoveSpeed: number;
  setEditCameraView: (mode: EditCameraViewMode) => void;
  setIsEditCameraOrthoPanning: Dispatch<SetStateAction<boolean>>;
  setIsGaussianOrbiting: Dispatch<SetStateAction<boolean>>;
  setIsGaussianPanning: Dispatch<SetStateAction<boolean>>;
  startSceneNavHistoryBatch: (label: string) => void;
  stopGaussianFpsLook: (exitPointerLock?: boolean) => void;
  stopGaussianKeyboardLoop: () => void;
  stopGaussianKeyboardMovement: () => void;
}

interface PreviewSceneNavigationHandlers {
  handleSceneNavBlur: () => void;
  handleSceneNavKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleSceneNavKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

const CAMERA_NAV_MOVE_CODES = new Set<CameraNavMoveCode>(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
function isCameraNavMoveCode(code: string): code is CameraNavMoveCode {
  return CAMERA_NAV_MOVE_CODES.has(code as CameraNavMoveCode);
}

function addSceneVectors(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleSceneVector(vector: SceneVector3, scale: number): SceneVector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

interface SceneNavigationMoveBasis {
  right: SceneVector3;
  cameraUp: SceneVector3;
  forward: SceneVector3;
  distance: number;
}

export function resolveSceneNavigationKeyboardDelta(
  frame: SceneNavigationMoveBasis,
  input: { right: number; up: number; forward: number },
  deltaSeconds: number,
  speed: number,
): SceneVector3 {
  const inputMagnitude = Math.hypot(input.right, input.up, input.forward);
  if (inputMagnitude === 0) return { x: 0, y: 0, z: 0 };

  const movementStep = Math.max(0.15, frame.distance * 0.85) * deltaSeconds * speed;
  const normalizedStep = movementStep / Math.max(1, inputMagnitude);
  return addSceneVectors(
    addSceneVectors(
      scaleSceneVector(frame.right, input.right * normalizedStep),
      scaleSceneVector(frame.cameraUp, input.up * normalizedStep),
    ),
    scaleSceneVector(frame.forward, input.forward * normalizedStep),
  );
}

function getEditCameraViewModeFromKey(event: Pick<KeyboardEvent, 'code' | 'key'>): EditCameraViewMode | null {
  if (event.code === 'Digit1' || event.code === 'Numpad1' || event.key === '1') return 'front';
  if (event.code === 'Digit2' || event.code === 'Numpad2' || event.key === '2') return 'side';
  if (event.code === 'Digit3' || event.code === 'Numpad3' || event.key === '3') return 'top';
  if (event.code === 'Digit4' || event.code === 'Numpad4' || event.key === '4') return 'camera';
  return null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function usePreviewSceneNavigation({
  applyNavigationCameraValues,
  containerRef,
  editCameraModeActive,
  effectiveResolution,
  endSceneNavHistoryBatch,
  finishGaussianKeyboardBatch,
  gaussianFpsLookStart,
  gaussianWheelBatchTimerRef,
  gaussianKeyboardBatchActiveRef,
  gaussianKeyboardFrameRef,
  gaussianKeyboardLastTimeRef,
  gaussianKeyboardMoveCodesRef,
  gaussianOrbitStart,
  gaussianPanStart,
  getFreshSceneNavTransform,
  getSceneNavPointerLockTarget,
  getSceneNavSolveSettings,
  isGaussianFpsLooking,
  isGaussianOrbiting,
  isGaussianPanning,
  isPreviewShortcutTarget,
  navigationSceneNavClip,
  sceneNavEnabled,
  sceneNavFpsMoveSpeed,
  setEditCameraView,
  setIsEditCameraOrthoPanning,
  setIsGaussianOrbiting,
  setIsGaussianPanning,
  startSceneNavHistoryBatch,
  stopGaussianFpsLook,
  stopGaussianKeyboardLoop,
  stopGaussianKeyboardMovement,
}: UsePreviewSceneNavigationOptions): PreviewSceneNavigationHandlers {
  const tickGaussianKeyboardMovementRef = useRef<(timestamp: number) => void>(() => undefined);
  const tickGaussianKeyboardMovement = useCallback((timestamp: number) => {
    gaussianKeyboardFrameRef.current = null;

    if (!sceneNavEnabled || !navigationSceneNavClip || document.activeElement !== containerRef.current) {
      stopGaussianKeyboardMovement();
      return;
    }

    const activeCodes = gaussianKeyboardMoveCodesRef.current;
    if (activeCodes.size === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
      return;
    }

    const dt = gaussianKeyboardLastTimeRef.current === null
      ? 1 / 60
      : Math.min(0.05, (timestamp - gaussianKeyboardLastTimeRef.current) / 1000);
    gaussianKeyboardLastTimeRef.current = timestamp;

    const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
    if (!freshTransform) {
      stopGaussianKeyboardMovement();
      return;
    }

    const rightInput = (activeCodes.has('KeyD') ? 1 : 0) - (activeCodes.has('KeyA') ? 1 : 0);
    const upInput = (activeCodes.has('KeyE') ? 1 : 0) - (activeCodes.has('KeyQ') ? 1 : 0);
    const forwardInput = (activeCodes.has('KeyW') ? 1 : 0) - (activeCodes.has('KeyS') ? 1 : 0);

    if (rightInput === 0 && upInput === 0 && forwardInput === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
      return;
    }

    const clipSource = navigationSceneNavClip.source;
    if (!clipSource || clipSource.type !== 'camera') {
      stopGaussianKeyboardMovement();
      return;
    }
    const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
    if (!solveSettings) {
      stopGaussianKeyboardMovement();
      return;
    }
    const frame = resolveOrbitCameraFrame(
      freshTransform,
      solveSettings.settings,
      { width: effectiveResolution.width, height: effectiveResolution.height },
    );
    const positionDelta = resolveSceneNavigationKeyboardDelta(
      frame,
      { right: rightInput, up: upInput, forward: forwardInput },
      dt,
      sceneNavFpsMoveSpeed,
    );

    applyNavigationCameraValues(navigationSceneNavClip, {
      positionX: freshTransform.position.x + positionDelta.x,
      positionY: freshTransform.position.y + positionDelta.y,
      positionZ: freshTransform.position.z + positionDelta.z,
    });

    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovementRef.current);
  }, [
    applyNavigationCameraValues,
    containerRef,
    effectiveResolution.height,
    effectiveResolution.width,
    finishGaussianKeyboardBatch,
    gaussianKeyboardFrameRef,
    gaussianKeyboardLastTimeRef,
    gaussianKeyboardMoveCodesRef,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    navigationSceneNavClip,
    sceneNavEnabled,
    sceneNavFpsMoveSpeed,
    stopGaussianKeyboardLoop,
    stopGaussianKeyboardMovement,
  ]);

  useEffect(() => {
    tickGaussianKeyboardMovementRef.current = tickGaussianKeyboardMovement;
  }, [tickGaussianKeyboardMovement]);

  const startGaussianKeyboardMovement = useCallback(() => {
    if (gaussianKeyboardFrameRef.current !== null) return;
    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovement);
  }, [gaussianKeyboardFrameRef, tickGaussianKeyboardMovement]);

  const handleSceneNavKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!sceneNavEnabled || !navigationSceneNavClip) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!isCameraNavMoveCode(event.code)) return;

    event.preventDefault();
    useEngineStore.getState().setSceneNavOrbitTarget(null);

    if (!gaussianKeyboardBatchActiveRef.current) {
      startSceneNavHistoryBatch('Scene move');
      gaussianKeyboardBatchActiveRef.current = true;
    }

    gaussianKeyboardMoveCodesRef.current.add(event.code);
    startGaussianKeyboardMovement();
  }, [
    gaussianKeyboardBatchActiveRef,
    gaussianKeyboardMoveCodesRef,
    navigationSceneNavClip,
    sceneNavEnabled,
    startGaussianKeyboardMovement,
    startSceneNavHistoryBatch,
  ]);

  const handleSceneNavKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isCameraNavMoveCode(event.code)) return;

    event.preventDefault();
    gaussianKeyboardMoveCodesRef.current.delete(event.code);

    if (gaussianKeyboardMoveCodesRef.current.size === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
    }
  }, [finishGaussianKeyboardBatch, gaussianKeyboardMoveCodesRef, stopGaussianKeyboardLoop]);

  const handleSceneNavBlur = useCallback(() => {
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
    setIsEditCameraOrthoPanning(false);
  }, [setIsEditCameraOrthoPanning, stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    if (!editCameraModeActive) return;

    const handleEditCameraViewShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTextEntryTarget(event.target)) return;

      const mode = getEditCameraViewModeFromKey(event);
      if (!mode) return;
      if (!isPreviewShortcutTarget()) return;

      event.preventDefault();
      event.stopPropagation();
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
      setEditCameraView(mode);
      containerRef.current?.focus({ preventScroll: true });
    };

    window.addEventListener('keydown', handleEditCameraViewShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleEditCameraViewShortcut, { capture: true });
  }, [
    containerRef,
    editCameraModeActive,
    isPreviewShortcutTarget,
    setEditCameraView,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  ]);

  useEffect(() => {
    const gaussianOrbitStartState = gaussianOrbitStart.current;
    const gaussianPanStartState = gaussianPanStart.current;

    return () => {
      if (gaussianWheelBatchTimerRef.current !== null) {
        window.clearTimeout(gaussianWheelBatchTimerRef.current);
        gaussianWheelBatchTimerRef.current = null;
        endSceneNavHistoryBatch();
      }
      if (gaussianOrbitStartState.clipId) {
        gaussianOrbitStartState.clipId = null;
        endSceneNavHistoryBatch();
      }
      if (gaussianPanStartState.clipId) {
        gaussianPanStartState.clipId = null;
        endSceneNavHistoryBatch();
      }
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
    };
  }, [
    endSceneNavHistoryBatch,
    gaussianOrbitStart,
    gaussianPanStart,
    gaussianWheelBatchTimerRef,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  ]);

  usePreviewSceneNavigationPointerEffects({
    applyNavigationCameraValues,
    effectiveResolution,
    endSceneNavHistoryBatch,
    gaussianFpsLookStart,
    gaussianOrbitStart,
    gaussianPanStart,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    getSceneNavSolveSettings,
    isGaussianFpsLooking,
    isGaussianOrbiting,
    isGaussianPanning,
    navigationSceneNavClip,
    sceneNavEnabled,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  });

  return {
    handleSceneNavBlur,
    handleSceneNavKeyDown,
    handleSceneNavKeyUp,
  };
}
