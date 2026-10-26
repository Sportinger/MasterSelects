import { EffectsPipeline } from '../EffectsPipeline';
import { renderHostPort } from '../../services/render/renderHostPort';
import { Logger } from '../../services/logger';
import type { LookDefinition } from './types';
import { lookPreviewEffects } from './lookEntryGraph';
import { fitThumbnailToWidthRect, type ThumbnailRect } from './lookThumbnailGeometry';
import {
  chooseLookThumbnailView, compareLookView, downscaleLookRaster, isAnimatedLook, LOOK_THUMBNAIL_HEIGHT, LOOK_THUMBNAIL_WIDTH,
  lookDetailRegionInFrame, lookThumbnailStillTimes, lookThumbnailViewRect, lookThumbnailWorkSize,
  type LookRaster, type LookThumbnailInfo, type LookThumbnailView,
} from './lookThumbnailViews';
import { guardGpuDevice } from '../../engine/core/gpuPipelineGuard';

const log = Logger.create('LookThumbnailRuntime');

/** The captured frame at working resolution (lookThumbnailViews.ts), on the GPU and as pixels for the views. */
interface SourceFrame {
  id: string;
  width: number;
  height: number;
  texture: GPUTexture;
  view: GPUTextureView;
  raster: LookRaster;
  /** Where the tile's pixels go on the 256x144 canvas. */
  tileRect: ThumbnailRect;
  /** The views of the unprocessed frame the effect views are compared with. */
  views: Record<LookThumbnailView, { rect: ThumbnailRect; pixels: Uint8ClampedArray } | null>;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function paddedPixels(pixels: Uint8ClampedArray, width: number, height: number): {
  data: Uint8Array<ArrayBuffer>;
  bytesPerRow: number;
} {
  const rowBytes = width * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const data = new Uint8Array(new ArrayBuffer(bytesPerRow * height));
  if (bytesPerRow === rowBytes) {
    data.set(pixels);
    return { data, bytesPerRow };
  }
  for (let y = 0; y < height; y++) {
    data.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * bytesPerRow);
  }
  return { data, bytesPerRow };
}

/** The capture canvas drawn at working size (worker-presenting hosts have no pixel readback). */
function canvasPixels(canvas: CanvasImageSource, width: number, height: number): Uint8ClampedArray | null {
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

class LookThumbnailRuntime {
  private device: GPUDevice | null = null;
  private deviceRequest: Promise<GPUDevice | null> | null = null;
  private pipeline: EffectsPipeline | null = null;
  private pipelineReady: Promise<void> | null = null;
  private source: SourceFrame | null = null;
  private sourcePromise: Promise<boolean> | null = null;
  private cache = new Map<string, ImageBitmap>();
  private info = new Map<string, LookThumbnailInfo>();
  private lastCaptureFailure: string | null = null;

  private captureFailed(reason: string): false {
    if (this.lastCaptureFailure !== reason) log.warn(reason);
    this.lastCaptureFailure = reason;
    return false;
  }

  async prepareSource(id: string): Promise<boolean> {
    if (this.source?.id === id) return true;
    while (this.sourcePromise) {
      await this.sourcePromise;
      if (this.source?.id === id) return true;
    }
    this.sourcePromise = this.captureSource(id).finally(() => { this.sourcePromise = null; });
    return this.sourcePromise;
  }

  private async captureSource(id: string): Promise<boolean> {
    const device = await this.resolveDevice();
    if (!device) return this.captureFailed('Look preview GPU device is unavailable');
    renderHostPort.requestRender();
    await nextPaint();
    await nextPaint();
    const pixels = await renderHostPort.readPixels();
    const captureCanvas = renderHostPort.getCaptureCanvas()?.canvas ?? null;
    const outputDimensions = renderHostPort.getOutputDimensions();
    const sourceWidth = pixels ? outputDimensions.width : captureCanvas?.width ?? 0;
    const sourceHeight = pixels ? outputDimensions.height : captureCanvas?.height ?? 0;
    if (sourceWidth <= 0 || sourceHeight <= 0) return this.captureFailed('Look preview source has invalid dimensions');
    if (pixels && pixels.byteLength !== sourceWidth * sourceHeight * 4) {
      return this.captureFailed('Look preview readback size does not match the render target');
    }
    if (!pixels && !captureCanvas) return this.captureFailed('Look preview source frame is unavailable');

    // Effects render at a working resolution close to the output, not at tile size (lookThumbnailViews.ts).
    const { width, height } = lookThumbnailWorkSize(sourceWidth, sourceHeight);
    const full = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    const data = pixels
      ? (width === sourceWidth && height === sourceHeight ? pixels.slice() : downscaleLookRaster({ data: pixels, width: sourceWidth, height: sourceHeight }, full, width, height, false))
      : canvasPixels(captureCanvas!, width, height);
    if (!data) return this.captureFailed('Look preview source frame could not be read');

    this.releaseSource();
    if (this.device !== device) {
      this.pipeline?.destroy();
      this.device = device;
      this.pipeline = new EffectsPipeline(device);
      this.pipelineReady = Promise.resolve();
    }
    await this.pipelineReady;

    const texture = device.createTexture({
      label: `look-source-${id}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const upload = paddedPixels(data, width, height);
    device.queue.writeTexture(
      { texture },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    const raster = { data, width, height };
    const tileRect = fitThumbnailToWidthRect(width, height, LOOK_THUMBNAIL_WIDTH, LOOK_THUMBNAIL_HEIGHT);
    const sourceView = (view: LookThumbnailView) => {
      const rect = lookThumbnailViewRect(view, raster, tileRect);
      return rect ? { rect, pixels: downscaleLookRaster(raster, rect, tileRect.width, tileRect.height, true) } : null;
    };
    this.source = { id, width, height, texture, view: texture.createView(), raster, tileRect,
      views: { frame: sourceView('frame'), detail: sourceView('detail') } };
    this.lastCaptureFailure = null;
    return true;
  }

  private async resolveDevice(): Promise<GPUDevice | null> {
    const sharedDevice = renderHostPort.getDevice();
    if (sharedDevice) return sharedDevice;
    if (this.device) return this.device;
    if (this.deviceRequest) return this.deviceRequest;
    if (!navigator.gpu) return null;
    this.deviceRequest = navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      .then((adapter) => adapter?.requestDevice({ label: 'look-thumbnail-device' }) ?? null)
      .then((device) => device && guardGpuDevice(device, 'look-thumbnails'))
      .then((device) => {
        if (device) {
          void device.lost.then(() => {
            if (this.device !== device) return;
            this.pipeline?.destroy();
            this.pipeline = null;
            this.pipelineReady = null;
            this.releaseSource();
            this.device = null;
          });
        }
        return device;
      })
      .finally(() => {
        this.deviceRequest = null;
      });
    return this.deviceRequest;
  }

  getCached(cacheKey: string): ImageBitmap | null {
    return this.cache.get(cacheKey) ?? null;
  }

  /** What the cached still shows: its view and time, or that the effect left the frame unchanged. */
  getPreviewInfo(cacheKey: string): LookThumbnailInfo | null {
    return this.info.get(cacheKey) ?? null;
  }

  async prewarm(look: LookDefinition): Promise<boolean> {
    if (!this.pipeline || !this.pipelineReady) return false;
    await this.pipelineReady;
    for (const entry of look.stack) this.pipeline.prewarmEffect(entry.effectId);
    return true;
  }

  /**
   * The tile of a look. A still (no `view`) renders at `timelineTimeSeconds` and, for an animated look
   * that shows no change there, at later times; it picks the view that shows the effect and records
   * that choice (getPreviewInfo). A hover frame passes the still's `view` and renders only that.
   */
  async renderLook(
    look: LookDefinition,
    sourceId: string,
    cacheKey: string,
    cache = true,
    /** Timeline time of the frame: the still's time, or a running time for the hover animation. */
    timelineTimeSeconds = 0,
    view?: LookThumbnailView,
  ): Promise<ImageBitmap | null> {
    if (cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }
    if (!await this.prepareSource(sourceId) || !this.source) return null;
    const source = this.source;
    const { tileRect } = source;
    if (tileRect.width <= 0 || tileRect.height <= 0) return null;

    if (view) {
      const rect = source.views[view]?.rect ?? source.views.frame?.rect;
      const raster = rect ? await this.renderRaster(look, timelineTimeSeconds) : null;
      return raster && rect ? this.toBitmap(downscaleLookRaster(raster, rect, tileRect.width, tileRect.height, true), tileRect) : null;
    }

    let still: { pixels: Uint8ClampedArray; info: LookThumbnailInfo } | null = null;
    for (const time of lookThumbnailStillTimes(timelineTimeSeconds, isAnimatedLook(look))) {
      const raster = await this.renderRaster(look, time);
      if (!raster || this.source !== source) return null;
      const rendered = (target: LookThumbnailView) => {
        const sourceView = source.views[target];
        if (!sourceView) return null;
        const pixels = downscaleLookRaster(raster, sourceView.rect, tileRect.width, tileRect.height, true);
        const compare = (region?: ThumbnailRect) => compareLookView(pixels, sourceView.pixels, tileRect.width, tileRect.height, region);
        return { pixels, compare };
      };
      const frame = rendered('frame'), detail = rendered('detail');
      if (!frame) return null;
      const centre = detail ? lookDetailRegionInFrame(source, tileRect) : null;
      const choice = chooseLookThumbnailView({ frame: frame.compare(), frameCentre: centre ? frame.compare(centre) : null,
        detail: detail?.compare() ?? null });
      if (choice !== 'unchanged') {
        still = { pixels: choice === 'detail' && detail ? detail.pixels : frame.pixels, info: { view: choice, timeSeconds: time, unchanged: false } };
        break;
      }
      // Nothing visible yet: keep the first still, so the tile shows the frame at the start time.
      still ??= { pixels: frame.pixels, info: { view: 'frame', timeSeconds: time, unchanged: true } };
    }
    if (!still) return null;
    if (still.info.unchanged) log.debug(`Look preview shows no visible change: ${look.id}`);
    const bitmap = await this.toBitmap(still.pixels, tileRect);
    if (bitmap && cache && this.source === source) {
      this.cache.set(cacheKey, bitmap);
      this.info.set(cacheKey, still.info);
    }
    return bitmap;
  }

  /** The look applied to the source at working resolution, read back as straight-alpha pixels. */
  private async renderRaster(look: LookDefinition, timelineTimeSeconds: number): Promise<LookRaster | null> {
    if (!this.device || !this.pipeline || !this.source) return null;
    const device = this.device, source = this.source;
    const { width, height } = source;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING;
    const ping = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
    const pong = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
    const pingView = ping.createView();
    const pongView = pong.createView();
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    // As applyLookToClip: the same graphs and values (lookEntryGraph.ts).
    const effects = lookPreviewEffects(look);
    const encoder = device.createCommandEncoder();
    const result = this.pipeline.applyEffects(
      encoder,
      effects,
      sampler,
      source.view,
      pingView,
      pingView,
      pongView,
      width,
      height,
      ping,
      pong,
      undefined,
      timelineTimeSeconds,
      undefined,
      { frameRate: 30, scopeId: `look-thumbnail:${look.id}` },
    );
    const finalTexture = result.finalView === pingView ? ping : result.finalView === pongView ? pong : null;
    if (!finalTexture) {
      device.queue.submit([encoder.finish()]);
      ping.destroy();
      pong.destroy();
      // Every effect passed its input through (or was skipped): the frame is the source.
      return result.finalView === source.view ? source.raster : null;
    }

    const tightBytesPerRow = width * 4;
    const bytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;
    const readback = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture: finalTexture },
      { buffer: readback, bytesPerRow, rowsPerImage: height },
      [width, height],
    );
    device.queue.submit([encoder.finish()]);
    try {
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readback.getMappedRange());
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + tightBytesPerRow), y * tightBytesPerRow);
      }
      readback.unmap();
      return { data, width, height };
    } finally {
      readback.destroy();
      ping.destroy();
      pong.destroy();
    }
  }

  private async toBitmap(pixels: Uint8ClampedArray, tileRect: ThumbnailRect): Promise<ImageBitmap | null> {
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = LOOK_THUMBNAIL_WIDTH;
    thumbnailCanvas.height = LOOK_THUMBNAIL_HEIGHT;
    const context = thumbnailCanvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#000';
    context.fillRect(0, 0, LOOK_THUMBNAIL_WIDTH, LOOK_THUMBNAIL_HEIGHT);
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), tileRect.width, tileRect.height), tileRect.x, tileRect.y);
    return createImageBitmap(thumbnailCanvas);
  }

  private releaseSource(): void {
    this.source?.texture.destroy();
    this.source = null;
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
    this.info.clear();
  }
}

interface LookThumbnailHotData { runtime?: LookThumbnailRuntime }
const hotData = import.meta.hot?.data as LookThumbnailHotData | undefined;
// A runtime parked by an older revision of this module (without preview info) is replaced, not reused.
const parkedRuntime = hotData?.runtime;
export const lookThumbnailRuntime = parkedRuntime && typeof parkedRuntime.getPreviewInfo === 'function'
  ? parkedRuntime : new LookThumbnailRuntime();

if (import.meta.hot) {
  import.meta.hot.dispose((data: LookThumbnailHotData) => {
    data.runtime = lookThumbnailRuntime;
  });
}
