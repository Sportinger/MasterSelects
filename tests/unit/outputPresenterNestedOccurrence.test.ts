import { describe, expect, it, vi } from 'vitest';
import {
  cacheActiveCompOutput,
  copyNestedCompTextureToPreview,
  type OutputPresenterDeps,
} from '../../src/engine/engineCore/outputPresenter';

describe('outputPresenter nested occurrence copy', () => {
  it.each([
    { finalIsPing: true, expectedSource: 'ping' },
    { finalIsPing: false, expectedSource: 'pong' },
  ])('caches the completed $expectedSource accumulator rather than the previous intermediate', ({
    finalIsPing,
    expectedSource,
  }) => {
    const pingTexture = { id: 'ping' } as unknown as GPUTexture;
    const pongTexture = { id: 'pong' } as unknown as GPUTexture;
    const cacheOutput = vi.fn();
    const resources = {
      compositor: { getLastRenderWasPing: vi.fn(() => finalIsPing) },
      renderTargetManager: {
        getPingTexture: vi.fn(() => pingTexture),
        getPongTexture: vi.fn(() => pongTexture),
        getResolution: vi.fn(() => ({ width: 1920, height: 1080 })),
      },
      nestedCompRenderer: { cacheActiveCompOutput: cacheOutput },
    };
    const deps = {
      getResources: () => resources,
    } as unknown as OutputPresenterDeps;

    cacheActiveCompOutput(deps, 'active-comp', 2.5);

    expect(cacheOutput).toHaveBeenCalledWith(
      'active-comp',
      expectedSource === 'ping' ? pingTexture : pongTexture,
      1920,
      1080,
      2.5,
    );
  });

  it('forwards the exact occurrence key to the texture lookup', () => {
    const view = { label: 'nested-occurrence-view' } as unknown as GPUTextureView;
    const getTexture = vi.fn(() => ({ view }));
    const commandBuffer = { label: 'copy-command-buffer' } as unknown as GPUCommandBuffer;
    const commandEncoder = {
      finish: vi.fn(() => commandBuffer),
    } as unknown as GPUCommandEncoder;
    const device = {
      createCommandEncoder: vi.fn(() => commandEncoder),
      queue: { submit: vi.fn() },
    } as unknown as GPUDevice;
    const canvasContext = {} as GPUCanvasContext;
    const outputBindGroup = {} as GPUBindGroup;
    const outputPipeline = {
      createOutputBindGroup: vi.fn(() => outputBindGroup),
      renderToCanvas: vi.fn(),
    };
    const resources = {
      nestedCompRenderer: { getTexture },
      outputPipeline,
      sampler: {} as GPUSampler,
    };
    const deps = {
      getDevice: () => device,
      getResources: () => resources,
      getTargetContext: () => canvasContext,
      getPreviewContext: () => null,
      getRenderDispatcher: () => null,
    } as unknown as OutputPresenterDeps;

    expect(copyNestedCompTextureToPreview(
      deps,
      'preview-a',
      'nested-comp',
      'parent_layer_3_nested-clip',
    )).toBe(true);
    expect(getTexture).toHaveBeenCalledWith('nested-comp', 'parent_layer_3_nested-clip');
    expect(outputPipeline.createOutputBindGroup).toHaveBeenCalledWith(
      resources.sampler,
      view,
    );
    expect(outputPipeline.renderToCanvas).toHaveBeenCalledWith(
      commandEncoder,
      canvasContext,
      outputBindGroup,
    );
    expect(device.queue.submit).toHaveBeenCalledWith([commandBuffer]);
  });

  it('does not copy when the exact occurrence lookup is unavailable', () => {
    const getTexture = vi.fn(() => undefined);
    const device = {
      createCommandEncoder: vi.fn(),
      queue: { submit: vi.fn() },
    } as unknown as GPUDevice;
    const deps = {
      getDevice: () => device,
      getResources: () => ({
        nestedCompRenderer: { getTexture },
        outputPipeline: {},
        sampler: {},
      }),
      getTargetContext: () => ({}),
      getPreviewContext: () => null,
      getRenderDispatcher: () => null,
    } as unknown as OutputPresenterDeps;

    expect(copyNestedCompTextureToPreview(
      deps,
      'preview-a',
      'nested-comp',
      'missing-occurrence',
    )).toBe(false);
    expect(device.createCommandEncoder).not.toHaveBeenCalled();
  });
});
