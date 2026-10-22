import { glyphAtlasCacheKey, type GlyphAtlasOptions, type GlyphAtlasPlan } from './glyphAtlasPlan';
import { rasterizeGlyphAtlas } from './glyphAtlasRaster';
export { glyphAtlasCacheKey, planGlyphAtlas } from './glyphAtlasPlan';
export type { GlyphAtlasOptions, GlyphAtlasPlan } from './glyphAtlasPlan';

export interface GlyphAtlasTexture extends GlyphAtlasPlan {
  texture: GPUTexture;
  view: GPUTextureView;
}

/**
 * Atlases kept per device. Typing a Custom Ramp builds one atlas per keystroke and a keyframed Weight up to
 * nine: the least recently used atlas beyond this many is dropped from the cache (not destroyed, since a
 * bind group may still hold it; the browser frees it once nothing does).
 */
export const GLYPH_ATLAS_CACHE_LIMIT = 24;

class GlyphAtlasRuntime {
  private atlases = new Map<GPUDevice, Map<string, GlyphAtlasTexture>>();

  get(device: GPUDevice, options: GlyphAtlasOptions): GlyphAtlasTexture {
    let deviceAtlases = this.atlases.get(device);
    if (!deviceAtlases) {
      deviceAtlases = new Map();
      this.atlases.set(device, deviceAtlases);
    }
    const key = glyphAtlasCacheKey(options);
    const cached = deviceAtlases.get(key);
    if (cached) {
      // Most recently used last, so eviction takes the oldest.
      deviceAtlases.delete(key); deviceAtlases.set(key, cached);
      return cached;
    }

    const { plan, canvas } = rasterizeGlyphAtlas(options);

    const texture = device.createTexture({
      label: `glyph-atlas-${key.slice(0, 48)}`,
      size: [plan.width, plan.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [plan.width, plan.height]);
    const atlas: GlyphAtlasTexture = { ...plan, texture, view: texture.createView() };
    deviceAtlases.set(key, atlas);
    while (deviceAtlases.size > GLYPH_ATLAS_CACHE_LIMIT) deviceAtlases.delete(deviceAtlases.keys().next().value!);
    return atlas;
  }

  size(device: GPUDevice): number {
    return this.atlases.get(device)?.size ?? 0;
  }

  releaseDevice(device: GPUDevice): void {
    const deviceAtlases = this.atlases.get(device);
    if (!deviceAtlases) return;
    for (const atlas of deviceAtlases.values()) atlas.texture.destroy();
    this.atlases.delete(device);
  }
}

interface GlyphAtlasHotData { runtime?: GlyphAtlasRuntime }
const hotData = import.meta.hot?.data as GlyphAtlasHotData | undefined;
const runtime = hotData?.runtime ?? new GlyphAtlasRuntime();

export function getGlyphAtlas(device: GPUDevice, options: GlyphAtlasOptions): GlyphAtlasTexture {
  return runtime.get(device, options);
}

/** Atlases the cache holds for a device (tests and diagnostics). */
export function cachedGlyphAtlasCount(device: GPUDevice): number {
  return runtime.size(device);
}

export function releaseGlyphAtlasesForDevice(device: GPUDevice | null): void {
  if (device) runtime.releaseDevice(device);
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: GlyphAtlasHotData) => { data.runtime = runtime; });
}
