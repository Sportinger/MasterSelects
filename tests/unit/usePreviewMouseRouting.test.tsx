import { renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewMouseRouting } from '../../src/components/preview/usePreviewMouseRouting';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';
import { useEngineStore } from '../../src/stores/engineStore';

function createMouseEvent(target: HTMLElement, button: number, shiftKey = false): React.MouseEvent {
  return {
    button,
    shiftKey,
    target,
    clientX: 120,
    clientY: 80,
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent;
}

function setupMouseRouting(options: {
  sceneNavEnabled?: boolean;
  viewNavigationEnabled?: boolean;
} = {}) {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  const pointerLockTarget = document.createElement('div');
  const requestPointerLock = vi.fn();
  Object.defineProperty(pointerLockTarget, 'requestPointerLock', { value: requestPointerLock });
  container.append(canvas);

  const setIsGaussianFpsLooking = vi.fn();
  const setIsGaussianOrbiting = vi.fn();
  const setIsGaussianPanning = vi.fn();
  const setIsPanning = vi.fn();
  const startSceneNavHistoryBatch = vi.fn();
  const navigationSceneNavClip = {
    id: 'camera-1',
    source: { type: 'camera' },
  } as unknown as TimelineClip;
  const transform = {
    position: { x: 0, y: 0, z: 5 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  } as ClipTransform;
  const gaussianOrbitStart = {
    current: {
      clipId: null,
      x: 0,
      y: 0,
      pitch: 0,
      yaw: 0,
      roll: 0,
      startPosX: 0,
      startPosY: 0,
      startPosZ: 0,
      pivotX: 0,
      pivotY: 0,
      pivotZ: 0,
      radius: 0,
    },
  };

  const { result } = renderHook(() => usePreviewMouseRouting({
    activeEditCameraOrthoFrame: null,
    beginEffectOrbitDrag: vi.fn(),
    canvasSize: { width: 1920, height: 1080 },
    containerRef: { current: container },
    editCameraOrthoMode: null,
    editCameraOrthoPanStart: {
      current: {
        x: 0,
        y: 0,
        center: { x: 0, y: 0, z: 0 },
        scale: 1,
        mode: 'front',
      },
    },
    editCameraOrthoViewActive: false,
    effectOrbitActive: false,
    endGaussianWheelBatch: vi.fn(),
    viewNavigationEnabled: options.viewNavigationEnabled ?? false,
    gaussianFpsLookStart: { current: { clipId: null, x: 0, y: 0 } },
    gaussianOrbitStart,
    gaussianPanStart: { current: { clipId: null, x: 0, y: 0, panX: 0, panY: 0, panZ: 0 } },
    getFreshSceneNavTransform: () => transform,
    getSceneNavPointerLockTarget: () => pointerLockTarget,
    getSceneNavSolveSettings: () => ({
      settings: { nearPlane: 0.1, farPlane: 1000, fov: 60, minimumDistance: 0.01 },
    }),
    isCanvasInteractionTarget: target => target === canvas,
    isEditCameraOrthoPanning: false,
    isPanning: false,
    isSceneObjectInteractionTarget: () => false,
    navigationSceneNavClip,
    panStart: { current: { x: 0, y: 0, panX: 0, panY: 0 } },
    sceneNavEnabled: options.sceneNavEnabled ?? true,
    setEditCameraOrthoFrame: vi.fn(),
    setIsEditCameraOrthoPanning: vi.fn(),
    setIsGaussianFpsLooking,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    setIsPanning,
    setViewPan: vi.fn(),
    setViewZoom: vi.fn(),
    startSceneNavHistoryBatch,
    stopGaussianFpsLook: vi.fn(),
    stopGaussianKeyboardMovement: vi.fn(),
    viewPan: { x: 0, y: 0 },
  }));

  return {
    canvas,
    gaussianOrbitStart,
    requestPointerLock,
    result,
    setIsGaussianFpsLooking,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    setIsPanning,
    startSceneNavHistoryBatch,
  };
}

describe('preview camera mouse routing', () => {
  beforeEach(() => {
    useEngineStore.setState({ sceneNavOrbitTarget: null });
  });

  it('uses left drag for orbit', () => {
    const routing = setupMouseRouting();

    routing.result.current.handleMouseDown(createMouseEvent(routing.canvas, 0));

    expect(routing.startSceneNavHistoryBatch).toHaveBeenCalledWith('Scene orbit');
    expect(routing.setIsGaussianOrbiting).toHaveBeenCalledWith(true);
    expect(routing.setIsGaussianFpsLooking).not.toHaveBeenCalled();
    expect(routing.setIsGaussianPanning).not.toHaveBeenCalled();
  });

  it.each([
    ['middle drag', 1, false],
    ['shift + left drag', 0, true],
  ])('uses %s for pan', (_label, button, shiftKey) => {
    const routing = setupMouseRouting();

    routing.result.current.handleMouseDown(createMouseEvent(routing.canvas, button, shiftKey));

    expect(routing.startSceneNavHistoryBatch).toHaveBeenCalledWith('Scene pan');
    expect(routing.setIsGaussianPanning).toHaveBeenCalledWith(true);
    expect(routing.setIsGaussianFpsLooking).not.toHaveBeenCalled();
    expect(routing.setIsGaussianOrbiting).not.toHaveBeenCalled();
  });

  it('uses right drag for FPS-style mouse look', () => {
    const routing = setupMouseRouting();

    routing.result.current.handleMouseDown(createMouseEvent(routing.canvas, 2));

    expect(routing.startSceneNavHistoryBatch).toHaveBeenCalledWith('Scene look');
    expect(routing.requestPointerLock).toHaveBeenCalledOnce();
    expect(routing.setIsGaussianFpsLooking).toHaveBeenCalledWith(true);
    expect(routing.setIsGaussianPanning).not.toHaveBeenCalled();
    expect(routing.setIsGaussianOrbiting).not.toHaveBeenCalled();
  });

  it('uses middle drag to pan a normal Preview panel', () => {
    const routing = setupMouseRouting({
      sceneNavEnabled: false,
      viewNavigationEnabled: true,
    });

    const event = createMouseEvent(routing.canvas, 1);
    routing.result.current.handleMouseDown(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(routing.setIsPanning).toHaveBeenCalledWith(true);
    expect(routing.startSceneNavHistoryBatch).not.toHaveBeenCalled();
  });

  it('uses the chosen scene object as the orbit pivot', () => {
    useEngineStore.getState().setSceneNavOrbitTarget({
      clipId: 'model-1',
      pivot: { x: 3, y: -2, z: 1 },
    });
    const routing = setupMouseRouting();

    routing.result.current.handleMouseDown(createMouseEvent(routing.canvas, 0));

    expect(routing.gaussianOrbitStart.current).toMatchObject({
      pivotX: 3,
      pivotY: -2,
      pivotZ: 1,
    });
    expect(routing.gaussianOrbitStart.current.localOffsetX).toBeTypeOf('number');
    expect(routing.gaussianOrbitStart.current.localOffsetY).toBeTypeOf('number');
    expect(routing.gaussianOrbitStart.current.localOffsetZ).toBeTypeOf('number');
  });

  it.each([
    ['middle drag', 1, false],
    ['shift + left drag', 0, true],
  ])('clears the object orbit target on %s pan', (_label, button, shiftKey) => {
    useEngineStore.getState().setSceneNavOrbitTarget({
      clipId: 'model-1',
      pivot: { x: 3, y: -2, z: 1 },
    });
    const routing = setupMouseRouting();

    routing.result.current.handleMouseDown(createMouseEvent(routing.canvas, button, shiftKey));

    expect(useEngineStore.getState().sceneNavOrbitTarget).toBeNull();
  });
});
