import type { RenderDeps } from '../RenderDispatcher';
import type { RenderOutputRouter } from '../contracts';
import type { PreviewFrameRecorder } from './dispatcherTelemetry';

export class EmptyFrameRenderer {
  private readonly deps: RenderDeps;
  private readonly outputRouter: RenderOutputRouter;
  private readonly recordMainPreviewFrame: PreviewFrameRecorder;

  constructor(
    deps: RenderDeps,
    outputRouter: RenderOutputRouter,
    recordMainPreviewFrame: PreviewFrameRecorder,
  ) {
    this.deps = deps;
    this.outputRouter = outputRouter;
    this.recordMainPreviewFrame = recordMainPreviewFrame;
  }

  renderEmptyFrame(device: GPUDevice): void {
    const d = this.deps;
    const commandEncoder = device.createCommandEncoder();
    const pingView = d.renderTargetManager?.getPingView();
    const pongView = d.renderTargetManager?.getPongView();

    // Use output pipeline to render empty frame (allows shader to generate checkerboard)
    if (pingView && d.outputPipeline && d.sampler) {
      // Pixel readback follows the compositor's last ping/pong target. Clear
      // both so an intentionally empty frame cannot expose the previous
      // composite when the last rendered target happened to be pong.
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [pingView, pongView].filter((view): view is GPUTextureView => !!view).map((view) => ({
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
        })),
      });
      clearPass.end();
    }

    const outputSnapshot = pingView && d.outputPipeline && d.sampler
      ? this.outputRouter.captureSnapshot()
      : undefined;
    this.outputRouter.routeEmptyFrame({
      commandEncoder,
      sourceView: pingView ?? undefined,
      sampler: d.sampler ?? undefined,
      snapshot: outputSnapshot,
      targetIds: outputSnapshot?.activeCompositionTargetIds,
    });
    if (pingView && d.outputPipeline && d.sampler && d.previewContext) {
      this.recordMainPreviewFrame('empty');
    }
    device.queue.submit([commandEncoder.finish()]);
  }
}
