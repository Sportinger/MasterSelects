import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PreviewFpsTouchControls,
  resolveFpsTouchStick,
} from '../../src/components/preview/PreviewFpsTouchControls';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';

const cameraClip = {
  id: 'camera-1',
  name: 'Camera',
  trackId: 'video-1',
  startTime: 0,
  duration: 10,
  source: { type: 'camera' },
} as TimelineClip;

const cameraTransform: ClipTransform = {
  opacity: 1,
  blendMode: 'normal',
  position: { x: 0, y: 0, z: 5 },
  anchor: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

let animationFrames = new Map<number, FrameRequestCallback>();
let nextAnimationFrameId = 1;

function flushAnimationFrame(timestamp: number): void {
  const callbacks = [...animationFrames.values()];
  animationFrames.clear();
  callbacks.forEach(callback => callback(timestamp));
}

describe('Preview FPS touch controls', () => {
  beforeEach(() => {
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId++;
      animationFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      animationFrames.delete(frameId);
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes and clamps a virtual stick to its circular range', () => {
    expect(resolveFpsTouchStick({ x: 100, y: 100 }, { x: 121, y: 79 }, 42)).toEqual({
      x: 0.5,
      y: -0.5,
    });
    const clamped = resolveFpsTouchStick({ x: 0, y: 0 }, { x: 300, y: 400 }, 42);
    expect(clamped.x).toBeCloseTo(0.6);
    expect(clamped.y).toBeCloseTo(0.8);
  });

  it('keeps turning while the right touch control is held at its cap', () => {
    const applyNavigationCameraValues = vi.fn();
    const startHistoryBatch = vi.fn();
    const endHistoryBatch = vi.fn();
    render(
      <PreviewFpsTouchControls
        applyNavigationCameraValues={applyNavigationCameraValues}
        cameraClip={cameraClip}
        effectiveResolution={{ width: 1920, height: 1080 }}
        endHistoryBatch={endHistoryBatch}
        getFreshTransform={() => cameraTransform}
        getSolveSettings={() => ({
          settings: { nearPlane: 0.1, farPlane: 1000, fov: 60, minimumDistance: 0.1 },
        })}
        moveSpeed={1}
        startHistoryBatch={startHistoryBatch}
      />,
    );
    const lookControl = screen.getByLabelText('Look around');

    fireEvent.pointerDown(lookControl, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 7,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(lookControl, {
      clientX: 40,
      clientY: 100,
      pointerId: 7,
      pointerType: 'touch',
    });

    flushAnimationFrame(16);
    flushAnimationFrame(32);

    expect(applyNavigationCameraValues).toHaveBeenCalledTimes(2);
    expect(applyNavigationCameraValues.mock.calls[0]?.[0]).toBe(cameraClip);
    expect(applyNavigationCameraValues.mock.calls[0]?.[1].rotationX).toBeCloseTo(0);
    expect(applyNavigationCameraValues.mock.calls[0]?.[1].rotationY).toBeGreaterThan(0);
    expect(applyNavigationCameraValues.mock.calls[1]?.[1].rotationY).toBeGreaterThan(0);

    fireEvent.pointerUp(lookControl, {
      clientX: 40,
      clientY: 100,
      pointerId: 7,
      pointerType: 'touch',
    });

    flushAnimationFrame(48);

    expect(startHistoryBatch).toHaveBeenCalledOnce();
    expect(startHistoryBatch).toHaveBeenCalledWith('Scene FPS touch look');
    expect(applyNavigationCameraValues).toHaveBeenCalledTimes(2);
    expect(endHistoryBatch).toHaveBeenCalledOnce();
  });
});
