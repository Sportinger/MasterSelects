import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSharedSceneDefaultCameraDistance,
  resolveRenderableSharedSceneCamera,
  resolveSharedSceneCamera,
  resolveSharedSceneCameraConfig,
} from '../../src/engine/scene/SceneCameraUtils';
import {
  resolveOrbitCameraPose,
  resolveOrbitCameraTranslationForFixedEye,
} from '../../src/engine/gaussian/core/SplatCameraUtils';
import { useEngineStore } from '../../src/stores/engineStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialEngineState = useEngineStore.getState();
const initialMediaState = useMediaStore.getState();
const initialTimelineState = useTimelineStore.getState();

describe('SceneCameraUtils', () => {
  beforeEach(() => {
    useEngineStore.setState(initialEngineState);
    useMediaStore.setState(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
  });

  it('resolves the selected scene-nav camera clip through the generic compatibility selector', () => {
    useEngineStore.setState({
      sceneNavClipId: 'camera-nav-1',
    } as any);
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    } as any);
    useTimelineStore.setState({
      playheadPosition: 4,
      tracks: [
        {
          id: 'track-camera',
          type: 'video',
          visible: true,
        },
      ],
      clips: [
        {
          id: 'camera-nav-1',
          trackId: 'track-camera',
          startTime: 0,
          duration: 10,
          transform: {
            position: { x: 0.2, y: -0.3, z: 4 },
            scale: { x: 1.1, y: 1.1, z: 0.25 },
            rotation: { x: 12, y: -18, z: 0 },
            opacity: 1,
            blendMode: 'normal',
          },
          source: {
            type: 'camera',
            cameraSettings: {
              fov: 70,
              near: 0.5,
              far: 500,
            },
          },
        },
      ],
    } as any);

    const viewport = { width: 1920, height: 1080 };
    const config = resolveSharedSceneCameraConfig(viewport, 4);
    const expected = resolveOrbitCameraPose(
      {
        position: { x: 0.2, y: -0.3, z: 4 },
        scale: { x: 1.1, y: 1.1, z: 0.25 },
        rotation: { x: 12, y: -18, z: 0 },
      },
      {
        nearPlane: 0.5,
        farPlane: 500,
        fov: 70,
        minimumDistance: getSharedSceneDefaultCameraDistance(70),
      },
      viewport,
    );

    expect(config).toMatchObject({
      position: expected.eye,
      target: expected.target,
      up: expected.up,
      fov: expected.fovDegrees,
      near: expected.near,
      far: expected.far,
      applyDefaultDistance: false,
    });
  });

  it('builds the default shared scene camera contract when no scene-specific camera is active', () => {
    useEngineStore.setState({
      sceneNavClipId: null,
    } as any);
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    } as any);
    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [],
      clips: [],
    } as any);

    const camera = resolveSharedSceneCamera({ width: 1280, height: 720 }, 0);

    expect(camera.cameraPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(camera.cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(camera.cameraUp).toEqual({ x: 0, y: 1, z: 0 });
    expect(camera.fov).toBe(50);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expect(camera.viewport).toEqual({ width: 1280, height: 720 });
    expect(camera.viewMatrix).toHaveLength(16);
    expect(camera.projectionMatrix).toHaveLength(16);
  });

  it('builds a renderable shared scene camera with default distance applied to the eye position', () => {
    useEngineStore.setState({
      sceneNavClipId: null,
    } as any);
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    } as any);
    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [],
      clips: [],
    } as any);

    const camera = resolveRenderableSharedSceneCamera({ width: 1280, height: 720 }, 0);
    const expectedDistance = getSharedSceneDefaultCameraDistance(50);

    expect(camera.cameraPosition).toEqual({ x: 0, y: 0, z: expectedDistance });
    expect(camera.cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(camera.applyDefaultDistance).toBe(false);
    expect(camera.viewMatrix[14]).toBeCloseTo(-expectedDistance);
  });

  it('resolves nested scene cameras from explicit scene context instead of the active timeline state', () => {
    useEngineStore.setState({
      sceneNavClipId: 'global-camera',
    } as any);
    useMediaStore.setState({
      activeCompositionId: 'main-comp',
      compositions: [{
        id: 'main-comp',
        camera: {
          enabled: true,
          position: { x: 9, y: 9, z: 9 },
          target: { x: 1, y: 1, z: 1 },
          up: { x: 0, y: 1, z: 0 },
          fov: 24,
          near: 0.4,
          far: 240,
        },
      }],
    } as any);
    useTimelineStore.setState({
      playheadPosition: 2,
      tracks: [{
        id: 'global-track',
        type: 'video',
        visible: true,
      }],
      clips: [{
        id: 'global-camera',
        trackId: 'global-track',
        startTime: 0,
        duration: 10,
        source: {
          type: 'camera',
          cameraSettings: {
            fov: 35,
            near: 0.2,
            far: 350,
          },
        },
      }],
      clipKeyframes: new Map(),
      getInterpolatedTransform: () => ({
        position: { x: 10, y: 10, z: 10 },
        scale: { x: 2, y: 2, z: 2 },
        rotation: { x: 45, y: 45, z: 45 },
        opacity: 1,
        blendMode: 'normal',
      }),
    } as any);

    const viewport = { width: 1920, height: 1080 };
    const context = {
      compositionId: 'nested-comp',
      sceneNavClipId: null,
      tracks: [{
        id: 'nested-track',
        type: 'video',
        visible: true,
      }],
      clips: [{
        id: 'nested-camera',
        trackId: 'nested-track',
        startTime: 0,
        duration: 10,
        transform: {
          position: { x: 0.2, y: -0.25, z: 4 },
          scale: { x: 1.1, y: 1.1, z: 0.4 },
          rotation: { x: 14, y: -12, z: 0 },
          opacity: 1,
          blendMode: 'normal',
        },
        source: {
          type: 'camera',
          cameraSettings: {
            fov: 68,
            near: 0.3,
            far: 420,
          },
        },
      }],
      clipKeyframes: new Map([
        ['nested-camera', [
          {
            id: 'nested-camera-kf-1',
            clipId: 'nested-camera',
            property: 'position.x',
            time: 0,
            value: 0.2,
            easing: 'linear',
          },
          {
            id: 'nested-camera-kf-2',
            clipId: 'nested-camera',
            property: 'position.x',
            time: 4,
            value: 0.6,
            easing: 'linear',
          },
        ]],
      ]),
    };

    const config = resolveSharedSceneCameraConfig(viewport, 2, context);
    const expected = resolveOrbitCameraPose(
      {
        position: { x: 0.4, y: -0.25, z: 4 },
        scale: { x: 1.1, y: 1.1, z: 0.4 },
        rotation: { x: 14, y: -12, z: 0 },
      },
      {
        nearPlane: 0.3,
        farPlane: 420,
        fov: 68,
        minimumDistance: getSharedSceneDefaultCameraDistance(68),
      },
      viewport,
    );

    expect(config).toMatchObject({
      position: expected.eye,
      target: expected.target,
      up: expected.up,
      fov: expected.fovDegrees,
      near: expected.near,
      far: expected.far,
      applyDefaultDistance: false,
    });
  });

  it('interpolates FPS look camera keyframes as world poses near vertical pitch', () => {
    const viewport = { width: 1920, height: 1080 };
    const settings = {
      nearPlane: 0.1,
      farPlane: 1000,
      fov: 60,
      minimumDistance: getSharedSceneDefaultCameraDistance(60),
    };
    const startTransform = {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 0 },
      rotation: { x: 89.5, y: 0, z: 0 },
    };
    const endRotation = { x: 89.5, y: 180, z: 0 };
    const endTranslation = resolveOrbitCameraTranslationForFixedEye(
      startTransform,
      endRotation,
      settings,
      viewport,
    );
    const endTransform = {
      position: {
        x: endTranslation.positionX,
        y: endTranslation.positionY,
        z: 0,
      },
      scale: {
        x: 1,
        y: 1,
        z: endTranslation.forwardOffset,
      },
      rotation: endRotation,
    };
    const startPose = resolveOrbitCameraPose(startTransform, settings, viewport);
    const endPose = resolveOrbitCameraPose(endTransform, settings, viewport);
    const cameraClip = {
      id: 'vertical-fps-camera',
      trackId: 'camera-track',
      startTime: 0,
      duration: 2,
      transform: {
        ...startTransform,
        opacity: 1,
        blendMode: 'normal',
      },
      source: {
        type: 'camera',
        cameraSettings: {
          fov: 60,
          near: 0.1,
          far: 1000,
        },
      },
    };

    const config = resolveSharedSceneCameraConfig(viewport, 1, {
      sceneNavClipId: 'vertical-fps-camera',
      tracks: [{
        id: 'camera-track',
        type: 'video',
        visible: true,
      }],
      clips: [cameraClip as any],
      clipKeyframes: new Map([[
        'vertical-fps-camera',
        [
          { id: 'px0', clipId: 'vertical-fps-camera', property: 'position.x', time: 0, value: startTransform.position.x, easing: 'linear' },
          { id: 'px1', clipId: 'vertical-fps-camera', property: 'position.x', time: 2, value: endTransform.position.x, easing: 'linear' },
          { id: 'py0', clipId: 'vertical-fps-camera', property: 'position.y', time: 0, value: startTransform.position.y, easing: 'linear' },
          { id: 'py1', clipId: 'vertical-fps-camera', property: 'position.y', time: 2, value: endTransform.position.y, easing: 'linear' },
          { id: 'sz0', clipId: 'vertical-fps-camera', property: 'scale.z', time: 0, value: startTransform.scale.z, easing: 'linear' },
          { id: 'sz1', clipId: 'vertical-fps-camera', property: 'scale.z', time: 2, value: endTransform.scale.z, easing: 'linear' },
          { id: 'rx0', clipId: 'vertical-fps-camera', property: 'rotation.x', time: 0, value: startTransform.rotation.x, easing: 'linear' },
          { id: 'rx1', clipId: 'vertical-fps-camera', property: 'rotation.x', time: 2, value: endTransform.rotation.x, easing: 'linear' },
          { id: 'ry0', clipId: 'vertical-fps-camera', property: 'rotation.y', time: 0, value: startTransform.rotation.y, easing: 'linear' },
          { id: 'ry1', clipId: 'vertical-fps-camera', property: 'rotation.y', time: 2, value: endTransform.rotation.y, easing: 'linear' },
        ],
      ]]),
    });

    expect(endPose.eye.x).toBeCloseTo(startPose.eye.x, 5);
    expect(endPose.eye.y).toBeCloseTo(startPose.eye.y, 5);
    expect(endPose.eye.z).toBeCloseTo(startPose.eye.z, 5);
    expect(config.position.x).toBeCloseTo(startPose.eye.x, 5);
    expect(config.position.y).toBeCloseTo(startPose.eye.y, 5);
    expect(config.position.z).toBeCloseTo(startPose.eye.z, 5);
  });
});
