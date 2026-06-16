import type { LayerRenderData } from '../../core/types';
import { Logger } from '../../../services/logger';
import type { RenderDeps } from '../RenderDispatcher';
import type { RenderOutputRouter, RenderTargetSnapshot } from '../contracts';
import type { PreviewFrameFallback } from './dispatcherTelemetry';

const log = Logger.create('RenderDispatcher');

type PreviewFrameRecorder = (
  mode: string,
  layerData?: LayerRenderData[],
  fallback?: PreviewFrameFallback,
) => void;

export class CachedFrameRenderer {
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

  private resolveCachedFrameRoute(): {
    snapshot: RenderTargetSnapshot;
    targetIds: readonly string[];
  } | null {
    const snapshot = this.outputRouter.captureSnapshot();
    const targetIds = snapshot.activeCompositionTargetIds;
    if (this.deps.previewContext) {
      return { snapshot, targetIds };
    }
    if (targetIds.some((targetId) => this.outputRouter.getTargetContext(targetId))) {
      return { snapshot, targetIds };
    }
    return null;
  }

  renderCachedFrame(time: number): boolean {
    const d = this.deps;
    const device = d.getDevice();
    const scrubbingCache = d.cacheManager.getScrubbingCache();
    if (!device || !scrubbingCache || !d.outputPipeline || !d.sampler) {
      return false;
    }

    const route = this.resolveCachedFrameRoute();
    if (!route) {
      return false;
    }

    const gpuCached = scrubbingCache.getGpuCachedFrame(time);
    if (gpuCached) {
      const commandEncoder = device.createCommandEncoder();
      this.outputRouter.routeCachedFrame({
        commandEncoder,
        bindGroup: gpuCached.bindGroup,
        time,
        snapshot: route.snapshot,
        targetIds: route.targetIds,
      });
      this.recordMainPreviewFrame('ram-gpu-cache', undefined, {
        targetTimeMs: Math.round(time * 1000),
        displayedTimeMs: Math.round(time * 1000),
      });
      device.queue.submit([commandEncoder.finish()]);
      return true;
    }

    const imageData = scrubbingCache.getCachedCompositeFrame(time);
    if (!imageData) {
      return false;
    }
    let createdTexture: GPUTexture | null = null;
    try {
      const { width, height } = { width: imageData.width, height: imageData.height };
      const gpuCacheAdmission = scrubbingCache.canCacheGpuFrame(time, {
        width,
        height,
        format: 'rgba8unorm',
        gpuBytes: width * height * 4,
      });
      if (!gpuCacheAdmission.admitted) {
        log.debug('RAM preview GPU cache skipped by runtime admission', {
          resourceId: gpuCacheAdmission.resourceId,
          reason: gpuCacheAdmission.reason,
          rejectedUnits: gpuCacheAdmission.rejectedUnits.map((entry) => entry.unit),
        });
        return false;
      }

      let canvas = d.cacheManager.getRamPlaybackCanvas();
      let ctx = d.cacheManager.getRamPlaybackCtx();

      if (!canvas || !ctx) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) return false;
        d.cacheManager.setRamPlaybackCanvas(canvas, ctx);
      } else if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.putImageData(imageData, 0, 0);

      const texture = device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      createdTexture = texture;

      device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [width, height]);

      const view = texture.createView();
      const bindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, view);

      const cachedOnGpu = scrubbingCache.addToGpuCache(time, {
        texture,
        view,
        bindGroup,
        width,
        height,
        format: 'rgba8unorm',
        gpuBytes: width * height * 4,
      });
      if (!cachedOnGpu) {
        createdTexture = null;
        return false;
      }
      createdTexture = null;

      const commandEncoder = device.createCommandEncoder();
      this.outputRouter.routeCachedFrame({
        commandEncoder,
        bindGroup,
        time,
        snapshot: route.snapshot,
        targetIds: route.targetIds,
      });
      this.recordMainPreviewFrame('ram-cpu-cache', undefined, {
        targetTimeMs: Math.round(time * 1000),
        displayedTimeMs: Math.round(time * 1000),
      });
      device.queue.submit([commandEncoder.finish()]);
      return true;
    } catch (e) {
      createdTexture?.destroy();
      log.warn('Failed to render cached frame', e);
      return false;
    }
  }
}
