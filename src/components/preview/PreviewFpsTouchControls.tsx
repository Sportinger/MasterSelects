import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import './PreviewFpsTouchControls.css';

import {
  resolveOrbitCameraFrame,
  resolveOrbitCameraTranslationForFixedEye,
} from '../../engine/gaussian/core/SplatCameraUtils';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { useEngineStore } from '../../stores/engineStore';
import { resolveSceneNavigationKeyboardDelta } from './usePreviewSceneNavigation';
import { resolveSceneNavigationLookRotation } from './usePreviewSceneNavigationPointerEffects';

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

interface SceneNavSolveSettings {
  settings: {
    nearPlane: number;
    farPlane: number;
    fov: number;
    minimumDistance: number;
  };
  sceneBounds?: { min: [number, number, number]; max: [number, number, number] };
}

interface PreviewFpsTouchControlsProps {
  applyNavigationCameraValues: (clip: TimelineClip, values: SceneNavCameraValues) => void;
  cameraClip: TimelineClip;
  effectiveResolution: PreviewSize;
  endHistoryBatch: () => void;
  getFreshTransform: (clip: TimelineClip | null) => ClipTransform | null;
  getSolveSettings: (clip: TimelineClip | null) => SceneNavSolveSettings | null;
  moveSpeed: number;
  startHistoryBatch: (label: string) => void;
}

interface Point {
  x: number;
  y: number;
}

const STICK_RADIUS_PX = 42;
const LOOK_STICK_PIXELS_PER_SECOND = 540;
const STICK_DEAD_ZONE = 0.01;

export function resolveFpsTouchStick(
  origin: Point,
  pointer: Point,
  radius: number = STICK_RADIUS_PX,
): Point {
  const dx = pointer.x - origin.x;
  const dy = pointer.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance < 0.000001) {
    return { x: dx / radius, y: dy / radius };
  }
  return { x: dx / distance, y: dy / distance };
}

function stopPointer(event: ReactPointerEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

export function PreviewFpsTouchControls({
  applyNavigationCameraValues,
  cameraClip,
  effectiveResolution,
  endHistoryBatch,
  getFreshTransform,
  getSolveSettings,
  moveSpeed,
  startHistoryBatch,
}: PreviewFpsTouchControlsProps) {
  const [moveStick, setMoveStick] = useState<Point>({ x: 0, y: 0 });
  const [lookStick, setLookStick] = useState<Point>({ x: 0, y: 0 });
  const movePointerIdRef = useRef<number | null>(null);
  const moveOriginRef = useRef<Point>({ x: 0, y: 0 });
  const moveInputRef = useRef<Point>({ x: 0, y: 0 });
  const lookPointerIdRef = useRef<number | null>(null);
  const lookOriginRef = useRef<Point>({ x: 0, y: 0 });
  const lookInputRef = useRef<Point>({ x: 0, y: 0 });
  const verticalPointerIdRef = useRef<number | null>(null);
  const verticalInputRef = useRef(0);
  const movementFrameRef = useRef<number | null>(null);
  const movementLastTimeRef = useRef<number | null>(null);
  const lookFrameRef = useRef<number | null>(null);
  const lookLastTimeRef = useRef<number | null>(null);
  const activeHistoryControlsRef = useRef(new Set<'move' | 'look'>());
  const tickMovementRef = useRef<(timestamp: number) => void>(() => undefined);
  const tickLookRef = useRef<(timestamp: number) => void>(() => undefined);

  const beginHistoryControl = useCallback((control: 'move' | 'look', label: string) => {
    const controls = activeHistoryControlsRef.current;
    if (controls.has(control)) return;
    if (controls.size === 0) startHistoryBatch(label);
    controls.add(control);
  }, [startHistoryBatch]);

  const endHistoryControl = useCallback((control: 'move' | 'look') => {
    const controls = activeHistoryControlsRef.current;
    if (!controls.delete(control)) return;
    if (controls.size === 0) endHistoryBatch();
  }, [endHistoryBatch]);

  const movementActive = useCallback(() => (
    movePointerIdRef.current !== null || verticalPointerIdRef.current !== null
  ), []);

  const finishMovementHistoryIfIdle = useCallback(() => {
    if (!movementActive()) endHistoryControl('move');
  }, [endHistoryControl, movementActive]);

  const stopMovementLoop = useCallback(() => {
    if (movementFrameRef.current !== null) {
      window.cancelAnimationFrame(movementFrameRef.current);
      movementFrameRef.current = null;
    }
    movementLastTimeRef.current = null;
  }, []);

  const tickMovement = useCallback((timestamp: number) => {
    movementFrameRef.current = null;
    const input = moveInputRef.current;
    const verticalInput = verticalInputRef.current;
    if (!movementActive() || (Math.hypot(input.x, input.y) < 0.01 && verticalInput === 0)) {
      stopMovementLoop();
      return;
    }

    const transform = getFreshTransform(cameraClip);
    const solveSettings = getSolveSettings(cameraClip);
    if (!transform || !solveSettings) {
      stopMovementLoop();
      return;
    }

    const deltaSeconds = movementLastTimeRef.current === null
      ? 1 / 60
      : Math.min(0.05, (timestamp - movementLastTimeRef.current) / 1000);
    movementLastTimeRef.current = timestamp;
    const frame = resolveOrbitCameraFrame(
      transform,
      solveSettings.settings,
      effectiveResolution,
      solveSettings.sceneBounds,
    );
    const delta = resolveSceneNavigationKeyboardDelta(
      frame,
      { right: input.x, up: verticalInput, forward: -input.y },
      deltaSeconds,
      moveSpeed,
    );
    applyNavigationCameraValues(cameraClip, {
      positionX: transform.position.x + delta.x,
      positionY: transform.position.y + delta.y,
      positionZ: transform.position.z + delta.z,
    });
    movementFrameRef.current = window.requestAnimationFrame(tickMovementRef.current);
  }, [
    applyNavigationCameraValues,
    cameraClip,
    effectiveResolution,
    getFreshTransform,
    getSolveSettings,
    moveSpeed,
    movementActive,
    stopMovementLoop,
  ]);

  useEffect(() => {
    tickMovementRef.current = tickMovement;
  }, [tickMovement]);

  const startMovementLoop = useCallback(() => {
    if (movementFrameRef.current !== null) return;
    movementFrameRef.current = window.requestAnimationFrame(tickMovementRef.current);
  }, []);

  const stopLookLoop = useCallback(() => {
    if (lookFrameRef.current !== null) {
      window.cancelAnimationFrame(lookFrameRef.current);
      lookFrameRef.current = null;
    }
    lookLastTimeRef.current = null;
  }, []);

  const tickLook = useCallback((timestamp: number) => {
    lookFrameRef.current = null;
    const input = lookInputRef.current;
    if (lookPointerIdRef.current === null || Math.hypot(input.x, input.y) < STICK_DEAD_ZONE) {
      stopLookLoop();
      return;
    }

    const transform = getFreshTransform(cameraClip);
    const solveSettings = getSolveSettings(cameraClip);
    if (!transform || !solveSettings) {
      stopLookLoop();
      return;
    }

    const deltaSeconds = lookLastTimeRef.current === null
      ? 1 / 60
      : Math.min(0.05, (timestamp - lookLastTimeRef.current) / 1000);
    lookLastTimeRef.current = timestamp;
    const deltaScale = LOOK_STICK_PIXELS_PER_SECOND * deltaSeconds;
    const { pitch, yaw } = resolveSceneNavigationLookRotation(
      transform.rotation,
      input.x * deltaScale,
      input.y * deltaScale,
    );
    const translation = resolveOrbitCameraTranslationForFixedEye(
      transform,
      { x: pitch, y: yaw, z: transform.rotation.z },
      solveSettings.settings,
      effectiveResolution,
      solveSettings.sceneBounds,
    );
    applyNavigationCameraValues(cameraClip, {
      positionX: translation.positionX,
      positionY: translation.positionY,
      positionZ: translation.positionZ,
      rotationX: pitch,
      rotationY: yaw,
    });
    lookFrameRef.current = window.requestAnimationFrame(tickLookRef.current);
  }, [
    applyNavigationCameraValues,
    cameraClip,
    effectiveResolution,
    getFreshTransform,
    getSolveSettings,
    stopLookLoop,
  ]);

  useEffect(() => {
    tickLookRef.current = tickLook;
  }, [tickLook]);

  const startLookLoop = useCallback(() => {
    if (lookFrameRef.current !== null) return;
    lookFrameRef.current = window.requestAnimationFrame(tickLookRef.current);
  }, []);

  const handleMovePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (movePointerIdRef.current !== null) return;
    stopPointer(event);
    useEngineStore.getState().setSceneNavOrbitTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    movePointerIdRef.current = event.pointerId;
    moveOriginRef.current = { x: event.clientX, y: event.clientY };
    moveInputRef.current = { x: 0, y: 0 };
    setMoveStick({ x: 0, y: 0 });
    beginHistoryControl('move', 'Scene FPS touch move');
  }, [beginHistoryControl]);

  const handleMovePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== movePointerIdRef.current) return;
    stopPointer(event);
    const input = resolveFpsTouchStick(moveOriginRef.current, { x: event.clientX, y: event.clientY });
    moveInputRef.current = input;
    setMoveStick(input);
    startMovementLoop();
  }, [startMovementLoop]);

  const finishMovePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== movePointerIdRef.current) return;
    stopPointer(event);
    movePointerIdRef.current = null;
    moveInputRef.current = { x: 0, y: 0 };
    setMoveStick({ x: 0, y: 0 });
    finishMovementHistoryIfIdle();
  }, [finishMovementHistoryIfIdle]);

  const handleLookPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointerIdRef.current !== null) return;
    stopPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    lookPointerIdRef.current = event.pointerId;
    lookOriginRef.current = { x: event.clientX, y: event.clientY };
    lookInputRef.current = { x: 0, y: 0 };
    setLookStick({ x: 0, y: 0 });
    beginHistoryControl('look', 'Scene FPS touch look');
  }, [beginHistoryControl]);

  const handleLookPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== lookPointerIdRef.current) return;
    stopPointer(event);
    const input = resolveFpsTouchStick(
      lookOriginRef.current,
      { x: event.clientX, y: event.clientY },
    );
    lookInputRef.current = input;
    setLookStick(input);
    if (Math.hypot(input.x, input.y) >= STICK_DEAD_ZONE) startLookLoop();
  }, [startLookLoop]);

  const finishLookPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== lookPointerIdRef.current) return;
    stopPointer(event);
    lookPointerIdRef.current = null;
    lookInputRef.current = { x: 0, y: 0 };
    setLookStick({ x: 0, y: 0 });
    stopLookLoop();
    endHistoryControl('look');
  }, [endHistoryControl, stopLookLoop]);

  const startVerticalMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>, direction: -1 | 1) => {
    if (verticalPointerIdRef.current !== null) return;
    stopPointer(event);
    useEngineStore.getState().setSceneNavOrbitTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    verticalPointerIdRef.current = event.pointerId;
    verticalInputRef.current = direction;
    beginHistoryControl('move', 'Scene FPS touch move');
    startMovementLoop();
  }, [beginHistoryControl, startMovementLoop]);

  const finishVerticalMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerId !== verticalPointerIdRef.current) return;
    stopPointer(event);
    verticalPointerIdRef.current = null;
    verticalInputRef.current = 0;
    finishMovementHistoryIfIdle();
  }, [finishMovementHistoryIfIdle]);

  useEffect(() => () => {
    stopMovementLoop();
    stopLookLoop();
    if (activeHistoryControlsRef.current.size > 0) {
      activeHistoryControlsRef.current.clear();
      endHistoryBatch();
    }
  }, [endHistoryBatch, stopLookLoop, stopMovementLoop]);

  const moveKnobStyle = {
    transform: `translate(${moveStick.x * STICK_RADIUS_PX}px, ${moveStick.y * STICK_RADIUS_PX}px)`,
  };
  const lookKnobStyle = {
    transform: `translate(${lookStick.x * STICK_RADIUS_PX}px, ${lookStick.y * STICK_RADIUS_PX}px)`,
  };

  return (
    <div className="preview-fps-touch-controls" aria-label="FPS touch controls">
      <div className="preview-fps-touch-cluster preview-fps-touch-cluster--move">
        <div
          aria-label="Move camera"
          className="preview-fps-touch-pad"
          onLostPointerCapture={finishMovePointer}
          onPointerCancel={finishMovePointer}
          onPointerDown={handleMovePointerDown}
          onPointerMove={handleMovePointerMove}
          onPointerUp={finishMovePointer}
          role="application"
        >
          <span className="preview-fps-touch-pad-ring" />
          <span className="preview-fps-touch-knob" style={moveKnobStyle} />
        </div>
        <div className="preview-fps-touch-elevation" aria-label="Camera elevation">
          <button
            aria-label="Move camera up"
            onLostPointerCapture={finishVerticalMove}
            onPointerCancel={finishVerticalMove}
            onPointerDown={(event) => startVerticalMove(event, 1)}
            onPointerUp={finishVerticalMove}
            type="button"
          >
            ▲
          </button>
          <button
            aria-label="Move camera down"
            onLostPointerCapture={finishVerticalMove}
            onPointerCancel={finishVerticalMove}
            onPointerDown={(event) => startVerticalMove(event, -1)}
            onPointerUp={finishVerticalMove}
            type="button"
          >
            ▼
          </button>
        </div>
      </div>
      <div className="preview-fps-touch-cluster preview-fps-touch-cluster--look">
        <div
          aria-label="Look around"
          className="preview-fps-touch-pad preview-fps-touch-pad--look"
          onLostPointerCapture={finishLookPointer}
          onPointerCancel={finishLookPointer}
          onPointerDown={handleLookPointerDown}
          onPointerMove={handleLookPointerMove}
          onPointerUp={finishLookPointer}
          role="application"
        >
          <span className="preview-fps-touch-pad-ring preview-fps-touch-pad-ring--cross" />
          <span className="preview-fps-touch-knob" style={lookKnobStyle} />
        </div>
      </div>
    </div>
  );
}
