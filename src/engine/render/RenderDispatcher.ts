// RenderDispatcher â€” extracted render methods from WebGPUEngine
// Handles: render(), renderEmptyFrame(), renderToPreviewCanvas(), renderCachedFrame()

import type { Layer, LayerRenderData } from '../core/types';
import type { ModelSequenceData } from '../../types/mediaSequences';
import type { TextureManager } from '../texture/TextureManager';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import type { CacheManager } from '../managers/CacheManager';
import type { ExportCanvasManager } from '../managers/ExportCanvasManager';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { OutputPipeline } from '../pipeline/OutputPipeline';
import type { SlicePipeline } from '../pipeline/SlicePipeline';
import type { RenderTargetManager } from '../core/RenderTargetManager';
import type { LayerCollector } from './LayerCollector';
import type { Compositor } from './Compositor';
import type { NestedCompRenderer } from './NestedCompRenderer';
import type { PerformanceStats } from '../stats/PerformanceStats';
import type { RenderLoop } from './RenderLoop';
import { useTimelineStore } from '../../stores/timeline';
import { reportRenderTime } from '../../services/performanceMonitor';
import { Logger } from '../../services/logger';
import { scrubSettleState } from '../../services/scrubSettleState';
import { flags } from '../featureFlags';
import type { NativeSceneRenderer } from '../native3d/NativeSceneRenderer';
import { collectActiveSceneSplatEffectors } from '../scene/SceneEffectorUtils';
import type { SceneSplatEffectorRuntimeData } from '../scene/types';
import { resolveSharedSplatSceneKey } from '../scene/runtime/SharedSplatRuntimeUtils';
import type { MotionRenderer } from '../motion/MotionRenderer';
import { getMotionRenderSize } from '../motion/MotionTypes';
import { RenderOutputRouterAdapter } from './RenderOutputRouterAdapter';
import type { RenderOutputRouter } from './contracts';
import { CachedFrameRenderer } from './dispatcher/cachedFrameRenderer';
import { DispatcherDebugSnapshotFacet, type RenderDispatcherDebugSnapshot } from './dispatcher/dispatcherDebugSnapshot';
import { DispatcherTelemetry } from './dispatcher/dispatcherTelemetry';
import { EmptyFrameRenderer } from './dispatcher/emptyFrameRenderer';
import { ExportReadinessFacet } from './dispatcher/exportReadinessFacet';
import { GaussianSequenceFacet, type GaussianSplatSceneLoadRequest } from './dispatcher/gaussianSequenceFacet';
import { GaussianSplatSceneLoader } from './dispatcher/gaussianSplatSceneLoader';
import { SharedScene3DProcessor } from './dispatcher/sharedScene3DProcessor';
import { TargetPreviewRenderer } from './dispatcher/targetPreviewRenderer';

export type { RenderDispatcherDebugSnapshot } from './dispatcher/dispatcherDebugSnapshot';

const log = Logger.create('RenderDispatcher');

export interface GaussianSplatSequenceWarmupOptions {
  time?: number;
  frameCount?: number;
  waitFrameCount?: number;
  timeoutMs?: number;
  includeFocusedClip?: boolean;
  priority?: boolean;
}

export interface GaussianSplatSequenceWarmupResult {
  requested: number;
  alreadyReady: number;
  waited: number;
  scheduled: number;
  timedOut: boolean;
}

/**
 * Mutable deps bag â€” the engine updates these references as they change
 * (e.g. after device loss/restore, canvas attach/detach).
 */
export interface RenderDeps {
  getDevice: () => GPUDevice | null;
  isRecovering: () => boolean;
  sampler: GPUSampler | null;
  previewContext: GPUCanvasContext | null;
  targetCanvases: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  compositorPipeline: CompositorPipeline | null;
  outputPipeline: OutputPipeline | null;
  slicePipeline: SlicePipeline | null;
  textureManager: TextureManager | null;
  maskTextureManager: MaskTextureManager | null;
  renderTargetManager: RenderTargetManager | null;
  layerCollector: LayerCollector | null;
  compositor: Compositor | null;
  nestedCompRenderer: NestedCompRenderer | null;
  motionRenderer: MotionRenderer | null;
  cacheManager: CacheManager;
  exportCanvasManager: ExportCanvasManager;
  performanceStats: PerformanceStats;
  renderLoop: RenderLoop | null;
  sceneRenderer?: NativeSceneRenderer | null;
}

export class RenderDispatcher {
  /** Whether the last render() call produced visible content */
  lastRenderHadContent = false;
  lastRenderDebugSnapshot: RenderDispatcherDebugSnapshot | null = null;
  private deps: RenderDeps;
  private outputRouter: RenderOutputRouter;
  private readonly telemetry = new DispatcherTelemetry();

  // Public delegate kept on the dispatcher: facets and internal paths route
  // through here so external instrumentation (tests, diagnostics) can
  // spy/suppress preview-frame telemetry at one stable point.
  recordMainPreviewFrame(
    ...args: Parameters<DispatcherTelemetry['recordMainPreviewFrame']>
  ): void {
    this.telemetry.recordMainPreviewFrame(...args);
  }

  // Compat accessors: the preview-hold state moved into the telemetry facet;
  // these keep the dispatcher's long-standing seed/inspect surface intact.
  get lastPreviewTargetTimeMs(): number | undefined {
    return this.telemetry.lastPreviewTargetTimeMs;
  }
  set lastPreviewTargetTimeMs(value: number | undefined) {
    this.telemetry.lastPreviewTargetTimeMs = value;
  }
  get lastPreviewDisplayedTimeMs(): number | undefined {
    return this.telemetry.lastPreviewDisplayedTimeMs;
  }
  set lastPreviewDisplayedTimeMs(value: number | undefined) {
    this.telemetry.lastPreviewDisplayedTimeMs = value;
  }

  private readonly debugSnapshotFacet = new DispatcherDebugSnapshotFacet();
  private readonly splatSceneLoader: GaussianSplatSceneLoader;
  private readonly exportReadiness: ExportReadinessFacet;
  private readonly gaussianSequenceFacet: GaussianSequenceFacet;
  private readonly sharedScene3DProcessor: SharedScene3DProcessor;
  private readonly cachedFrameRenderer: CachedFrameRenderer;
  private readonly emptyFrameRenderer: EmptyFrameRenderer;
  private readonly targetPreviewRenderer: TargetPreviewRenderer;
  private lastCompositeView: GPUTextureView | null = null;
  private renderTimeOverride: number | null = null;

  constructor(deps: RenderDeps, outputRouter?: RenderOutputRouter) {
    this.deps = deps;
    this.outputRouter = outputRouter ?? new RenderOutputRouterAdapter({
      canvasTargets: {
        registerTargetCanvas: () => null,
        unregisterTargetCanvas: (targetId) => {
          deps.targetCanvases.delete(targetId);
        },
        getTargetContext: (targetId) => deps.targetCanvases.get(targetId)?.context ?? null,
      },
      getPreviewContext: () => this.deps.previewContext,
      getOutputPipeline: () => this.deps.outputPipeline,
      getSlicePipeline: () => this.deps.slicePipeline,
      getResolution: () => this.deps.renderTargetManager?.getResolution() ?? null,
      shouldSkipPreviewOutput: () => this.deps.exportCanvasManager.shouldSkipPreviewOutput(),
      getExportCanvasContext: () => this.deps.exportCanvasManager.getExportCanvasContext(),
      isExporting: () => this.deps.exportCanvasManager.getIsExporting(),
    });
    this.splatSceneLoader = new GaussianSplatSceneLoader({
      getDevice: () => this.deps.getDevice(),
      requestRender: () => {
        this.deps.renderLoop?.requestRender();
      },
    });
    // Readiness work routes back through the dispatcher's public methods so
    // they stay the single spy/override point for tests and instrumentation.
    this.exportReadiness = new ExportReadinessFacet({
      getResolution: () => this.deps.renderTargetManager?.getResolution() ?? null,
      ensureSceneRendererInitialized: (width, height) => this.ensureSceneRendererInitialized(width, height),
      preloadSceneModelAsset: (url, fileName, modelSequence) =>
        modelSequence
          ? this.preloadSceneModelAsset(url, fileName, modelSequence)
          : this.preloadSceneModelAsset(url, fileName),
      ensureGaussianSplatSceneLoaded: (request) => this.ensureGaussianSplatSceneLoaded(request),
    });
    this.gaussianSequenceFacet = new GaussianSequenceFacet({
      resolveSceneKey: (clipId, runtimeKey) => this.getNativeGaussianSplatSceneKey(clipId, runtimeKey),
      isSplatLoading: (sceneKey) => this.splatSceneLoader.isLoading(sceneKey),
      ensureSceneLoaded: (request) => this.ensureGaussianSplatSceneLoaded(request),
    });
    this.sharedScene3DProcessor = new SharedScene3DProcessor({
      renderDeps: this.deps,
      debugSnapshotFacet: this.debugSnapshotFacet,
      gaussianSequenceFacet: this.gaussianSequenceFacet,
      getLastRenderDebugSnapshot: () => this.lastRenderDebugSnapshot,
      getEffectiveTimelineTime: () => this.getEffectiveTimelineTime(),
      collectActiveSplatEffectors: (width, height) => this.collectActiveSplatEffectors(width, height),
      getNativeGaussianSplatSceneKey: (clipId, runtimeKey) => this.getNativeGaussianSplatSceneKey(clipId, runtimeKey),
      isSplatLoading: (sceneKey) => this.splatSceneLoader.isLoading(sceneKey),
      ensureGaussianSplatSceneLoaded: (request) => this.ensureGaussianSplatSceneLoaded(request),
    });
    // Facets route through the dispatcher delegate so the long-standing
    // public spy/suppress point (recordMainPreviewFrame) keeps working.
    const recordMainPreviewFrame = this.recordMainPreviewFrame.bind(this);
    this.cachedFrameRenderer = new CachedFrameRenderer(this.deps, this.outputRouter, recordMainPreviewFrame);
    this.emptyFrameRenderer = new EmptyFrameRenderer(this.deps, this.outputRouter, recordMainPreviewFrame);
    this.targetPreviewRenderer = new TargetPreviewRenderer(this.deps, recordMainPreviewFrame);
  }

  setRenderTimeOverride(time: number | null): void {
    this.renderTimeOverride = typeof time === 'number' && Number.isFinite(time) ? time : null;
  }

  private getEffectiveTimelineTime(): number {
    if (this.renderTimeOverride !== null) {
      return this.renderTimeOverride;
    }
    return useTimelineStore.getState().playheadPosition;
  }

  private getNativeGaussianSplatSceneKey(
    clipId: string,
    runtimeKey?: string,
  ): string {
    return resolveSharedSplatSceneKey({
      clipId,
      runtimeKey,
    });
  }

  private collectActiveSplatEffectors(width: number, height: number): SceneSplatEffectorRuntimeData[] {
    return collectActiveSceneSplatEffectors(
      width,
      height,
      this.getEffectiveTimelineTime(),
    );
  }

  async ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    return this.splatSceneLoader.ensureSceneLoaded(options);
  }

  async ensureSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    const { getNativeSceneRenderer } = await import('../native3d/NativeSceneRenderer');
    const renderer = this.deps.sceneRenderer ?? getNativeSceneRenderer();
    const initialized = await renderer.initialize(width, height);
    if (initialized) {
      this.deps.sceneRenderer = renderer;
    }
    return initialized;
  }

  async preloadSceneModelAsset(url: string, fileName: string, modelSequence?: ModelSequenceData): Promise<boolean> {
    if (!url) return false;

    const existingRenderer = this.deps.sceneRenderer;
    let renderer = existingRenderer;
    if (!renderer?.isInitialized) {
      const resolution = this.deps.renderTargetManager?.getResolution() ?? { width: 1, height: 1 };
      const initialized = await this.ensureSceneRendererInitialized(resolution.width, resolution.height);
      if (!initialized) {
        return false;
      }
      renderer = this.deps.sceneRenderer ?? null;
    }

    if (!renderer) {
      return false;
    }

    return renderer.preloadModel(url, fileName, modelSequence);
  }

  clearExportReadinessCache(): void {
    this.exportReadiness.clearExportReadinessCache();
  }

  async ensureExportLayersReady(layers: Layer[]): Promise<void> {
    await this.exportReadiness.ensureExportLayersReady(layers);
  }

  // === MAIN RENDER ===

  render(layers: Layer[]): void {
    const d = this.deps;
    if (d.isRecovering()) return;

    const device = d.getDevice();
    if (!device || !d.compositorPipeline || !d.outputPipeline || !d.sampler) return;
    if (!d.renderTargetManager || !d.layerCollector || !d.compositor || !d.textureManager) return;

    const pingView = d.renderTargetManager.getPingView();
    const pongView = d.renderTargetManager.getPongView();
    if (!pingView || !pongView) return;

    // Clear frame-scoped caches (external texture bind groups)
    d.compositorPipeline.beginFrame();

    const t0 = performance.now();
    const { width, height } = d.renderTargetManager.getResolution();
    const skipEffects = false;
    const isExporting = d.exportCanvasManager.getIsExporting();
    const timelineState = useTimelineStore.getState();
    const isPlaying =
      (d.renderLoop?.getIsPlaying() ?? false) &&
      timelineState.isPlaying;

    // Collect layer data
    const t1 = performance.now();
    const layerData = d.layerCollector.collect(layers, {
      textureManager: d.textureManager!,
      scrubbingCache: d.cacheManager.getScrubbingCache(),
      motionRenderer: d.motionRenderer,
      getLastVideoTime: (key) => d.cacheManager.getLastVideoTime(key),
      setLastVideoTime: (key, time) => d.cacheManager.setLastVideoTime(key, time),
      isExporting,
      isPlaying,
    });
    const importTime = performance.now() - t1;
    const debugSnapshot: RenderDispatcherDebugSnapshot = this.debugSnapshotFacet.createRenderDebugSnapshot(
      layers,
      layerData,
    );
    this.lastRenderDebugSnapshot = debugSnapshot;
    this.debugSnapshotFacet.recordSceneRenderInputChanged(layers, layerData);

    // Update stats
    d.performanceStats.setDecoder(d.layerCollector.getDecoder());
    d.performanceStats.setWebCodecsInfo(d.layerCollector.getWebCodecsInfo());
    d.renderLoop?.setHasActiveVideo(d.layerCollector.hasActiveVideo());

    // Handle empty layers
    if (layerData.length === 0) {
      const previewFallback = this.telemetry.getPreviewFallbackFromLayers(layers);
      const hasVisibleInputLayer = this.telemetry.hasVisiblePreviewInputLayer(layers);
      const lastPreviewDisplayedTimeMs = this.telemetry.getLastPreviewDisplayedTimeMs();
      // During playback, if we just had content, hold the last frame on screen
      // instead of flashing black. This only applies when an input layer exists
      // for the current time but collection produced no texture/frame, which
      // handles transient decoder stalls on Windows/Linux where readyState drops
      // briefly. Real timeline gaps must render empty instead of retaining the
      // previous clip's last frame.
      const isDragging = timelineState.isDraggingPlayhead;
      const isScrubSettling =
        !isPlaying &&
        !isDragging &&
        !!previewFallback.clipId &&
        scrubSettleState.isPending(previewFallback.clipId);
      const emptyScrubHoldDriftMs =
        typeof previewFallback.targetTimeMs === 'number' &&
        typeof lastPreviewDisplayedTimeMs === 'number'
          ? Math.abs(previewFallback.targetTimeMs - lastPreviewDisplayedTimeMs)
          : undefined;
      // During interactive scrubs, a stale visible frame is preferable to a
      // black clear while the browser decoder catches up to a long-GOP seek.
      const canHoldEmptyScrubFrame =
        (isDragging || isScrubSettling) &&
        this.lastRenderHadContent;
      const canHoldPausedEmptyFrame =
        !isPlaying &&
        !isDragging &&
        !isScrubSettling &&
        !isExporting &&
        this.telemetry.shouldHoldLastFrameOnEmptyPlayback(
          this.lastRenderHadContent,
          previewFallback.targetTimeMs,
        );
      const shouldHoldEmptyFrame =
        hasVisibleInputLayer &&
        (
          (isPlaying && this.telemetry.shouldHoldLastFrameOnEmptyPlayback(this.lastRenderHadContent, previewFallback.targetTimeMs)) ||
          canHoldEmptyScrubFrame ||
          canHoldPausedEmptyFrame
        );

      if (shouldHoldEmptyFrame) {
        const heldCompositeRendered = this.renderHeldCompositeFrame(device);
        // Don't render anything â€” canvas retains previous frame automatically.
        // Log once so the stall is visible in telemetry.
        log.debug('Holding last frame during empty preview frame', {
          isPlaying,
          isDragging,
          driftMs: emptyScrubHoldDriftMs,
          heldCompositeRendered,
        });
        this.recordMainPreviewFrame(
          isDragging || isScrubSettling
            ? 'empty-hold'
            : isPlaying
              ? 'playback-stall-hold'
              : 'paused-empty-hold',
          undefined,
          {
            ...previewFallback,
            displayedTimeMs: lastPreviewDisplayedTimeMs,
          }
        );
        d.performanceStats.setLayerCount(0);
        return;
      }
      this.lastRenderHadContent = false;
      this.lastCompositeView = null;
      this.renderEmptyFrame(device);
      this.recordMainPreviewFrame('empty', undefined, previewFallback);
      d.performanceStats.setLayerCount(0);
      return;
    }
    this.lastRenderHadContent = true;

    // === Shared 3D Scene Pass ===
    if (flags.use3DLayers) {
      this.process3DLayers(layerData, device, width, height);
    }
    debugSnapshot.after3DLayerData = layerData.length;

    const commandBuffers: GPUCommandBuffer[] = [];

    // Pre-render nested compositions (batched with main composite)
    let hasNestedComps = false;
    let hasDeferredNestedComp = false;
    let hasMotionLayers = false;

    const preRenderEncoder = device.createCommandEncoder();
    for (let i = layerData.length - 1; i >= 0; i--) {
      const data = layerData[i];
      if (data.layer.source?.type === 'motion') {
        hasMotionLayers = true;
        const rendered = d.motionRenderer?.renderLayer(data.layer, preRenderEncoder);
        const size = rendered ?? getMotionRenderSize(data.layer.source.motion);
        data.textureView = rendered?.textureView ?? null;
        data.sourceWidth = size.width;
        data.sourceHeight = size.height;
      }

      if (data.layer.source?.nestedComposition) {
        hasNestedComps = true;
        const nc = data.layer.source.nestedComposition;
        const view = d.nestedCompRenderer!.preRender(
          nc.compositionId,
          nc.layers,
          nc.width,
          nc.height,
          preRenderEncoder,
          d.sampler,
          nc.currentTime,
          nc.sceneClips,
          nc.sceneTracks,
          0,
          skipEffects,
          isExporting ? 'export' : 'preview',
        );
        if (view) {
          data.textureView = view;
        } else {
          hasDeferredNestedComp = true;
          layerData.splice(i, 1);
        }
      }
    }
    debugSnapshot.finalLayerData = layerData.length;
    if (hasDeferredNestedComp && isExporting) {
      throw new Error('Export frame deferred because a nested composition was not ready');
    }
    if (hasDeferredNestedComp && layerData.length === 0 && !isExporting) {
      const heldCompositeRendered = this.renderHeldCompositeFrame(device);
      if (heldCompositeRendered) {
        this.recordMainPreviewFrame('nested-stall-hold', undefined, {
          ...this.telemetry.getPreviewFallbackFromLayers(layers),
          displayedTimeMs: this.telemetry.getLastPreviewDisplayedTimeMs(),
        });
        d.performanceStats.setLayerCount(0);
        return;
      }
    }
    if (hasNestedComps || hasMotionLayers) {
      commandBuffers.push(preRenderEncoder.finish());
    }

    // Composite
    const t2 = performance.now();

    // Get effect temp textures for pre-processing effects on source layers
    const effectTempTexture = d.renderTargetManager.getEffectTempTexture() ?? undefined;
    const effectTempView = d.renderTargetManager.getEffectTempView() ?? undefined;
    const effectTempTexture2 = d.renderTargetManager.getEffectTempTexture2() ?? undefined;
    const effectTempView2 = d.renderTargetManager.getEffectTempView2() ?? undefined;

    const commandEncoder = device.createCommandEncoder();
    const result = d.compositor.composite(layerData, commandEncoder, {
      device, sampler: d.sampler, pingView, pongView, outputWidth: width, outputHeight: height,
      skipEffects,
      effectTempTexture, effectTempView, effectTempTexture2, effectTempView2,
      motionTime: this.getEffectiveTimelineTime(),
      particleQuality: isExporting ? 'export' : 'preview',
    });
    const renderTime = performance.now() - t2;

    // Output
    const skipCanvas = d.exportCanvasManager.shouldSkipPreviewOutput();
    const outputSnapshot = !skipCanvas ? this.outputRouter.captureSnapshot() : undefined;
    const activeTargetIds = outputSnapshot?.activeCompositionTargetIds ?? [];
    const exportCtx = d.exportCanvasManager.getExportCanvasContext();
    const exportTarget = isExporting && exportCtx
      ? {
        context: exportCtx,
        mode: d.exportCanvasManager.isStackedAlpha() ? 'stackedAlpha' as const : 'normal' as const,
      }
      : undefined;

    this.outputRouter.routeCompositeFrame({
      commandEncoder,
      sourceView: result.finalView,
      sampler: d.sampler,
      snapshot: outputSnapshot,
      targetIds: outputSnapshot?.activeCompositionTargetIds,
      exportTarget,
    });

    if (!skipCanvas) {
      if (d.previewContext) {
        this.recordMainPreviewFrame('composite', layerData);
      } else if (activeTargetIds.length > 0) {
        this.recordMainPreviewFrame('target-composite', layerData);
      }
    }

    // Batch submit all command buffers in single call
    commandBuffers.push(commandEncoder.finish());
    const t3 = performance.now();
    try {
      device.queue.submit(commandBuffers);
    } catch (e) {
      // GPU submit failed - likely device lost or validation error
      log.error('GPU submit failed', e);
      return;
    }
    this.lastCompositeView = result.finalView;
    const submitTime = performance.now() - t3;

    // Cleanup after submit
    if (hasNestedComps) {
      d.nestedCompRenderer!.cleanupPendingTextures();
    }

    // Stats
    const totalTime = performance.now() - t0;
    d.performanceStats.recordRenderTiming({
      importTexture: importTime,
      createBindGroup: 0,
      renderPass: renderTime,
      submit: submitTime,
      total: totalTime,
    });
    d.performanceStats.setLayerCount(result.layerCount);
    d.performanceStats.updateStats();
    reportRenderTime(totalTime);
  }

  /**
   * Process 3D layers through the shared scene renderer and replace them
   * with a single synthetic LayerRenderData entry.
   */
  private process3DLayers(layerData: LayerRenderData[], device: GPUDevice, width: number, height: number): void {
    this.sharedScene3DProcessor.process3DLayers(layerData, device, width, height);
  }

  private renderHeldCompositeFrame(device: GPUDevice): boolean {
    const d = this.deps;
    if (!this.lastCompositeView || !d.sampler || d.exportCanvasManager.shouldSkipPreviewOutput()) {
      return false;
    }

    const commandEncoder = device.createCommandEncoder();
    const outputSnapshot = this.outputRouter.captureSnapshot();
    this.outputRouter.routeCompositeFrame({
      commandEncoder,
      sourceView: this.lastCompositeView,
      sampler: d.sampler,
      snapshot: outputSnapshot,
      targetIds: outputSnapshot.activeCompositionTargetIds,
    });

    try {
      device.queue.submit([commandEncoder.finish()]);
      return true;
    } catch (e) {
      log.warn('Failed to render held composite frame', e);
      this.lastCompositeView = null;
      return false;
    }
  }

  getGaussianSplatSceneBounds(clipId: string): { min: [number, number, number]; max: [number, number, number] } | undefined {
    return this.splatSceneLoader.getSceneBounds(clipId);
  }

  renderEmptyFrame(device: GPUDevice): void {
    this.emptyFrameRenderer.renderEmptyFrame(device);
  }

  /**
   * Render specific layers to a specific target canvas
   * Used for multi-composition preview where each preview shows different content
   */
  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    this.targetPreviewRenderer.renderToPreviewCanvas(canvasId, layers);
  }

  renderCachedFrame(time: number): boolean {
    return this.cachedFrameRenderer.renderCachedFrame(time);
  }
}
