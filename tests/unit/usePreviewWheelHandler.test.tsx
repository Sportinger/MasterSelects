import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewWheelHandler } from '../../src/components/preview/usePreviewWheelHandler';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';

describe('preview wheel scene dolly', () => {
  let frameId = 0;
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    frames = new Map();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spreads a slower wheel dolly across animation frames', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.append(canvas);
    const cameraClip = {
      id: 'editor-camera',
      startTime: 0,
      source: { type: 'camera' },
    } as unknown as TimelineClip;
    let transform = {
      position: { x: 0, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { all: 1, x: 1, y: 1, z: 1 },
      opacity: 1,
      blendMode: 'normal',
    } as ClipTransform;
    const applyNavigationCameraValues = vi.fn((_clip: TimelineClip, values: {
      positionX?: number;
      positionY?: number;
      positionZ?: number;
    }) => {
      transform = {
        ...transform,
        position: {
          x: values.positionX ?? transform.position.x,
          y: values.positionY ?? transform.position.y,
          z: values.positionZ ?? transform.position.z,
        },
      };
    });
    const scheduleGaussianWheelBatchEnd = vi.fn();

    const { result } = renderHook(() => usePreviewWheelHandler({
      activeEditCameraOrthoFrame: null,
      applyNavigationCameraValues,
      canvasRef: { current: canvas },
      canvasSize: { width: 1920, height: 1080 },
      containerRef: { current: container },
      containerSize: { width: 960, height: 540 },
      editCameraClipIdRef: { current: cameraClip.id },
      editCameraModeActive: true,
      editCameraOrthoMode: null,
      editCameraOrthoViewActive: false,
      editCameraSettingsRef: { current: { fov: 60, near: 0.1, far: 1000 } },
      effectiveResolution: { width: 1920, height: 1080 },
      effectOrbitActive: false,
      viewNavigationEnabled: false,
      gaussianFpsLookStart: { current: { clipId: null, x: 0, y: 0 } },
      gaussianKeyboardMoveCodesRef: { current: new Set() },
      getFreshSceneNavTransform: () => transform,
      handleEffectOrbitWheel: () => false,
      isCanvasInteractionTarget: target => target === canvas,
      minimumViewZoom: 0.1,
      navigationSceneNavClip: cameraClip,
      sceneNavEnabled: true,
      scheduleGaussianWheelBatchEnd,
      setEditCameraOrthoFrame: vi.fn(),
      setSceneNavFpsMoveSpeed: vi.fn(),
      setViewPan: vi.fn(),
      setViewZoom: vi.fn(),
      viewPan: { x: 0, y: 0 },
      viewZoom: 1,
    }));
    const event = {
      altKey: false,
      clientX: 0,
      clientY: 0,
      deltaMode: 0,
      deltaY: -100,
      preventDefault: vi.fn(),
      target: canvas,
    } as unknown as React.WheelEvent;

    act(() => result.current(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(applyNavigationCameraValues).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);

    let now = 0;
    act(() => {
      const [firstId, firstFrame] = [...frames.entries()][0];
      frames.delete(firstId);
      now += 1000 / 60;
      firstFrame(now);
    });

    const firstFramePosition = transform.position.z;
    expect(firstFramePosition).toBeGreaterThan(4.56);
    expect(firstFramePosition).toBeLessThan(5);

    act(() => {
      for (let count = 0; count < 60 && frames.size > 0; count += 1) {
        const [id, callback] = [...frames.entries()][0];
        frames.delete(id);
        now += 1000 / 60;
        callback(now);
      }
    });

    expect(frames).toHaveLength(0);
    expect(transform.position.z).toBeCloseTo(5 * Math.exp(-0.065), 6);
    expect(applyNavigationCameraValues.mock.calls.length).toBeGreaterThan(2);
    expect(scheduleGaussianWheelBatchEnd.mock.calls.length).toBeGreaterThan(2);
  });

  it('zooms a normal Preview panel around the pointer', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.append(canvas);
    container.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 960,
      height: 540,
      right: 960,
      bottom: 540,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const setViewPan = vi.fn();
    const setViewZoom = vi.fn();
    const { result, rerender } = renderHook(({ viewPan, viewZoom }) => usePreviewWheelHandler({
      activeEditCameraOrthoFrame: null,
      applyNavigationCameraValues: vi.fn(),
      canvasRef: { current: canvas },
      canvasSize: { width: 960, height: 540 },
      containerRef: { current: container },
      containerSize: { width: 960, height: 540 },
      editCameraClipIdRef: { current: null },
      editCameraModeActive: false,
      editCameraOrthoMode: null,
      editCameraOrthoViewActive: false,
      editCameraSettingsRef: { current: { fov: 60, near: 0.1, far: 1000 } },
      effectiveResolution: { width: 1920, height: 1080 },
      effectOrbitActive: false,
      gaussianFpsLookStart: { current: { clipId: null, x: 0, y: 0 } },
      gaussianKeyboardMoveCodesRef: { current: new Set() },
      getFreshSceneNavTransform: () => null,
      handleEffectOrbitWheel: () => false,
      isCanvasInteractionTarget: target => target === canvas,
      minimumViewZoom: 1,
      navigationSceneNavClip: null,
      sceneNavEnabled: false,
      scheduleGaussianWheelBatchEnd: vi.fn(),
      setEditCameraOrthoFrame: vi.fn(),
      setSceneNavFpsMoveSpeed: vi.fn(),
      setViewPan,
      setViewZoom,
      viewNavigationEnabled: true,
      viewPan,
      viewZoom,
    }), {
      initialProps: {
        viewPan: { x: 0, y: 0 },
        viewZoom: 1,
      },
    });
    const event = {
      altKey: false,
      clientX: 600,
      clientY: 300,
      deltaMode: 0,
      deltaY: -100,
      preventDefault: vi.fn(),
      target: canvas,
    } as unknown as React.WheelEvent;

    act(() => result.current(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(setViewZoom).toHaveBeenCalledWith(1.1);
    expect(setViewPan).toHaveBeenCalledWith({ x: -12, y: -3 });

    setViewPan.mockClear();
    setViewZoom.mockClear();
    rerender({ viewPan: { x: 42, y: -18 }, viewZoom: 1.05 });
    const zoomOutEvent = {
      ...event,
      deltaY: 100,
      preventDefault: vi.fn(),
    } as unknown as React.WheelEvent;

    act(() => result.current(zoomOutEvent));

    expect(zoomOutEvent.preventDefault).toHaveBeenCalledOnce();
    expect(setViewZoom).toHaveBeenCalledWith(1);
    expect(setViewPan).toHaveBeenCalledWith({ x: 0, y: 0 });
  });
});
