import { describe, expect, it } from 'vitest';
import {
  buildVoxelUniformData,
  resolveVoxelFootprint,
  resolveVoxelGridDimensions,
  shouldRenderVoxelFloor,
} from '../../src/engine/native3d/passes/voxelPass/voxelUniforms';
import { resolveRenderableSharedSceneCamera } from '../../src/engine/scene/SceneCameraUtils';
import type { SceneCamera, SceneCameraConfig, SceneVoxelLayer } from '../../src/engine/scene/types';
import { WORLD_HEIGHT } from '../../src/engine/native3d/sceneRenderer/constants';
import { compileVoxelGraph, createDefaultVoxelGraph } from '../../src/services/operators/voxelGraph';

const IDENTITY = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function makeLayer(overrides: Partial<SceneVoxelLayer> = {}): SceneVoxelLayer {
  return {
    kind: 'voxel',
    layerId: 'voxel-layer',
    clipId: 'voxel-clip',
    opacity: 0.8,
    blendMode: 'normal',
    sourceWidth: 1920,
    sourceHeight: 1080,
    worldMatrix: IDENTITY,
    voxelParams: {},
    ...overrides,
  };
}

function buildCamera(config: SceneCameraConfig, viewport = { width: 1280, height: 720 }): SceneCamera {
  return resolveRenderableSharedSceneCamera(
    viewport,
    0,
    { previewCameraOverride: config } as never,
  );
}

function projectLayerOrigin(uniforms: Float32Array): { clip: number[]; ndc: number[] } {
  const worldOrigin = [uniforms[28]!, uniforms[29]!, uniforms[30]!, uniforms[31]!];
  const clip = [0, 1, 2, 3].map((row) =>
    uniforms[row]! * worldOrigin[0]! +
    uniforms[4 + row]! * worldOrigin[1]! +
    uniforms[8 + row]! * worldOrigin[2]! +
    uniforms[12 + row]! * worldOrigin[3]!,
  );
  return {
    clip,
    ndc: clip.slice(0, 3).map((value) => value / clip[3]!),
  };
}

function expectOriginVisible(camera: SceneCamera): void {
  const projected = projectLayerOrigin(buildVoxelUniformData(makeLayer(), camera));
  expect(projected.clip[3]).toBeGreaterThan(0);
  for (const component of projected.ndc) {
    expect(component).toBeGreaterThanOrEqual(-1);
    expect(component).toBeLessThanOrEqual(1);
  }
}

describe('voxel uniform construction', () => {
  it.each([['geometry.box', 0], ['geometry.sphere', 1], ['geometry.cylinder', 2]] as const)(
    'packs the connected %s topology for native instancing', (operator, shapeCode) => {
      const graph = createDefaultVoxelGraph(); graph.nodes.find(node => node.id === 'box')!.operator = operator;
      const voxelGraphPlan = compileVoxelGraph({ operatorGraph: JSON.stringify(graph) });
      const uniforms = buildVoxelUniformData(makeLayer({ voxelGraphPlan }), buildCamera({
        position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
        fov: 50, near: 0.1, far: 100, applyDefaultDistance: false,
      }));
      expect(uniforms[50]).toBe(shapeCode);
    });
  it('projects the footprint origin into visible perspective clip space', () => {
    expectOriginVisible(buildCamera({
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 50,
      near: 0.1,
      far: 1000,
      applyDefaultDistance: true,
      projection: 'perspective',
    }));
  });

  it('projects the footprint origin into visible editor-style orthographic clip space', () => {
    expectOriginVisible(buildCamera({
      position: { x: 0, y: 10, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: -1 },
      fov: 50,
      near: 0.1,
      far: 1000,
      applyDefaultDistance: false,
      projection: 'orthographic',
      orthographicScale: 4,
    }));
  });

  it('matches plane footprint semantics with a composition reference size', () => {
    const layer = makeLayer();
    const camera = {
      ...buildCamera({
        position: { x: 0, y: 0, z: 3 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fov: 50,
        near: 0.1,
        far: 100,
        applyDefaultDistance: false,
      }, { width: 400, height: 400 }),
      referenceSize: { width: 1920, height: 1080 },
    };
    const footprint = resolveVoxelFootprint(layer, camera);
    const uniforms = buildVoxelUniformData(layer, camera);

    expect(footprint.sourcePixelScale).toBe(1);
    expect(footprint.width).toBeCloseTo(WORLD_HEIGHT);
    expect(footprint.height).toBeCloseTo(WORLD_HEIGHT / (16 / 9));
    expect(uniforms[16]).toBeCloseTo(footprint.width);
    expect(uniforms[21]).toBeCloseTo(footprint.height);
    expect(uniforms[35]).toBeCloseTo(footprint.height);
  });

  it('preserves portrait media proportions inside a landscape 3D editor pane', () => {
    const layer = makeLayer({ sourceWidth: 576, sourceHeight: 1024 });
    const camera = {
      ...buildCamera({
        position: { x: 0, y: 0, z: 3 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fov: 50,
        near: 0.1,
        far: 100,
        applyDefaultDistance: false,
      }, { width: 595, height: 348 }),
      referenceSize: { width: 1080, height: 1920 },
    };

    const footprint = resolveVoxelFootprint(layer, camera);
    const uniforms = buildVoxelUniformData(layer, camera);

    expect(footprint.width / footprint.height).toBeCloseTo(576 / 1024);
    expect(uniforms[16] / uniforms[21]).toBeCloseTo(576 / 1024);
    expect(footprint.sourcePixelScale).toBeCloseTo(1024 / 1920);
  });

  it('falls back to viewport size for source pixel scale when referenceSize is absent', () => {
    const layer = makeLayer();
    const camera = buildCamera({
      position: { x: 0, y: 0, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 50,
      near: 0.1,
      far: 100,
      applyDefaultDistance: false,
    }, { width: 400, height: 400 });
    const footprint = resolveVoxelFootprint(layer, camera);

    expect(footprint.sourcePixelScale).toBeCloseTo(1920 / 400);
    expect(footprint.width).toBeCloseTo(WORLD_HEIGHT * (1920 / 400));
    expect(footprint.height).toBeCloseTo(WORLD_HEIGHT * (1920 / 400) / (16 / 9));
  });

  it('derives grid dimensions and applies parameter fallbacks', () => {
    const inheritedHeight = makeLayer({
      voxelParams: {
        columns: 12.6,
        heightScale: 'invalid',
        height: 0.72,
        gap: 'invalid',
      },
    });
    const grid = resolveVoxelGridDimensions(inheritedHeight);
    const uniforms = buildVoxelUniformData(inheritedHeight, buildCamera({
      position: { x: 0, y: 0, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 50,
      near: 0.1,
      far: 100,
      applyDefaultDistance: false,
    }), grid);

    expect(grid).toEqual({ columns: 13, rows: 7 });
    expect(uniforms[32]).toBe(13);
    expect(uniforms[33]).toBe(7);
    expect(uniforms[34]).toBeCloseTo(0.06);
    expect(uniforms[36]).toBeCloseTo(0.72);
    expect(uniforms[37]).toBeCloseTo(0.015);
    expect(uniforms[38]).toBeCloseTo(3);
    expect(uniforms[40]).toBeCloseTo(310);

    const defaults = buildVoxelUniformData(makeLayer(), buildCamera({
      position: { x: 0, y: 0, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 50,
      near: 0.1,
      far: 100,
      applyDefaultDistance: false,
    }));
    expect(defaults[32]).toBe(107);
    expect(defaults[33]).toBe(60);
    expect(defaults[36]).toBeCloseTo(1.2);
  });

  it('omits the native 3D backing plane when floor brightness is zero', () => {
    expect(shouldRenderVoxelFloor(makeLayer({ voxelParams: { floorBrightness: 0 } }))).toBe(false);
    expect(shouldRenderVoxelFloor(makeLayer({ voxelParams: { floorBrightness: 0.1 } }))).toBe(true);
  });
});
