import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeSceneRenderer } from '../../src/engine/native3d/NativeSceneRenderer';
import type {
  SceneCamera,
  SceneModelLayer,
  ScenePlaneLayer,
  ScenePrimitiveLayer,
  SceneSplatLayer,
  SceneText3DLayer,
} from '../../src/engine/scene/types';

type RenderPassEntry = {
  descriptor: GPURenderPassDescriptor & { label?: string };
  pass: ReturnType<typeof makeRenderPass>;
};
type NativeSceneRendererTestAccess = NativeSceneRenderer & {
  sceneView: GPUTextureView;
  modelRuntimeCache: {
    runtimes: Map<string, unknown>;
    loading: Map<string, Promise<unknown>>;
  };
};

const mockGaussianRenderer = {
  isInitialized: true,
  initialize: vi.fn(),
  hasScene: vi.fn(() => true),
  beginFrame: vi.fn(),
  renderToTexture: vi.fn(),
};

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

vi.mock('../../src/engine/gaussian/core/GaussianSplatGpuRenderer', () => ({
  getGaussianSplatGpuRenderer: vi.fn(() => mockGaussianRenderer),
}));

Object.assign(globalThis, {
  GPUTextureUsage: {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
  },
  GPUBufferUsage: {
    UNIFORM: 1,
    COPY_DST: 2,
    VERTEX: 4,
    INDEX: 8,
  },
  GPUShaderStage: {
    VERTEX: 1,
    FRAGMENT: 2,
    COMPUTE: 4,
  },
});

function makeRenderPass() {
  return {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    setIndexBuffer: vi.fn(),
    draw: vi.fn(),
    drawIndexed: vi.fn(),
    end: vi.fn(),
  };
}

function createFakeDevice() {
  const renderPasses: RenderPassEntry[] = [];
  const commandEncoder = {
    beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor & { label?: string }) => {
      const pass = makeRenderPass();
      renderPasses.push({ descriptor, pass });
      return pass;
    }),
    finish: vi.fn(() => ({ label: 'native-scene-command-buffer' })),
  };

  const device = {
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const width = descriptor.size.width ?? descriptor.size[0] ?? 1;
      const height = descriptor.size.height ?? descriptor.size[1] ?? 1;
      return {
        width,
        height,
        format: descriptor.format,
        createView: vi.fn(() => ({
          label: `${descriptor.format}-view-${width}x${height}`,
          format: descriptor.format,
        })),
        destroy: vi.fn(),
      };
    }),
    createCommandEncoder: vi.fn(() => commandEncoder),
    createBindGroupLayout: vi.fn(() => ({ label: 'bind-group-layout' })),
    createShaderModule: vi.fn(() => ({ label: 'shader-module' })),
    createPipelineLayout: vi.fn(() => ({ label: 'pipeline-layout' })),
    createRenderPipeline: vi.fn(() => ({ label: 'render-pipeline' })),
    createSampler: vi.fn(() => ({ label: 'sampler' })),
    createBuffer: vi.fn(() => ({
      destroy: vi.fn(),
    })),
    createBindGroup: vi.fn(() => ({ label: 'bind-group' })),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
    },
  };

  return {
    device: device as unknown as GPUDevice,
    commandEncoder,
    renderPasses,
  };
}

function makeCamera(): SceneCamera {
  return {
    viewMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    projectionMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    cameraPosition: { x: 0, y: 0, z: 5 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    cameraUp: { x: 0, y: 1, z: 0 },
    fov: 50,
    near: 0.1,
    far: 100,
    viewport: { width: 1280, height: 720 },
    applyDefaultDistance: false,
  };
}

async function createInitializedRenderer(): Promise<NativeSceneRenderer> {
  const renderer = new NativeSceneRenderer();
  await renderer.initialize(1280, 720);
  return renderer;
}

function makeSplatLayer(layerId: string, z: number, opacity: number): SceneSplatLayer {
  return {
    kind: 'splat',
    layerId,
    clipId: `${layerId}-clip`,
    opacity,
    blendMode: 'normal',
    sourceWidth: 1920,
    sourceHeight: 1080,
    worldMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, z, 1,
    ]),
    gaussianSplatSettings: {
      render: {
        useNativeRenderer: true,
        backgroundColor: 'transparent',
        maxSplats: 0,
        sortFrequency: 1,
      },
    } as unknown as ScenePlaneLayer,
  };
}

function makePlaneLayer(layerId: string, opacity: number): ScenePlaneLayer {
  return {
    kind: 'plane',
    layerId,
    clipId: `${layerId}-clip`,
    opacity,
    blendMode: 'normal',
    sourceWidth: 1920,
    sourceHeight: 1080,
    worldMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    alphaMode: 'opaque',
    castsDepth: true,
    receivesDepth: true,
    videoElement: {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as ScenePlaneLayer,
  };
}

function readUniformWrite(call: unknown[]): Float32Array {
  return new Float32Array(
    call[2] as ArrayBuffer,
    call[3] as number,
    (call[4] as number) / 4,
  );
}

function makePrimitiveLayer(layerId: string, meshType: ScenePrimitiveLayer['meshType'], opacity = 1): ScenePrimitiveLayer {
  return {
    kind: 'primitive',
    layerId,
    clipId: `${layerId}-clip`,
    opacity,
    blendMode: 'normal',
    sourceWidth: 100,
    sourceHeight: 100,
    worldMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    worldTransform: {
      position: { x: 0, y: 0, z: 0 },
      rotationRadians: { x: 0, y: 0, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    meshType,
  };
}

function makeTextLayer(layerId: string, opacity = 1): SceneText3DLayer {
  return {
    kind: 'text3d',
    layerId,
    clipId: `${layerId}-clip`,
    opacity,
    blendMode: 'normal',
    sourceWidth: 100,
    sourceHeight: 100,
    worldMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    worldTransform: {
      position: { x: 0, y: 0, z: 0 },
      rotationRadians: { x: 0, y: 0, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    text3DProperties: {
      text: 'Native',
      fontFamily: 'helvetiker',
      fontWeight: 'bold',
      size: 0.42,
      depth: 0.14,
      color: '#ff8844',
      letterSpacing: 0.02,
      lineHeight: 1.15,
      textAlign: 'center',
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.01,
      bevelSegments: 2,
    },
  };
}

function makeModelLayer(layerId: string, opacity = 1): SceneModelLayer {
  return {
    kind: 'model',
    layerId,
    clipId: `${layerId}-clip`,
    opacity,
    blendMode: 'normal',
    sourceWidth: 100,
    sourceHeight: 100,
    worldMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    worldTransform: {
      position: { x: 0, y: 0, z: 0 },
      rotationRadians: { x: 0, y: 0, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    modelUrl: 'blob:model-native',
    modelFileName: 'hero.glb',
  };
}

describe('NativeSceneRenderer shared depth contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockGaussianRenderer.isInitialized = true;
    mockGaussianRenderer.hasScene.mockReturnValue(true);
    mockGaussianRenderer.renderToTexture.mockImplementation((clipId: string) => ({
      label: `splat-view-${clipId}`,
    }));
  });

  it('clears one shared depth target and routes all native splat layers through it', async () => {
    const renderer = await createInitializedRenderer();

    const { device, renderPasses } = createFakeDevice();
    const result = renderer.renderScene(
      device,
      [
        makeSplatLayer('back-splat', 6, 0.6),
        makeSplatLayer('front-splat', 2, 0.9),
      ],
      makeCamera(),
      [],
      false,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(mockGaussianRenderer.beginFrame).toHaveBeenCalledTimes(1);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(4);

    const depthTextureCall = device.createTexture.mock.calls.find(
      ([descriptor]: [GPUTextureDescriptor]) => descriptor.format === 'depth24plus',
    );
    expect(depthTextureCall).toBeTruthy();

    expect(renderPasses).toHaveLength(1);
    expect(renderPasses[0]?.descriptor.label).toBe('native-scene-clear-pass');
    expect(renderPasses[0]?.descriptor.depthStencilAttachment).toMatchObject({
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    });

    const firstColorOptions = mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4];
    const firstDepthMaskOptions = mockGaussianRenderer.renderToTexture.mock.calls[1]?.[4];
    const secondColorOptions = mockGaussianRenderer.renderToTexture.mock.calls[2]?.[4];
    const secondDepthMaskOptions = mockGaussianRenderer.renderToTexture.mock.calls[3]?.[4];
    expect(firstColorOptions.depthView).toBeTruthy();
    expect(firstDepthMaskOptions.depthView).toBe(firstColorOptions.depthView);
    expect(secondColorOptions.depthView).toBe(firstColorOptions.depthView);
    expect(secondDepthMaskOptions.depthView).toBe(firstColorOptions.depthView);

    for (const options of [
      firstColorOptions,
      firstDepthMaskOptions,
      secondColorOptions,
      secondDepthMaskOptions,
    ]) {
      expect(options.outputView).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
      expect(options.depthLoadOp).toBe('load');
      expect(options.depthStoreOp).toBe('store');
    }

    expect(firstColorOptions.depthWrite).toBe(false);
    expect(firstColorOptions.layerOpacity).toBeCloseTo(0.9);
    expect(firstColorOptions.depthAlphaCutoff).toBe(0);
    expect(firstDepthMaskOptions.depthWrite).toBe(true);
    expect(firstDepthMaskOptions.colorWrite).toBe(false);
    expect(firstDepthMaskOptions.layerOpacity).toBeCloseTo(0.9);
    expect(firstDepthMaskOptions.depthAlphaCutoff).toBeGreaterThan(0.05);
    expect(firstDepthMaskOptions.sortFrequency).toBe(0);

    expect(secondColorOptions.depthWrite).toBe(false);
    expect(secondColorOptions.layerOpacity).toBeCloseTo(0.6);
    expect(secondDepthMaskOptions.depthWrite).toBe(true);
    expect(secondDepthMaskOptions.colorWrite).toBe(false);
    expect(secondDepthMaskOptions.layerOpacity).toBeCloseTo(0.6);

    expect(device.queue.submit).toHaveBeenCalledWith([
      { label: 'native-scene-command-buffer' },
    ]);
  });

  it('renders opaque planes before soft splat depth masking in the shared native scene', async () => {
    const renderer = await createInitializedRenderer();

    const { device, renderPasses } = createFakeDevice();
    const result = renderer.renderScene(
      device,
      [
        makePlaneLayer('video-plane', 1),
        makeSplatLayer('hero-splat', 2, 0.8),
      ],
      makeCamera(),
      [],
      false,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(2);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-plane-opaque-pass',
    ]);
    const planeUniform = readUniformWrite(device.queue.writeBuffer.mock.calls[0]);
    expect(planeUniform[16]).toBeCloseTo(1);
    expect(planeUniform[17]).toBe(1);

    const colorOptions = mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4];
    const depthMaskOptions = mockGaussianRenderer.renderToTexture.mock.calls[1]?.[4];
    expect(colorOptions.depthView).toBeTruthy();
    expect(colorOptions.outputView).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(colorOptions.depthLoadOp).toBe('load');
    expect(colorOptions.depthStoreOp).toBe('store');
    expect(colorOptions.depthWrite).toBe(false);
    expect(colorOptions.layerOpacity).toBeCloseTo(0.8);
    expect(depthMaskOptions.depthWrite).toBe(true);
    expect(depthMaskOptions.colorWrite).toBe(false);
    expect(depthMaskOptions.depthAlphaCutoff).toBeGreaterThan(0.05);
  });

  it('keeps source alpha for non-opaque video planes', async () => {
    const renderer = await createInitializedRenderer();

    const { device, renderPasses } = createFakeDevice();
    const result = renderer.renderScene(
      device,
      [{
        ...makePlaneLayer('transparent-video-plane', 0.6),
        alphaMode: 'straight',
        castsDepth: false,
      }],
      makeCamera(),
      [],
      false,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-plane-transparent-pass',
    ]);
    const planeUniform = readUniformWrite(device.queue.writeBuffer.mock.calls[0]);
    expect(planeUniform[16]).toBeCloseTo(0.6);
    expect(planeUniform[17]).toBe(0);
  });

  it('applies clip masks in native 3D plane UV space', async () => {
    const renderer = await createInitializedRenderer();

    const { device, renderPasses } = createFakeDevice();
    const maskView = { label: 'clip-mask-view' };
    const maskTextureManager = {
      hasMaskTexture: vi.fn(() => true),
      getMaskInfo: vi.fn(() => ({ hasMask: true, view: maskView })),
    };

    const result = renderer.renderScene(
      device,
      [{
        ...makePlaneLayer('masked-video-plane', 1),
        maskClipId: 'masked-video-plane-clip',
      }],
      makeCamera(),
      [],
      false,
      null,
      maskTextureManager as never,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-plane-transparent-pass',
    ]);
    const planeUniform = readUniformWrite(device.queue.writeBuffer.mock.calls[0]);
    expect(planeUniform[18]).toBe(1);
    expect(planeUniform[19]).toBe(0);
    expect(maskTextureManager.getMaskInfo).toHaveBeenCalledWith('masked-video-plane-clip');

    const planeBindGroupCall = device.createBindGroup.mock.calls.find(
      ([descriptor]: [{ label?: string }]) => descriptor.label === 'native-scene-plane-bind-group-masked-video-plane',
    );
    expect(planeBindGroupCall?.[0].entries).toContainEqual({ binding: 3, resource: maskView });
  });

  it('reuses the cached video plane texture while a scrubbed video frame is not ready', async () => {
    const renderer = await createInitializedRenderer();

    const { device } = createFakeDevice();
    const readyPlane = makePlaneLayer('video-plane', 1);
    const initialResult = renderer.renderScene(
      device,
      [readyPlane],
      makeCamera(),
      [],
      false,
    );

    expect(initialResult).toBeTruthy();
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);

    const notReadyResult = renderer.renderScene(
      device,
      [{
        ...readyPlane,
        videoElement: {
          ...(readyPlane.videoElement as object),
          readyState: 1,
        } as unknown as HTMLVideoElement,
      }],
      makeCamera(),
      [],
      false,
    );

    expect(notReadyResult).toBeTruthy();
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached video plane texture after a transient upload failure', async () => {
    const renderer = await createInitializedRenderer();

    const { device } = createFakeDevice();
    const plane = makePlaneLayer('video-plane', 1);
    renderer.renderScene(
      device,
      [plane],
      makeCamera(),
      [],
      false,
    );
    device.queue.copyExternalImageToTexture.mockImplementationOnce(() => {
      throw new Error('transient upload failure');
    });

    const result = renderer.renderScene(
      device,
      [plane],
      makeCamera(),
      [],
      false,
    );

    expect(result).toBeTruthy();
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
  });

  it('forwards shared-scene effectors only to native splat layers', async () => {
    const renderer = await createInitializedRenderer();

    const { device } = createFakeDevice();
    renderer.renderScene(
      device,
      [
        makePlaneLayer('video-plane', 1),
        makeSplatLayer('hero-splat', 2, 0.8),
      ],
      makeCamera(),
      [{
        clipId: 'effector-1',
        position: { x: 0.5, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        radius: 1,
        mode: 'repel',
        strength: 30,
        falloff: 1,
        speed: 1,
        seed: 2,
        time: 0.5,
      }],
      false,
    );

    const splatOptions = mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4];
    expect(splatOptions.effectors).toHaveLength(1);
    expect(splatOptions.effectors[0]).toMatchObject({
      clipId: 'effector-1',
      mode: 'repel',
    });
  });

  it('keeps paused preview on worker sorting and reserves precise sorting for explicit precise renders', async () => {
    const renderer = await createInitializedRenderer();

    const { device } = createFakeDevice();
    renderer.renderScene(
      device,
      [makeSplatLayer('paused-preview-splat', 2, 1)],
      makeCamera(),
      [],
      false,
    );

    expect(mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4]).toMatchObject({
      precise: false,
      sortFrequency: 1,
      depthWrite: false,
    });
    expect(mockGaussianRenderer.renderToTexture.mock.calls[1]?.[4]).toMatchObject({
      precise: false,
      sortFrequency: 0,
      depthWrite: true,
      colorWrite: false,
    });

    vi.clearAllMocks();
    const preciseLayer = {
      ...makeSplatLayer('export-splat', 2, 1),
      preciseSplatSorting: true,
    };
    renderer.renderScene(
      device,
      [preciseLayer],
      makeCamera(),
      [],
      false,
    );

    expect(mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4]).toMatchObject({
      precise: true,
      sortFrequency: 1,
      depthWrite: false,
    });
  });

  it('uses gaussian splat runtime keys as native scene identities for sequence layers', async () => {
    const renderer = await createInitializedRenderer();

    const { device } = createFakeDevice();
    mockGaussianRenderer.hasScene.mockImplementation((sceneKey: string) => sceneKey === 'sequence/frame-0002');

    renderer.renderScene(
      device,
      [
        {
          ...makeSplatLayer('sequence-splat', 2, 1),
          clipId: 'sequence-splat-clip',
          gaussianSplatRuntimeKey: 'sequence/frame-0002',
        },
      ],
      makeCamera(),
      [],
      false,
    );

    expect(mockGaussianRenderer.hasScene).toHaveBeenCalledWith('sequence/frame-0002');
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledWith(
      'sequence/frame-0002',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        worldMatrix: expect.any(Float32Array),
      }),
    );
  });

  it('renders opaque primitive meshes before soft splat depth masking in the shared native scene', async () => {
    const renderer = await createInitializedRenderer();

    const { device, renderPasses } = createFakeDevice();
    const result = renderer.renderScene(
      device,
      [
        makePrimitiveLayer('cube-mesh', 'cube', 1),
        makeSplatLayer('hero-splat', 2, 0.8),
      ],
      makeCamera(),
      [],
      false,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(2);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-mesh-opaque-pass',
    ]);

    const meshPass = renderPasses[1]?.pass;
    expect(meshPass?.setVertexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.setIndexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.drawIndexed).toHaveBeenCalledTimes(1);
  });

  it('renders native 3D text inside the shared native scene before soft splat depth masking', async () => {
    const renderer = await createInitializedRenderer();

    const { device, renderPasses } = createFakeDevice();
    const result = renderer.renderScene(
      device,
      [
        makeTextLayer('headline-text', 1),
        makeSplatLayer('hero-splat', 2, 0.8),
      ],
      makeCamera(),
      [],
      false,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(2);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-mesh-opaque-pass',
    ]);

    const meshPass = renderPasses[1]?.pass;
    expect(meshPass?.setVertexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.setIndexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.drawIndexed).toHaveBeenCalledTimes(1);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
  });

  it('renders imported models inside the shared native scene before soft splat depth masking', async () => {
    const renderer = await createInitializedRenderer();
    (renderer as NativeSceneRendererTestAccess).modelRuntimeCache.runtimes.set('blob:model-native', {
      url: 'blob:model-native',
      fileName: 'hero.glb',
      format: 'glb',
      primitives: [{
        vertices: new Float32Array([
          -0.5, -0.5, 0, 0, 0, 1, 0, 0,
           0.5, -0.5, 0, 0, 0, 1, 0, 0,
           0.0,  0.5, 0, 0, 0, 1, 0, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
        baseColor: [0.2, 0.4, 0.8, 1] as const,
      }],
    });

    const { device, renderPasses } = createFakeDevice();
    const result = renderer.renderScene(
      device,
      [
        makeModelLayer('hero-model', 1),
        makeSplatLayer('hero-splat', 2, 0.8),
      ],
      makeCamera(),
      [],
      false,
    );

    expect(result).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(2);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-mesh-opaque-pass',
    ]);

    const meshPass = renderPasses[1]?.pass;
    expect(meshPass?.setVertexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.setIndexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.drawIndexed).toHaveBeenCalledTimes(1);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
  });

  it('holds the last loaded model sequence frame while the next realtime frame is loading', async () => {
    const renderer = await createInitializedRenderer();
    const sequence = {
      sequenceName: 'seq',
      frameCount: 2,
      fps: 30,
      playbackMode: 'clamp' as const,
      frames: [
        { name: 'frame0000000.glb', modelUrl: 'blob:model-0' },
        { name: 'frame0000001.glb', modelUrl: 'blob:model-1' },
      ],
    };
    (renderer as NativeSceneRendererTestAccess).modelRuntimeCache.runtimes.set('blob:model-0', {
      url: 'blob:model-0',
      fileName: 'frame0000000.glb',
      format: 'glb',
      normalizationKey: 'seq|2|30|frame0000000.glb|blob:model-0',
      primitives: [{
        vertices: new Float32Array([
          -0.5, -0.5, 0, 0, 0, 1, 0, 0,
           0.5, -0.5, 0, 0, 0, 1, 0, 0,
           0.0,  0.5, 0, 0, 0, 1, 0, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
        baseColor: [0.2, 0.4, 0.8, 1] as const,
      }],
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })) as typeof fetch);

    const firstLayer = {
      ...makeModelLayer('hero-sequence', 1),
      clipId: 'hero-sequence-clip',
      modelUrl: 'blob:model-0',
      modelFileName: 'frame0000000.glb',
      modelSequence: sequence,
    };
    const secondLayer = {
      ...firstLayer,
      modelUrl: 'blob:model-1',
      modelFileName: 'frame0000001.glb',
    };

    const { device } = createFakeDevice();
    const first = renderer.renderScene(device, [firstLayer], makeCamera(), [], true);
    const second = renderer.renderScene(device, [secondLayer], makeCamera(), [], true);

    expect(first).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
    expect(second).toEqual((renderer as NativeSceneRendererTestAccess).sceneView);
  });

  it('throttles realtime model sequence loading so playback does not queue every GLB frame', async () => {
    const renderer = await createInitializedRenderer();
    const sequence = {
      sequenceName: 'seq',
      frameCount: 3,
      fps: 30,
      playbackMode: 'clamp' as const,
      frames: [
        { name: 'frame0000000.glb', modelUrl: 'blob:model-0' },
        { name: 'frame0000001.glb', modelUrl: 'blob:model-1' },
        { name: 'frame0000002.glb', modelUrl: 'blob:model-2' },
      ],
    };
    (renderer as NativeSceneRendererTestAccess).modelRuntimeCache.runtimes.set('blob:model-0', {
      url: 'blob:model-0',
      fileName: 'frame0000000.glb',
      format: 'glb',
      normalizationKey: 'seq|3|30|frame0000000.glb|blob:model-0',
      primitives: [{
        vertices: new Float32Array([
          -0.5, -0.5, 0, 0, 0, 1, 0, 0,
           0.5, -0.5, 0, 0, 0, 1, 0, 0,
           0.0,  0.5, 0, 0, 0, 1, 0, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
        baseColor: [0.2, 0.4, 0.8, 1] as const,
      }],
    });

    const pending = new Promise<Response>(() => {});
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const baseLayer = {
      ...makeModelLayer('hero-sequence', 1),
      clipId: 'hero-sequence-clip',
      modelSequence: sequence,
    };

    const { device } = createFakeDevice();
    renderer.renderScene(device, [{ ...baseLayer, modelUrl: 'blob:model-0', modelFileName: 'frame0000000.glb' }], makeCamera(), [], true);
    renderer.renderScene(device, [{ ...baseLayer, modelUrl: 'blob:model-1', modelFileName: 'frame0000001.glb' }], makeCamera(), [], true);
    renderer.renderScene(device, [{ ...baseLayer, modelUrl: 'blob:model-2', modelFileName: 'frame0000002.glb' }], makeCamera(), [], true);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((renderer as NativeSceneRendererTestAccess).modelRuntimeCache.loading.size).toBe(1);
  });
});
