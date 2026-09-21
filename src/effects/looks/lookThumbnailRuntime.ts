import { EffectsPipeline } from '../EffectsPipeline';
import { getDefaultParams } from '..';
import { renderHostPort } from '../../services/render/renderHostPort';
import { Logger } from '../../services/logger';
import type { LookDefinition } from './types';
import { fitThumbnailToWidthRect } from './lookThumbnailGeometry';

const THUMBNAIL_WIDTH = 256;
const THUMBNAIL_HEIGHT = 144;
const log = Logger.create('LookThumbnailRuntime');

interface SourceFrame {
  id: string;
  width: number;
  height: number;
  texture: GPUTexture;
  view: GPUTextureView;
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

class LookThumbnailRuntime {
  private device: GPUDevice | null = null;
  private deviceRequest: Promise<GPUDevice | null> | null = null;
  private pipeline: EffectsPipeline | null = null;
  private pipelineReady: Promise<void> | null = null;
  private source: SourceFrame | null = null;
  private sourcePromise: Promise<boolean> | null = null;
  private cache = new Map<string, ImageBitmap>();
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
    const width = pixels ? outputDimensions.width : captureCanvas?.width ?? 0;
    const height = pixels ? outputDimensions.height : captureCanvas?.height ?? 0;
    if (width <= 0 || height <= 0) return this.captureFailed('Look preview source has invalid dimensions');
    if (pixels && pixels.byteLength !== width * height * 4) {
      return this.captureFailed('Look preview readback size does not match the render target');
    }
    if (!pixels && !captureCanvas) return this.captureFailed('Look preview source frame is unavailable');

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
    if (pixels) {
      const upload = paddedPixels(pixels, width, height);
      device.queue.writeTexture(
        { texture },
        upload.data,
        { bytesPerRow: upload.bytesPerRow, rowsPerImage: height },
        { width, height },
      );
    } else if (captureCanvas) {
      const bitmap = await createImageBitmap(captureCanvas);
      device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        { width, height },
      );
      bitmap.close();
    }
    this.source = { id, width, height, texture, view: texture.createView() };
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

  async prewarm(look: LookDefinition): Promise<boolean> {
    if (!this.pipeline || !this.pipelineReady) return false;
    await this.pipelineReady;
    for (const entry of look.stack) this.pipeline.prewarmEffect(entry.effectId);
    return true;
  }

  async renderLook(
    look: LookDefinition,
    sourceId: string,
    cacheKey: string,
    cache = true,
  ): Promise<ImageBitmap | null> {
    if (cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }
    if (!await this.prepareSource(sourceId) || !this.device || !this.pipeline || !this.source) return null;

    const device = this.device;
    const targetRect = fitThumbnailToWidthRect(
      this.source.width,
      this.source.height,
      THUMBNAIL_WIDTH,
      THUMBNAIL_HEIGHT,
    );
    if (targetRect.width <= 0 || targetRect.height <= 0) return null;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING;
    const ping = device.createTexture({ size: [targetRect.width, targetRect.height], format: 'rgba8unorm', usage });
    const pong = device.createTexture({ size: [targetRect.width, targetRect.height], format: 'rgba8unorm', usage });
    const pingView = ping.createView();
    const pongView = pong.createView();
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const effects = look.stack.map((entry, index) => ({
      id: `${look.id}:${index}`,
      type: entry.effectId,
      name: entry.effectId,
      enabled: entry.enabled,
      params: { ...getDefaultParams(entry.effectId), ...entry.params },
    }));
    const encoder = device.createCommandEncoder();
    const result = this.pipeline.applyEffects(
      encoder,
      effects,
      sampler,
      this.source.view,
      pingView,
      pingView,
      pongView,
      targetRect.width,
      targetRect.height,
      ping,
      pong,
      undefined,
      0,
      undefined,
      { frameRate: 30, scopeId: `look-thumbnail:${look.id}` },
    );
    const finalTexture = result.finalView === pingView ? ping : result.finalView === pongView ? pong : null;
    if (!finalTexture) {
      ping.destroy();
      pong.destroy();
      return null;
    }

    const tightBytesPerRow = targetRect.width * 4;
    const bytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;
    const readback = device.createBuffer({
      size: bytesPerRow * targetRect.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture: finalTexture },
      { buffer: readback, bytesPerRow, rowsPerImage: targetRect.height },
      [targetRect.width, targetRect.height],
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readback.getMappedRange());
    const rgba = new Uint8ClampedArray(targetRect.width * targetRect.height * 4);
    for (let y = 0; y < targetRect.height; y += 1) {
      rgba.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + tightBytesPerRow),
        y * tightBytesPerRow,
      );
    }
    for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
    readback.unmap();
    readback.destroy();
    ping.destroy();
    pong.destroy();

    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = THUMBNAIL_WIDTH;
    thumbnailCanvas.height = THUMBNAIL_HEIGHT;
    const context = thumbnailCanvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#000';
    context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    context.putImageData(
      new ImageData(rgba, targetRect.width, targetRect.height),
      targetRect.x,
      targetRect.y,
    );
    const bitmap = await createImageBitmap(thumbnailCanvas);
    if (cache) this.cache.set(cacheKey, bitmap);
    return bitmap;
  }

  private releaseSource(): void {
    this.source?.texture.destroy();
    this.source = null;
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
  }
}

interface LookThumbnailHotData { runtime?: LookThumbnailRuntime }
const hotData = import.meta.hot?.data as LookThumbnailHotData | undefined;
export const lookThumbnailRuntime = hotData?.runtime ?? new LookThumbnailRuntime();

if (import.meta.hot) {
  import.meta.hot.dispose((data: LookThumbnailHotData) => {
    data.runtime = lookThumbnailRuntime;
  });
}
