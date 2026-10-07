import { Logger } from '../../services/logger';

const log = Logger.create('SoftwareOutputCanvas');
const MAX_EDGE = 4096;

/** Strip WebGPU row padding and convert BGRA to the software canvas's RGBA layout. */
export function softwareCanvasPixels(source: Uint8Array, width: number, height: number, bytesPerRow: number,
  bgra: boolean): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = source.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
    pixels.set(row, y * width * 4);
  }
  if (bgra) for (let i = 0; i < pixels.length; i += 4) {
    const blue = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = blue;
  }
  return pixels;
}

/**
 * A GPU render target presented through a real main-thread 2D canvas on Linux/Mesa.
 * The renderer uses its normal output/slice passes; only final presentation reads back.
 * At most one asynchronous readback is in flight, with the newest frame following it.
 * No GPU canvas or transferred OffscreenCanvas participates in screen composition.
 */
export class SoftwareOutputCanvas implements GPUCanvasContext {
  readonly __brand = 'GPUCanvasContext' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly paint: CanvasRenderingContext2D;
  private configuration: GPUCanvasConfigurationOut | null = null;
  private texture: GPUTexture | null = null;
  private readback: GPUBuffer | null = null;
  private epoch = 0;
  private frame = 0;
  private busy = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const paint = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!paint) throw new Error('Software preview canvas is unavailable.');
    this.paint = paint;
  }

  configure(configuration: GPUCanvasConfiguration): undefined {
    this.unconfigure();
    if (configuration.format !== 'bgra8unorm' && configuration.format !== 'rgba8unorm') {
      throw new Error('Software preview requires an 8-bit RGBA or BGRA output.');
    }
    this.configuration = { ...configuration, usage: (configuration.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC,
      viewFormats: [...(configuration.viewFormats ?? [])], colorSpace: configuration.colorSpace ?? 'srgb',
      alphaMode: configuration.alphaMode ?? 'opaque' };
    const epoch = this.epoch;
    void configuration.device.lost?.then(() => { if (this.epoch === epoch) this.unconfigure(); });
    this.paint.fillStyle = '#000';
    this.paint.fillRect(0, 0, this.canvas.width, this.canvas.height);
    return undefined;
  }

  getConfiguration(): GPUCanvasConfigurationOut | null {
    return this.configuration ? { ...this.configuration, viewFormats: [...this.configuration.viewFormats] } : null;
  }

  getCurrentTexture(): GPUTexture {
    const configuration = this.configuration;
    if (!configuration) throw new Error('Software preview canvas is not configured.');
    const width = Math.max(1, Math.min(MAX_EDGE, this.canvas.width));
    const height = Math.max(1, Math.min(MAX_EDGE, this.canvas.height));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
      this.texture?.destroy();
      this.texture = configuration.device.createTexture({ label: 'software-preview-output', size: [width, height],
        format: configuration.format, usage: configuration.usage, viewFormats: configuration.viewFormats });
    }
    this.frame++;
    this.schedule();
    return this.texture;
  }

  private schedule(): void {
    if (this.busy || !this.configuration || !this.texture) return;
    this.busy = true;
    // getCurrentTexture runs during encoding. Defer the copy until its caller submits.
    queueMicrotask(() => { void this.present(); });
  }

  private async present(): Promise<void> {
    const configuration = this.configuration, texture = this.texture;
    const epoch = this.epoch, frame = this.frame;
    let buffer: GPUBuffer | null = null;
    try {
      if (!configuration || !texture) return;
      const { width, height } = texture;
      const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
      buffer = configuration.device.createBuffer({ label: 'software-preview-readback', size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      this.readback = buffer;
      const encoder = configuration.device.createCommandEncoder({ label: 'software-preview-copy' });
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow, rowsPerImage: height }, [width, height]);
      configuration.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      if (epoch !== this.epoch || texture !== this.texture || width !== this.canvas.width || height !== this.canvas.height) return;
      const pixels = softwareCanvasPixels(new Uint8Array(buffer.getMappedRange()), width, height, bytesPerRow,
        configuration.format === 'bgra8unorm');
      this.paint.putImageData(new ImageData(pixels, width, height, { colorSpace: configuration.colorSpace }), 0, 0);
    } catch (error) {
      if (epoch === this.epoch && this.configuration) log.warn('Software preview presentation failed', error);
    } finally {
      if (buffer?.mapState === 'mapped') buffer.unmap();
      buffer?.destroy();
      if (this.readback === buffer) this.readback = null;
      this.busy = false;
      if (this.configuration && this.frame !== frame) this.schedule();
    }
  }

  unconfigure(): undefined {
    this.epoch++;
    this.configuration = null;
    this.texture?.destroy(); this.texture = null;
    this.readback?.destroy(); this.readback = null;
    return undefined;
  }
}
