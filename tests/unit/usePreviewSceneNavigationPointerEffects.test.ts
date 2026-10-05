import { describe, expect, it } from 'vitest';

import { resolveSceneNavigationLookRotation, resolveSceneOrbitDragRotation } from '../../src/components/preview/usePreviewSceneNavigationPointerEffects';
import { resolveOrbitCameraFrame } from '../../src/engine/gaussian/core/SplatCameraUtils';
import { resolveSceneOrbitPosition } from '../../src/components/preview/previewSceneCameraMath';

describe('preview camera FPS look', () => {
  it('turns right when the mouse moves right', () => {
    const result = resolveSceneNavigationLookRotation({ x: 4, y: 12 }, 10, 0);

    expect(result.pitch).toBe(4);
    expect(result.yaw).toBeLessThan(12);
  });

  it('turns left when the mouse moves left', () => {
    const result = resolveSceneNavigationLookRotation({ x: 4, y: 12 }, -10, 0);

    expect(result.pitch).toBe(4);
    expect(result.yaw).toBeGreaterThan(12);
  });
});

describe('preview camera orbit', () => {
  it.each([[-20, 0], [20, 0], [0, -20], [0, 20]])('carries a front landmark with the pointer (%s, %s)', (dx, dy) => {
    const { pitch, yaw } = resolveSceneOrbitDragRotation(0, 0, dx, dy);
    const frame = resolveOrbitCameraFrame({ position: { x: 0, y: 0, z: 3 },
      scale: { x: 1, y: 1 }, rotation: { x: pitch, y: yaw, z: 0 } },
    { nearPlane: 0.01, farPlane: 100, fov: 60 }, { width: 1920, height: 1080 });
    const eye = resolveSceneOrbitPosition(frame, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 });
    const front = { x: -eye.x, y: -eye.y, z: 0.8 - eye.z };
    const dot = (v: typeof front) => front.x * v.x + front.y * v.y + front.z * v.z;
    const depth = dot(frame.forward);
    const screenX = dot(frame.right) / depth;
    const screenY = -dot(frame.cameraUp) / depth;
    if (dx) expect(Math.sign(screenX)).toBe(Math.sign(dx));
    if (dy) expect(Math.sign(screenY)).toBe(Math.sign(dy));
    expect(Math.hypot(eye.x, eye.y, eye.z)).toBeCloseTo(3);
  });
});
