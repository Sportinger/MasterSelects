import { getCameraDescriptorForPath, getCameraDescriptorsForClip } from '../../src/services/properties/cameraProperties';
import type { TimelineClip } from '../../src/types/timeline';
import { describe, expect, it, vi } from 'vitest';
import { RasterDepthOfField, rasterBlurRadius, rasterFocusParams } from '../../src/engine/native3d/sceneRenderer/rasterDepthOfField';
import type { SceneCamera } from '../../src/engine/scene/types';
const camera = { cameraPosition: { x: 0, y: 0, z: 4 }, cameraTarget: { x: 0, y: 0, z: 0 }, fov: 60,
  projection: 'perspective', projectionMatrix: Float32Array.of(1,0,0,0,0,1,0,0,0,0,-1.001,-1,0,0,-.1001,0),
  viewport: { width: 1080, height: 1920 }, lens: { fStop: .5, focusDistance: 0 } } as SceneCamera;
describe('raster camera depth of field', () => {
  it('is free at the pinhole default, and never blurs path-traced or orthographic cameras twice', () => {
    expect(rasterFocusParams({ ...camera, lens: undefined }, 'raster')).toBeNull();
    expect(rasterFocusParams(camera, 'path-traced')).toBeNull();
    expect(rasterFocusParams({ ...camera, projection: 'orthographic' }, 'raster')).toBeNull();
    const device = { createTexture: vi.fn() }; const view = {} as GPUTextureView;
    expect(new RasterDepthOfField().render(device as unknown as GPUDevice, {} as GPUCommandEncoder, 'test', view, view,
      { ...camera, lens: undefined }, 'raster')).toBe(view);
    expect(device.createTexture).not.toHaveBeenCalled();
  });
  it('focuses on the target, preserves that plane, and scales blur with aperture and output resolution', () => {
    const p = rasterFocusParams(camera, 'raster')!;
    expect(p[2]).toBe(4); expect(rasterBlurRadius(p, 4)).toBe(0);
    expect(rasterBlurRadius(p, 1)).toBeGreaterThan(1);
    const closed = rasterFocusParams({ ...camera, lens: { ...camera.lens!, fStop: 1 } }, 'raster')!;
    expect(rasterBlurRadius(closed, 2)).toBeCloseTo(rasterBlurRadius(p, 2) / 2);
    const half = rasterFocusParams({ ...camera, viewport: { width: 540, height: 960 } }, 'raster')!;
    expect(rasterBlurRadius(half, 2)).toBeCloseTo(rasterBlurRadius(p, 2) / 2);
    expect(rasterBlurRadius(p, .00001)).toBe(18);
  });
  it('honors explicit focus and safely disables impossible focus distances', () => {
    const lens = { ...camera.lens!, focusDistance: 2 };
    expect(rasterBlurRadius(rasterFocusParams({ ...camera, lens }, 'raster')!, 2)).toBe(0);
    expect(rasterFocusParams({ ...camera, lens: { ...lens, focusDistance: .001 } }, 'raster')).toBeNull();
  });
});

it('exposes camera lens properties to normal keyframe authoring without leaking them to other clips', () => {
  const clip = { source: { type: 'camera', cameraSettings: { fov: 60, near: .1, far: 1000 } } } as TimelineClip;
  const descriptor = getCameraDescriptorForPath('camera.fStop', clip)!;
  expect(descriptor.animatable).toBe(true); expect(descriptor.read(clip)).toBe(0);
  const updated = descriptor.write(clip, .4); expect(descriptor.read(updated)).toBe(.4);
  expect(updated.source?.cameraSettings?.fov).toBe(60); expect(descriptor.read(clip)).toBe(0);
  expect(getCameraDescriptorsForClip({ source: { type: 'solid' } } as TimelineClip)).toEqual([]);
});
