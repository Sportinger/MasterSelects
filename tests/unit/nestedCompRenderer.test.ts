import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayerRenderData } from '../../src/engine/core/types';
import { NestedCompRenderer } from '../../src/engine/render/NestedCompRenderer';
import type { CompositorPipeline } from '../../src/engine/pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import type { TextureManager } from '../../src/engine/texture/TextureManager';
import type { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import {
  getSharedSceneDefaultCameraDistance,
  resolveRenderableSharedSceneCamera,
} from '../../src/engine/scene/SceneCameraUtils';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const { mockNativeSceneRenderer } = vi.hoisted(() => ({
  mockNativeSceneRenderer: {
    isInitialized: true,
    initialize: vi.fn(async () => true),
    renderScene: vi.fn(() => ({ label: 'nested-shared-scene-view' })),
  },
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('../../src/engine/native3d/NativeSceneRenderer', () => ({
  getNativeSceneRenderer: vi.fn(() => mockNativeSceneRenderer),
}));

const initialMediaState = useMediaStore.getState();
const initialTimelineState = useTimelineStore.getState();
type NestedCompRendererTestAccess = NestedCompRenderer & {
  collectNestedLayerData: (layers: TimelineClip[]) => LayerRenderData[];
  process3DLayersForNested: (
    layerData: LayerRenderData[],
    width: number,
    height: number,
    compId: string,
    clips: TimelineClip[],
    tracks: TimelineTrack[],
  ) => void;
};

function createRenderer() {
  return new NestedCompRenderer(
    {} as GPUDevice,
    {} as unknown as CompositorPipeline,
    {} as unknown as EffectsPipeline,
    {} as unknown as TextureManager,
    {
      getMaskInfo: vi.fn(() => ({
        hasMask: false,
        view: null,
      })),
    } as unknown as MaskTextureManager,
    null,
  ) as unknown as NestedCompRendererTestAccess;
}

describe('NestedCompRenderer shared-scene integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNativeSceneRenderer.isInitialized = true;
    mockNativeSceneRenderer.renderScene.mockReturnValue({ label: 'nested-shared-scene-view' });
    useMediaStore.setState(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
  });

  it('collects nested gaussian splats as shared-scene placeholders', () => {
    const renderer = createRenderer();

    const nestedLayerData = renderer.collectNestedLayerData([{
      id: 'nested-splat-layer',
      name: 'Nested Splat',
      sourceClipId: 'nested-splat-clip',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0.25, y: -0.5, z: 2 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      is3D: true,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:nested-splat',
        gaussianSplatFileName: 'nested.ply',
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
          },
        },
      },
    }] as unknown as TimelineClip[]);

    expect(nestedLayerData).toHaveLength(1);
    expect(nestedLayerData[0]).toMatchObject({
      layer: expect.objectContaining({
        id: 'nested-splat-layer',
        sourceClipId: 'nested-splat-clip',
      }),
      textureView: null,
      sourceWidth: 0,
      sourceHeight: 0,
    });
  });

  it('renders nested 3D layers through the shared scene renderer with nested camera and effector context', () => {
    const renderer = createRenderer();
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
      isPlaying: false,
      isExporting: false,
      clipKeyframes: new Map(),
      tracks: [],
      clips: [],
    });

    const sceneTracks = [{
      id: 'nested-track',
      type: 'video',
      visible: true,
    }];
    const sceneClips = [{
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
    }, {
      id: 'nested-effector',
      trackId: 'nested-track',
      startTime: 1,
      duration: 4,
      transform: {
        position: { x: 0.35, y: -0.15, z: 1.75 },
        scale: { x: 0.45, y: 0.55, z: 0.65 },
        rotation: { x: 10, y: 20, z: 30 },
        opacity: 1,
        blendMode: 'normal',
      },
      source: {
        type: 'splat-effector',
        splatEffectorSettings: {
          mode: 'swirl',
          strength: 45,
          falloff: 1.5,
          speed: 1.25,
          seed: 9,
        },
      },
    }];
    const layerData: LayerRenderData[] = [{
      layer: {
        id: 'nested-splat-layer',
        name: 'Nested Splat',
        sourceClipId: 'nested-splat-clip',
        visible: true,
        opacity: 0.8,
        blendMode: 'screen',
        effects: [{ id: 'fx-1' } as unknown as LayerRenderData['layer']['effects'][number]],
        position: { x: 0.25, y: -0.5, z: 2 },
        scale: { x: 1.5, y: 1.25, z: 0.75 },
        rotation: { x: 0, y: 0, z: 0 },
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:nested-splat',
          gaussianSplatFileName: 'nested.ply',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
            },
          },
          mediaTime: 1.5,
        },
      } as unknown as LayerRenderData,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: 1920,
      sourceHeight: 1080,
    }];
    const expectedCamera = resolveRenderableSharedSceneCamera(
      { width: 1280, height: 720 },
      2,
      {
        clips: sceneClips as unknown as TimelineClip[],
        tracks: sceneTracks as unknown as TimelineTrack[],
        clipKeyframes: new Map(),
        compositionId: 'nested-comp',
        sceneNavClipId: null,
      },
    );

    renderer.process3DLayersForNested(
      layerData,
      1280,
      720,
      2,
      'nested-comp',
      sceneClips as unknown as TimelineClip[],
      sceneTracks as unknown as TimelineTrack[],
    );

    expect(mockNativeSceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [deviceArg, layers3D, camera, effectors, isRealtimePlayback] =
      mockNativeSceneRenderer.renderScene.mock.calls[0];
    expect(deviceArg).toEqual({});
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'splat',
      layerId: 'nested-splat-layer',
      clipId: 'nested-splat-clip',
    });
    expect(camera).toMatchObject({
      cameraPosition: expectedCamera.cameraPosition,
      cameraTarget: expectedCamera.cameraTarget,
      fov: expectedCamera.fov,
      near: expectedCamera.near,
      far: expectedCamera.far,
      viewport: expectedCamera.viewport,
    });
    expect(effectors).toHaveLength(1);
    expect(effectors[0]).toMatchObject({
      clipId: 'nested-effector',
      mode: 'swirl',
      strength: 45,
    });
    expect(isRealtimePlayback).toBe(false);

    expect(layerData).toHaveLength(1);
    expect(layerData[0]).toMatchObject({
      textureView: { label: 'nested-shared-scene-view' },
      sourceWidth: 1280,
      sourceHeight: 720,
    });
    expect(layerData[0]?.layer).toMatchObject({
      id: '__scene_3d_nested__',
      opacity: 0.8,
      blendMode: 'screen',
    });
  });

  it('uses a renderable default camera for nested 3D video planes without a scene camera', () => {
    const renderer = createRenderer();
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    });
    useTimelineStore.setState({
      isPlaying: false,
      isExporting: false,
      clipKeyframes: new Map(),
      tracks: [],
      clips: [],
    });

    const layerData: LayerRenderData[] = [{
      layer: {
        id: 'nested-video-plane',
        name: 'Nested Video Plane',
        sourceClipId: 'nested-video-plane-clip',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        is3D: true,
        source: {
          type: 'video',
          videoElement: {
            readyState: 4,
            videoWidth: 1920,
            videoHeight: 1080,
          },
        },
      } as unknown as LayerRenderData,
      isVideo: true,
      externalTexture: null,
      textureView: { label: 'nested-plane-view' } as unknown as LayerRenderData,
      sourceWidth: 1920,
      sourceHeight: 1080,
    }];

    renderer.process3DLayersForNested(
      layerData,
      1280,
      720,
      0,
      'nested-comp',
      [],
      [],
    );

    expect(mockNativeSceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [, layers3D, camera] = mockNativeSceneRenderer.renderScene.mock.calls[0];
    const defaultDistance = getSharedSceneDefaultCameraDistance(50);
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'plane',
      layerId: 'nested-video-plane',
      clipId: 'nested-video-plane-clip',
    });
    expect(camera.cameraPosition).toEqual({ x: 0, y: 0, z: defaultDistance });
    expect(camera.cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(camera.viewMatrix[14]).toBeCloseTo(-defaultDistance);
    expect(layerData[0]?.textureView).toEqual({ label: 'nested-shared-scene-view' });
  });
});
