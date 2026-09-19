import type { CacheManager } from '../managers/CacheManager';
import type { ExportCanvasManager } from '../managers/ExportCanvasManager';
import type { PerformanceStats } from '../stats/PerformanceStats';
import { RenderDispatcher, type RenderDeps } from '../render/RenderDispatcher';
import { RenderLoop } from '../render/RenderLoop';
import { RenderOutputRouterAdapter } from '../render/RenderOutputRouterAdapter';
import type { EngineResourceSet } from './engineResources';

export interface EngineRenderDispatcherFactoryDeps {
  getDevice(): GPUDevice | null;
  isRecovering(): boolean;
  getResources(): EngineResourceSet | null;
  getPreviewContext(): GPUCanvasContext | null;
  getTargetCanvases(): Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  getCacheManager(): CacheManager;
  getExportCanvasManager(): ExportCanvasManager;
  getPerformanceStats(): PerformanceStats;
  getRenderLoop(): RenderLoop | null;
  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null;
  unregisterTargetCanvas(targetId: string): void;
  getTargetContext(targetId: string): GPUCanvasContext | null;
}

export function createEngineRenderDispatcher(deps: EngineRenderDispatcherFactoryDeps): RenderDispatcher {
  const res = deps.getResources;
  const renderDeps = {
    getDevice: deps.getDevice,
    isRecovering: deps.isRecovering,
  } as RenderDeps;
  Object.defineProperties(renderDeps, {
    sampler: { get: () => res()?.sampler ?? null },
    previewContext: { get: deps.getPreviewContext },
    targetCanvases: { get: deps.getTargetCanvases },
    compositorPipeline: { get: () => res()?.compositorPipeline ?? null },
    effectsPipeline: { get: () => res()?.effectsPipeline ?? null },
    outputPipeline: { get: () => res()?.outputPipeline ?? null },
    slicePipeline: { get: () => res()?.slicePipeline ?? null },
    textureManager: { get: () => res()?.textureManager ?? null },
    maskTextureManager: { get: () => res()?.maskTextureManager ?? null },
    renderTargetManager: { get: () => res()?.renderTargetManager ?? null },
    layerCollector: { get: () => res()?.layerCollector ?? null },
    compositor: { get: () => res()?.compositor ?? null },
    nestedCompRenderer: { get: () => res()?.nestedCompRenderer ?? null },
    motionRenderer: { get: () => res()?.motionRenderer ?? null },
    cacheManager: { get: deps.getCacheManager },
    exportCanvasManager: { get: deps.getExportCanvasManager },
    performanceStats: { get: deps.getPerformanceStats },
    renderLoop: { get: deps.getRenderLoop },
  });
  const renderOutputRouter = new RenderOutputRouterAdapter({
    canvasTargets: {
      registerTargetCanvas: deps.registerTargetCanvas,
      unregisterTargetCanvas: deps.unregisterTargetCanvas,
      getTargetContext: deps.getTargetContext,
    },
    getPreviewContext: deps.getPreviewContext,
    getOutputPipeline: () => res()?.outputPipeline ?? null,
    getSlicePipeline: () => res()?.slicePipeline ?? null,
    getResolution: () => res()?.renderTargetManager.getResolution() ?? null,
    shouldSkipPreviewOutput: () => deps.getExportCanvasManager().shouldSkipPreviewOutput(),
    getExportCanvasContext: () => deps.getExportCanvasManager().getExportCanvasContext(),
    isExporting: () => deps.getExportCanvasManager().getIsExporting(),
  });
  return new RenderDispatcher(renderDeps, renderOutputRouter);
}
