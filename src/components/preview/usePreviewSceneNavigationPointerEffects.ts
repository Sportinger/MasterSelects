import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  resolveOrbitCameraFrame,
  resolveOrbitCameraTranslationForFixedEye,
} from '../../engine/gaussian/core/SplatCameraUtils';
import type { SceneVector3 } from '../../engine/scene/types';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';

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

interface UsePreviewSceneNavigationPointerEffectsOptions {
  applyNavigationCameraValues: (clip: TimelineClip, values: SceneNavCameraValues) => void;
  effectiveResolution: PreviewSize;
  effectiveSceneNavFpsMode: boolean;
  endSceneNavHistoryBatch: () => void;
  gaussianFpsLookStart: MutableRefObject<FpsLookStart>;
  gaussianOrbitStart: MutableRefObject<OrbitStart>;
  gaussianPanStart: MutableRefObject<PanStart>;
  getFreshSceneNavTransform: (clip: TimelineClip | null) => ClipTransform | null;
  getSceneNavPointerLockTarget: () => HTMLElement | null;
  getSceneNavSolveSettings: (clip: TimelineClip | null) => SceneNavSolveSettings | null;
  isGaussianFpsLooking: boolean;
  isGaussianOrbiting: boolean;
  isGaussianPanning: boolean;
  navigationSceneNavClip: TimelineClip | null;
  sceneNavEnabled: boolean;
  setIsGaussianOrbiting: Dispatch<SetStateAction<boolean>>;
  setIsGaussianPanning: Dispatch<SetStateAction<boolean>>;
  stopGaussianFpsLook: (exitPointerLock?: boolean) => void;
  stopGaussianKeyboardMovement: () => void;
}

const CAMERA_NAV_FPS_LOOK_SPEED = 0.18;

function addSceneVectors(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleSceneVector(vector: SceneVector3, scale: number): SceneVector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function usePreviewSceneNavigationPointerEffects({
  applyNavigationCameraValues,
  effectiveResolution,
  effectiveSceneNavFpsMode,
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
}: UsePreviewSceneNavigationPointerEffectsOptions): void {
  useEffect(() => {
    if (sceneNavEnabled) return;
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
    if (isGaussianOrbiting) {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endSceneNavHistoryBatch();
    }
    if (isGaussianPanning) {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endSceneNavHistoryBatch();
    }
  }, [
    endSceneNavHistoryBatch,
    gaussianOrbitStart,
    gaussianPanStart,
    isGaussianOrbiting,
    isGaussianPanning,
    sceneNavEnabled,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  ]);

  useEffect(() => {
    if (effectiveSceneNavFpsMode) {
      if (isGaussianOrbiting) {
        gaussianOrbitStart.current.clipId = null;
        setIsGaussianOrbiting(false);
        endSceneNavHistoryBatch();
      }
      return;
    }

    if (isGaussianFpsLooking) {
      stopGaussianFpsLook();
    }
  }, [
    effectiveSceneNavFpsMode,
    endSceneNavHistoryBatch,
    gaussianOrbitStart,
    isGaussianFpsLooking,
    isGaussianOrbiting,
    setIsGaussianOrbiting,
    stopGaussianFpsLook,
  ]);

  useEffect(() => {
    if (!isGaussianOrbiting) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      const {
        clipId,
        x,
        y,
        pitch,
        yaw,
        roll,
        startPosX,
        startPosY,
        startPosZ,
        pivotX,
        pivotY,
        pivotZ,
        radius,
      } = gaussianOrbitStart.current;
      if (!clipId) return;
      if (!navigationSceneNavClip || navigationSceneNavClip.id !== clipId) return;

      const dx = event.clientX - x;
      const dy = event.clientY - y;
      const nextPitch = pitch + dy * 0.25;
      const nextYaw = yaw - dx * 0.25;
      const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);

      let nextPosition = { x: startPosX, y: startPosY, z: startPosZ };
      if (solveSettings && radius > 1e-6) {
        const frame = resolveOrbitCameraFrame(
          {
            position: { x: startPosX, y: startPosY, z: startPosZ },
            scale: { all: 1, x: 1, y: 1 },
            rotation: { x: nextPitch, y: nextYaw, z: roll },
          },
          solveSettings.settings,
          { width: effectiveResolution.width, height: effectiveResolution.height },
          solveSettings.sceneBounds,
        );
        nextPosition = {
          x: pivotX - frame.forward.x * radius,
          y: pivotY - frame.forward.y * radius,
          z: pivotZ - frame.forward.z * radius,
        };
      }

      applyNavigationCameraValues(navigationSceneNavClip, {
        positionX: nextPosition.x,
        positionY: nextPosition.y,
        positionZ: nextPosition.z,
        rotationX: nextPitch,
        rotationY: nextYaw,
      });
    };

    const finishGaussianOrbit = () => {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endSceneNavHistoryBatch();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianOrbit);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianOrbit);
    };
  }, [
    applyNavigationCameraValues,
    effectiveResolution.height,
    effectiveResolution.width,
    endSceneNavHistoryBatch,
    gaussianOrbitStart,
    getSceneNavSolveSettings,
    isGaussianOrbiting,
    navigationSceneNavClip,
    setIsGaussianOrbiting,
  ]);

  useEffect(() => {
    if (!isGaussianFpsLooking || !navigationSceneNavClip) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      const { clipId, x, y } = gaussianFpsLookStart.current;
      if (!clipId) return;

      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
      if (!freshTransform || !solveSettings) return;

      const pointerLockTarget = getSceneNavPointerLockTarget();
      const pointerLockActive = pointerLockTarget !== null && document.pointerLockElement === pointerLockTarget;
      const deltaX = pointerLockActive ? event.movementX : event.clientX - x;
      const deltaY = pointerLockActive ? event.movementY : event.clientY - y;

      if (!pointerLockActive) {
        gaussianFpsLookStart.current.x = event.clientX;
        gaussianFpsLookStart.current.y = event.clientY;
      }

      if (deltaX === 0 && deltaY === 0) return;

      const nextPitch = freshTransform.rotation.x + deltaY * CAMERA_NAV_FPS_LOOK_SPEED;
      const nextYaw = freshTransform.rotation.y - deltaX * CAMERA_NAV_FPS_LOOK_SPEED;
      const nextTranslation = resolveOrbitCameraTranslationForFixedEye(
        freshTransform,
        {
          x: nextPitch,
          y: nextYaw,
          z: freshTransform.rotation.z,
        },
        solveSettings.settings,
        { width: effectiveResolution.width, height: effectiveResolution.height },
        solveSettings.sceneBounds,
      );

      applyNavigationCameraValues(navigationSceneNavClip, {
        positionX: nextTranslation.positionX,
        positionY: nextTranslation.positionY,
        positionZ: nextTranslation.positionZ,
        rotationX: nextPitch,
        rotationY: nextYaw,
      });
    };

    const finishGaussianFpsLook = () => {
      stopGaussianFpsLook();
    };

    const handlePointerLockChange = () => {
      const pointerLockTarget = getSceneNavPointerLockTarget();
      const pointerLockActive = pointerLockTarget !== null && document.pointerLockElement === pointerLockTarget;
      if (!pointerLockActive && gaussianFpsLookStart.current.clipId) {
        stopGaussianFpsLook(false);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianFpsLook);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianFpsLook);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [
    applyNavigationCameraValues,
    effectiveResolution.height,
    effectiveResolution.width,
    gaussianFpsLookStart,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    getSceneNavSolveSettings,
    isGaussianFpsLooking,
    navigationSceneNavClip,
    stopGaussianFpsLook,
  ]);

  useEffect(() => {
    if (!isGaussianPanning) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      const { clipId, x, y, panX, panY, panZ } = gaussianPanStart.current;
      if (!clipId) return;
      if (!navigationSceneNavClip || navigationSceneNavClip.id !== clipId) return;

      const dx = event.clientX - x;
      const dy = event.clientY - y;
      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
      if (!freshTransform || !solveSettings) return;

      const frame = resolveOrbitCameraFrame(
        {
          ...freshTransform,
          position: { x: panX, y: panY, z: panZ },
        },
        solveSettings.settings,
        { width: effectiveResolution.width, height: effectiveResolution.height },
        solveSettings.sceneBounds,
      );
      const worldPerPixel = (2 * frame.distance * Math.tan(((frame.fovDegrees * Math.PI) / 180) * 0.5)) /
        Math.max(1, effectiveResolution.height);
      const positionDelta = addSceneVectors(
        scaleSceneVector(frame.right, -dx * worldPerPixel),
        scaleSceneVector(frame.cameraUp, dy * worldPerPixel),
      );

      applyNavigationCameraValues(navigationSceneNavClip, {
        positionX: panX + positionDelta.x,
        positionY: panY + positionDelta.y,
        positionZ: panZ + positionDelta.z,
      });
    };

    const finishGaussianPan = () => {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endSceneNavHistoryBatch();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianPan);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianPan);
    };
  }, [
    applyNavigationCameraValues,
    effectiveResolution.height,
    effectiveResolution.width,
    endSceneNavHistoryBatch,
    gaussianPanStart,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    isGaussianPanning,
    navigationSceneNavClip,
    setIsGaussianPanning,
  ]);
}
