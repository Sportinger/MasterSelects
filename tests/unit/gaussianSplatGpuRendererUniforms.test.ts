import { describe, expect, it, vi } from 'vitest';
import { GaussianSplatGpuRenderer } from '../../src/engine/gaussian/core/GaussianSplatGpuRenderer';
import type { SplatCameraParams } from '../../src/engine/gaussian/core/GaussianSplatGpuRenderer';
import type { LocalSplatEffectorData } from '../../src/engine/native3d/passes/EffectorCompute';

type GaussianSplatGpuRendererTestAccess = GaussianSplatGpuRenderer & {
  device: GPUDevice;
  pipeline: GPURenderPipeline | null;
  pipelineWithDepth: GPURenderPipeline | null;
  splatDataBindGroupLayout: GPUBindGroupLayout;
  cameraBindGroupLayout: GPUBindGroupLayout;
  renderTargetPool: {
    resetFrame: () => void;
    acquire: (width: number, height: number) => { texture: unknown; view: GPUTextureView };
  };
  sceneCache: Map<string, unknown>;
  effectorCompute: {
    isInitialized: boolean;
    prepareLocalSplatEffectors: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
  _initialized: boolean;
  createPipeline(): void;
};

type GPUShaderStageValues = {
  VERTEX: number;
  FRAGMENT: number;
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

Object.assign(globalThis, {
  GPUBufferUsage: {
    UNIFORM: 1,
    COPY_DST: 2,
    STORAGE: 4,
  },
  GPUShaderStage: {
    VERTEX: 1,
    FRAGMENT: 2,
  },
});

function makeCamera(): SplatCameraParams {
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
    viewport: { width: 1280, height: 720 },
    fov: 50,
    near: 0.1,
    far: 1000,
  };
}

function makeWorldMatrix(scaleX: number): Float32Array {
  return new Float32Array([
    scaleX, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function makeScene(bindGroup: unknown) {
  return {
    splatBuffer: { label: 'splat-buffer' },
    splatCount: 1,
    identityIndexBuffer: { label: 'identity-index-buffer' },
    bindGroup,
    framesSinceSort: 0,
    sortedBindGroup: null,
    workerSorter: null,
    workerSortedBindGroup: null,
  };
}

describe('GaussianSplatGpuRenderer camera uniforms', () => {
  it('exposes camera uniforms to the fragment shader for depth alpha cutoff', () => {
    const createBindGroupLayout = vi.fn((descriptor: { label?: string }) => ({
      label: descriptor.label,
    }));
    const device = {
      createShaderModule: vi.fn(() => ({ label: 'shader-module' })),
      createBindGroupLayout,
      createPipelineLayout: vi.fn(() => ({ label: 'pipeline-layout' })),
      createRenderPipeline: vi.fn(() => ({ label: 'pipeline' })),
    };
    const renderer = new GaussianSplatGpuRenderer() as unknown as GaussianSplatGpuRendererTestAccess;
    renderer.device = device;

    renderer.createPipeline();

    const cameraLayout = createBindGroupLayout.mock.calls.find(
      ([descriptor]) => descriptor.label === 'splat-camera-bind-group-layout',
    )?.[0];
    const shaderStage = globalThis.GPUShaderStage as unknown as GPUShaderStageValues;
    expect(cameraLayout?.entries[0]?.visibility).toBe(
      shaderStage.VERTEX | shaderStage.FRAGMENT,
    );
  });

  it('uses a distinct camera bind group for each splat rendered in the same command encoder', () => {
    const renderPasses: Array<{ setBindGroup: ReturnType<typeof vi.fn> }> = [];
    const writeBuffer = vi.fn();
    const device = {
      createBuffer: vi.fn((descriptor: { label?: string }) => ({
        label: descriptor.label,
        destroy: vi.fn(),
      })),
      createBindGroup: vi.fn((descriptor: { label?: string }) => ({
        label: descriptor.label,
      })),
      queue: {
        writeBuffer,
      },
    };
    const commandEncoder = {
      beginRenderPass: vi.fn(() => {
        const pass = {
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        };
        renderPasses.push(pass);
        return pass;
      }),
    };
    const renderer = new GaussianSplatGpuRenderer() as unknown as GaussianSplatGpuRendererTestAccess;
    renderer.device = device;
    renderer.pipeline = { label: 'pipeline' };
    renderer.pipelineWithDepth = null;
    renderer.splatDataBindGroupLayout = { label: 'splat-layout' };
    renderer.cameraBindGroupLayout = { label: 'camera-layout' };
    renderer.renderTargetPool = {
      resetFrame: vi.fn(),
      acquire: vi.fn()
        .mockReturnValueOnce({ texture: { label: 'target-a' }, view: { label: 'target-view-a' } })
        .mockReturnValueOnce({ texture: { label: 'target-b' }, view: { label: 'target-view-b' } }),
    };
    renderer._initialized = true;
    renderer.sceneCache.set('splat-a', makeScene({ label: 'splat-a-bind-group' }));
    renderer.sceneCache.set('splat-b', makeScene({ label: 'splat-b-bind-group' }));

    renderer.beginFrame();
    renderer.renderToTexture(
      'splat-a',
      makeCamera(),
      { width: 1280, height: 720 },
      commandEncoder,
      { worldMatrix: makeWorldMatrix(1) },
    );
    renderer.renderToTexture(
      'splat-b',
      makeCamera(),
      { width: 1280, height: 720 },
      commandEncoder,
      { worldMatrix: makeWorldMatrix(3) },
    );

    expect(device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({
      label: 'splat-camera-uniforms-0',
    }));
    expect(device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({
      label: 'splat-camera-uniforms-1',
    }));
    expect(writeBuffer.mock.calls[0]?.[0]).not.toBe(writeBuffer.mock.calls[1]?.[0]);

    const firstCameraBindGroup = renderPasses[0]?.setBindGroup.mock.calls.find(
      ([slot]) => slot === 1,
    )?.[1];
    const secondCameraBindGroup = renderPasses[1]?.setBindGroup.mock.calls.find(
      ([slot]) => slot === 1,
    )?.[1];
    expect(firstCameraBindGroup).toEqual({ label: 'splat-camera-bind-group-0' });
    expect(secondCameraBindGroup).toEqual({ label: 'splat-camera-bind-group-1' });
    expect(firstCameraBindGroup).not.toBe(secondCameraBindGroup);
  });

  it('keeps worker sort ordering when effectors render through an active splat buffer', () => {
    const renderPasses: Array<{ setBindGroup: ReturnType<typeof vi.fn> }> = [];
    const workerOrderBuffer = { label: 'worker-order-buffer' };
    const workerSorter = {
      orderBuffer: workerOrderBuffer,
      hasSortedOrder: true,
      requestSort: vi.fn(),
      applyPending: vi.fn(() => 1),
    };
    const device = {
      createBuffer: vi.fn((descriptor: { label?: string }) => ({
        label: descriptor.label,
        destroy: vi.fn(),
      })),
      createBindGroup: vi.fn((descriptor: { label?: string }) => ({
        label: descriptor.label,
      })),
      queue: {
        writeBuffer: vi.fn(),
      },
    };
    const commandEncoder = {
      beginRenderPass: vi.fn(() => {
        const pass = {
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        };
        renderPasses.push(pass);
        return pass;
      }),
    };
    const renderer = new GaussianSplatGpuRenderer() as unknown as GaussianSplatGpuRendererTestAccess;
    const localEffectors: LocalSplatEffectorData[] = [{
      position: { x: 0, y: 0, z: 0 },
      axis: { x: 0, y: 0, z: 1 },
      radius: 1,
      strength: 0.2,
      falloff: 1,
      speed: 1,
      seed: 0,
      time: 0,
      mode: 0,
    }];
    renderer.device = device;
    renderer.pipeline = { label: 'pipeline' };
    renderer.pipelineWithDepth = null;
    renderer.splatDataBindGroupLayout = { label: 'splat-layout' };
    renderer.cameraBindGroupLayout = { label: 'camera-layout' };
    renderer.renderTargetPool = {
      resetFrame: vi.fn(),
      acquire: vi.fn(() => ({ texture: { label: 'target' }, view: { label: 'target-view' } })),
    };
    renderer.effectorCompute = {
      isInitialized: true,
      prepareLocalSplatEffectors: vi.fn(() => localEffectors),
      execute: vi.fn(),
    };
    renderer._initialized = true;
    renderer.sceneCache.set('splat-a', {
      ...makeScene({ label: 'identity-bind-group' }),
      splatCount: 4,
      workerSorter,
      workerSortedBindGroup: { label: 'base-worker-sorted-bind-group' },
    });

    renderer.renderToTexture(
      'splat-a',
      makeCamera(),
      { width: 1280, height: 720 },
      commandEncoder,
      {
        worldMatrix: makeWorldMatrix(1),
        effectors: [{
          clipId: 'effector-1',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          radius: 1,
          mode: 'repel',
          strength: 20,
          falloff: 1,
          speed: 1,
          seed: 0,
          time: 0,
        }],
      },
    );
    renderer.renderToTexture(
      'splat-a',
      makeCamera(),
      { width: 1280, height: 720 },
      commandEncoder,
      {
        worldMatrix: makeWorldMatrix(1),
        effectors: [{
          clipId: 'effector-1',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          radius: 1,
          mode: 'repel',
          strength: 20,
          falloff: 1,
          speed: 1,
          seed: 0,
          time: 0,
        }],
      },
    );

    const activeWorkerBindGroupCalls = device.createBindGroup.mock.calls.filter(
      ([descriptor]) => descriptor.label === 'splat-worker-sorted-active-bind-group-splat-a',
    );
    expect(activeWorkerBindGroupCalls).toHaveLength(1);
    const activeWorkerBindGroupDescriptor = activeWorkerBindGroupCalls[0]?.[0];
    expect(activeWorkerBindGroupDescriptor).toMatchObject({
      entries: [
        { binding: 0, resource: { buffer: { label: 'effector-output-splat-a' } } },
        { binding: 1, resource: { buffer: workerOrderBuffer } },
      ],
    });
    expect(workerSorter.requestSort).toHaveBeenCalled();
    expect(workerSorter.applyPending).toHaveBeenCalledWith(device.queue);

    const splatDataBindGroup = renderPasses[0]?.setBindGroup.mock.calls.find(
      ([slot]) => slot === 0,
    )?.[1];
    expect(splatDataBindGroup).toEqual({ label: 'splat-worker-sorted-active-bind-group-splat-a' });
    const reusedSplatDataBindGroup = renderPasses[1]?.setBindGroup.mock.calls.find(
      ([slot]) => slot === 0,
    )?.[1];
    expect(reusedSplatDataBindGroup).toBe(splatDataBindGroup);
  });
});
