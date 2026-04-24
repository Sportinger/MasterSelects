import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderDispatcher } from '../../src/engine/render/RenderDispatcher';
import { getSharedSceneDefaultCameraDistance } from '../../src/engine/scene/SceneCameraUtils';
import { useEngineStore } from '../../src/stores/engineStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

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

vi.mock('../../src/services/performanceMonitor', () => ({
  reportRenderTime: vi.fn(),
}));

function createDispatcher(isPlaying = true) {
  const collect = vi.fn(() => []);
  const deps = {
    getDevice: vi.fn(() => ({})),
    isRecovering: vi.fn(() => false),
    sampler: {},
    previewContext: null,
    targetCanvases: new Map(),
    compositorPipeline: {
      beginFrame: vi.fn(),
    },
    outputPipeline: {},
    slicePipeline: null,
    textureManager: {},
    maskTextureManager: null,
    renderTargetManager: {
      getPingView: vi.fn(() => ({})),
      getPongView: vi.fn(() => ({})),
      getResolution: vi.fn(() => ({ width: 1920, height: 1080 })),
    },
    layerCollector: {
      collect,
      getDecoder: vi.fn(() => 'WebCodecs'),
      getWebCodecsInfo: vi.fn(() => undefined),
      hasActiveVideo: vi.fn(() => false),
    },
    compositor: {},
    nestedCompRenderer: null,
    cacheManager: {
      getScrubbingCache: vi.fn(() => null),
      getLastVideoTime: vi.fn(),
      setLastVideoTime: vi.fn(),
    },
    exportCanvasManager: {
      getIsExporting: vi.fn(() => false),
    },
    performanceStats: {
      setDecoder: vi.fn(),
      setWebCodecsInfo: vi.fn(),
      setLayerCount: vi.fn(),
    },
    renderLoop: {
      getIsPlaying: vi.fn(() => isPlaying),
      setHasActiveVideo: vi.fn(),
    },
  } as any;

  const dispatcher = new RenderDispatcher(deps);
  const renderEmptyFrame = vi
    .spyOn(dispatcher, 'renderEmptyFrame')
    .mockImplementation(() => {});
  const recordMainPreviewFrame = vi
    .spyOn(dispatcher as any, 'recordMainPreviewFrame')
    .mockImplementation(() => {});

  return {
    dispatcher,
    deps,
    collect,
    renderEmptyFrame,
    recordMainPreviewFrame,
  };
}

describe('RenderDispatcher empty playback hold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEngineStore.setState({
      sceneNavClipId: null,
      sceneNavFpsMode: false,
    } as any);
    useMediaStore.setState({
      files: [],
      activeCompositionId: null,
      compositions: [],
    } as any);
    useTimelineStore.setState({
      isDraggingPlayhead: false,
      playheadPosition: 0,
      tracks: [],
      clips: [],
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
    } as any);
  });

  it('keeps the last frame on small playback stalls with an empty layer set', () => {
    const { dispatcher, deps, renderEmptyFrame, recordMainPreviewFrame } = createDispatcher(true);

    dispatcher.lastRenderHadContent = true;
    (dispatcher as any).lastPreviewTargetTimeMs = 17_667;

    dispatcher.render([{
      id: 'layer-1',
      sourceClipId: 'clip-1',
      visible: true,
      opacity: 1,
      source: {
        type: 'video',
        mediaTime: 17.75,
      },
    } as any]);

    expect(renderEmptyFrame).not.toHaveBeenCalled();
    expect(recordMainPreviewFrame).not.toHaveBeenCalled();
    expect(deps.performanceStats.setLayerCount).toHaveBeenCalledWith(0);
    expect(dispatcher.lastRenderHadContent).toBe(true);
  });

  it('clears the stale preview canvas on large target jumps with empty layer data', () => {
    const { dispatcher, deps, renderEmptyFrame, recordMainPreviewFrame } = createDispatcher(true);

    dispatcher.lastRenderHadContent = true;
    (dispatcher as any).lastPreviewTargetTimeMs = 17_667;

    dispatcher.render([{
      id: 'layer-1',
      sourceClipId: 'clip-1',
      visible: true,
      opacity: 1,
      source: {
        type: 'video',
        mediaTime: 8.02,
      },
    } as any]);

    expect(renderEmptyFrame).toHaveBeenCalledTimes(1);
    expect(recordMainPreviewFrame).toHaveBeenCalledWith('empty', undefined, {
      clipId: 'clip-1',
      targetTimeMs: 8020,
    });
    expect(deps.performanceStats.setLayerCount).toHaveBeenCalledWith(0);
    expect(dispatcher.lastRenderHadContent).toBe(false);
  });

  it('uses the export render-time override for active splat effectors', () => {
    const { dispatcher } = createDispatcher(false);

    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [{
        id: 'track-1',
        type: 'video',
        visible: true,
      }],
      clips: [{
        id: 'effector-1',
        trackId: 'track-1',
        startTime: 5,
        duration: 2,
        transform: {
          position: { x: 0.25, y: -0.5, z: 3 },
          scale: { x: 0.4, y: 0.6, z: 0.8 },
          rotation: { x: 10, y: 20, z: 30 },
          opacity: 1,
          blendMode: 'normal',
        },
        source: {
          type: 'splat-effector',
          splatEffectorSettings: {
            mode: 'swirl',
            strength: 55,
            falloff: 1.2,
            speed: 2,
            seed: 7,
          },
        },
      }],
    } as any);

    expect((dispatcher as any).collectActiveSplatEffectors(1920, 1080)).toHaveLength(0);

    dispatcher.setRenderTimeOverride(5.5);
    const effectors = (dispatcher as any).collectActiveSplatEffectors(1920, 1080);

    expect(effectors).toHaveLength(1);
    expect(effectors[0]).toMatchObject({
      clipId: 'effector-1',
      mode: 'swirl',
      strength: 55,
      falloff: 1.2,
      speed: 2,
      seed: 7,
      time: 0.5,
      position: {
        x: 0.4444444444444444,
        y: 0.5,
        z: 3,
      },
      rotation: {
        x: 10,
        y: 20,
        z: 30,
      },
      scale: {
        x: 0.4,
        y: 0.6,
        z: 0.8,
      },
      radius: 0.8,
    });
  });

  it('routes native gaussian splats through the shared scene renderer with the shared camera and effectors', () => {
    const { dispatcher, deps } = createDispatcher(false);
    deps.sceneRenderer = {
      isInitialized: true,
      renderScene: vi.fn(() => ({ label: 'shared-scene-view' })),
    };

    useTimelineStore.setState({
      playheadPosition: 0.25,
      tracks: [{
        id: 'track-1',
        type: 'video',
        visible: true,
      }],
      clips: [{
        id: 'effector-1',
        trackId: 'track-1',
        startTime: 0,
        duration: 1,
        transform: {
          position: { x: 0.1, y: -0.2, z: 1.5 },
          scale: { x: 0.5, y: 0.4, z: 0.75 },
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
      }],
    } as any);

    const layerData = [
      {
        layer: {
          id: 'native-splat-layer',
          sourceClipId: 'native-splat-clip',
          name: 'Native Splat',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          is3D: true,
          position: { x: 0.25, y: -0.5, z: 3 },
          scale: { x: 2, y: 1.5, z: 0.75 },
          rotation: { x: 0.1, y: -0.2, z: 0.3 },
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:native-splat',
            gaussianSplatFileName: 'native.ply',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
                backgroundColor: 'transparent',
                maxSplats: 0,
                sortFrequency: 1,
              },
            },
            mediaTime: 1.25,
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ] as any;

    (dispatcher as any).process3DLayers(layerData, {} as GPUDevice, 1920, 1080);

    expect(deps.sceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [deviceArg, layers3D, camera, effectors, isRealtimePlayback] =
      deps.sceneRenderer.renderScene.mock.calls[0];
    expect(deviceArg).toEqual({});
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'splat',
      layerId: 'native-splat-layer',
      clipId: 'native-splat-clip',
    });
    expect(layers3D[0].worldMatrix).toBeInstanceOf(Float32Array);
    expect(layers3D[0].worldMatrix[12]).toBeCloseTo(0.25);
    expect(layers3D[0].worldMatrix[13]).toBeCloseTo(-0.5);
    expect(layers3D[0].worldMatrix[14]).toBeCloseTo(3);
    const defaultDistance = getSharedSceneDefaultCameraDistance(50);
    expect(camera.cameraPosition.x).toBeCloseTo(0);
    expect(camera.cameraPosition.y).toBeCloseTo(0);
    expect(camera.cameraPosition.z).toBeCloseTo(defaultDistance);
    expect(camera.viewMatrix[14]).toBeCloseTo(-defaultDistance);
    expect(effectors).toHaveLength(1);
    expect(effectors[0]).toMatchObject({
      clipId: 'effector-1',
      mode: 'swirl',
      strength: 45,
    });
    expect(isRealtimePlayback).toBe(false);

    expect(layerData).toHaveLength(1);
    expect(layerData[0]?.textureView).toEqual({ label: 'shared-scene-view' });
    expect(layerData[0]?.layer.id).toBe('__scene_3d__');
    expect(layerData[0]?.layer.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(layerData[0]?.layer.scale).toEqual({ x: 1, y: 1 });
    expect(layerData[0]?.layer.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('routes pure native gaussian-splat scenes through the shared scene renderer', () => {
    const { dispatcher, deps } = createDispatcher(false);
    deps.sceneRenderer = {
      isInitialized: true,
      renderScene: vi.fn(() => ({ label: 'shared-scene-view' })),
    };

    const layerData = [
      {
        layer: {
          id: 'native-splat-layer',
          sourceClipId: 'native-splat-clip',
          name: 'Native Splat',
          visible: true,
          opacity: 0.75,
          blendMode: 'screen',
          effects: [{ id: 'fx-1' }],
          is3D: true,
          position: { x: 0.5, y: -0.25, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:native-splat',
            gaussianSplatFileName: 'native.ply',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ] as any;

    (dispatcher as any).process3DLayers(layerData, {} as GPUDevice, 1920, 1080);

    expect(deps.sceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [deviceArg, layers3D] = deps.sceneRenderer.renderScene.mock.calls[0];
    expect(deviceArg).toEqual({});
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'splat',
      layerId: 'native-splat-layer',
      clipId: 'native-splat-clip',
    });

    expect(layerData).toHaveLength(1);
    expect(layerData[0]?.textureView).toEqual({ label: 'shared-scene-view' });
    expect(layerData[0]?.layer.id).toBe('__scene_3d__');
    expect(layerData[0]?.layer.opacity).toBeCloseTo(0.75);
    expect(layerData[0]?.layer.blendMode).toBe('screen');
  });

  it('routes plane plus primitive plus native gaussian-splat scenes through the shared scene renderer once native assets are ready', () => {
    const { dispatcher, deps } = createDispatcher(false);
    deps.sceneRenderer = {
      isInitialized: true,
      renderScene: vi.fn(() => ({ label: 'shared-scene-mixed-view' })),
    };

    const layerData = [
      {
        layer: {
          id: 'video-plane',
          sourceClipId: 'video-plane-clip',
          name: 'Video Plane',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          is3D: true,
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'video',
            videoElement: {
              readyState: 4,
              videoWidth: 1920,
              videoHeight: 1080,
            },
          },
        },
        isVideo: true,
        externalTexture: null,
        textureView: { label: 'plane-layer-view' },
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
      {
        layer: {
          id: 'cube-mesh',
          sourceClipId: 'cube-mesh-clip',
          name: 'Cube Mesh',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          is3D: true,
          position: { x: -0.5, y: 0.25, z: 0.75 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'model',
            meshType: 'cube',
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 100,
        sourceHeight: 100,
      },
      {
        layer: {
          id: 'native-splat-layer',
          sourceClipId: 'native-splat-clip',
          name: 'Native Splat',
          visible: true,
          opacity: 0.8,
          blendMode: 'screen',
          effects: [{ id: 'fx-1' }],
          is3D: true,
          position: { x: 0.25, y: 0, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:native-splat',
            gaussianSplatFileName: 'native.ply',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ] as any;

    (dispatcher as any).process3DLayers(layerData, {} as GPUDevice, 1920, 1080);

    expect(deps.sceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [, layers3D] = deps.sceneRenderer.renderScene.mock.calls[0];
    expect(layers3D).toHaveLength(3);
    expect(layers3D.map((layer: any) => layer.kind)).toEqual(['plane', 'primitive', 'splat']);

    expect(layerData).toHaveLength(1);
    expect(layerData[0]?.textureView).toEqual({ label: 'shared-scene-mixed-view' });
    expect(layerData[0]?.layer.id).toBe('__scene_3d__');
    expect(layerData[0]?.layer.opacity).toBe(1);
    expect(layerData[0]?.layer.blendMode).toBe('normal');
  });

  it('uses a renderable default camera for 3D video planes', () => {
    const { dispatcher, deps } = createDispatcher(false);
    deps.sceneRenderer = {
      isInitialized: true,
      renderScene: vi.fn(() => ({ label: 'shared-scene-video-view' })),
    };

    const layerData = [
      {
        layer: {
          id: 'video-plane',
          sourceClipId: 'video-plane-clip',
          name: 'Video Plane',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          is3D: true,
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'video',
            videoElement: {
              readyState: 4,
              videoWidth: 1920,
              videoHeight: 1080,
            },
          },
        },
        isVideo: true,
        externalTexture: null,
        textureView: { label: 'plane-layer-view' },
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ] as any;

    (dispatcher as any).process3DLayers(layerData, {} as GPUDevice, 1920, 1080);

    expect(deps.sceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [, layers3D, camera] = deps.sceneRenderer.renderScene.mock.calls[0];
    const defaultDistance = getSharedSceneDefaultCameraDistance(50);
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'plane',
      layerId: 'video-plane',
      clipId: 'video-plane-clip',
    });
    expect(camera.cameraPosition).toEqual({ x: 0, y: 0, z: defaultDistance });
    expect(camera.cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(camera.viewMatrix[14]).toBeCloseTo(-defaultDistance);
    expect(layerData[0]?.textureView).toEqual({ label: 'shared-scene-video-view' });
  });

  it('routes 3D text plus native gaussian-splat scenes through the shared scene renderer once native assets are ready', () => {
    const { dispatcher, deps } = createDispatcher(false);
    deps.sceneRenderer = {
      isInitialized: true,
      renderScene: vi.fn(() => ({ label: 'shared-scene-text-view' })),
    };

    const layerData = [
      {
        layer: {
          id: 'headline-text',
          sourceClipId: 'headline-text-clip',
          name: 'Headline Text',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          is3D: true,
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'model',
            meshType: 'text3d',
            text3DProperties: {
              text: 'Native',
              fontFamily: 'helvetiker',
              fontWeight: 'bold',
              size: 0.42,
              depth: 0.14,
              color: '#ffffff',
              letterSpacing: 0.02,
              lineHeight: 1.15,
              textAlign: 'center',
              curveSegments: 8,
              bevelEnabled: true,
              bevelThickness: 0.02,
              bevelSize: 0.01,
              bevelSegments: 2,
            },
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 100,
        sourceHeight: 100,
      },
      {
        layer: {
          id: 'native-splat-layer',
          sourceClipId: 'native-splat-clip',
          name: 'Native Splat',
          visible: true,
          opacity: 0.8,
          blendMode: 'screen',
          effects: [{ id: 'fx-1' }],
          is3D: true,
          position: { x: 0.25, y: 0, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:native-splat',
            gaussianSplatFileName: 'native.ply',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ] as any;

    (dispatcher as any).process3DLayers(layerData, {} as GPUDevice, 1920, 1080);

    expect(deps.sceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [, layers3D] = deps.sceneRenderer.renderScene.mock.calls[0];
    expect(layers3D).toHaveLength(2);
    expect(layers3D.map((layer: any) => layer.kind)).toEqual(['text3d', 'splat']);

    expect(layerData).toHaveLength(1);
    expect(layerData[0]?.textureView).toEqual({ label: 'shared-scene-text-view' });
    expect(layerData[0]?.layer.id).toBe('__scene_3d__');
  });

  it('routes imported models plus native gaussian-splat scenes through the shared scene renderer', () => {
    const { dispatcher, deps } = createDispatcher(false);
    deps.sceneRenderer = {
      isInitialized: true,
      renderScene: vi.fn(() => ({ label: 'shared-scene-model-view' })),
    };

    const layerData = [
      {
        layer: {
          id: 'hero-model',
          sourceClipId: 'hero-model-clip',
          name: 'Hero Model',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          is3D: true,
          position: { x: -0.2, y: 0.1, z: 0.5 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'model',
            modelUrl: 'blob:hero-model',
            file: new File(['model'], 'hero.glb'),
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 100,
        sourceHeight: 100,
      },
      {
        layer: {
          id: 'native-splat-layer',
          sourceClipId: 'native-splat-clip',
          name: 'Native Splat',
          visible: true,
          opacity: 0.8,
          blendMode: 'screen',
          effects: [{ id: 'fx-1' }],
          is3D: true,
          position: { x: 0.25, y: 0, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:native-splat',
            gaussianSplatFileName: 'native.ply',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ] as any;

    (dispatcher as any).process3DLayers(layerData, {} as GPUDevice, 1920, 1080);

    expect(deps.sceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [, layers3D] = deps.sceneRenderer.renderScene.mock.calls[0];
    expect(layers3D).toHaveLength(2);
    expect(layers3D.map((layer: any) => layer.kind)).toEqual(['model', 'splat']);
    expect(layers3D[0]).toMatchObject({
      kind: 'model',
      modelUrl: 'blob:hero-model',
      modelFileName: 'hero.glb',
    });

    expect(layerData).toHaveLength(1);
    expect(layerData[0]?.textureView).toEqual({ label: 'shared-scene-model-view' });
    expect(layerData[0]?.layer.id).toBe('__scene_3d__');
  });

  it('waits for nested 3D and splat assets before precise export rendering', async () => {
    const { dispatcher, deps } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'preloadSceneModelAsset').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    await dispatcher.ensureExportLayersReady([
      {
        id: 'native-splat',
        name: 'Native Splat',
        sourceClipId: 'native-splat',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:native-splat',
          gaussianSplatFileName: 'native.splat',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
            },
          },
        },
      },
      {
        id: 'nested-comp',
        name: 'Nested Comp',
        visible: true,
        opacity: 1,
        source: {
          type: 'image',
          nestedComposition: {
            compositionId: 'comp-1',
            width: 1920,
            height: 1080,
            layers: [
              {
                id: 'nested-model',
                name: 'Hero Model',
                visible: true,
                opacity: 1,
                is3D: true,
                source: {
                  type: 'model',
                  modelUrl: 'blob:model-1',
                },
              },
              {
                id: 'nested-splat',
                name: 'Nested Splat',
                visible: true,
                opacity: 1,
                is3D: true,
                source: {
                  type: 'gaussian-splat',
                  gaussianSplatUrl: 'blob:media-splat',
                  gaussianSplatFileName: 'media-backed.splat',
                  gaussianSplatFileHash: 'media-hash-1',
                  gaussianSplatSettings: {
                    render: {
                      useNativeRenderer: false,
                      maxSplats: 0,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ] as any);

    expect(dispatcher.ensureSceneRendererInitialized).toHaveBeenCalledWith(1920, 1080);
    expect(dispatcher.preloadSceneModelAsset).toHaveBeenCalledWith('blob:model-1', 'Hero Model');
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'native-splat',
        clipId: 'native-splat',
        url: 'blob:native-splat',
        fileName: 'native.splat',
      }),
    );
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'nested-splat',
        clipId: 'nested-splat',
        fileName: 'media-backed.splat',
        url: 'blob:media-splat',
      }),
    );
    expect(deps.renderTargetManager.getResolution).toHaveBeenCalled();
  });

  it('waits for native sequence scene loading for sequence layers during precise export', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    await dispatcher.ensureExportLayersReady([
      {
        id: 'three-sequence',
        name: 'Three Sequence',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:sequence-frame-1',
          gaussianSplatFileName: 'frame_0001.ply',
          gaussianSplatSequence: {
            frameCount: 2,
            fps: 24,
            sharedBounds: {
              min: [-1, -1, -1],
              max: [1, 1, 1],
            },
            frames: [],
          },
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: false,
              maxSplats: 0,
            },
          },
        },
      },
    ] as any);

    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'three-sequence',
        clipId: 'three-sequence',
        fileName: 'frame_0001.ply',
        url: 'blob:sequence-frame-1',
      }),
    );
  });

  it('waits for native sequence scenes by runtime key during precise export', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    await dispatcher.ensureExportLayersReady([
      {
        id: 'native-sequence',
        name: 'Native Sequence',
        sourceClipId: 'native-sequence',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:sequence-frame-2',
          gaussianSplatFileName: 'frame_0002.ply',
          gaussianSplatRuntimeKey: 'sequence/frame-0002',
          gaussianSplatSequence: {
            frameCount: 2,
            fps: 24,
            frames: [],
          },
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
              maxSplats: 0,
            },
          },
        },
      },
    ] as any);

    expect(dispatcher.ensureSceneRendererInitialized).toHaveBeenCalledWith(1920, 1080);
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'sequence/frame-0002',
        clipId: 'native-sequence',
        url: 'blob:sequence-frame-2',
        fileName: 'frame_0002.ply',
      }),
    );
  });

  it('does not collapse sequence export readiness to mediaFileId across different frame runtimes', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    const makeLayer = (runtimeKey: string, url: string) => ({
      id: `three-sequence-${runtimeKey}`,
      name: 'Three Sequence',
      visible: true,
      opacity: 1,
      is3D: true,
      source: {
        type: 'gaussian-splat',
        mediaFileId: 'media-sequence-1',
        gaussianSplatUrl: url,
        gaussianSplatFileName: 'frame_0001.ply',
        gaussianSplatRuntimeKey: runtimeKey,
        gaussianSplatSequence: {
          frameCount: 2,
          fps: 24,
          frames: [],
        },
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
            maxSplats: 0,
          },
        },
      },
    });

    await dispatcher.ensureExportLayersReady([makeLayer('sequence/frame-0001', 'blob:sequence-frame-1')] as any);
    await dispatcher.ensureExportLayersReady([makeLayer('sequence/frame-0002', 'blob:sequence-frame-2')] as any);

    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(2);
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sceneKey: 'sequence/frame-0001',
        clipId: 'three-sequence-sequence/frame-0001',
        url: 'blob:sequence-frame-1',
      }),
    );
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sceneKey: 'sequence/frame-0002',
        clipId: 'three-sequence-sequence/frame-0002',
        url: 'blob:sequence-frame-2',
      }),
    );
  });

  it('fails precise export when a required asset does not become ready', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'preloadSceneModelAsset').mockResolvedValue(false);

    await expect(dispatcher.ensureExportLayersReady([
      {
        id: 'model-layer',
        name: 'Broken Model',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'model',
          modelUrl: 'blob:broken-model',
        },
      },
    ] as any)).rejects.toThrow('Precise export asset wait failed: 3D model "Broken Model" was not ready in time');
  });

  it('reuses export readiness cache for repeated frames with the same assets', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'preloadSceneModelAsset').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    const layers = [
      {
        id: 'native-splat',
        name: 'Native Splat',
        sourceClipId: 'native-splat',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:native-splat',
          gaussianSplatFileName: 'native.splat',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
            },
          },
        },
      },
      {
        id: 'model-layer',
        name: 'Hero Model',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'model',
          modelUrl: 'blob:model-1',
        },
      },
      {
        id: 'three-splat',
        name: 'Three Splat',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:three-splat',
          gaussianSplatFileHash: 'three-hash',
          gaussianSplatFileName: 'three.splat',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: false,
              maxSplats: 0,
            },
          },
        },
      },
    ] as any;

    await dispatcher.ensureExportLayersReady(layers);
    await dispatcher.ensureExportLayersReady(layers);

    expect(dispatcher.ensureSceneRendererInitialized).toHaveBeenCalledTimes(1);
    expect(dispatcher.preloadSceneModelAsset).toHaveBeenCalledTimes(1);
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(2);
  });
});
