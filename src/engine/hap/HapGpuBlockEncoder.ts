// WebGPU BC block compressor for HAP export.
// Runs the hapBlockEncode.wgsl compute kernels on a private GPUDevice so an
// export never contends with the preview engine's device or error scopes.
// Compressed blocks read back 4-8x smaller than RGBA, so the GPU->CPU copy is
// cheaper than a plain pixel readback. Falls back to null when WebGPU is
// unavailable — callers then use the CPU encoder in a worker.

import shaderSource from './hapBlockEncode.wgsl?raw';
import { Logger } from '../../services/logger';

const log = Logger.create('HapGpuBlockEncoder');

export type HapGpuEncodeFormat = 'bc1' | 'bc3' | 'ycocg-bc3';

export interface HapCpuFrameSource {
  pixels: Uint8Array | Uint8ClampedArray;
}

export type HapGpuFrameSource = VideoFrame | ImageBitmap | HapCpuFrameSource;

const ENTRY_POINTS: Record<HapGpuEncodeFormat, string> = {
  'bc1': 'encodeBc1',
  'bc3': 'encodeBc3',
  'ycocg-bc3': 'encodeYCoCgBc3',
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`WebGPU ${stage} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }) as Promise<T>;
}

export class HapGpuBlockEncoder {
  private readonly device: GPUDevice;
  private readonly texture: GPUTexture;
  private readonly outputBuffer: GPUBuffer;
  private readonly stagingBuffer: GPUBuffer;
  private readonly uniformBuffer: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly blocksX: number;
  private readonly blocksY: number;
  private readonly outputBytes: number;
  readonly width: number;
  readonly height: number;
  readonly format: HapGpuEncodeFormat;
  private destroyed = false;
  private encodeChain: Promise<unknown> = Promise.resolve();

  private constructor(
    device: GPUDevice,
    format: HapGpuEncodeFormat,
    width: number,
    height: number,
  ) {
    this.device = device;
    this.format = format;
    this.width = width;
    this.height = height;
    this.blocksX = Math.max(1, Math.ceil(width / 4));
    this.blocksY = Math.max(1, Math.ceil(height / 4));
    const bytesPerBlock = format === 'bc1' ? 8 : 16;
    this.outputBytes = this.blocksX * this.blocksY * bytesPerBlock;

    this.texture = device.createTexture({
      label: 'hap-encode-source',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.outputBuffer = device.createBuffer({
      label: 'hap-encode-blocks',
      size: this.outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.stagingBuffer = device.createBuffer({
      label: 'hap-encode-staging',
      size: this.outputBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffer = device.createBuffer({
      label: 'hap-encode-params',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Uint32Array([this.blocksX, this.blocksY, width, height]),
    );

    const module = device.createShaderModule({
      label: 'hap-block-encode',
      code: shaderSource,
    });
    this.pipeline = device.createComputePipeline({
      label: `hap-encode-${format}`,
      layout: 'auto',
      compute: { module, entryPoint: ENTRY_POINTS[format] },
    });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: { buffer: this.outputBuffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  static async create(
    format: HapGpuEncodeFormat,
    width: number,
    height: number,
  ): Promise<HapGpuBlockEncoder | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    try {
      // requestAdapter/requestDevice can stall on some Windows drivers (the
      // preview engine sees the same); never let a hung request hang an export.
      const adapter = await withTimeout(navigator.gpu.requestAdapter(), 4000, 'requestAdapter');
      if (!adapter) return null;
      const device = await withTimeout(adapter.requestDevice(), 4000, 'requestDevice');
      return new HapGpuBlockEncoder(device, format, width, height);
    } catch (error) {
      log.warn('WebGPU unavailable for HAP encode, using CPU fallback', error);
      return null;
    }
  }

  /** Compress one frame; resolves with tightly packed BC blocks. */
  encode(source: HapGpuFrameSource): Promise<Uint8Array> {
    const run = this.encodeChain
      .catch(() => undefined)
      .then(() => this.encodeInternal(source));
    this.encodeChain = run;
    return run;
  }

  private async encodeInternal(source: HapGpuFrameSource): Promise<Uint8Array> {
    if (this.destroyed) throw new Error('HapGpuBlockEncoder is destroyed');

    if ('pixels' in source) {
      const pixels = source.pixels;
      const expected = this.width * this.height * 4;
      if (pixels.length < expected) {
        throw new Error(`HAP encode pixels too small: ${pixels.length} < ${expected}`);
      }
      this.device.queue.writeTexture(
        { texture: this.texture },
        pixels as unknown as BufferSource,
        { bytesPerRow: this.width * 4 },
        { width: this.width, height: this.height },
      );
    } else {
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture: this.texture },
        { width: this.width, height: this.height },
      );
    }

    const encoder = this.device.createCommandEncoder({ label: 'hap-encode' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.blocksX / 8),
      Math.ceil(this.blocksY / 8),
    );
    pass.end();
    encoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, this.outputBytes);
    this.device.queue.submit([encoder.finish()]);

    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    try {
      const mapped = new Uint8Array(this.stagingBuffer.getMappedRange());
      return mapped.slice();
    } finally {
      this.stagingBuffer.unmap();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    void this.encodeChain.catch(() => undefined).then(() => {
      try { this.texture.destroy(); } catch { /* device may be gone */ }
      try { this.outputBuffer.destroy(); } catch { /* device may be gone */ }
      try { this.stagingBuffer.destroy(); } catch { /* device may be gone */ }
      try { this.uniformBuffer.destroy(); } catch { /* device may be gone */ }
      try { this.device.destroy(); } catch { /* device may be gone */ }
    });
  }
}
