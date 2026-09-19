import { describe, expect, it } from 'vitest';
import { indexDisplayedMediaTimes, resolveTerrainProjection } from '../../src/engine/render/Compositor';
import type { LayerRenderData } from '../../src/engine/core/types';
import type { TerrainProjectionDescriptor } from '../../src/types/terrainAttachment';

const descriptor: TerrainProjectionDescriptor = {
  attachment: {
    version: 1,
    targetVideoClipId: 'tracked-video',
    trackId: 'terrain-track',
    placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    visible: true,
  },
  terrain: {
    version: 1,
    solver: 'colmap-openmvs',
    referenceTime: 1,
    intrinsics: { width: 100, height: 100, fx: 100, fy: 100, cx: 50, cy: 50 },
    cameras: [{ time: 1, duration: .033, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0], error: 0, observations: 1 }],
    vertices: [], triangles: [], sourceFrameCount: 1, sparsePointCount: 0, medianError: 0,
  },
  // A timeline-time fallback must never be used for a held/unknown video frame.
  camera: { time: 1, duration: .033, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0], error: 0, observations: 1 },
};

function target(displayedMediaTime?: number): LayerRenderData {
  return { layer: { id: 'target-layer', sourceClipId: 'tracked-video' }, displayedMediaTime } as LayerRenderData;
}

describe('terrain projection camera timing', () => {
  it('uses the target video displayed PTS and hides while that PTS is unknown or uncovered', () => {
    expect(resolveTerrainProjection(descriptor, indexDisplayedMediaTimes([target()]))).toBeNull();
    expect(resolveTerrainProjection(descriptor, indexDisplayedMediaTimes([target(Number.NaN)]))).toBeNull();
    expect(resolveTerrainProjection(descriptor, indexDisplayedMediaTimes([target(1.01)]))?.camera).toBe(descriptor.terrain.cameras[0]);
    expect(resolveTerrainProjection(descriptor, indexDisplayedMediaTimes([target(1.08)]))).toBeNull();
  });
});
