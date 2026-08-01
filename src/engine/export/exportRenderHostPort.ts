import type { ModelSequenceData } from '../../types/mediaSequences';
import type { Layer } from '../core/types';
import type { RenderCommandTarget } from '../render/contracts/workerRenderGraph';
import type { GaussianSplatSceneLoadRequest } from '../render/dispatcher/gaussianSequenceFacet';
import type { RenderSurfaceFrameContext } from '../../services/render/renderHostTypes';
import { engine } from '../WebGPUEngine';
import {
  createBrowserWorkerRenderHostRuntimeBridge,
  isBrowserWorkerRenderHostRuntimeSupported,
  type WorkerRenderHostRuntimeBridge,
} from '../../services/render/workerRenderHostRuntimeBridge';
import {
  buildWorkerSoftwarePreviewFrame,
  closeWorkerSoftwarePreviewFrame,
  hasOnlyTransientWorkerSoftwareSkips,
  hasWorkerSoftwareBlockingSkips,
  type WorkerSoftwarePreviewFrameDiagnostics,
  type WorkerSoftwarePreviewSkipReason,
} from '../../services/render/workerSoftwarePreviewFrame';
import {
  buildWorkerGpuFrameStackProjectionRequest,
  type WorkerGpuFrameStackResolvedVideoSource,
} from '../../services/render/workerGpuFrameStackHostProjection';
import { projectWorkerGpuFrameStack } from '../../services/render/workerGpuFrameStackProjector';
import type { WorkerGpuFrameStackIdentity } from '../../services/render/workerGpuFrameStackContract';
import type { WorkerGpuPresentFrameStackCommand } from '../../services/render/workerGpuRuntimeCommands';

export interface ExportRenderHostPort {
  getTelemetry(): ExportRenderHostTelemetry;
  ensureReady(): Promise<boolean>;
  getOutputDimensions(): { width: number; height: number };
  setResolution(width: number, height: number): void;
  setExporting(exporting: boolean): void;
  initExportCanvas(width: number, height: number, stackedAlpha: boolean): boolean;
  isDeviceValid(): boolean;
  setRenderTimeOverride(time: number | null): void;
  ensureExportLayersReady(layers: Layer[]): Promise<void>;
  render(layers: Layer[], frameContext: RenderSurfaceFrameContext): void;
  createVideoFrameFromExport(timestamp: number, duration: number): Promise<VideoFrame | null>;
  readPixels(): Promise<Uint8ClampedArray | null>;
  cleanupExportCanvas(): void;
  requestPreviewRender(): void;
  hasMaskTexture(layerId: string): boolean;
  updateMaskTexture(layerId: string, imageData: ImageData | null): void;
  removeMaskTexture(layerId: string): void;
  ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean>;
  ensureSceneRendererInitialized(width: number, height: number): Promise<boolean>;
  preloadSceneModelAsset(
    url: string,
    fileName: string,
    modelSequence?: ModelSequenceData,
  ): Promise<boolean>;
}

export interface ExportRenderHostTelemetry {
  readonly mode: 'main' | 'worker-software';
  readonly presentationStrategy: 'main-host-fallback' | 'worker-software-readback';
  readonly lifecycleOwner: 'exportRenderHostPort';
  readonly fallbackMode?: 'main-host-fallback';
  readonly strictWorkerOnly?: boolean;
  readonly worker?: {
    readonly enabled: boolean;
    readonly ready: boolean;
    readonly targetReady: boolean;
    readonly renderedFrameCount: number;
    readonly fallbackFrameCount: number;
    readonly strictBlockedFrameCount: number;
    readonly readbackFrameCount: number;
    readonly transientRetryCount: number;
    readonly lastDiagnostics: WorkerSoftwarePreviewFrameDiagnostics | null;
  };
}

const WORKER_EXPORT_TRANSIENT_RETRY_LIMIT = 3;
const WORKER_EXPORT_TRANSIENT_RETRY_DELAY_MS = 50;

class MainExportRenderHostPort implements ExportRenderHostPort {
  getTelemetry(): ExportRenderHostTelemetry {
    return {
      mode: 'main',
      presentationStrategy: 'main-host-fallback',
      lifecycleOwner: 'exportRenderHostPort',
    };
  }

  async ensureReady(): Promise<boolean> {
    return engine.isDeviceValid() || engine.initialize();
  }

  getOutputDimensions(): { width: number; height: number } {
    return engine.getOutputDimensions();
  }

  setResolution(width: number, height: number): void {
    engine.setResolution(width, height);
  }

  setExporting(exporting: boolean): void {
    engine.setExporting(exporting);
  }

  initExportCanvas(width: number, height: number, stackedAlpha: boolean): boolean {
    return engine.initExportCanvas(width, height, stackedAlpha);
  }

  isDeviceValid(): boolean {
    return engine.isDeviceValid();
  }

  setRenderTimeOverride(time: number | null): void {
    engine.setRenderTimeOverride(time);
  }

  ensureExportLayersReady(layers: Layer[]): Promise<void> {
    return engine.ensureExportLayersReady(layers);
  }

  render(
    layers: Layer[],
    frameContext: RenderSurfaceFrameContext = {
      compositionId: 'export',
      timelineTimeSeconds: 0,
    },
  ): void {
    engine.render(layers, frameContext);
  }

  createVideoFrameFromExport(timestamp: number, duration: number): Promise<VideoFrame | null> {
    return engine.createVideoFrameFromExport(timestamp, duration);
  }

  readPixels(): Promise<Uint8ClampedArray | null> {
    return engine.readPixels();
  }

  cleanupExportCanvas(): void {
    engine.cleanupExportCanvas();
  }

  requestPreviewRender(): void {
    engine.requestNewFrameRender();
  }

  hasMaskTexture(layerId: string): boolean {
    return engine.hasMaskTexture(layerId);
  }

  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    engine.updateMaskTexture(layerId, imageData);
  }

  removeMaskTexture(layerId: string): void {
    engine.removeMaskTexture(layerId);
  }

  ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    return engine.ensureGaussianSplatSceneLoaded(options);
  }

  ensureSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    return engine.ensureSceneRendererInitialized(width, height);
  }

  preloadSceneModelAsset(
    url: string,
    fileName: string,
    modelSequence?: ModelSequenceData,
  ): Promise<boolean> {
    return modelSequence
      ? engine.preloadSceneModelAsset(url, fileName, modelSequence)
      : engine.preloadSceneModelAsset(url, fileName);
  }
}

function readRenderHostDevMode(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('masterselects.renderHostMode');
  } catch {
    return null;
  }
}

function canUseWorkerSoftwareExport(): boolean {
  const mode = readRenderHostDevMode();
  // The software worker snapshots every video frame to an ImageBitmap, paints
  // it through Canvas2D, reads the full RGBA surface back, and transfers those
  // pixels to the main thread. That path is useful for explicit worker testing,
  // but it is substantially slower than the normal WebGPU zero-copy exporter
  // at full resolution. Keep it opt-in until the worker owns a GPU/encoder path.
  return (mode === 'worker-software' || mode === 'worker-only')
    && typeof OffscreenCanvas !== 'undefined'
    && isBrowserWorkerRenderHostRuntimeSupported();
}

function isWorkerOnlyStrictMode(): boolean {
  return readRenderHostDevMode() === 'worker-only';
}

function waitForWorkerExportRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, WORKER_EXPORT_TRANSIENT_RETRY_DELAY_MS);
  });
}

function activePixelLayers(layers: readonly Layer[]): readonly Layer[] {
  return layers.filter((layer) => (
    layer.visible
    && layer.opacity > 0
    && layer.source != null
    && layer.source.type !== 'motion-adjustment'
  ));
}

function completedWorkerGpuFrameStackDiagnostics(
  sourceLayerCount: number,
  presentableLayerCount: number,
): WorkerSoftwarePreviewFrameDiagnostics {
  const skippedByReason: Record<WorkerSoftwarePreviewSkipReason, number> = {
    'createImageBitmap-failed': 0,
    'empty-image': 0,
    'empty-text-canvas': 0,
    'empty-video-frame': 0,
    invisible: 0,
    'missing-source': 0,
    'non-rendering-source': 0,
    'runtime-frame-missing': 0,
    'scrub-hold': 0,
    'unsupported-blend-mode': 0,
    'unsupported-color-correction': 0,
    'unsupported-effects': 0,
    'unsupported-mask': 0,
    'unsupported-nested-composition': 0,
    'unsupported-source': 0,
    'unsupported-transition': 0,
    'video-not-ready': 0,
    'video-seeking': 0,
    'video-time-drift': 0,
  };
  return {
    sourceLayerCount,
    presentableLayerCount,
    skippedLayerCount: 0,
    bitmapLayerCount: 0,
    htmlVideoLayerCount: 0,
    webCodecsLayerCount: 0,
    forcedRuntimeFrameLayerCount: 0,
    solidLayerCount: 0,
    skippedByReason,
    maxVideoDriftMs: 0,
  };
}

function requiresWorkerGpuFrameStack(
  layers: readonly Layer[],
  ancestry: ReadonlySet<string> = new Set(),
): boolean {
  const active = activePixelLayers(layers);
  if (active.length > 1) return true;
  if (layers.some((layer) => (
    layer.visible
    && layer.opacity > 0
    && layer.source?.type === 'motion-adjustment'
  ))) return true;
  for (const layer of active) {
    const nested = layer.source?.nestedComposition;
    if (!nested) continue;
    if (ancestry.has(nested.compositionId)) return true;
    const nestedAncestry = new Set(ancestry);
    nestedAncestry.add(nested.compositionId);
    if (requiresWorkerGpuFrameStack(nested.layers, nestedAncestry)) return true;
    return true;
  }
  return false;
}

function positiveFrameDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function resolveExportVideoSource(layer: Layer): WorkerGpuFrameStackResolvedVideoSource | null {
  const source = layer.source;
  if (!source || source.type !== 'video') return null;
  const sourceId = `export-video:${layer.sourceClipId ?? layer.id}`;
  const videoFrame = source.videoFrame;
  if (videoFrame) {
    const width = positiveFrameDimension(videoFrame.displayWidth)
      ?? positiveFrameDimension(videoFrame.codedWidth);
    const height = positiveFrameDimension(videoFrame.displayHeight)
      ?? positiveFrameDimension(videoFrame.codedHeight);
    if (width && height) {
      return { kind: 'bitmap', sourceId, source: videoFrame, width, height };
    }
  }
  const video = source.videoElement;
  const width = positiveFrameDimension(video?.videoWidth);
  const height = positiveFrameDimension(video?.videoHeight);
  if (video && width && height && video.readyState >= 2) {
    return { kind: 'bitmap', sourceId, source: video, width, height };
  }
  return null;
}

class WorkerFirstExportRenderHostPort implements ExportRenderHostPort {
  private readonly main = new MainExportRenderHostPort();
  private bridge: WorkerRenderHostRuntimeBridge | null = null;
  private gpuBridge: WorkerRenderHostRuntimeBridge | null = null;
  private workerReady = false;
  private workerUnavailable = false;
  private targetReady = false;
  private gpuWorkerReady = false;
  private gpuTargetReady = false;
  private gpuTargetWidth = 0;
  private gpuTargetHeight = 0;
  private width = 1;
  private height = 1;
  private currentTime: number | null = null;
  private pendingReadback: Promise<Uint8ClampedArray | null> | null = null;
  private renderedFrameCount = 0;
  private fallbackFrameCount = 0;
  private strictBlockedFrameCount = 0;
  private readbackFrameCount = 0;
  private transientRetryCount = 0;
  private mainFallbackTouched = false;
  private resetMainFallbackAfterRestore = false;
  private suppressNextWorkerTargetResize = false;
  private lastDiagnostics: WorkerSoftwarePreviewFrameDiagnostics | null = null;
  private requestSequence = 0;

  getTelemetry(): ExportRenderHostTelemetry {
    const workerEnabled = canUseWorkerSoftwareExport() && !this.workerUnavailable;
    if (!workerEnabled && !isWorkerOnlyStrictMode()) return this.main.getTelemetry();
    return {
      mode: 'worker-software',
      presentationStrategy: 'worker-software-readback',
      lifecycleOwner: 'exportRenderHostPort',
      fallbackMode: 'main-host-fallback',
      strictWorkerOnly: isWorkerOnlyStrictMode(),
      worker: {
        enabled: workerEnabled,
        ready: this.workerReady,
        targetReady: this.targetReady,
        renderedFrameCount: this.renderedFrameCount,
        fallbackFrameCount: this.fallbackFrameCount,
        strictBlockedFrameCount: this.strictBlockedFrameCount,
        readbackFrameCount: this.readbackFrameCount,
        transientRetryCount: this.transientRetryCount,
        lastDiagnostics: this.lastDiagnostics,
      },
    };
  }

  async ensureReady(): Promise<boolean> {
    if (canUseWorkerSoftwareExport() && !this.workerUnavailable) {
      if (await this.ensureWorkerReady()) {
        return true;
      }
    }
    if (isWorkerOnlyStrictMode()) {
      return false;
    }
    this.mainFallbackTouched = true;
    return this.main.ensureReady();
  }

  getOutputDimensions(): { width: number; height: number } {
    if (this.isWorkerPathActive() && !this.mainFallbackTouched) {
      return { width: this.width, height: this.height };
    }
    if (isWorkerOnlyStrictMode()) {
      return { width: this.width, height: this.height };
    }
    return this.main.getOutputDimensions();
  }

  setResolution(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    if (this.gpuTargetWidth !== this.width || this.gpuTargetHeight !== this.height) {
      this.gpuTargetReady = false;
    }
    if (this.isWorkerPathActive()) {
      if (this.suppressNextWorkerTargetResize) {
        this.suppressNextWorkerTargetResize = false;
      } else {
        this.pendingReadback = this.ensureWorkerTarget();
      }
      if (!this.mainFallbackTouched) return;
    }
    if (isWorkerOnlyStrictMode()) return;
    this.main.setResolution(this.width, this.height);
    if (this.resetMainFallbackAfterRestore) {
      this.resetMainFallbackAfterRestore = false;
      this.mainFallbackTouched = false;
    }
  }

  setExporting(exporting: boolean): void {
    if (this.isWorkerPathActive() && !this.mainFallbackTouched) return;
    if (isWorkerOnlyStrictMode()) return;
    this.main.setExporting(exporting);
  }

  initExportCanvas(width: number, height: number, stackedAlpha: boolean): boolean {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    if (this.gpuTargetWidth !== this.width || this.gpuTargetHeight !== this.height) {
      this.gpuTargetReady = false;
    }
    if (this.isWorkerPathActive()) {
      this.pendingReadback = this.ensureWorkerTarget();
      return false;
    }
    if (isWorkerOnlyStrictMode()) return false;
    this.mainFallbackTouched = true;
    return this.main.initExportCanvas(width, height, stackedAlpha);
  }

  isDeviceValid(): boolean {
    if (isWorkerOnlyStrictMode()) return this.isWorkerPathActive();
    return this.isWorkerPathActive() || this.main.isDeviceValid();
  }

  setRenderTimeOverride(time: number | null): void {
    this.currentTime = time;
    if (this.isWorkerPathActive() && !this.mainFallbackTouched) return;
    if (isWorkerOnlyStrictMode()) return;
    this.main.setRenderTimeOverride(time);
  }

  ensureExportLayersReady(layers: Layer[]): Promise<void> {
    if (isWorkerOnlyStrictMode()) return Promise.resolve();
    return this.isWorkerPathActive() ? Promise.resolve() : this.main.ensureExportLayersReady(layers);
  }

  render(
    layers: Layer[],
    frameContext: RenderSurfaceFrameContext = {
      compositionId: 'export',
      timelineTimeSeconds: this.currentTime ?? 0,
    },
  ): void {
    if (this.isWorkerPathActive()) {
      this.pendingReadback = requiresWorkerGpuFrameStack(layers)
        ? this.renderWorkerGpuFrameStack(layers, frameContext)
        : this.renderWorkerSoftwareFrame(layers, frameContext);
      return;
    }
    if (isWorkerOnlyStrictMode()) {
      this.pendingReadback = Promise.resolve(null);
      return;
    }
    this.pendingReadback = null;
    this.main.render(layers, frameContext);
  }

  createVideoFrameFromExport(timestamp: number, duration: number): Promise<VideoFrame | null> {
    if (isWorkerOnlyStrictMode()) return Promise.resolve(null);
    return this.isWorkerPathActive()
      ? Promise.resolve(null)
      : this.main.createVideoFrameFromExport(timestamp, duration);
  }

  async readPixels(): Promise<Uint8ClampedArray | null> {
    if (this.isWorkerPathActive() && this.pendingReadback) {
      const readback = await this.pendingReadback;
      this.pendingReadback = null;
      return readback;
    }
    this.pendingReadback = null;
    if (isWorkerOnlyStrictMode()) return null;
    return this.main.readPixels();
  }

  cleanupExportCanvas(): void {
    if (!isWorkerOnlyStrictMode() && (!this.isWorkerPathActive() || this.mainFallbackTouched)) {
      this.main.cleanupExportCanvas();
      this.resetMainFallbackAfterRestore = this.workerReady && this.mainFallbackTouched;
    }
    if (this.bridge && this.targetReady) {
      void this.bridge.detachTargetSurface('export');
    }
    if (this.gpuBridge && this.gpuTargetReady) {
      void this.gpuBridge.detachTargetSurface('export');
    }
    this.targetReady = false;
    this.gpuTargetReady = false;
    this.gpuTargetWidth = 0;
    this.gpuTargetHeight = 0;
    this.pendingReadback = null;
    this.suppressNextWorkerTargetResize = this.workerReady;
  }

  requestPreviewRender(): void {
    if (isWorkerOnlyStrictMode()) return;
    this.main.requestPreviewRender();
  }

  hasMaskTexture(layerId: string): boolean {
    if (isWorkerOnlyStrictMode()) return false;
    return this.main.hasMaskTexture(layerId);
  }

  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    if (isWorkerOnlyStrictMode()) return;
    this.main.updateMaskTexture(layerId, imageData);
  }

  removeMaskTexture(layerId: string): void {
    if (isWorkerOnlyStrictMode()) return;
    this.main.removeMaskTexture(layerId);
  }

  ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    if (isWorkerOnlyStrictMode()) return Promise.resolve(false);
    return this.main.ensureGaussianSplatSceneLoaded(options);
  }

  ensureSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    if (isWorkerOnlyStrictMode()) return Promise.resolve(false);
    return this.main.ensureSceneRendererInitialized(width, height);
  }

  preloadSceneModelAsset(
    url: string,
    fileName: string,
    modelSequence?: ModelSequenceData,
  ): Promise<boolean> {
    if (isWorkerOnlyStrictMode()) return Promise.resolve(false);
    return this.main.preloadSceneModelAsset(url, fileName, modelSequence);
  }

  private async ensureWorkerReady(): Promise<boolean> {
    if (this.workerReady) return true;
    if (this.workerUnavailable) return false;
    try {
      this.bridge = createBrowserWorkerRenderHostRuntimeBridge();
      const initialized = await this.bridge.initialize('worker-software-export-host', 'worker-software-readback');
      this.workerReady = initialized.accepted && initialized.initialized;
      return this.workerReady;
    } catch {
      this.workerUnavailable = true;
      this.bridge = null;
      this.workerReady = false;
      return false;
    }
  }

  private async ensureGpuWorkerReady(): Promise<boolean> {
    if (this.gpuWorkerReady) return true;
    try {
      this.gpuBridge = createBrowserWorkerRenderHostRuntimeBridge();
      const initialized = await this.gpuBridge.initialize(
        'worker-gpu-export-host',
        'worker-webgpu-present',
      );
      this.gpuWorkerReady = initialized.accepted && initialized.initialized;
      return this.gpuWorkerReady;
    } catch {
      this.gpuBridge = null;
      this.gpuWorkerReady = false;
      return false;
    }
  }

  private isWorkerPathActive(): boolean {
    return this.workerReady && canUseWorkerSoftwareExport() && !this.workerUnavailable;
  }

  private createExportTarget(
    presentation: RenderCommandTarget['presentation'] = 'software',
  ): RenderCommandTarget {
    return {
      id: 'export',
      compositionId: 'export',
      size: { x: this.width, y: this.height },
      devicePixelRatio: 1,
      showTransparencyGrid: false,
      presentation,
    };
  }

  private async ensureWorkerTarget(): Promise<Uint8ClampedArray | null> {
    if (!this.bridge || !this.workerReady) return null;
    const canvas = new OffscreenCanvas(this.width, this.height);
    const target = this.createExportTarget();
    const registered = await this.bridge.registerTarget(target);
    if (!registered.accepted) return null;
    const attached = await this.bridge.attachTargetSurface({
      targetId: target.id,
      canvas,
      presentation: 'software',
    });
    this.targetReady = attached.accepted;
    return null;
  }

  private async ensureGpuWorkerTarget(): Promise<boolean> {
    if (
      this.gpuTargetReady
      && this.gpuTargetWidth === this.width
      && this.gpuTargetHeight === this.height
    ) return true;
    if (!(await this.ensureGpuWorkerReady()) || !this.gpuBridge) return false;
    const target = this.createExportTarget('offscreen-canvas');
    const registered = await this.gpuBridge.registerTarget(target);
    if (!registered.accepted) return false;
    const canvas = new OffscreenCanvas(this.width, this.height);
    const attached = await this.gpuBridge.attachTargetSurface({
      targetId: target.id,
      canvas,
      presentation: 'offscreen-canvas',
    });
    this.gpuTargetReady = attached.accepted;
    if (this.gpuTargetReady) {
      this.gpuTargetWidth = this.width;
      this.gpuTargetHeight = this.height;
    }
    return this.gpuTargetReady;
  }

  private async renderWorkerGpuFrameStack(
    layers: Layer[],
    frameContext: RenderSurfaceFrameContext,
  ): Promise<Uint8ClampedArray | null> {
    if (!(await this.ensureGpuWorkerTarget()) || !this.gpuBridge) {
      if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
      return this.renderMainFallbackFrame(layers, frameContext);
    }
    const sequence = this.requestSequence++;
    const requestId = `worker-export-frame-stack:${sequence}`;
    const readbackId = `${requestId}:readback`;
    const nowMs = Date.now();
    const frame: WorkerGpuFrameStackIdentity = {
      requestId,
      targetId: 'export',
      compositionId: frameContext.compositionId,
      timelineTime: frameContext.timelineTimeSeconds,
      frameIndex: sequence,
      intent: 'export',
      submitByMs: nowMs + 30_000,
      expireAfterMs: nowMs + 60_000,
      graphVersion: 0,
      exact: true,
    };
    try {
      const request = buildWorkerGpuFrameStackProjectionRequest({
        layers,
        width: this.width,
        height: this.height,
        frame,
        occurrenceNamespace: `export:${frameContext.compositionId}`,
        intent: 'export',
        surface: 'export',
        nowMs,
        resolveVideoSource: resolveExportVideoSource,
      });
      const stack = await projectWorkerGpuFrameStack(request);
      const command: WorkerGpuPresentFrameStackCommand = {
        type: 'gpu.presentFrameStack',
        commandId: requestId,
        admission: {
          nowMs: Date.now(),
          requestId,
          targetId: 'export',
          intent: 'export',
          graphVersion: frame.graphVersion,
        },
        stack,
        readback: {
          readbackId,
          targetId: frame.targetId,
          compositionId: frame.compositionId,
          timelineTime: frame.timelineTime,
          frameIndex: frame.frameIndex,
          width: this.width,
          height: this.height,
          format: 'rgba8unorm',
          colorSpace: 'srgb',
        },
      };
      const output = await this.gpuBridge.presentGpuFrameStack(command);
      const readback = output.readback;
      const identity = readback?.identity;
      if (
        !output.accepted
        || !output.presentedFrameId
        || !readback
        || !identity
        || readback.width !== this.width
        || readback.height !== this.height
        || identity.readbackId !== readbackId
        || identity.targetId !== frame.targetId
        || identity.compositionId !== frame.compositionId
        || identity.timelineTime !== frame.timelineTime
        || identity.frameIndex !== frame.frameIndex
      ) {
        throw new Error('Worker GPU export returned no identity-matched exact readback');
      }
      this.lastDiagnostics = completedWorkerGpuFrameStackDiagnostics(layers.length, stack.bindings.length);
      this.renderedFrameCount += 1;
      this.readbackFrameCount += 1;
      return readback.pixels;
    } catch {
      if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
      return this.renderMainFallbackFrame(layers, frameContext);
    }
  }

  private async renderWorkerSoftwareFrame(
    layers: Layer[],
    frameContext: RenderSurfaceFrameContext,
  ): Promise<Uint8ClampedArray | null> {
    await this.ensureWorkerTarget();
    if (!this.bridge || !this.targetReady) {
      if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
      return this.renderMainFallbackFrame(layers, frameContext);
    }

    const packet = await this.buildWorkerSoftwareFrameWithTransientRetries(layers);
    if (hasWorkerSoftwareBlockingSkips(packet.diagnostics)) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
      return this.renderMainFallbackFrame(layers, frameContext);
    }

    const output = await this.bridge.presentSoftwareFrame(
      `worker-export:${this.requestSequence++}`,
      'export',
      this.currentTime ?? 0,
      packet.frame,
      packet.transfer,
      { readback: true },
    );
    this.renderedFrameCount += 1;
    if (output.readback?.pixels) {
      this.readbackFrameCount += 1;
      return output.readback.pixels;
    }
    if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
    return this.renderMainFallbackFrame(layers, frameContext);
  }

  private async buildWorkerSoftwareFrameWithTransientRetries(
    layers: Layer[],
  ): Promise<Awaited<ReturnType<typeof buildWorkerSoftwarePreviewFrame>>> {
    for (let attempt = 0; ; attempt++) {
      const packet = await buildWorkerSoftwarePreviewFrame(layers, {
        width: this.width,
        height: this.height,
      }, {
        allowHtmlVideoSnapshots: true,
      });
      this.lastDiagnostics = packet.diagnostics;
      if (
        !hasWorkerSoftwareBlockingSkips(packet.diagnostics) ||
        !hasOnlyTransientWorkerSoftwareSkips(packet.diagnostics) ||
        attempt >= WORKER_EXPORT_TRANSIENT_RETRY_LIMIT
      ) {
        return packet;
      }
      this.transientRetryCount += 1;
      closeWorkerSoftwarePreviewFrame(packet.frame);
      await waitForWorkerExportRetry();
    }
  }

  private async renderMainFallbackFrame(
    layers: Layer[],
    frameContext: RenderSurfaceFrameContext,
  ): Promise<Uint8ClampedArray | null> {
    if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
    this.fallbackFrameCount += 1;
    this.mainFallbackTouched = true;
    if (!(await this.main.ensureReady())) return null;
    this.main.setResolution(this.width, this.height);
    this.main.setExporting(true);
    this.main.setRenderTimeOverride(this.currentTime);
    await this.main.ensureExportLayersReady(layers);
    this.main.render(layers, frameContext);
    return this.main.readPixels();
  }

  private blockStrictFallbackFrame(): null {
    this.strictBlockedFrameCount += 1;
    return null;
  }
}

export const exportRenderHostPort: ExportRenderHostPort = new WorkerFirstExportRenderHostPort();
