// Byte texture runtime: uploads a CPU byte block as a `texture_2d<u32>` so a
// fullscreen effect can reinterpret raw memory as pixels. Each texel is one
// little-endian u32 word (4 bytes); the effect decides how many words form a
// pixel. Uploads happen only when the provider's version changes.

export interface ByteTextureUpload {
  /** Raw bytes, at least `width * height * 4` long. */
  data: Uint8Array;
  /** Texture width in u32 words. */
  width: number;
  /** Texture height in rows. */
  height: number;
  /** Changing this string triggers a re-upload. */
  version: string;
}

export interface ByteTextureContext {
  /** Effect instance id (stable per clip effect). */
  effectInstanceId: string;
  width: number;
  height: number;
  timelineTimeSeconds: number;
  frameRate: number;
  scopeId: string;
}

/** Portable render-clock identity supplied by the render owner. */
export interface EffectRenderClockContext {
  frameRate: number;
  scopeId: string;
}

export type ByteTextureProvider = (
  params: Record<string, number | boolean | string>,
  context: ByteTextureContext,
) => ByteTextureUpload | null;

interface ByteTextureEntry {
  ownerKey: string;
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  version: string;
  bytes: number;
}

export const BYTE_TEXTURE_MAX_DIMENSION = 8192;
export const BYTE_TEXTURE_CACHE_MAX_ENTRIES = 32;
export const BYTE_TEXTURE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export class ByteTextureCache {
  private readonly entries = new Map<string, ByteTextureEntry>();
  private cachedBytes = 0;
  private fallback: ByteTextureEntry | null = null;
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Returns the view to bind; a zero 1×1 texture when `upload` is null. */
  getView(key: string, upload: ByteTextureUpload | null): GPUTextureView {
    if (!upload) return this.getFallback().view;

    const width = upload.width;
    const height = upload.height;
    if (!Number.isInteger(width) || width < 1 || width > BYTE_TEXTURE_MAX_DIMENSION
      || !Number.isInteger(height) || height < 1 || height > BYTE_TEXTURE_MAX_DIMENSION) {
      throw new Error(`Byte texture dimensions must be positive integers up to ${BYTE_TEXTURE_MAX_DIMENSION}.`);
    }
    const requiredBytes = width * height * 4;
    if (requiredBytes > BYTE_TEXTURE_CACHE_MAX_BYTES) throw new Error('Byte texture exceeds the cache byte budget.');
    if (upload.data.byteLength < requiredBytes) throw new Error(`Byte texture upload needs ${requiredBytes} bytes, received ${upload.data.byteLength}.`);

    const cacheKey = JSON.stringify([key, upload.version, width, height]);
    let entry = this.entries.get(cacheKey);
    if (entry) {
      // Refresh insertion order so eviction is true least-recently-used.
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, entry);
      return entry.view;
    }
    if (!entry) {
      const texture = this.device.createTexture({
        label: `effect-bytes-${key}-${upload.version}`,
        size: { width, height },
        format: 'r32uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const bytesPerRow = width * 4;
      const source = upload.data.byteOffset === 0 && upload.data.byteLength === requiredBytes
        ? upload.data
        : upload.data.subarray(0, requiredBytes);
      this.device.queue.writeTexture(
        { texture },
        source as unknown as GPUAllowSharedBufferSource,
        { bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      entry = { ownerKey: key, texture, view: texture.createView(), width, height, version: upload.version, bytes: requiredBytes };
      this.entries.set(cacheKey, entry);
      this.cachedBytes += requiredBytes;
      this.evictIfNeeded();
    }
    return entry.view;
  }

  release(key: string): void {
    for (const [cacheKey, entry] of this.entries) {
      if (entry.ownerKey !== key) continue;
      this.entries.delete(cacheKey);
      this.cachedBytes -= entry.bytes;
      // Do not destroy here: a view may still be referenced by an unsubmitted encoder.
    }
  }

  destroy(): void {
    for (const entry of this.entries.values()) entry.texture.destroy();
    this.entries.clear();
    this.cachedBytes = 0;
    this.fallback?.texture.destroy();
    this.fallback = null;
  }

  private getFallback(): ByteTextureEntry {
    if (this.fallback) return this.fallback;
    const texture = this.device.createTexture({
      label: 'effect-bytes-fallback',
      size: { width: 1, height: 1 },
      format: 'r32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture }, new Uint32Array([0]), { bytesPerRow: 4 }, { width: 1, height: 1 });
    this.fallback = { ownerKey: 'fallback', texture, view: texture.createView(), width: 1, height: 1, version: 'fallback', bytes: 4 };
    return this.fallback;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > BYTE_TEXTURE_CACHE_MAX_ENTRIES || this.cachedBytes > BYTE_TEXTURE_CACHE_MAX_BYTES) {
      const oldest = this.entries.entries().next().value as [string, ByteTextureEntry] | undefined;
      if (!oldest) return;
      this.entries.delete(oldest[0]);
      this.cachedBytes -= oldest[1].bytes;
      // Dropping ownership lets WebGPU retire the texture after queued command references are done.
      // Explicit destruction is reserved for owner teardown, where no new encoders can borrow it.
    }
  }
}
