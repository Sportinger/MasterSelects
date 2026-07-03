import type { ModelSequenceData } from '../../types/mediaSequences';
import type { Layer } from '../core/types';
import type { RenderCommandTarget } from '../render/contracts/workerRenderGraph';
import type { GaussianSplatSceneLoadRequest } from '../render/dispatcher/gaussianSequenceFacet';
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
} from '../../services/render/workerSoftwarePreviewFrame';

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
  render(layers: Layer[]): void;
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

  render(layers: Layer[]): void {
    engine.render(layers);
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
  return readRenderHostDevMode() !== 'main'
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

class WorkerFirstExportRenderHostPort implements ExportRenderHostPort {
  private readonly main = new MainExportRenderHostPort();
  private bridge: WorkerRenderHostRuntimeBridge | null = null;
  private workerReady = false;
  private workerUnavailable = false;
  private targetReady = false;
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

  render(layers: Layer[]): void {
    if (this.isWorkerPathActive()) {
      this.pendingReadback = this.renderWorkerSoftwareFrame(layers);
      return;
    }
    if (isWorkerOnlyStrictMode()) {
      this.pendingReadback = Promise.resolve(null);
      return;
    }
    this.pendingReadback = null;
    this.main.render(layers);
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
    this.targetReady = false;
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

  private isWorkerPathActive(): boolean {
    return this.workerReady && canUseWorkerSoftwareExport() && !this.workerUnavailable;
  }

  private createExportTarget(): RenderCommandTarget {
    return {
      id: 'export',
      compositionId: 'export',
      size: { x: this.width, y: this.height },
      devicePixelRatio: 1,
      showTransparencyGrid: false,
      presentation: 'software',
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

  private async renderWorkerSoftwareFrame(layers: Layer[]): Promise<Uint8ClampedArray | null> {
    await this.ensureWorkerTarget();
    if (!this.bridge || !this.targetReady) {
      if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
      return this.renderMainFallbackFrame(layers);
    }

    const packet = await this.buildWorkerSoftwareFrameWithTransientRetries(layers);
    if (hasWorkerSoftwareBlockingSkips(packet.diagnostics)) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
      return this.renderMainFallbackFrame(layers);
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
    return this.renderMainFallbackFrame(layers);
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

  private async renderMainFallbackFrame(layers: Layer[]): Promise<Uint8ClampedArray | null> {
    if (isWorkerOnlyStrictMode()) return this.blockStrictFallbackFrame();
    this.fallbackFrameCount += 1;
    this.mainFallbackTouched = true;
    if (!(await this.main.ensureReady())) return null;
    this.main.setResolution(this.width, this.height);
    this.main.setExporting(true);
    this.main.setRenderTimeOverride(this.currentTime);
    await this.main.ensureExportLayersReady(layers);
    this.main.render(layers);
    return this.main.readPixels();
  }

  private blockStrictFallbackFrame(): null {
    this.strictBlockedFrameCount += 1;
    return null;
  }
}

export const exportRenderHostPort: ExportRenderHostPort = new WorkerFirstExportRenderHostPort();
