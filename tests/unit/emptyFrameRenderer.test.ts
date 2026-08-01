import { describe, expect, it, vi } from 'vitest';

import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import type { RenderOutputRouter } from '../../src/engine/render/contracts';
import { EmptyFrameRenderer } from '../../src/engine/render/dispatcher/emptyFrameRenderer';

describe('EmptyFrameRenderer', () => {
  it('clears both compositor targets so readback cannot retain the previous frame', () => {
    const pingView = { label: 'ping' } as GPUTextureView;
    const pongView = { label: 'pong' } as GPUTextureView;
    const renderPass = { end: vi.fn() };
    const commandEncoder = {
      beginRenderPass: vi.fn(() => renderPass),
      finish: vi.fn(() => ({ label: 'empty-frame-command' })),
    } as unknown as GPUCommandEncoder;
    const device = {
      createCommandEncoder: vi.fn(() => commandEncoder),
      queue: { submit: vi.fn() },
    } as unknown as GPUDevice;
    const deps = {
      sampler: {} as GPUSampler,
      outputPipeline: {},
      previewContext: {} as GPUCanvasContext,
      renderTargetManager: {
        getPingView: vi.fn(() => pingView),
        getPongView: vi.fn(() => pongView),
      },
    } as unknown as RenderDeps;
    const outputRouter = {
      captureSnapshot: vi.fn(() => ({ activeCompositionTargetIds: [] })),
      routeEmptyFrame: vi.fn(),
    } as unknown as RenderOutputRouter;
    const recordMainPreviewFrame = vi.fn();
    const renderer = new EmptyFrameRenderer(deps, outputRouter, recordMainPreviewFrame);

    renderer.renderEmptyFrame(device);

    expect(commandEncoder.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [
        {
          view: pingView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
        {
          view: pongView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    expect(renderPass.end).toHaveBeenCalledOnce();
    expect(outputRouter.routeEmptyFrame).toHaveBeenCalledWith(expect.objectContaining({
      commandEncoder,
      sourceView: pingView,
      sampler: deps.sampler,
    }));
    expect(device.queue.submit).toHaveBeenCalledWith([{ label: 'empty-frame-command' }]);
    expect(recordMainPreviewFrame).toHaveBeenCalledWith('empty');
  });
});
