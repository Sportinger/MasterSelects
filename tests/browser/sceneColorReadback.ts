import { SCENE_COLOR_FORMAT } from '../../src/engine/native3d/sceneRenderer/constants';

/** IEEE half to float. */
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >> 10) & 0x1f, mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/**
 * An HDR scene color target (the native passes' SCENE_COLOR_FORMAT) for the check pages, read back
 * as the 8-bit values the former rgba8unorm target stored: clamped to [0, 1] and rounded.
 */
export class SceneColorReadback {
  readonly texture: GPUTexture;
  private readonly buffer: GPUBuffer;
  private readonly bytesPerRow: number;

  private readonly device: GPUDevice;
  private readonly width: number;
  private readonly height: number;

  constructor(device: GPUDevice, width: number, height: number) {
    this.device = device; this.width = width; this.height = height;
    this.texture = device.createTexture({ size: [width, height], format: SCENE_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
    this.bytesPerRow = Math.ceil(width * 8 / 256) * 256;
    this.buffer = device.createBuffer({ size: this.bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  encodeCopy(encoder: GPUCommandEncoder): void {
    encoder.copyTextureToBuffer({ texture: this.texture }, { buffer: this.buffer, bytesPerRow: this.bytesPerRow }, [this.width, this.height]);
  }

  /** Waits for the copy (submit first) and returns tightly packed rgba bytes. */
  async read(): Promise<Uint8Array> {
    await this.buffer.mapAsync(GPUMapMode.READ);
    const halves = new Uint16Array(this.buffer.getMappedRange());
    const rgba = new Uint8Array(this.width * this.height * 4), rowHalves = this.bytesPerRow / 2;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width * 4; x++) {
        rgba[y * this.width * 4 + x] = Math.round(Math.min(1, Math.max(0, half(halves[y * rowHalves + x]))) * 255);
      }
    }
    this.buffer.unmap();
    return rgba;
  }

  destroy(): void {
    this.texture.destroy();
    this.buffer.destroy();
  }
}
