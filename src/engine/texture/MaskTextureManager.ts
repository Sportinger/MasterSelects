// Mask texture handling for layer masking

import { Logger } from '../../services/logger';

const log = Logger.create('MaskTextureManager');
const MAX_MASK_RASTER_CACHE_BYTES = 64 * 1024 * 1024;

export class MaskTextureManager {
  private device: GPUDevice;

  // Mask textures per layer
  private maskTextures: Map<string, GPUTexture> = new Map();
  private maskTextureViews: Map<string, GPUTextureView> = new Map();
  private maskTextureSizes: Map<string, { width: number; height: number }> = new Map();
  private maskTextureVersions = new Map<string, string>();
  private maskRasterCache = new Map<string, ImageData>();
  private maskRasterCacheBytes = 0;
  private externalMaskTextureViews: Map<string, GPUTextureView> = new Map();
  private frameScopedMaskTextureIds = new Set<string>();
  private activeFrameScopedMaskTextureIds = new Set<string>();
  private lastMaskDebugLog: number | null = null;

  // Fallback mask texture (fully white = no masking)
  private whiteMaskTexture: GPUTexture | null = null;
  private whiteMaskView: GPUTextureView | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.createWhiteMaskTexture();
  }

  private createWhiteMaskTexture(): void {
    this.whiteMaskTexture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture: this.whiteMaskTexture },
      new Uint8Array([255, 255, 255, 255]),  // Pure white = fully visible
      { bytesPerRow: 4 },
      [1, 1]
    );

    this.whiteMaskView = this.whiteMaskTexture.createView();
  }

  // Update mask texture for a layer
  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    // If no imageData, layer will use white fallback (no masking)
    if (!imageData) {
      this.removeMaskTexture(layerId);
      log.debug(`No mask data for layer ${layerId}, using white fallback`);
      return;
    }

    let maskTexture = this.maskTextures.get(layerId);
    const currentSize = this.maskTextureSizes.get(layerId);

    if (!maskTexture || currentSize?.width !== imageData.width || currentSize?.height !== imageData.height) {
      maskTexture?.destroy();

      maskTexture = this.device.createTexture({
        size: [imageData.width, imageData.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });

      this.maskTextures.set(layerId, maskTexture);
      this.maskTextureViews.set(layerId, maskTexture.createView());
      this.maskTextureSizes.set(layerId, { width: imageData.width, height: imageData.height });
    }

    // Upload mask data
    this.device.queue.writeTexture(
      { texture: maskTexture },
      imageData.data,
      {
        bytesPerRow: imageData.width * 4,
        rowsPerImage: imageData.height,
      },
      [imageData.width, imageData.height]
    );

    log.debug(`Uploaded mask texture for layer ${layerId}: ${imageData.width}x${imageData.height}`);
  }

  // Remove mask texture for a layer
  removeMaskTexture(layerId: string): void {
    const texture = this.maskTextures.get(layerId);
    if (texture) texture.destroy();
    this.maskTextures.delete(layerId);
    this.maskTextureViews.delete(layerId);
    this.maskTextureSizes.delete(layerId);
    this.maskTextureVersions.delete(layerId);
    this.frameScopedMaskTextureIds.delete(layerId);
    this.activeFrameScopedMaskTextureIds.delete(layerId);
  }

  /** Mark a nested-composition mask as safe to discard once its occurrence leaves a frame. */
  markFrameScopedMaskTexture(layerId: string): void {
    this.frameScopedMaskTextureIds.add(layerId);
  }

  hasMaskTextureVersion(layerId: string, version: string): boolean {
    return this.maskTextureVersions.get(layerId) === version && this.hasMaskTexture(layerId);
  }

  setMaskTextureVersion(layerId: string, version: string): void {
    this.maskTextureVersions.set(layerId, version);
  }

  /** Reuse CPU mask rasters across occurrence-scoped GPU texture lifetimes. */
  getOrCreateMaskRaster(
    version: string,
    createRaster: () => ImageData | null,
  ): ImageData | null {
    const cached = this.maskRasterCache.get(version);
    if (cached) {
      // Refresh insertion order for byte-bounded LRU eviction.
      this.maskRasterCache.delete(version);
      this.maskRasterCache.set(version, cached);
      return cached;
    }

    const raster = createRaster();
    if (!raster) return null;

    const rasterBytes = raster.data.byteLength;
    if (rasterBytes > MAX_MASK_RASTER_CACHE_BYTES) return raster;

    while (
      this.maskRasterCacheBytes + rasterBytes > MAX_MASK_RASTER_CACHE_BYTES &&
      this.maskRasterCache.size > 0
    ) {
      const oldestVersion = this.maskRasterCache.keys().next().value;
      if (oldestVersion === undefined) break;
      const oldestRaster = this.maskRasterCache.get(oldestVersion);
      this.maskRasterCache.delete(oldestVersion);
      this.maskRasterCacheBytes -= oldestRaster?.data.byteLength ?? 0;
    }

    this.maskRasterCache.set(version, raster);
    this.maskRasterCacheBytes += rasterBytes;
    return raster;
  }

  /** Release inactive nested masks after the frame using them has been submitted. */
  cleanupPendingFrameScopedTextures(): void {
    for (const layerId of Array.from(this.frameScopedMaskTextureIds)) {
      if (this.activeFrameScopedMaskTextureIds.has(layerId)) continue;
      this.removeMaskTexture(layerId);
    }
    this.activeFrameScopedMaskTextureIds.clear();
  }

  // Check if a layer has a mask texture
  hasMaskTexture(layerId: string): boolean {
    return this.maskTextureViews.has(layerId);
  }

  // Get mask texture view for a layer (returns white fallback if no mask)
  getMaskTextureView(layerId: string): GPUTextureView | null {
    return this.maskTextureViews.get(layerId) ?? null;
  }

  // Get the fallback white mask view
  getWhiteMaskView(): GPUTextureView {
    return this.whiteMaskView!;
  }

  // Get mask info in single lookup (avoids double Map access)
  getMaskInfo(layerId: string): { hasMask: boolean; view: GPUTextureView } {
    if (this.frameScopedMaskTextureIds.has(layerId)) {
      this.activeFrameScopedMaskTextureIds.add(layerId);
    }
    const view = this.externalMaskTextureViews.get(layerId) ?? this.maskTextureViews.get(layerId);
    return view
      ? { hasMask: true, view }
      : { hasMask: false, view: this.whiteMaskView! };
  }

  setExternalMaskTextureView(layerId: string, view: GPUTextureView): void {
    this.externalMaskTextureViews.set(layerId, view);
  }

  removeExternalMaskTextureView(layerId: string): void {
    this.externalMaskTextureViews.delete(layerId);
  }

  // Log mask state for debugging (throttled)
  logMaskState(layerId: string, hasMask: boolean): void {
    if (hasMask && (!this.lastMaskDebugLog || Date.now() - this.lastMaskDebugLog > 1000)) {
      log.debug(`Rendering layer ${layerId} WITH mask`);
      this.lastMaskDebugLog = Date.now();
    }
  }

  // Clear all mask textures
  clearAll(): void {
    for (const texture of this.maskTextures.values()) {
      texture.destroy();
    }
    this.maskTextures.clear();
    this.maskTextureViews.clear();
    this.maskTextureSizes.clear();
    this.maskTextureVersions.clear();
    this.maskRasterCache.clear();
    this.maskRasterCacheBytes = 0;
    this.externalMaskTextureViews.clear();
    this.frameScopedMaskTextureIds.clear();
    this.activeFrameScopedMaskTextureIds.clear();
  }

  destroy(): void {
    this.clearAll();
    this.whiteMaskTexture?.destroy();
    this.whiteMaskTexture = null;
    this.whiteMaskView = null;
  }
}
