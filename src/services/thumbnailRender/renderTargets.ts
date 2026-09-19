import { Logger } from '../logger';
import type { ThumbnailRenderTarget, ThumbnailResources } from './contracts';

const log = Logger.create('ThumbnailRenderer');

export class ThumbnailRenderTargets {
  private pingTexture: GPUTexture | null = null;
  private pongTexture: GPUTexture | null = null;
  private pingView: GPUTextureView | null = null;
  private pongView: GPUTextureView | null = null;
  private effectTempTexture: GPUTexture | null = null;
  private effectTempTexture2: GPUTexture | null = null;
  private effectTempView: GPUTextureView | null = null;
  private effectTempView2: GPUTextureView | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private canvas: OffscreenCanvas | null = null;
  private canvasContext: GPUCanvasContext | null = null;

  ensure(resources: ThumbnailResources, width: number, height: number): ThumbnailRenderTarget | null {
    if (!this.ensurePingPongTextures(resources, width, height)) {
      return null;
    }
    if (!this.ensureCanvas(resources, width, height)) {
      return null;
    }

    if (
      !this.pingView ||
      !this.pongView ||
      !this.effectTempView ||
      !this.effectTempView2 ||
      !this.effectTempTexture ||
      !this.effectTempTexture2 ||
      !this.canvasContext ||
      !this.canvas
    ) {
      return null;
    }

    return {
      pingView: this.pingView,
      pongView: this.pongView,
      effectTempView: this.effectTempView,
      effectTempView2: this.effectTempView2,
      effectTempTexture: this.effectTempTexture,
      effectTempTexture2: this.effectTempTexture2,
      canvasContext: this.canvasContext,
      canvas: this.canvas,
    };
  }

  dispose(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.effectTempTexture?.destroy();
    this.effectTempTexture2?.destroy();
    this.pingTexture = null;
    this.pongTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.effectTempView = null;
    this.effectTempView2 = null;
    this.effectTempTexture = null;
    this.effectTempTexture2 = null;
    this.canvas = null;
    this.canvasContext = null;
    this.currentWidth = 0;
    this.currentHeight = 0;
  }

  private ensurePingPongTextures(resources: ThumbnailResources, width: number, height: number): boolean {
    if (
      this.pingTexture &&
      this.pongTexture &&
      this.effectTempTexture &&
      this.effectTempTexture2 &&
      this.currentWidth === width &&
      this.currentHeight === height
    ) {
      return true;
    }

    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.effectTempTexture?.destroy();
    this.effectTempTexture2?.destroy();

    const { device } = resources;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.STORAGE_BINDING;

    this.pingTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage,
    });

    this.pongTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage,
    });

    this.effectTempTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage,
    });

    this.effectTempTexture2 = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage,
    });

    this.pingView = this.pingTexture.createView();
    this.pongView = this.pongTexture.createView();
    this.effectTempView = this.effectTempTexture.createView();
    this.effectTempView2 = this.effectTempTexture2.createView();
    this.currentWidth = width;
    this.currentHeight = height;

    return true;
  }

  private ensureCanvas(resources: ThumbnailResources, width: number, height: number): boolean {
    if (this.canvas && this.canvas.width === width && this.canvas.height === height) {
      return true;
    }

    const { device } = resources;
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) {
      log.error('Failed to get WebGPU context from OffscreenCanvas');
      return false;
    }

    const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
      device,
      format: preferredFormat,
      alphaMode: 'premultiplied',
    });

    this.canvasContext = ctx;
    return true;
  }
}
