import { describe, expect, it, vi } from 'vitest';
import { GaussianSplatGpuRenderer } from '../../src/engine/gaussian/core/GaussianSplatGpuRenderer';
import type { SplatCameraParams } from '../../src/engine/gaussian/core/GaussianSplatGpuRenderer';

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
    const renderer = new GaussianSplatGpuRenderer() as any;
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
});
