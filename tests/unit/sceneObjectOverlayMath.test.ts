import { describe, expect, it } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import {
  buildCameraPreviewSceneObject,
  buildCameraWireframeLines,
  collectPreviewSceneObjects,
  projectWorldToCanvas,
  resolveAxisScreenHandle,
} from '../../src/components/preview/sceneObjectOverlayMath';
import {
  SCENE_GIZMO_AXIS_HIT_START_OFFSET,
  SCENE_GIZMO_AXIS_SCREEN_LENGTH,
} from '../../src/engine/scene/SceneGizmoConstants';
import { resolveRenderableSharedSceneCamera } from '../../src/engine/scene/SceneCameraUtils';

function makeClip(partial: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.dat'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'gaussian-splat' },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    masks: [],
    ...partial,
  };
}

const tracks: TimelineTrack[] = [{
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  clips: [],
  visible: true,
  muted: false,
  locked: false,
}];

describe('sceneObjectOverlayMath', () => {
  it('projects world origin into the canvas', () => {
    const camera = resolveRenderableSharedSceneCamera({ width: 1920, height: 1080 }, 0);
    const screen = projectWorldToCanvas({ x: 0, y: 0, z: 0 }, camera, { width: 960, height: 540 });

    expect(screen.visible).toBe(true);
    expect(screen.x).toBeCloseTo(480, 0);
    expect(screen.y).toBeCloseTo(270, 0);
  });

  it('collects active scene objects only from visible video tracks and skips cameras in the normal view', () => {
    const clips = [
      makeClip({ id: 'active-splat', name: 'Splat' }),
      makeClip({ id: 'future-splat', startTime: 20 }),
      makeClip({
        id: 'camera',
        name: 'Camera',
        source: { type: 'camera', cameraSettings: { fov: 50, near: 0.1, far: 1000 } },
      }),
    ];

    const { objects } = collectPreviewSceneObjects({
      clips,
      tracks,
      clipKeyframes: new Map(),
      playheadPosition: 1,
      viewport: { width: 1920, height: 1080 },
      canvasSize: { width: 960, height: 540 },
    });

    expect(objects.map((object) => object.clipId).toSorted()).toEqual(['active-splat']);
  });

  it('builds the camera preview object explicitly for camera edit view', () => {
    const viewport = { width: 1920, height: 1080 };
    const canvasSize = { width: 960, height: 540 };
    const renderCamera = resolveRenderableSharedSceneCamera(viewport, 0);
    const cameraClip = makeClip({
      id: 'timeline-camera',
      name: 'Timeline Camera',
      source: { type: 'camera', cameraSettings: { fov: 50, near: 0.1, far: 1000 } },
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0.2, y: 0.1, z: 4 },
        scale: { x: 1, y: 1, z: 0 },
        rotation: { x: 12, y: 30, z: 0 },
      },
    });

    const object = buildCameraPreviewSceneObject(
      cameraClip,
      cameraClip.transform,
      renderCamera,
      viewport,
      canvasSize,
    );

    expect(object?.clipId).toBe('timeline-camera');
    expect(object?.kind).toBe('camera');
    expect(object?.transformSpace).toBe('world');
    expect(Number.isFinite(object?.screen.x)).toBe(true);
    expect(Number.isFinite(object?.screen.y)).toBe(true);
  });

  it('draws the camera edit-view frame from lens FOV and camera resolution aspect', () => {
    const viewport = { width: 1920, height: 1080 };
    const canvasSize = { width: 960, height: 540 };
    const renderCamera = resolveRenderableSharedSceneCamera(viewport, 0);

    const getFrustumBounds = (cameraSettings: {
      fov: number;
      near: number;
      far: number;
      resolutionWidth: number;
      resolutionHeight: number;
    }) => {
      const object = {
        clipId: `camera-${cameraSettings.fov}`,
        name: 'Camera',
        kind: 'camera' as const,
        transformSpace: 'world' as const,
        worldPosition: { x: 0, y: 0, z: 0 },
        axisBasis: {
          x: { x: 1, y: 0, z: 0 },
          y: { x: 0, y: 1, z: 0 },
          z: { x: 0, y: 0, z: -1 },
        },
        cameraSettings,
        screen: projectWorldToCanvas({ x: 0, y: 0, z: 0 }, renderCamera, canvasSize),
      };
      const points = buildCameraWireframeLines(object, renderCamera, canvasSize)
        .filter((line) => line.role === 'frustum')
        .flatMap((line) => [line.from, line.to]);
      return {
        width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
        height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
      };
    };

    const teleBounds = getFrustumBounds({ fov: 30, near: 0.1, far: 1000, resolutionWidth: 1920, resolutionHeight: 1080 });
    const wideBounds = getFrustumBounds({ fov: 90, near: 0.1, far: 1000, resolutionWidth: 1920, resolutionHeight: 1080 });
    const squareBounds = getFrustumBounds({ fov: 90, near: 0.1, far: 1000, resolutionWidth: 1080, resolutionHeight: 1080 });

    expect(wideBounds.width).toBeGreaterThan(teleBounds.width);
    expect(wideBounds.height).toBeGreaterThan(teleBounds.height);
    expect(squareBounds.width).toBeLessThan(wideBounds.width);
    expect(squareBounds.height).toBeCloseTo(wideBounds.height, 3);
  });

  it('keeps axis hitboxes aligned with the GPU gizmo length while leaving the center grip free', () => {
    const camera = resolveRenderableSharedSceneCamera({ width: 1920, height: 1080 }, 0);
    const canvasSize = { width: 960, height: 540 };
    const origin = { x: 0, y: 0, z: 0 };
    const screenOrigin = projectWorldToCanvas(origin, camera, canvasSize);
    const handle = resolveAxisScreenHandle('x', origin, camera, canvasSize);

    const startDistance = Math.hypot(
      handle.start.x - screenOrigin.x,
      handle.start.y - screenOrigin.y,
    );
    const endDistance = Math.hypot(
      handle.end.x - screenOrigin.x,
      handle.end.y - screenOrigin.y,
    );

    expect(startDistance).toBeCloseTo(SCENE_GIZMO_AXIS_HIT_START_OFFSET, 5);
    expect(endDistance).toBeCloseTo(SCENE_GIZMO_AXIS_SCREEN_LENGTH, 5);
  });

  it('aligns gaussian splat axis hitboxes with native orientation presets', () => {
    const canvasSize = { width: 960, height: 540 };
    const { camera, objects } = collectPreviewSceneObjects({
      clips: [
        makeClip({
          id: 'oriented-splat',
          source: {
            type: 'gaussian-splat',
            gaussianSplatSettings: {
              render: {
                orientationPreset: 'flip-x-180',
              },
            },
          },
        }),
      ],
      tracks,
      clipKeyframes: new Map(),
      playheadPosition: 1,
      viewport: { width: 1920, height: 1080 },
      canvasSize,
    });
    const object = objects[0]!;
    const yHandle = resolveAxisScreenHandle('y', object.worldPosition, camera, canvasSize, object.axisBasis.y);

    expect(object.axisBasis.y.y).toBeCloseTo(-1);
    expect(object.axisBasis.z.z).toBeCloseTo(-1);
    expect(yHandle.direction.y).toBeGreaterThan(0);
  });

  it('maps effector transform into shared scene space', () => {
    const clips = [
      makeClip({
        id: 'effector',
        source: { type: 'splat-effector' },
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0.5, y: 0.25, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      }),
    ];

    const { objects } = collectPreviewSceneObjects({
      clips,
      tracks,
      clipKeyframes: new Map(),
      playheadPosition: 1,
      viewport: { width: 1920, height: 1080 },
      canvasSize: { width: 960, height: 540 },
    });

    expect(objects[0]?.kind).toBe('effector');
    expect(objects[0]?.worldPosition.x).toBeCloseTo(0.8889, 3);
    expect(objects[0]?.worldPosition.y).toBeCloseTo(-0.25, 3);
    expect(objects[0]?.worldPosition.z).toBe(2);
  });
});
