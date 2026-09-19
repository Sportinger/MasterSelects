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
}

export type ByteTextureProvider = (
  params: Record<string, number | boolean | string>,
  context: ByteTextureContext,
) => ByteTextureUpload | null;

interface ByteTextureEntry {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  version: string;
}

export const BYTE_TEXTURE_MAX_DIMENSION = 8192;

export class ByteTextureCache {
  private readonly entries = new Map<string, ByteTextureEntry>();
  private fallback: ByteTextureEntry | null = null;
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Returns the view to bind; a zero 1×1 texture when `upload` is null. */
  getView(key: string, upload: ByteTextureUpload | null): GPUTextureView {
    if (!upload) return this.getFallback().view;

    const width = Math.max(1, Math.min(BYTE_TEXTURE_MAX_DIMENSION, Math.floor(upload.width)));
    const height = Math.max(1, Math.min(BYTE_TEXTURE_MAX_DIMENSION, Math.floor(upload.height)));
    const requiredBytes = width * height * 4;
    if (upload.data.byteLength < requiredBytes) return this.getFallback().view;

    let entry = this.entries.get(key);
    if (entry && (entry.width !== width || entry.height !== height)) {
      entry.texture.destroy();
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const texture = this.device.createTexture({
        label: `effect-bytes-${key}`,
        size: { width, height },
        format: 'r32uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      entry = { texture, view: texture.createView(), width, height, version: '' };
      this.entries.set(key, entry);
    }
    if (entry.version !== upload.version) {
      const bytesPerRow = width * 4;
      const source = upload.data.byteOffset === 0 && upload.data.byteLength === requiredBytes
        ? upload.data
        : upload.data.subarray(0, requiredBytes);
      this.device.queue.writeTexture(
        { texture: entry.texture },
        source as unknown as GPUAllowSharedBufferSource,
        { bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      entry.version = upload.version;
    }
    return entry.view;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.texture.destroy();
    this.entries.delete(key);
  }

  destroy(): void {
    for (const entry of this.entries.values()) entry.texture.destroy();
    this.entries.clear();
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
    this.fallback = { texture, view: texture.createView(), width: 1, height: 1, version: 'fallback' };
    return this.fallback;
  }
}
