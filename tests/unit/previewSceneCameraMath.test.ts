import { describe, expect, it } from 'vitest';

import { resolveOrbitCameraFrame } from '../../src/engine/gaussian/core/SplatCameraUtils';
import {
  resolveSceneNavigationOrbit,
  resolveSceneOrbitPosition,
} from '../../src/components/preview/previewSceneCameraMath';
import type { ClipTransform } from '../../src/types/timelineCore';

const settings = {
  nearPlane: 0.1,
  farPlane: 1000,
  fov: 60,
  minimumDistance: 2,
};
const viewport = { width: 800, height: 600 };
const sceneBounds = {
  min: [-1, -1, -1] as [number, number, number],
  max: [1, 1, 1] as [number, number, number],
};

describe('preview scene camera math', () => {
  it('orbits around the current view target after the camera was panned', () => {
    const pannedTransform: ClipTransform = {
      position: { x: 2, y: -1, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { all: 1, x: 1, y: 1, z: 1 },
      opacity: 1,
      blendMode: 'normal',
    };

    const orbit = resolveSceneNavigationOrbit(
      pannedTransform,
      settings,
      viewport,
      sceneBounds,
    );
    const frame = resolveOrbitCameraFrame(pannedTransform, settings, viewport, sceneBounds);
    const reconstructedEye = resolveSceneOrbitPosition(frame, orbit.pivot, orbit.localOffset);

    expect(orbit.pivot).toEqual(frame.target);
    expect(orbit.pivot).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(reconstructedEye.x).toBeCloseTo(pannedTransform.position.x, 8);
    expect(reconstructedEye.y).toBeCloseTo(pannedTransform.position.y, 8);
    expect(reconstructedEye.z).toBeCloseTo(pannedTransform.position.z, 8);
  });

  it('keeps the camera position stable when orbiting an off-center object target', () => {
    const transform: ClipTransform = {
      position: { x: 4, y: 2, z: 5 },
      rotation: { x: 12, y: -18, z: 0 },
      scale: { all: 1, x: 1, y: 1, z: 1 },
      opacity: 1,
      blendMode: 'normal',
    };
    const target = { x: 1, y: -2, z: 0 };
    const orbit = resolveSceneNavigationOrbit(transform, settings, viewport, sceneBounds, target);
    const frame = resolveOrbitCameraFrame(transform, settings, viewport, sceneBounds);
    const reconstructedEye = resolveSceneOrbitPosition(frame, target, orbit.localOffset);

    expect(orbit.pivot).toEqual(target);
    expect(orbit.radius).toBeCloseTo(Math.hypot(3, 4, 5), 8);
    expect(reconstructedEye.x).toBeCloseTo(transform.position.x, 8);
    expect(reconstructedEye.y).toBeCloseTo(transform.position.y, 8);
    expect(reconstructedEye.z).toBeCloseTo(transform.position.z, 8);
  });
});
