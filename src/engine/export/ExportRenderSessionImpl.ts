import type {
  ExportFrameCapture,
  ExportRenderFrameInput,
  ExportRenderSession,
} from '../render/contracts/exportRenderSession';
import { syncExportMaskTextures } from './ExportMaskTextures';
import type { Layer } from '../core/types';
import {
  exportRenderHostPort,
  type ExportRenderHostPort,
} from './exportRenderHostPort';

export interface ExportRenderSessionOptions {
  readonly runId: string;
  readonly width: number;
  readonly height: number;
  readonly stackedAlpha: boolean;
  readonly preferZeroCopy: boolean;
  readonly host?: ExportRenderHostPort;
}

export interface ExportRenderSessionFrameMetrics {
  readonly maskSyncMs: number;
  readonly ensureLayersMs: number;
  readonly renderMs: number;
  readonly captureMs: number;
}

export type ExportRenderSessionFrameCapture = ExportFrameCapture & {
  readonly metrics: ExportRenderSessionFrameMetrics;
};

export class ExportFrameCaptureUnavailableError extends Error {
  readonly captureKind: ExportFrameCapture['kind'];

  constructor(captureKind: ExportFrameCapture['kind']) {
    super(`Export ${captureKind} capture was unavailable`);
    this.name = 'ExportFrameCaptureUnavailableError';
    this.captureKind = captureKind;
  }
}

export class ExportRenderSessionImpl implements ExportRenderSession {
  readonly runId: string;
  readonly signal: AbortSignal;

  private readonly abortController = new AbortController();
  private readonly width: number;
  private readonly height: number;
  private readonly stackedAlpha: boolean;
  private readonly preferZeroCopy: boolean;
  private readonly host: ExportRenderHostPort;
  private originalDimensions: { width: number; height: number } | null = null;
  private disposed = false;
  private useZeroCopy = false;

  constructor(options: ExportRenderSessionOptions) {
    this.runId = options.runId;
    this.width = options.width;
    this.height = options.height;
    this.stackedAlpha = options.stackedAlpha;
    this.preferZeroCopy = options.preferZeroCopy;
    this.host = options.host ?? exportRenderHostPort;
    this.signal = this.abortController.signal;
  }

  get usesZeroCopy(): boolean {
    return this.useZeroCopy;
  }

  begin(): void {
    this.originalDimensions = this.host.getOutputDimensions();
    this.host.setResolution(this.width, this.height);
    this.host.setExporting(true);

    // Initialize export canvas for zero-copy VideoFrame creation
    this.useZeroCopy = this.preferZeroCopy
      ? this.host.initExportCanvas(this.width, this.height, this.stackedAlpha)
      : false;
  }

  async renderFrame(input: ExportRenderFrameInput): Promise<ExportRenderSessionFrameCapture> {
    const layers = input.layers as Layer[];

    // Check GPU device validity
    if (!this.host.isDeviceValid()) {
      throw new Error('WebGPU device lost during export. Try keeping the browser tab in focus.');
    }

    this.host.setRenderTimeOverride(input.time);
    const maskSyncStart = performance.now();
    syncExportMaskTextures(layers, this.width, this.height, input.time, this.host);
    const maskSyncMs = performance.now() - maskSyncStart;

    const ensureLayersStart = performance.now();
    await this.host.ensureExportLayersReady(layers);
    const ensureLayersMs = performance.now() - ensureLayersStart;

    const renderStart = performance.now();
    this.host.render(layers);
    const renderMs = performance.now() - renderStart;

    if (this.useZeroCopy) {
      // Zero-copy path: create VideoFrame directly from OffscreenCanvas
      // await ensures GPU has finished rendering before we capture
      const captureStart = performance.now();
      const videoFrame = await this.host.createVideoFrameFromExport(
        input.timestampMicros ?? 0,
        input.durationMicros ?? 0,
      );
      const captureMs = performance.now() - captureStart;
      if (!videoFrame) {
        if (!this.host.isDeviceValid()) {
          throw new Error('WebGPU device lost during export. Try keeping the browser tab in focus.');
        }
        const readbackCapture = await this.capturePixels(input, {
          maskSyncMs,
          ensureLayersMs,
          renderMs,
        });
        if (readbackCapture) {
          return readbackCapture;
        }
        throw new ExportFrameCaptureUnavailableError('video-frame');
      }

      return {
        kind: 'video-frame',
        frame: videoFrame,
        width: videoFrame.displayWidth || videoFrame.codedWidth,
        height: videoFrame.displayHeight || videoFrame.codedHeight,
        timestampMicros: input.timestampMicros,
        durationMicros: input.durationMicros,
        metrics: { maskSyncMs, ensureLayersMs, renderMs, captureMs },
      };
    }

    const readbackCapture = await this.capturePixels(input, {
      maskSyncMs,
      ensureLayersMs,
      renderMs,
    });
    if (!readbackCapture) {
      throw new ExportFrameCaptureUnavailableError('rgba-pixels');
    }
    return readbackCapture;
  }

  private async capturePixels(
    input: ExportRenderFrameInput,
    metrics: Omit<ExportRenderSessionFrameMetrics, 'captureMs'>
  ): Promise<ExportRenderSessionFrameCapture | null> {
    // Fallback: read pixels from GPU (slower)
    const captureStart = performance.now();
    const pixels = await this.host.readPixels();
    const captureMs = performance.now() - captureStart;
    if (!pixels) {
      if (!this.host.isDeviceValid()) {
        throw new Error('WebGPU device lost during export. Try keeping the browser tab in focus.');
      }
      return null;
    }

    return {
      kind: 'rgba-pixels',
      pixels,
      width: this.width,
      height: this.height,
      timestampMicros: input.timestampMicros,
      durationMicros: input.durationMicros,
      metrics: { ...metrics, captureMs },
    };
  }

  cancel(reason?: string): void {
    if (!this.signal.aborted) {
      this.abortController.abort(reason);
    }
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (!this.originalDimensions) return;

    this.host.setRenderTimeOverride(null);
    this.host.cleanupExportCanvas();
    this.host.setExporting(false);
    this.host.setResolution(this.originalDimensions.width, this.originalDimensions.height);
  }
}
