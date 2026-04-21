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
  const renderPasses: Array<{ descriptor: any; pass: ReturnType<typeof makeRenderPass> }> = [];
  const commandEncoder = {
    beginRenderPass: vi.fn((descriptor: any) => {
      const pass = makeRenderPass();
      renderPasses.push({ descriptor, pass });
      return pass;
    }),
    finish: vi.fn(() => ({ label: 'native-scene-command-buffer' })),
  };

  const device = {
    createTexture: vi.fn((descriptor: any) => {
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
    device: device as any,
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
    } as any,
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
    } as any,
  };
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

    expect(result).toEqual((renderer as any).sceneView);
    expect(mockGaussianRenderer.beginFrame).toHaveBeenCalledTimes(1);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(2);

    const depthTextureCall = device.createTexture.mock.calls.find(
      ([descriptor]: any[]) => descriptor.format === 'depth24plus',
    );
    expect(depthTextureCall).toBeTruthy();

    expect(renderPasses).toHaveLength(2);
    expect(renderPasses[0]?.descriptor.label).toBe('native-scene-clear-pass');
    expect(renderPasses[0]?.descriptor.depthStencilAttachment).toMatchObject({
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    });
    expect(renderPasses[1]?.descriptor.label).toBe('native-scene-splat-composite');
    expect(renderPasses[1]?.descriptor.colorAttachments[0]).toMatchObject({
      loadOp: 'load',
      storeOp: 'store',
    });

    const firstOptions = mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4];
    const secondOptions = mockGaussianRenderer.renderToTexture.mock.calls[1]?.[4];
    expect(firstOptions.depthView).toBeTruthy();
    expect(secondOptions.depthView).toBe(firstOptions.depthView);
    expect(firstOptions.depthLoadOp).toBe('load');
    expect(firstOptions.depthStoreOp).toBe('store');
    expect(secondOptions.depthLoadOp).toBe('load');
    expect(secondOptions.depthStoreOp).toBe('store');

    expect(device.queue.submit).toHaveBeenCalledWith([
      { label: 'native-scene-command-buffer' },
    ]);
  });

  it('renders opaque planes before splat compositing in the shared native scene', async () => {
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

    expect(result).toEqual((renderer as any).sceneView);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(1);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-plane-opaque-pass',
      'native-scene-splat-composite',
    ]);

    const splatOptions = mockGaussianRenderer.renderToTexture.mock.calls[0]?.[4];
    expect(splatOptions.depthView).toBeTruthy();
    expect(splatOptions.depthLoadOp).toBe('load');
    expect(splatOptions.depthStoreOp).toBe('store');
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

  it('renders opaque primitive meshes before splat compositing in the shared native scene', async () => {
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

    expect(result).toEqual((renderer as any).sceneView);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(1);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-mesh-opaque-pass',
      'native-scene-splat-composite',
    ]);

    const meshPass = renderPasses[1]?.pass;
    expect(meshPass?.setVertexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.setIndexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.drawIndexed).toHaveBeenCalledTimes(1);
  });

  it('renders native 3D text inside the shared native scene before splat compositing', async () => {
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

    expect(result).toEqual((renderer as any).sceneView);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(1);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-mesh-opaque-pass',
      'native-scene-splat-composite',
    ]);

    const meshPass = renderPasses[1]?.pass;
    expect(meshPass?.setVertexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.setIndexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.drawIndexed).toHaveBeenCalledTimes(1);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
  });

  it('renders imported models inside the shared native scene before splat compositing', async () => {
    const renderer = await createInitializedRenderer();
    (renderer as any).modelRuntimeCache.runtimes.set('blob:model-native', {
      url: 'blob:model-native',
      fileName: 'hero.glb',
      format: 'glb',
      primitives: [{
        vertices: new Float32Array([
          -0.5, -0.5, 0, 0, 0, 1,
           0.5, -0.5, 0, 0, 0, 1,
           0.0,  0.5, 0, 0, 0, 1,
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

    expect(result).toEqual((renderer as any).sceneView);
    expect(mockGaussianRenderer.renderToTexture).toHaveBeenCalledTimes(1);
    expect(renderPasses.map((entry) => entry.descriptor.label)).toEqual([
      'native-scene-clear-pass',
      'native-scene-mesh-opaque-pass',
      'native-scene-splat-composite',
    ]);

    const meshPass = renderPasses[1]?.pass;
    expect(meshPass?.setVertexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.setIndexBuffer).toHaveBeenCalledTimes(1);
    expect(meshPass?.drawIndexed).toHaveBeenCalledTimes(1);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
  });
});
