import { describe, expect, it } from 'vitest';
import { resolveOrbitCameraFrame } from '../../src/engine/gaussian/core/SplatCameraUtils';
import { parseGlb } from '../../src/engine/native3d/assets/modelRuntimeCache/gltf';
import {
  assessTrackingSceneCalibration,
  assertTrackingSceneCameraCalibration,
  buildTrackingSceneCameraPlan,
  terrainCameraToEditorPose,
} from '../../src/services/planarTracking/trackingSceneCamera';
import {
  buildTrackingSceneMesh,
  encodeTrackingSceneGlb,
} from '../../src/services/planarTracking/trackingSceneGeometry';
import { terrainCameraPoint, terrainProject, terrainRotation } from '../../src/services/planarTracking/terrainGeometry';
import type { DenseTerrainMesh, TerrainCamera, TerrainReconstruction, TerrainVector } from '../../src/types/terrainTracking';
import type { TimelineClip } from '../../src/types/timeline';

const identityCamera = (time: number, duration = 1): TerrainCamera => ({
  time,
  duration,
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
  error: 0,
  observations: 10,
});

function terrain(overrides: Partial<TerrainReconstruction> = {}): TerrainReconstruction {
  return {
    version: 1,
    solver: 'browser-sfm',
    referenceTime: 10,
    intrinsics: { width: 1000, height: 500, fx: 600, fy: 600, cx: 500, cy: 250 },
    cameras: [identityCamera(10), identityCamera(11)],
    vertices: [
      { position: [0, 0, 4], uvq: [0, 0, 1] },
      { position: [2, 0, 4], uvq: [1, 0, 1] },
      { position: [0, 2, 4], uvq: [0, 1, 1] },
    ],
    triangles: [0, 1, 2],
    sourceFrameCount: 2,
    sparsePointCount: 3,
    medianError: 0,
    ...overrides,
  };
}

const bounds = {
  min: [0, -2, -4] as [number, number, number],
  max: [2, 0, -4] as [number, number, number],
  center: { x: 1, y: -1, z: -4 },
  maxDimension: 2,
  diagonal: Math.sqrt(8),
};

describe('tracking scene geometry', () => {
  it('converts dense COLMAP geometry to editor coordinates and emits a valid reusable GLB', () => {
    const denseMesh: DenseTerrainMesh = {
      positions: [0, 0, 4, 2, 0, 4, 0, 2, 4],
      indices: [0, 1, 2],
      origin: [0, 0, 4], axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, 1], size: [2, 2],
    };
    const mesh = buildTrackingSceneMesh(terrain({ denseMesh }));
    expect(mesh.source).toBe('dense');
    expect(mesh.positions).toEqual([0, 0, -4, 2, 0, -4, 0, -2, -4]);
    expect(mesh.bounds).toEqual(bounds);

    const encoded = encodeTrackingSceneGlb(mesh, {
      assetId: 'tracking:source:terrain',
      sourceMediaId: 'source',
      geometrySource: mesh.source,
    });
    const parsed = parseGlb(encoded);
    expect(parsed?.json.meshes?.[0]?.primitives[0]?.attributes).toMatchObject({ POSITION: 0, NORMAL: 1 });
    expect(parsed?.json.accessors?.[0]).toMatchObject({ count: 3, componentType: 5126 });
    expect(parsed?.buffers[0]?.byteLength).toBeGreaterThan(0);
  });

  it('uses unique footstep patches before falling back to the sparse reconstruction', () => {
    const patch: DenseTerrainMesh = {
      positions: [0, 0, 2, 1, 0, 2, 0, 1, 2],
      indices: [0, 1, 2],
      origin: [0, 0, 2], axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, 1], size: [1, 1],
    };
    const patched = buildTrackingSceneMesh(terrain({
      denseMesh: undefined,
      footsteps: [
        { id: 'a', name: 'A', placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, mesh: patch },
        { id: 'b', name: 'B', placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, mesh: patch },
      ],
    }));
    expect(patched.source).toBe('footstep-patches');
    expect(patched.positions).toHaveLength(9);

    const sparse = buildTrackingSceneMesh(terrain({ denseMesh: undefined, footsteps: [] }));
    expect(sparse.source).toBe('sparse');
    expect(sparse.positions).toEqual([0, 0, -4, 2, 0, -4, 0, -2, -4]);
  });
});

describe('tracking scene camera', () => {
  it('preserves a rotated COLMAP camera projection after coordinate conversion', () => {
    const rotation = terrainRotation([Math.SQRT1_2, 0, Math.SQRT1_2, 0]);
    const camera: TerrainCamera = {
      ...identityCamera(0),
      rotation,
      translation: [0.25, -0.5, 1],
    };
    const cameraPoint: TerrainVector = [1, 2, 5];
    const shifted: TerrainVector = [
      cameraPoint[0] - camera.translation[0],
      cameraPoint[1] - camera.translation[1],
      cameraPoint[2] - camera.translation[2],
    ];
    const worldPoint: TerrainVector = [
      rotation[0] * shifted[0] + rotation[3] * shifted[1] + rotation[6] * shifted[2],
      rotation[1] * shifted[0] + rotation[4] * shifted[1] + rotation[7] * shifted[2],
      rotation[2] * shifted[0] + rotation[5] * shifted[1] + rotation[8] * shifted[2],
    ];
    const projectedCameraPoint = terrainCameraPoint(camera, worldPoint);
    expect(projectedCameraPoint[0]).toBeCloseTo(cameraPoint[0], 8);
    expect(projectedCameraPoint[1]).toBeCloseTo(cameraPoint[1], 8);
    expect(projectedCameraPoint[2]).toBeCloseTo(cameraPoint[2], 8);

    const pose = terrainCameraToEditorPose(camera);
    const frame = resolveOrbitCameraFrame(
      { position: pose.position, rotation: pose.rotation, scale: { x: 1, y: 1, z: 1 } },
      { nearPlane: 0.01, farPlane: 1000, fov: 45, minimumDistance: 1 },
      { width: 1000, height: 500 },
    );
    const editorPoint = { x: worldPoint[0], y: -worldPoint[1], z: -worldPoint[2] };
    const delta = {
      x: editorPoint.x - frame.eye.x,
      y: editorPoint.y - frame.eye.y,
      z: editorPoint.z - frame.eye.z,
    };
    const dot = (a: typeof delta, b: typeof delta) => a.x * b.x + a.y * b.y + a.z * b.z;
    const sceneProjection: [number, number] = [
      0.5 + 600 * dot(delta, frame.right) / (1000 * dot(delta, frame.forward)),
      0.5 - 600 * dot(delta, frame.cameraUp) / (500 * dot(delta, frame.forward)),
    ];
    const colmapProjection = terrainProject(terrain().intrinsics, cameraPoint);
    expect(sceneProjection[0]).toBeCloseTo(colmapProjection[0], 8);
    expect(sceneProjection[1]).toBeCloseTo(colmapProjection[1], 8);
  });

  it('maps source PTS through clip speed and splits real camera-coverage gaps', () => {
    const sourceClip = {
      id: 'source-clip', duration: 2, inPoint: 10, outPoint: 14, speed: 2,
      reversed: false, mediaFileId: 'source',
    } as TimelineClip;
    const plan = buildTrackingSceneCameraPlan({
      terrain: terrain({ cameras: [identityCamera(10), identityCamera(11), identityCamera(13)] }),
      bounds,
      sourceTiming: { clip: sourceClip, keyframes: [] },
      preferredFrameRate: 60,
    });
    expect(plan.duration).toBe(2);
    expect(plan.frameRate).toBe(60);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]).toMatchObject({ startTime: 0, duration: 1 });
    expect(plan.segments[0]?.poses.map((pose) => pose.time)).toEqual([0, 0.5]);
    expect(plan.segments[1]).toMatchObject({ startTime: 1.5, duration: 0.5 });
  });

  it('uses raw solved timestamps and camera cadence without a surviving source clip', () => {
    const plan = buildTrackingSceneCameraPlan({
      terrain: terrain({ cameras: [identityCamera(10, 1 / 24), identityCamera(10 + 1 / 24, 1 / 24)] }),
      bounds,
    });
    expect(plan.frameRate).toBe(24);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]?.startTime).toBe(0);
    expect(plan.segments[0]?.poses[0]?.time).toBe(0);
    expect(plan.segments[0]?.poses[1]?.time).toBeCloseTo(1 / 24, 10);
  });

  it('rejects calibration the standard scene camera cannot reproduce', () => {
    expect(() => assertTrackingSceneCameraCalibration({
      width: 1000, height: 500, fx: 600, fy: 580, cx: 480, cy: 250, k1: 0.02,
    })).toThrow(/SIMPLE_PINHOLE/);
  });

  it('quantifies and explicitly enables a best-fit camera for unsupported lens terms', () => {
    const intrinsics = {
      width: 720, height: 1280, fx: 587.7322376026574, fy: 587.7322376026574,
      cx: 360, cy: 640, k1: -0.0008439721664813247,
    };
    const assessment = assessTrackingSceneCalibration(intrinsics);
    expect(assessment.exactSupported).toBe(false);
    expect(assessment.reason).toMatch(/radial distortion/);
    expect(assessment.maxPixelError).toBeGreaterThan(0.9);
    expect(assessment.maxPixelError).toBeLessThan(1.1);

    const plan = buildTrackingSceneCameraPlan({
      terrain: terrain({ intrinsics }),
      bounds,
      allowApproximateCamera: true,
    });
    expect(plan.calibration).toEqual(assessment);
    expect(plan.settings.fov).toBeCloseTo(
      2 * Math.atan(1280 / (2 * intrinsics.fy)) * 180 / Math.PI,
      10,
    );
  });
});
