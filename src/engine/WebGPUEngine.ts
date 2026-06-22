// WebGPU Rendering Engine - Thin Facade
// Orchestrates: PerformanceStats, RenderTargetManager, OutputWindowManager,
//               RenderLoop, LayerCollector, Compositor, NestedCompRenderer

import type { ModelSequenceData } from '../types';
import type { Layer, EngineStats } from './core/types';
// OutputWindow type no longer needed — state lives in renderTargetStore
import { WebGPUContext, type GPUPowerPreference } from './core/WebGPUContext';
import { CacheManager } from './managers/CacheManager';
import { ExportCanvasManager } from './managers/ExportCanvasManager';
import { VideoFrameManager } from './video/VideoFrameManager';
import { useSettingsStore } from '../stores/settingsStore';
import { useRenderTargetStore } from '../stores/renderTargetStore';
import { Logger } from '../services/logger';
import { buildDebugInfrastructureState, type DebugInfrastructureState } from './engineCore/debugInfrastructureState';
import { wireContextRecovery } from './engineCore/contextRecoveryWiring';
import * as engineResources from './engineCore/engineResources';
import { createEngineRenderDispatcher } from './engineCore/renderDispatcherFactory';
import * as outputWindows from './engineCore/outputWindowController';
import * as outputPresenter from './engineCore/outputPresenter';
import { PixelReadback } from './engineCore/pixelReadback';
import type { GaussianSplatSceneLoadRequest } from './render/dispatcher/gaussianSequenceFacet';

const log = Logger.create('WebGPUEngine');

import { PerformanceStats } from './stats/PerformanceStats';
import type { RenderLoop } from './render/RenderLoop';
import type { LayerCollector } from './render/LayerCollector';
import type { RenderDispatcher, RenderDispatcherDebugSnapshot } from './render/RenderDispatcher';
import type { TextureManager } from './texture/TextureManager';
import type { ScrubbingCacheStats } from './texture/ScrubbingCache';

export class WebGPUEngine {
  // Core context
  private context: WebGPUContext;

  // Stats + render orchestration
  private performanceStats: PerformanceStats;
  private renderLoop: RenderLoop | null = null;
  private renderDispatcher: RenderDispatcher | null = null;

  // Device-epoch resource set (managers, pipelines, renderers).
  // Rebuilt by createResources(); see EngineResourceSet for loss semantics.
  private res: engineResources.EngineResourceSet | null = null;

  // Engine-lifetime managers (survive device loss)
  private cacheManager: CacheManager = new CacheManager();
  private exportCanvasManager: ExportCanvasManager = new ExportCanvasManager();
  private videoFrameManager: VideoFrameManager;

  // Resources
  private pixelReadback = new PixelReadback();

  // Unified canvas management - single Map replaces 6 old Maps
  private targetCanvases: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }> = new Map();
  // Legacy: kept for backward compat during migration
  private mainPreviewCanvas: HTMLCanvasElement | null = null;
  private previewContext: GPUCanvasContext | null = null;

  // State flags
  private isRecoveringFromDeviceLoss = false;

  // Track whether play has ever been pressed — persists across RenderLoop recreations.
  // Before first play, idle detection is suppressed so video GPU surfaces stay warm.
  private hasEverPlayed = false;
  // Track playing state so it can be carried over when RenderLoop is recreated
  private _isPlaying = false;

  constructor() {
    this.context = new WebGPUContext();
    this.videoFrameManager = new VideoFrameManager();
    this.performanceStats = new PerformanceStats();

    wireContextRecovery(this.context, {
      setRecovering: (recovering) => { this.isRecoveringFromDeviceLoss = recovering; },
      handleDeviceLost: () => this.handleDeviceLost(),
      handleDeviceRestored: () => { this.handleDeviceRestored(); },
    });
  }

  // === INITIALIZATION ===

  async initialize(): Promise<boolean> {
    const preference = useSettingsStore.getState().gpuPowerPreference;
    const success = await this.context.initialize(preference);
    if (!success) return false;

    await this.createResources();
    log.info('Engine initialized');
    return true;
  }

  private getRenderLoopHooks(): engineResources.EngineRenderLoopHooks {
    return {
      performanceStats: this.performanceStats,
      isRecovering: () => this.isRecoveringFromDeviceLoss || this.context.recovering,
      isExporting: () => this.exportCanvasManager.getIsExporting(),
    };
  }

  private async createResources(): Promise<void> {
    const device = this.context.getDevice();
    if (!device) return;

    // Ordered construction sequence lives in createEngineResources();
    // the render dispatcher is created last, exactly as before.
    const { resources, renderLoop } = await engineResources.createEngineResources({
      device,
      cacheManager: this.cacheManager,
      requestRender: () => this.requestRender(),
      createSampler: () => this.context.createSampler(),
      createSolidColorTexture: (r, g, b, a) => this.context.createSolidColorTexture(r, g, b, a),
      renderLoopHooks: this.getRenderLoopHooks(),
    });
    this.res = resources;
    this.renderLoop = renderLoop;

    this.renderDispatcher = createEngineRenderDispatcher({
      getDevice: () => this.context.getDevice(),
      isRecovering: () => this.isRecoveringFromDeviceLoss || this.context.recovering,
      getResources: () => this.res,
      getPreviewContext: () => this.previewContext,
      getTargetCanvases: () => this.targetCanvases,
      getCacheManager: () => this.cacheManager,
      getExportCanvasManager: () => this.exportCanvasManager,
      getPerformanceStats: () => this.performanceStats,
      getRenderLoop: () => this.renderLoop,
      registerTargetCanvas: (targetId, canvas) => this.registerTargetCanvas(targetId, canvas),
      unregisterTargetCanvas: (targetId) => this.unregisterTargetCanvas(targetId),
      getTargetContext: (targetId) => this.getTargetContext(targetId),
    });
  }

  // === DEVICE RECOVERY ===

  private handleDeviceLost(): void {
    this.renderLoop?.stop();
    this.renderDispatcher?.clearExportReadinessCache();
    this.pixelReadback.destroy();

    // Clear GPU resources
    this.res?.renderTargetManager.clearAll();
    this.previewContext = null;
    this.targetCanvases.clear();
    this.cacheManager.handleDeviceLost();

    // Clear managers
    engineResources.releaseEngineResourcesOnDeviceLost(this.res);

    log.debug('Resources cleaned after device loss');
  }

  private async handleDeviceRestored(): Promise<void> {
    await this.createResources();
    this.reconfigureCanvasesAfterRestore();
    this.renderLoop?.start();
    this.requestRender();
    log.info('Recovery complete');
  }

  /** Reconfigure main preview + all target canvases after device restore/reinit */
  private reconfigureCanvasesAfterRestore(): void {
    if (this.mainPreviewCanvas) {
      this.previewContext = this.context.configureCanvas(this.mainPreviewCanvas);
    }
    for (const [id, entry] of this.targetCanvases) {
      const ctx = this.context.configureCanvas(entry.canvas);
      if (ctx) {
        this.targetCanvases.set(id, { canvas: entry.canvas, context: ctx });
        // Also update the store's context reference
        useRenderTargetStore.getState().setTargetCanvas(id, entry.canvas, ctx);
      }
    }
  }

  // === CANVAS MANAGEMENT (Unified) ===

  setPreviewCanvas(canvas: HTMLCanvasElement): void {
    this.mainPreviewCanvas = canvas;
    this.previewContext = this.context.configureCanvas(canvas);
  }

  /**
   * Register a canvas as a render target. Configures WebGPU context and stores in unified map.
   * Returns the GPU context or null on failure.
   */
  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null {
    const ctx = this.context.configureCanvas(canvas);
    if (ctx) {
      this.targetCanvases.set(targetId, { canvas, context: ctx });
      log.debug('Registered target canvas', { targetId });
      return ctx;
    }
    return null;
  }

  /** Remove a canvas from the unified target map */
  unregisterTargetCanvas(targetId: string): void {
    this.targetCanvases.delete(targetId);
    log.debug('Unregistered target canvas', { targetId });
  }

  /** Lookup GPU context for a target */
  getTargetContext(targetId: string): GPUCanvasContext | null {
    return this.targetCanvases.get(targetId)?.context ?? null;
  }

  // === OUTPUT WINDOWS ===

  private readonly outputWindowDeps: outputWindows.OutputWindowControllerDeps = {
    getOutputWindowManager: () => this.res?.outputWindowManager ?? null,
    registerTargetCanvas: (targetId, canvas) => this.registerTargetCanvas(targetId, canvas),
    unregisterTargetCanvas: (targetId) => this.unregisterTargetCanvas(targetId),
  };

  /**
   * Create an output window, register it as a render target, and configure WebGPU.
   * The window will automatically receive frames based on its source (default: activeComp).
   */
  createOutputWindow(id: string, name: string): { id: string; name: string } | null {
    return outputWindows.createOutputWindow(this.outputWindowDeps, id, name);
  }

  closeOutputWindow(id: string): void {
    outputWindows.closeOutputWindow(this.outputWindowDeps, id);
  }

  restoreOutputWindow(id: string): boolean {
    return outputWindows.restoreOutputWindow(this.outputWindowDeps, id);
  }

  removeOutputTarget(id: string): void {
    outputWindows.removeOutputTarget(this.outputWindowDeps, id);
  }

  /**
   * After page refresh, try to reconnect to existing output windows by name.
   * Takes an array of {id, name, source} from saved metadata.
   */
  reconnectOutputWindows(savedTargets: Array<{ id: string; name: string; source: import('../types/renderTarget').RenderSource }>): number {
    return outputWindows.reconnectOutputWindows(this.outputWindowDeps, savedTargets);
  }

  // === MASK MANAGEMENT ===

  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    this.res?.maskTextureManager?.updateMaskTexture(layerId, imageData);
  }

  removeMaskTexture(layerId: string): void {
    this.res?.maskTextureManager?.removeMaskTexture(layerId);
  }

  hasMaskTexture(layerId: string): boolean {
    return this.res?.maskTextureManager?.hasMaskTexture(layerId) ?? false;
  }

  // === VIDEO MANAGEMENT ===

  registerVideo(video: HTMLVideoElement): void {
    this.videoFrameManager.registerVideo(video);
  }

  setActiveVideo(video: HTMLVideoElement | null): void {
    this.videoFrameManager.setActiveVideo(video);
  }

  cleanupVideo(video: HTMLVideoElement): void {
    this.cacheManager.cleanupVideoCache(video);
    this.videoFrameManager.cleanupVideo(video);
    if (video.src) {
      // Release video element resources to free memory
      video.pause();
      video.removeAttribute('src');
      video.load(); // Forces release of media resources
    }
    log.debug('Cleaned up video resources');
  }

  setHasActiveVideo(hasVideo: boolean): void {
    this.renderLoop?.setHasActiveVideo(hasVideo);
  }

  setTimelineVisualDemand(hasDemand: boolean): void {
    this.renderLoop?.setTimelineVisualDemand(hasDemand);
  }

  setVisualTargetFps(targetFps: number): void {
    this.renderLoop?.setVisualTargetFps(targetFps);
  }

  setIsPlaying(playing: boolean): void {
    this._isPlaying = playing;
    if (playing) this.hasEverPlayed = true;
    this.renderLoop?.setIsPlaying(playing);
  }

  setIsScrubbing(scrubbing: boolean): void {
    this.renderLoop?.setIsScrubbing(scrubbing);
  }

  setContinuousRender(enabled: boolean): void {
    this.renderLoop?.setContinuousRender(enabled);
  }

  // Called by RVFC when a new decoded frame is ready - bypasses scrub rate limiter
  requestNewFrameRender(): void {
    this.renderLoop?.requestNewFrameRender();
  }

  // === TEXTURE MANAGEMENT ===

  createImageTexture(image: HTMLImageElement): GPUTexture | null {
    return this.res?.textureManager?.createImageTexture(image) ?? null;
  }

  importVideoTexture(source: HTMLVideoElement | VideoFrame): GPUExternalTexture | null {
    return this.res?.textureManager?.importVideoTexture(source) ?? null;
  }

  // === CACHING (delegated to CacheManager) ===

  clearCaches(): void {
    this.cacheManager.clearAll();
    this.res?.textureManager?.clearCaches();
  }

  clearVideoCache(): void {
    this.cacheManager.clearVideoTimeTracking();
  }

  cacheFrameAtTime(video: HTMLVideoElement, time: number): void {
    this.cacheManager.cacheFrameAtTime(video, time);
  }

  getCachedFrame(videoSrc: string, time: number): GPUTextureView | null {
    return this.cacheManager.getCachedFrame(videoSrc, time);
  }

  getScrubbingCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    return this.cacheManager.getScrubbingCachedRanges(videoSrc);
  }

  getScrubbingCacheStats(): ScrubbingCacheStats {
    return this.cacheManager.getScrubbingCacheStats();
  }

  clearScrubbingCache(videoSrc?: string): void {
    this.cacheManager.clearScrubbingCache(videoSrc);
  }

  // === RAM PREVIEW CACHE ===

  private getResolutionOrDefault(): { width: number; height: number } {
    return this.res?.renderTargetManager.getResolution() ?? { width: 640, height: 360 };
  }

  async cacheCompositeFrame(time: number): Promise<void> {
    await this.cacheManager.cacheCompositeFrame(time, () => this.readPixels(), () => this.getResolutionOrDefault());
  }

  getCachedCompositeFrame(time: number): ImageData | null {
    return this.cacheManager.getCachedCompositeFrame(time);
  }

  hasCompositeCacheFrame(time: number): boolean {
    return this.cacheManager.hasCompositeCacheFrame(time);
  }

  clearCompositeCache(): void {
    this.cacheManager.clearCompositeCache();
  }

  getCompositeCacheStats(): { count: number; maxFrames: number; memoryMB: number } {
    return this.cacheManager.getCompositeCacheStats(() => this.getResolutionOrDefault());
  }

  setGeneratingRamPreview(generating: boolean): void {
    this.exportCanvasManager.setGeneratingRamPreview(generating);
  }

  setExporting(exporting: boolean): void {
    this.exportCanvasManager.setExporting(exporting);
    if (exporting) this.cacheManager.clearVideoTimeTracking();
  }

  getIsExporting(): boolean {
    return this.exportCanvasManager.getIsExporting();
  }

  initExportCanvas(width: number, height: number, stackedAlpha = false): boolean {
    const device = this.context.getDevice();
    if (!device) {
      log.error('Cannot init export canvas: no device');
      return false;
    }
    return this.exportCanvasManager.initExportCanvas(device, width, height, stackedAlpha);
  }

  async createVideoFrameFromExport(timestamp: number, duration: number): Promise<VideoFrame | null> {
    const device = this.context.getDevice();
    if (!device) return null;
    return this.exportCanvasManager.createVideoFrameFromExport(device, timestamp, duration);
  }

  cleanupExportCanvas(): void {
    this.exportCanvasManager.cleanupExportCanvas();
  }

  // === RENDER LOOP ===

  requestRender(): void {
    this.renderLoop?.requestRender();
  }

  getIsIdle(): boolean {
    return this.renderLoop?.getIsIdle() ?? false;
  }

  /**
   * Ensure the scrubbing cache has at least one frame for this video.
   * Called before seeking to provide a fallback frame during seek.
   */
  ensureVideoFrameCached(video: HTMLVideoElement, ownerId?: string): void {
    this.cacheManager.ensureVideoFrameCached(video, ownerId);
  }

  captureVideoFrameAtTime(video: HTMLVideoElement, time: number, ownerId?: string): boolean {
    return this.cacheManager.captureVideoFrameAtTime(video, time, ownerId);
  }

  markVideoFramePresented(video: HTMLVideoElement, time?: number, ownerId?: string): void {
    this.cacheManager.markVideoFramePresented(video, time, ownerId);
  }

  getLastPresentedVideoTime(video: HTMLVideoElement): number | undefined {
    return this.cacheManager.getLastPresentedVideoTime(video);
  }

  getLastPresentedVideoOwner(video: HTMLVideoElement): string | undefined {
    return this.cacheManager.getLastPresentedVideoOwner(video);
  }

  markVideoGpuReady(video: HTMLVideoElement): void {
    this.res?.layerCollector.markVideoGpuReady(video);
  }

  /**
   * Pre-cache a video frame using createImageBitmap (async forced decode).
   * This is the ONLY way to get a real frame from a never-played video after reload.
   * Call from canplaythrough handlers during project restore.
   */
  async preCacheVideoFrame(video: HTMLVideoElement, ownerId?: string): Promise<boolean> {
    const success = await this.cacheManager.preCacheVideoFrame(video, ownerId);
    if (success) {
      this.requestRender();
    }
    return success;
  }

  updatePlayheadTracking(playhead: number): boolean {
    return this.renderLoop?.updatePlayheadTracking(playhead) ?? false;
  }

  start(renderCallback: () => void): void {
    if (!this.performanceStats) return;

    this.renderLoop = engineResources.startEngineRenderLoop({
      currentLoop: this.renderLoop,
      hooks: this.getRenderLoopHooks(),
      hasEverPlayed: this.hasEverPlayed,
      isPlaying: this._isPlaying,
      requestRender: () => this.requestRender(),
    }, renderCallback);
  }

  stop(): void {
    this.renderLoop?.stop();
  }

  // === MAIN RENDER (delegated to RenderDispatcher) ===

  render(layers: Layer[]): void {
    this.renderDispatcher?.render(layers);
  }

  setRenderTimeOverride(time: number | null): void {
    this.renderDispatcher?.setRenderTimeOverride(time);
  }

  async ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    return this.renderDispatcher?.ensureGaussianSplatSceneLoaded(options) ?? false;
  }

  async ensureSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    return this.renderDispatcher?.ensureSceneRendererInitialized(width, height) ?? false;
  }

  async preloadSceneModelAsset(url: string, fileName: string, modelSequence?: ModelSequenceData): Promise<boolean> {
    return this.renderDispatcher?.preloadSceneModelAsset(url, fileName, modelSequence) ?? false;
  }

  async ensureExportLayersReady(layers: Layer[]): Promise<void> {
    await this.renderDispatcher?.ensureExportLayersReady(layers);
  }

  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    this.renderDispatcher?.renderToPreviewCanvas(canvasId, layers);
  }

  renderCachedFrame(time: number): boolean {
    return this.renderDispatcher?.renderCachedFrame(time) ?? false;
  }

  getGaussianSplatSceneBounds(clipId: string): { min: [number, number, number]; max: [number, number, number] } | undefined {
    return this.renderDispatcher?.getGaussianSplatSceneBounds(clipId);
  }

  // === NESTED COMPOSITION HELPERS (delegated to outputPresenter) ===

  private readonly presenterDeps: outputPresenter.OutputPresenterDeps = {
    getDevice: () => this.context.getDevice(),
    getResources: () => this.res,
    getPreviewContext: () => this.previewContext,
    getTargetContext: (targetId) => this.getTargetContext(targetId),
    getRenderDispatcher: () => this.renderDispatcher,
  };

  hasNestedCompTexture(compositionId: string): boolean {
    return this.res?.nestedCompRenderer.hasTexture(compositionId) ?? false;
  }

  cacheActiveCompOutput(compositionId: string): void {
    outputPresenter.cacheActiveCompOutput(this.presenterDeps, compositionId);
  }

  copyMainOutputToPreview(canvasId: string): boolean {
    return outputPresenter.copyMainOutputToPreview(this.presenterDeps, canvasId);
  }

  copyNestedCompTextureToPreview(canvasId: string, compositionId: string): boolean {
    return outputPresenter.copyNestedCompTextureToPreview(this.presenterDeps, canvasId, compositionId);
  }

  cleanupNestedCompTexture(compositionId: string): void {
    this.res?.nestedCompRenderer.cleanupTexture(compositionId);
  }

  /**
   * Render sliced output to a specific canvas using the main composited output.
   * Used by TargetPreview to preview sliced output for a target.
   */
  renderSlicedToCanvas(canvasId: string, slices: import('../types/outputSlice').OutputSlice[]): boolean {
    return outputPresenter.renderSlicedToCanvas(this.presenterDeps, canvasId, slices);
  }

  // === RESOLUTION ===

  setResolution(width: number, height: number): void {
    if (this.res?.renderTargetManager.setResolution(width, height)) {
      this.cacheManager.clearCompositeCache();
      this.cacheManager.clearScrubbingCache();
      this.res.outputWindowManager.updateResolution(width, height);
      this.res.outputPipeline?.invalidateCache();
      this.res.compositorPipeline?.invalidateBindGroupCache();
      log.debug('Caches cleared for resolution change', { width, height });
    }
  }

  clearFrame(): void {
    outputPresenter.clearFrame(this.presenterDeps);
  }

  getOutputDimensions(): { width: number; height: number } {
    return this.getResolutionOrDefault();
  }

  // === STATS ===

  getStats(): EngineStats {
    const stats = this.performanceStats.getStats(this.getIsIdle());
    const renderDispatcher = this.getRenderDispatcherDebugSnapshot();
    return renderDispatcher ? { ...stats, renderDispatcher } : stats;
  }

  // === ACCESSORS ===

  getDevice(): GPUDevice | null {
    return this.context.getDevice();
  }

  getLastRenderedTexture(): GPUTexture | null {
    return outputPresenter.getLastRenderedTexture(this.presenterDeps);
  }

  getLayerCollector(): LayerCollector | null {
    return this.res?.layerCollector ?? null;
  }

  getRenderLoop(): RenderLoop | null {
    return this.renderLoop;
  }

  getRenderDispatcherDebugSnapshot(): RenderDispatcherDebugSnapshot | null {
    return this.renderDispatcher?.lastRenderDebugSnapshot ?? null;
  }

  getDebugInfrastructureState(): DebugInfrastructureState {
    return buildDebugInfrastructureState({
      context: this.context,
      renderDispatcher: this.renderDispatcher,
      previewContext: this.previewContext,
      targetCanvases: this.targetCanvases,
      resources: this.res,
    });
  }

  getTextureManager(): TextureManager | null {
    return this.res?.textureManager ?? null;
  }

  isDeviceValid(): boolean {
    return this.context.initialized && this.context.getDevice() !== null;
  }

  getGPUInfo(): { vendor: string; device: string; description: string } | null {
    return this.context.getGPUInfo();
  }

  getPowerPreference(): GPUPowerPreference {
    return this.context.getPowerPreference();
  }

  async reinitializeWithPreference(preference: GPUPowerPreference): Promise<boolean> {
    log.info('Reinitializing with preference', { preference });
    this.stop();
    this.handleDeviceLost();
    const success = await this.context.reinitializeWithPreference(preference);
    if (!success) {
      log.error('Failed to reinitialize with new preference');
      return false;
    }
    await this.createResources();
    this.reconfigureCanvasesAfterRestore();
    this.requestRender();
    log.info('Reinitialize complete');
    return true;
  }

  // === PIXEL READBACK ===

  async readPixels(): Promise<Uint8ClampedArray | null> {
    const device = this.context.getDevice();
    if (!device || !this.res) return null;
    return this.pixelReadback.readPixels(device, this.res.renderTargetManager, this.res.compositor);
  }

  // === CLEANUP ===

  destroy(): void {
    this.stop();
    engineResources.destroyEngineRenderers(this.res);
    this.cacheManager.destroy();
    this.exportCanvasManager.destroy();
    this.videoFrameManager.destroy();
    engineResources.destroyEnginePipelines(this.res);
    this.pixelReadback.destroy();
    this.context.destroy();
  }
}

// === HMR SINGLETON ===

let engineInstance: WebGPUEngine;

const hot = typeof import.meta !== 'undefined'
  ? (import.meta as { hot?: { data: Record<string, unknown> } }).hot
  : undefined;

const hmrLog = Logger.create('WebGPU-HMR');

if (hot) {
  const existing = hot.data.engine as WebGPUEngine | undefined;
  if (existing) {
    hmrLog.debug('Reusing engine from HMR');
    existing.clearVideoCache();
    engineInstance = existing;
  } else {
    hmrLog.debug('Creating new engine');
    engineInstance = new WebGPUEngine();
    hot.data.engine = engineInstance;
  }
} else {
  engineInstance = new WebGPUEngine();
}

export const engine = engineInstance;
