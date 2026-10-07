import type { OutputPipeline } from '../pipeline/OutputPipeline';
import type { SlicePipeline } from '../pipeline/SlicePipeline';
import type { OutputSlice } from '../../types/outputSlice';
import { captureRenderTargetSnapshot } from '../../services/render/renderTargetSnapshotFactory';
import { findRenderTargetDescriptor } from './contracts/renderTargetSnapshot';
import type {
  RenderCachedFrameRouteInput,
  RenderCanvasTargetRegistration,
  RenderCompositeFrameRouteInput,
  RenderEmptyFrameRouteInput,
  RenderOutputRouter,
  RenderTargetSnapshot,
} from './contracts';

export interface RenderOutputRouterCanvasDelegate {
  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null;
  unregisterTargetCanvas(targetId: string): void;
  getTargetContext(targetId: string): GPUCanvasContext | null;
}

export interface RenderOutputRouterRuntimeDelegate {
  getPreviewContext(): GPUCanvasContext | null;
  getOutputPipeline(): OutputPipeline | null;
  getSlicePipeline(): SlicePipeline | null;
  getResolution(): { width: number; height: number } | null;
  shouldSkipPreviewOutput(): boolean;
  getExportCanvasContext(): GPUCanvasContext | null;
  isExporting(): boolean;
}

export interface RenderOutputRouterAdapterDeps extends RenderOutputRouterRuntimeDelegate {
  canvasTargets: RenderOutputRouterCanvasDelegate;
  captureSnapshot?: () => RenderTargetSnapshot;
}

export class RenderOutputRouterAdapter implements RenderOutputRouter {
  private readonly deps: RenderOutputRouterAdapterDeps;

  constructor(deps: RenderOutputRouterAdapterDeps) {
    this.deps = deps;
  }

  captureSnapshot(): RenderTargetSnapshot {
    return (this.deps.captureSnapshot ?? captureRenderTargetSnapshot)();
  }

  registerCanvasTarget(target: RenderCanvasTargetRegistration): GPUCanvasContext | null {
    return this.deps.canvasTargets.registerTargetCanvas(target.id, target.canvas);
  }

  unregisterTarget(id: string): void {
    this.deps.canvasTargets.unregisterTargetCanvas(id);
  }

  getTargetContext(id: string): GPUCanvasContext | null {
    return this.deps.canvasTargets.getTargetContext(id);
  }

  routeCompositeFrame(input: RenderCompositeFrameRouteInput): void {
    const outputPipeline = this.deps.getOutputPipeline();
    if (!outputPipeline) return;

    const resolution = this.deps.getResolution() ?? input.snapshot?.resolution;
    if (resolution) {
      outputPipeline.updateResolution(resolution.width, resolution.height);
    }

    if (!this.deps.shouldSkipPreviewOutput()) {
      const previewContext = this.deps.getPreviewContext();
      if (previewContext) {
        const mainBindGroup = outputPipeline.createOutputBindGroup(input.sampler, input.sourceView, 'normal');
        outputPipeline.renderToCanvas(input.commandEncoder, previewContext, mainBindGroup);
      }

      const snapshot = input.snapshot ?? this.captureSnapshot();
      const targetIds = input.targetIds ?? snapshot.activeCompositionTargetIds;
      const slicePipeline = this.deps.getSlicePipeline();
      for (const targetId of targetIds) {
        const target = findRenderTargetDescriptor(snapshot, targetId);
        const ctx = this.getTargetContext(targetId);
        if (!target || !ctx) continue;

        let sliceLookupId = target.id;
        if (target.id === '__om_preview__' && snapshot.outputPreview.previewingTargetId) {
          if (snapshot.outputPreview.activeTab === 'output') {
            sliceLookupId = snapshot.outputPreview.previewingTargetId;
          }
        }

        const config = snapshot.sliceConfigs[sliceLookupId];
        const enabledSlices = config?.slices.filter((slice) => slice.enabled) ?? [];

        if (enabledSlices.length > 0 && slicePipeline) {
          // Vertices are keyed by the drawn target (not sliceLookupId): every target in this
          // encoder needs its own buffer, even when two of them show the same slice config.
          slicePipeline.buildVertexBuffer(enabledSlices as OutputSlice[], target.id);
          slicePipeline.renderSlicedOutput(input.commandEncoder, ctx, input.sourceView, input.sampler, target.id);
        } else {
          const targetBindGroup = outputPipeline.createOutputBindGroup(
            input.sampler,
            input.sourceView,
            target.showTransparencyGrid ? 'grid' : 'normal',
          );
          outputPipeline.renderToCanvas(input.commandEncoder, ctx, targetBindGroup);
        }
      }
    }

    if (input.exportTarget) {
      const exportBindGroup = outputPipeline.createOutputBindGroup(
        input.sampler,
        input.sourceView,
        input.exportTarget.mode,
      );
      outputPipeline.renderToCanvas(input.commandEncoder, input.exportTarget.context, exportBindGroup);
    }
  }

  routeEmptyFrame(input: RenderEmptyFrameRouteInput): void {
    const outputPipeline = this.deps.getOutputPipeline();
    if (input.sourceView && outputPipeline && input.sampler) {
      const resolution = this.deps.getResolution() ?? input.snapshot?.resolution;
      if (resolution) {
        outputPipeline.updateResolution(resolution.width, resolution.height);
      }

      const previewContext = this.deps.getPreviewContext();
      if (previewContext) {
        const mainBindGroup = outputPipeline.createOutputBindGroup(input.sampler, input.sourceView, 'normal');
        outputPipeline.renderToCanvas(input.commandEncoder, previewContext, mainBindGroup);
      }

      const snapshot = input.snapshot ?? this.captureSnapshot();
      const targetIds = input.targetIds ?? snapshot.activeCompositionTargetIds;
      for (const targetId of targetIds) {
        const target = findRenderTargetDescriptor(snapshot, targetId);
        const ctx = this.getTargetContext(targetId);
        if (!target || !ctx) continue;

        const targetBindGroup = outputPipeline.createOutputBindGroup(
          input.sampler,
          input.sourceView,
          target.showTransparencyGrid ? 'grid' : 'normal',
        );
        outputPipeline.renderToCanvas(input.commandEncoder, ctx, targetBindGroup);
      }
    } else {
      const previewContext = this.deps.getPreviewContext();
      if (previewContext) {
        try {
          const pass = input.commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: previewContext.getCurrentTexture().createView(),
              clearValue: input.clearColor ?? { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          pass.end();
        } catch {
          // Canvas context lost - skip
        }
      }
    }

    const emptyExportCtx = this.deps.getExportCanvasContext();
    if (this.deps.isExporting() && emptyExportCtx) {
      try {
        const pass = input.commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: emptyExportCtx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.end();
      } catch {
        // Export canvas context lost - skip
      }
    }
  }

  routeCachedFrame(input: RenderCachedFrameRouteInput): void {
    const outputPipeline = this.deps.getOutputPipeline();
    if (!outputPipeline) return;

    const previewContext = this.deps.getPreviewContext();
    if (previewContext) {
      outputPipeline.renderToCanvas(input.commandEncoder, previewContext, input.bindGroup);
    }

    const snapshot = input.snapshot ?? this.captureSnapshot();
    const targetIds = input.targetIds ?? snapshot.activeCompositionTargetIds;
    for (const targetId of targetIds) {
      const ctx = this.getTargetContext(targetId);
      if (ctx) {
        outputPipeline.renderToCanvas(input.commandEncoder, ctx, input.bindGroup);
      }
    }
  }
}
