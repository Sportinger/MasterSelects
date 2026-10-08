import { describe, expect, it } from 'vitest';
import { applyCameraShake } from '../../src/engine/scene/cameraUtils/cameraShake';
import { getInterpolatedClipCameraSettings } from '../../src/utils/keyframeInterpolation';

const camera = { position: { x: 2, y: 1, z: 3 }, target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 }, fov: 60, near: .01, far: 1000 };
const settings = { fov: 60, near: .01, far: 1000 };
describe('additive camera shake', () => {
  it('leaves unconfigured cameras and zero-strength loop endpoints unchanged', () => {
    expect(applyCameraShake(camera, settings, 57)).toBe(camera);
    expect(applyCameraShake(camera, { ...settings, shakeAmount: 0 }, 59)).toBe(camera);
  });
  it('is independent of seek order and works with the physical lens bypassed', () => {
    const s = { ...settings, physicalCameraEnabled: false, shakeAmount: 4, shakeSeed: 29 };
    const a = applyCameraShake(camera, s, 57 + 20 / 60);
    applyCameraShake(camera, s, 10);
    expect(applyCameraShake(camera, s, 57 + 20 / 60)).toEqual(a);
    expect(a).not.toEqual(camera);
    expect(camera.position).toEqual({ x: 2, y: 1, z: 3 });
    expect(Math.hypot(a.target.x-a.position.x, a.target.y-a.position.y, a.target.z-a.position.z))
      .toBeCloseTo(Math.sqrt(14), 10);
    expect(Math.hypot(a.up.x, a.up.y, a.up.z)).toBeCloseTo(1, 10);
  });
  it('interpolates its own envelope without adding pose keys', () => {
    const keys = [
      { id: 'a', property: 'camera.shakeAmount' as const, time: 52, value: 0, easing: 'linear' as const },
      { id: 'b', property: 'camera.shakeAmount' as const, time: 54, value: .2, easing: 'linear' as const },
    ];
    expect(getInterpolatedClipCameraSettings(keys, 53, settings).shakeAmount).toBeCloseTo(.1);
  });
});
