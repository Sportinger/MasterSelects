import { engine } from '../../engine/WebGPUEngine';
import { useEngineStore } from '../../stores/engineStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import type { EngineStats, Layer } from '../../types';
import type { WorkerFirstCacheRuntimeSnapshot } from '../../engine/texture/ScrubbingCache';
import { framePhaseMonitor } from '../framePhaseMonitor';
import { playheadState } from '../layerBuilder/PlayheadState';
import { Logger } from '../logger';
import type { RamPreviewRenderEngine } from '../ramPreviewEngine';
import type { RenderHostSelectionTelemetry } from './renderHostSelection';
import type {
  RenderCaptureCanvas,
  RenderFrameCallback,
  RenderHostLayerCollector,
  RenderHostPort,
  RenderHostRenderLoop,
  RenderHostTelemetry,
} from './renderHostTypes';

const log = Logger.create('MainFallbackRenderHostPort');

function hasCaptureBackingStore(canvas: HTMLCanvasElement): boolean {
  return canvas.width > 0 && canvas.height > 0;
}

function canvasIntersectsViewport(rect: DOMRect, win: Window): boolean {
  const width = win.innerWidth || rect.right;
  const height = win.innerHeight || rect.bottom;
  return rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < width
    && rect.top < height;
}

function canvasCenterIsVisible(canvas: HTMLCanvasElement, rect: DOMRect, doc: Document): boolean {
  const win = doc.defaultView;
  if (!win || typeof doc.elementFromPoint !== 'function') return false;
  const width = win.innerWidth || rect.right;
  const height = win.innerHeight || rect.bottom;
  const x = Math.max(0, Math.min(width - 1, rect.left + rect.width / 2));
  const y = Math.max(0, Math.min(height - 1, rect.top + rect.height / 2));
  const element = doc.elementFromPoint(x, y);
  return element === canvas || Boolean(element && canvas.contains(element));
}

function captureCanvasScore(canvas: HTMLCanvasElement, source: string): number {
  if (!hasCaptureBackingStore(canvas)) return -1;

  let score = 10;
  if (source === 'mainPreviewCanvas') score += 5;
  if (source === 'renderTarget:preview') score += 4;
  if (source.startsWith('renderTarget:')) score += 2;

  const doc = canvas.ownerDocument;
  if (!canvas.isConnected || !doc || doc.visibilityState === 'hidden') return score;

  score += 10;
  const win = doc.defaultView;
  if (!win) return score;

  const rect = canvas.getBoundingClientRect();
  if (canvasIntersectsViewport(rect, win)) score += 20;
  if (canvasCenterIsVisible(canvas, rect, doc)) score += 20;
  return score;
}

function selectBestCaptureCanvas(candidates: RenderCaptureCanvas[]): RenderCaptureCanvas | null {
  let best: { candidate: RenderCaptureCanvas; score: number } | null = null;
  for (const candidate of candidates) {
    const score = captureCanvasScore(candidate.canvas, candidate.source);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }
  return best?.candidate ?? null;
}

type PlaybackDebugStatsReader = (
  decoder: EngineStats['decoder']
) => NonNullable<EngineStats['playback']>;

let playbackDebugStatsReader: PlaybackDebugStatsReader | null = null;
let playbackDebugStatsReaderLoad: Promise<void> | null = null;

function loadPlaybackDebugStatsReader(): void {
  if (playbackDebugStatsReader || playbackDebugStatsReaderLoad) {
    return;
  }

  playbackDebugStatsReaderLoad = import('../playbackDebugSnapshot')
    .then((module) => {
      playbackDebugStatsReader = module.getPlaybackDebugStats as PlaybackDebugStatsReader;
    })
    .catch((error) => {
      playbackDebugStatsReaderLoad = null;
      log.warn('Failed to load playback debug stats reader', error);
    });
}

function readPlaybackDebugStats(decoder: EngineStats['decoder']): EngineStats['playback'] | undefined {
  if (playbackDebugStatsReader) {
    return playbackDebugStatsReader(decoder);
  }
  loadPlaybackDebugStatsReader();
  return undefined;
}

export class MainFallbackRenderHostPort implements RenderHostPort {
  private statsAndWatchdogInterval: ReturnType<typeof setInterval> | null = null;
  private renderFrameCallbacks: RenderFrameCallback[] = [];
  private initializePromise: Promise<boolean> | null = null;
  private readonly getSelectionTelemetry: () => RenderHostSelectionTelemetry;
  private readonly ramPreviewRenderEngine: RamPreviewRenderEngine = {
    render: (layers) => this.render(layers),
    cacheCompositeFrame: (time) => this.cacheCompositeFrame(time),
  };

  constructor(getSelectionTelemetry: () => RenderHostSelectionTelemetry) {
    this.getSelectionTelemetry = getSelectionTelemetry;
  }

  getTelemetry(): RenderHostTelemetry {
    return {
      mode: 'main',
      presentationStrategy: 'main-host-fallback',
      lifecycleOwner: 'renderHostPort',
      statsOwner: 'renderHostPort',
      watchdogOwner: 'renderHostPort',
      selection: this.getSelectionTelemetry(),
    };
  }

  initialize(): Promise<boolean> {
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromise = this.initializeEngine();
    return this.initializePromise;
  }

  startRenderLoop(renderFrame: RenderFrameCallback): void {
    engine.start(renderFrame);
    void import('../playbackHealthMonitor')
      .then(({ playbackHealthMonitor }) => {
        playbackHealthMonitor.start();
      })
      .catch((error) => {
        log.warn('Failed to start playback health monitor', error);
      });
  }

  startStatsAndWatchdog(renderFrame: RenderFrameCallback): () => void {
    this.renderFrameCallbacks.push(renderFrame);
    if (this.statsAndWatchdogInterval !== null) {
      return () => {
        this.stopStatsAndWatchdog(renderFrame);
      };
    }

    this.statsAndWatchdogInterval = setInterval(() => {
      try {
        const renderLoop = engine.getRenderLoop();
        if (playheadState.isUsingInternalPosition && renderLoop?.getIsRunning?.() !== true) {
          const currentRenderFrame = this.renderFrameCallbacks[this.renderFrameCallbacks.length - 1];
          if (!currentRenderFrame) {
            return;
          }
          log.warn('Render loop was stopped during playback; restarting');
          engine.start(currentRenderFrame);
          engine.setIsPlaying(true);
          engine.requestRender();
        }
        const stats = engine.getStats();
        const statsUpdate: EngineStats = { ...stats };
        try {
          const playbackStats = readPlaybackDebugStats(stats.decoder);
          if (playbackStats) {
            statsUpdate.playback = playbackStats;
          }
        } catch (_e) {
          // Keep base engine stats flowing even if optional debug collectors fail.
        }
        try {
          statsUpdate.mainThread = framePhaseMonitor.summary();
        } catch (_e) {
          // Keep base engine stats flowing even if optional debug collectors fail.
        }
        useEngineStore.getState().setEngineStats(statsUpdate);
      } catch (_e) {
        // Stats and watchdog failures must not interrupt playback rendering.
      }
    }, 1000);

    return () => {
      this.stopStatsAndWatchdog(renderFrame);
    };
  }

  stopRenderLoopForDiagnostics(): void {
    engine.stop();
  }

  startExistingRenderLoopForDiagnostics(): void {
    engine.getRenderLoop()?.start();
  }

  private stopStatsAndWatchdog(renderFrame: RenderFrameCallback): void {
    const index = this.renderFrameCallbacks.lastIndexOf(renderFrame);
    if (index !== -1) {
      this.renderFrameCallbacks.splice(index, 1);
    }

    if (this.renderFrameCallbacks.length === 0 && this.statsAndWatchdogInterval !== null) {
      clearInterval(this.statsAndWatchdogInterval);
      this.statsAndWatchdogInterval = null;
    }
  }

  private async initializeEngine(): Promise<boolean> {
    const success = await engine.initialize();
    const engineStore = useEngineStore.getState();
    engineStore.setEngineReady(success);
    if (success) {
      engineStore.setGpuInfo(engine.getGPUInfo());
      const isLinux = navigator.platform.toLowerCase().includes('linux');
      if (isLinux) {
        engineStore.setLinuxVulkanWarning(true);
      }
      return true;
    }

    const hasGPU = typeof navigator.gpu !== 'undefined';
    const error = !hasGPU
      ? 'WebGPU is not available in this browser. Please use Chrome 113+ or Edge 113+.'
      : 'No compatible GPU adapter found. Your GPU may not support WebGPU. '
        + 'Try enabling hardware acceleration in browser settings, '
        + 'or switch to a GPU with Vulkan/D3D12 support.';
    engineStore.setEngineInitFailed(true, error);
    log.error('Engine initialization failed', { hasGPU, error });
    return false;
  }

  setTimelineVisualDemand(hasDemand: boolean): void {
    engine.setTimelineVisualDemand(hasDemand);
  }

  setVisualTargetFps(targetFps: number): void {
    engine.setVisualTargetFps(targetFps);
  }

  setIsPlaying(isPlaying: boolean): void {
    engine.setIsPlaying(isPlaying);
  }

  setPlaybackSpeed(_playbackSpeed: number): void {
    // Main-thread engine paths already read playback speed through timeline state.
  }

  setIsScrubbing(isScrubbing: boolean): void {
    engine.setIsScrubbing(isScrubbing);
  }

  setContinuousRender(enabled: boolean): void {
    engine.setContinuousRender(enabled);
  }

  getRamPreviewRenderEngine(): RamPreviewRenderEngine {
    return this.ramPreviewRenderEngine;
  }

  render(layers: Layer[]): void {
    engine.render(layers);
  }

  renderCachedFrame(time: number): boolean {
    return engine.renderCachedFrame(time);
  }

  cacheCompositeFrame(time: number): Promise<void> {
    return engine.cacheCompositeFrame(time);
  }

  cacheActiveCompOutput(compositionId: string): void {
    engine.cacheActiveCompOutput(compositionId);
  }

  getIsExporting(): boolean {
    return engine.getIsExporting();
  }

  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    engine.renderToPreviewCanvas(canvasId, layers);
  }

  copyNestedCompTextureToPreview(canvasId: string, compositionId: string): boolean {
    return engine.copyNestedCompTextureToPreview(canvasId, compositionId);
  }

  setResolution(width: number, height: number): void {
    engine.setResolution(width, height);
  }

  getOutputDimensions(): { width: number; height: number } {
    return engine.getOutputDimensions();
  }

  readPixels(): Promise<Uint8ClampedArray | null> {
    return engine.readPixels();
  }

  getCaptureCanvas(): RenderCaptureCanvas | null {
    const engineState = engine as unknown as {
      mainPreviewCanvas?: HTMLCanvasElement | null;
      targetCanvases?: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
    };

    const candidates: RenderCaptureCanvas[] = [];

    const mainPreviewCanvas = engineState.mainPreviewCanvas;
    if (mainPreviewCanvas) {
      candidates.push({ canvas: mainPreviewCanvas, source: 'mainPreviewCanvas' });
    }
    const activeTargets = useRenderTargetStore.getState().getActiveCompTargets();
    for (const target of activeTargets) {
      if (target.canvas) {
        candidates.push({ canvas: target.canvas, source: `renderTarget:${target.id}` });
      }
    }

    const targetCanvases = engineState.targetCanvases;
    if (targetCanvases) {
      for (const [targetId, entry] of targetCanvases) {
        candidates.push({ canvas: entry.canvas, source: `engineTarget:${targetId}` });
      }
    }

    return selectBestCaptureCanvas(candidates);
  }

  getDevice(): GPUDevice | null {
    return engine.getDevice();
  }

  getLastRenderedTexture(): GPUTexture | null {
    return engine.getLastRenderedTexture();
  }

  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    engine.updateMaskTexture(layerId, imageData);
  }

  removeMaskTexture(layerId: string): void {
    engine.removeMaskTexture(layerId);
  }

  updateCanvasTexture(canvas: HTMLCanvasElement): boolean {
    return engine.getTextureManager()?.updateCanvasTexture(canvas) ?? false;
  }

  invalidateCompositorBindings(layerId?: string): void {
    const pipeline = (engine as unknown as {
      compositorPipeline?: { invalidateBindGroupCache: (layerId?: string) => void };
    }).compositorPipeline;
    pipeline?.invalidateBindGroupCache(layerId);
  }

  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null {
    return engine.registerTargetCanvas(targetId, canvas);
  }

  unregisterTargetCanvas(targetId: string): void {
    engine.unregisterTargetCanvas(targetId);
  }

  setPreviewCanvas(canvas: HTMLCanvasElement): void {
    engine.setPreviewCanvas(canvas);
  }

  requestRender(): void {
    engine.requestRender();
  }

  requestNewFrameRender(): void {
    engine.requestNewFrameRender();
  }

  clearVideoCache(): void {
    engine.clearVideoCache();
  }

  clearScrubbingCache(videoSrc?: string): void {
    engine.clearScrubbingCache(videoSrc);
  }

  clearCompositeCache(): void {
    engine.clearCompositeCache();
  }

  clearCaches(): void {
    engine.clearCaches();
  }

  clearFrame(): void {
    engine.clearFrame();
  }

  setGeneratingRamPreview(generating: boolean): void {
    engine.setGeneratingRamPreview(generating);
  }

  getScrubbingCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    return engine.getScrubbingCachedRanges(videoSrc);
  }

  getStats(): EngineStats {
    return engine.getStats();
  }

  getLayerCollector(): RenderHostLayerCollector | null {
    return engine.getLayerCollector();
  }

  getScrubbingCacheStats(): ReturnType<typeof engine.getScrubbingCacheStats> {
    return engine.getScrubbingCacheStats();
  }

  getCompositeCacheStats(): ReturnType<typeof engine.getCompositeCacheStats> {
    return engine.getCompositeCacheStats();
  }

  getWorkerFirstCacheRuntimeSnapshot(): WorkerFirstCacheRuntimeSnapshot {
    const engineWithCacheManager = engine as unknown as {
      cacheManager?: {
        getWorkerFirstCacheRuntimeSnapshot?: () => WorkerFirstCacheRuntimeSnapshot;
      };
    };
    return engineWithCacheManager.cacheManager?.getWorkerFirstCacheRuntimeSnapshot?.() ?? {
      generatedAtMs: Date.now(),
      records: [],
    };
  }

  getRenderLoop(): RenderHostRenderLoop | null {
    return engine.getRenderLoop();
  }

  getDebugInfrastructureState(): ReturnType<typeof engine.getDebugInfrastructureState> {
    return engine.getDebugInfrastructureState();
  }

  getRenderDispatcherDebugSnapshot(): ReturnType<typeof engine.getRenderDispatcherDebugSnapshot> {
    return engine.getRenderDispatcherDebugSnapshot();
  }

  cleanupVideo(video: HTMLVideoElement): void {
    engine.cleanupVideo(video);
  }

  preCacheVideoFrame(video: HTMLVideoElement, ownerId?: string): Promise<boolean> {
    return engine.preCacheVideoFrame(video, ownerId);
  }

  ensureVideoFrameCached(video: HTMLVideoElement, ownerId?: string): void {
    engine.ensureVideoFrameCached(video, ownerId);
  }

  cacheFrameAtTime(video: HTMLVideoElement, time: number, _ownerId?: string): void {
    engine.cacheFrameAtTime(video, time);
  }

  captureVideoFrameAtTime(video: HTMLVideoElement, time: number, ownerId?: string): boolean {
    return engine.captureVideoFrameAtTime(video, time, ownerId);
  }

  markVideoFramePresented(video: HTMLVideoElement, time?: number, ownerId?: string): void {
    engine.markVideoFramePresented(video, time, ownerId);
  }

  getLastPresentedVideoTime(video: HTMLVideoElement): number | undefined {
    return engine.getLastPresentedVideoTime(video);
  }

  markVideoGpuReady(video: HTMLVideoElement): void {
    engine.markVideoGpuReady(video);
  }

  createOutputWindow(id: string, name: string): { id: string; name: string } | null {
    return engine.createOutputWindow(id, name);
  }

  closeOutputWindow(id: string): void {
    engine.closeOutputWindow(id);
  }

  restoreOutputWindow(id: string): boolean {
    return engine.restoreOutputWindow(id);
  }

  removeOutputTarget(id: string): void {
    engine.removeOutputTarget(id);
  }
}
