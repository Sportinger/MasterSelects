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
import { seekVideo } from './VideoSeeker';

const MAX_EXPORT_VIDEO_SOURCE_NESTING_DEPTH = 8;
const EXPORT_NESTED_DEFER_RETRY_LIMIT = 3;
const EXPORT_NESTED_DEFER_RETRY_DELAY_MS = 16;

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

function createInvalidExportHostError(
  telemetry: ReturnType<ExportRenderHostPort['getTelemetry']>,
  phase: string,
): Error {
  const hostDescription = `${telemetry.mode}/${telemetry.presentationStrategy}`;
  return new Error(
    `Export render host is unavailable during ${phase} (${hostDescription}). Try keeping the browser tab in focus.`,
  );
}

function finiteTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectExportLayerVideoSources(
  layers: Layer[],
  result: Map<HTMLVideoElement, number | null>,
  depth = 0,
): void {
  if (depth >= MAX_EXPORT_VIDEO_SOURCE_NESTING_DEPTH) return;

  for (const layer of layers) {
    if (!layer || layer.visible === false || layer.opacity === 0) continue;

    const source = layer.source;
    if (!source) continue;

    if (source.videoElement && !source.videoFrame) {
      result.set(
        source.videoElement,
        finiteTime(source.mediaTime) ?? finiteTime(source.targetMediaTime),
      );
    }

    const nestedLayers = source.nestedComposition?.layers;
    if (nestedLayers?.length) {
      collectExportLayerVideoSources(nestedLayers, result, depth + 1);
    }
  }
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && !video.seeking) return Promise.resolve();

  return new Promise((resolve) => {
    const timeoutId = setTimeout(finish, 800);

    function cleanup(): void {
      clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('canplaythrough', onReady);
      video.removeEventListener('seeked', onReady);
      video.removeEventListener('error', finish);
    }

    function finish(): void {
      cleanup();
      resolve();
    }

    function onReady(): void {
      if (video.readyState >= 2 && !video.seeking) finish();
    }

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('seeked', onReady);
    video.addEventListener('error', finish);
  });
}

function isNestedCompositionDeferredError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('nested composition was not ready');
}

function waitForNestedCompositionRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(finish, EXPORT_NESTED_DEFER_RETRY_DELAY_MS);

    function cleanup(): void {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    }

    function finish(): void {
      cleanup();
      resolve();
    }

    function onAbort(): void {
      cleanup();
      reject(signal.reason);
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForExportLayerVideoSources(
  layers: Layer[],
  signal: AbortSignal,
): Promise<void> {
  const sources = new Map<HTMLVideoElement, number | null>();
  collectExportLayerVideoSources(layers, sources);
  if (sources.size === 0) return;

  await Promise.all([...sources.entries()].map(async ([video, targetTime]) => {
    if (signal.aborted) throw new Error('Export cancelled');
    if (targetTime !== null) {
      await seekVideo(video, targetTime);
      return;
    }
    await waitForVideoReady(video);
  }));
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

  async begin(): Promise<void> {
    const ready = await this.host.ensureReady();
    if (!ready) {
      throw new Error('Export render host failed to initialize');
    }

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

    await this.ensureHostAvailable('frame render');

    this.host.setRenderTimeOverride(input.time);
    const ensureLayersStart = performance.now();
    await this.host.ensureExportLayersReady(layers);
    await waitForExportLayerVideoSources(layers, this.signal);
    const ensureLayersMs = performance.now() - ensureLayersStart;

    const maskSyncStart = performance.now();
    syncExportMaskTextures(layers, this.width, this.height, input.time, this.host);
    const maskSyncMs = performance.now() - maskSyncStart;

    let renderMs = 0;
    for (let attempt = 0; ; attempt += 1) {
      const renderStart = performance.now();
      try {
        this.host.render(layers);
        renderMs += performance.now() - renderStart;
        break;
      } catch (error) {
        renderMs += performance.now() - renderStart;
        if (!isNestedCompositionDeferredError(error) || attempt >= EXPORT_NESTED_DEFER_RETRY_LIMIT) {
          throw error;
        }
        await waitForNestedCompositionRetry(this.signal);
        await this.host.ensureExportLayersReady(layers);
        await waitForExportLayerVideoSources(layers, this.signal);
      }
    }

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
          throw createInvalidExportHostError(this.host.getTelemetry(), 'zero-copy capture');
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
        throw createInvalidExportHostError(this.host.getTelemetry(), 'readback capture');
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

  private async ensureHostAvailable(phase: string): Promise<void> {
    if (this.host.isDeviceValid()) return;

    const recovered = await this.host.ensureReady();
    if (recovered && this.host.isDeviceValid()) return;

    throw createInvalidExportHostError(this.host.getTelemetry(), phase);
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
    this.host.requestPreviewRender();
  }
}
