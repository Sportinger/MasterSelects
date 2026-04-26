import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSharedSceneDefaultCameraDistance,
  resolveRenderableSharedSceneCamera,
  resolveSharedSceneCamera,
  resolveSharedSceneCameraConfig,
} from '../../src/engine/scene/SceneCameraUtils';
import {
  resolveOrbitCameraFrame,
  resolveOrbitCameraPose,
  resolveOrbitCameraTranslationForFixedEye,
} from '../../src/engine/gaussian/core/SplatCameraUtils';
import { useEngineStore } from '../../src/stores/engineStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';

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
    });
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    });
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
    });

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
    });
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    });
    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [],
      clips: [],
    });

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
    });
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    });
    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [],
      clips: [],
    });

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
    });
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
    });
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
    });

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

    expect(config.position.x).toBeCloseTo(expected.eye.x, 5);
    expect(config.position.y).toBeCloseTo(expected.eye.y, 5);
    expect(config.position.z).toBeCloseTo(expected.eye.z, 5);
    expect(config.target.x).toBeCloseTo(expected.target.x, 5);
    expect(config.target.y).toBeCloseTo(expected.target.y, 5);
    expect(config.target.z).toBeCloseTo(expected.target.z, 5);
    expect(config.up.x).toBeCloseTo(expected.up.x, 5);
    expect(config.up.y).toBeCloseTo(expected.up.y, 5);
    expect(config.up.z).toBeCloseTo(expected.up.z, 5);
    expect(config.fov).toBe(expected.fovDegrees);
    expect(config.near).toBe(expected.near);
    expect(config.far).toBe(expected.far);
    expect(config.applyDefaultDistance).toBe(false);
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
      clips: [cameraClip as unknown as TimelineClip],
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

  it('interpolates pure camera zoom keyframes in world pose space', () => {
    const viewport = { width: 1920, height: 1080 };
    const settings = {
      nearPlane: 0.1,
      farPlane: 1000,
      fov: 60,
      minimumDistance: getSharedSceneDefaultCameraDistance(60),
    };
    const cameraClip = {
      id: 'zoom-camera',
      trackId: 'camera-track',
      startTime: 0,
      duration: 2,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
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
    const startFrame = resolveOrbitCameraFrame(cameraClip.transform, settings, viewport);
    const endFrame = resolveOrbitCameraFrame(
      {
        ...cameraClip.transform,
        scale: { x: 0.25, y: 0.25, z: 0 },
      },
      settings,
      viewport,
    );

    const config = resolveSharedSceneCameraConfig(viewport, 1, {
      sceneNavClipId: 'zoom-camera',
      tracks: [{
        id: 'camera-track',
        type: 'video',
        visible: true,
      }],
      clips: [cameraClip as unknown as TimelineClip],
      clipKeyframes: new Map([[
        'zoom-camera',
        [
          { id: 'sx0', clipId: 'zoom-camera', property: 'scale.x', time: 0, value: 1, easing: 'linear' },
          { id: 'sx1', clipId: 'zoom-camera', property: 'scale.x', time: 2, value: 0.25, easing: 'linear' },
          { id: 'sy0', clipId: 'zoom-camera', property: 'scale.y', time: 0, value: 1, easing: 'linear' },
          { id: 'sy1', clipId: 'zoom-camera', property: 'scale.y', time: 2, value: 0.25, easing: 'linear' },
        ],
      ]]),
    });

    expect(config.position.z).toBeCloseTo((startFrame.eye.z + endFrame.eye.z) / 2, 5);
    expect(config.target).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('interpolates camera targets directly between keyed world poses', () => {
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
      rotation: { x: 0, y: 0, z: 0 },
    };
    const endTransform = {
      position: { x: 1, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    };
    const cameraClip = {
      id: 'target-camera',
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
    const startFrame = resolveOrbitCameraFrame(startTransform, settings, viewport);
    const endFrame = resolveOrbitCameraFrame(endTransform, settings, viewport);
    const expectedTarget = {
      x: (startFrame.target.x + endFrame.target.x) / 2,
      y: (startFrame.target.y + endFrame.target.y) / 2,
      z: (startFrame.target.z + endFrame.target.z) / 2,
    };

    const config = resolveSharedSceneCameraConfig(viewport, 1, {
      sceneNavClipId: 'target-camera',
      tracks: [{
        id: 'camera-track',
        type: 'video',
        visible: true,
      }],
      clips: [cameraClip as unknown as TimelineClip],
      clipKeyframes: new Map([[
        'target-camera',
        [
          { id: 'px0', clipId: 'target-camera', property: 'position.x', time: 0, value: startTransform.position.x, easing: 'linear' },
          { id: 'px1', clipId: 'target-camera', property: 'position.x', time: 2, value: endTransform.position.x, easing: 'linear' },
          { id: 'sx0', clipId: 'target-camera', property: 'scale.x', time: 0, value: startTransform.scale.x, easing: 'linear' },
          { id: 'sx1', clipId: 'target-camera', property: 'scale.x', time: 2, value: endTransform.scale.x, easing: 'linear' },
          { id: 'sy0', clipId: 'target-camera', property: 'scale.y', time: 0, value: startTransform.scale.y, easing: 'linear' },
          { id: 'sy1', clipId: 'target-camera', property: 'scale.y', time: 2, value: endTransform.scale.y, easing: 'linear' },
          { id: 'ry0', clipId: 'target-camera', property: 'rotation.y', time: 0, value: startTransform.rotation.y, easing: 'linear' },
          { id: 'ry1', clipId: 'target-camera', property: 'rotation.y', time: 2, value: endTransform.rotation.y, easing: 'linear' },
        ],
      ]]),
    });

    expect(config.target.x).toBeCloseTo(expectedTarget.x, 5);
    expect(config.target.y).toBeCloseTo(expectedTarget.y, 5);
    expect(config.target.z).toBeCloseTo(expectedTarget.z, 5);
  });
});
