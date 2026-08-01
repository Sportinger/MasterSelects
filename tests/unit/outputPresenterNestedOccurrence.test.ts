import { describe, expect, it, vi } from 'vitest';
import {
  copyNestedCompTextureToPreview,
  type OutputPresenterDeps,
} from '../../src/engine/engineCore/outputPresenter';

describe('outputPresenter nested occurrence copy', () => {
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
