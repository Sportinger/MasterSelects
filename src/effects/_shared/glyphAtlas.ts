import { glyphAtlasCacheKey, type GlyphAtlasOptions, type GlyphAtlasPlan } from './glyphAtlasPlan';
import { rasterizeGlyphAtlas } from './glyphAtlasRaster';
export { glyphAtlasCacheKey, planGlyphAtlas } from './glyphAtlasPlan';
export type { GlyphAtlasOptions, GlyphAtlasPlan } from './glyphAtlasPlan';

export interface GlyphAtlasTexture extends GlyphAtlasPlan {
  texture: GPUTexture;
  view: GPUTextureView;
}

/**
 * Atlases kept per device, least recently used evicted first: a Custom Ramp builds one atlas per
 * keystroke, and each costs width × height × 4 bytes of GPU memory.
 */
export const GLYPH_ATLAS_CACHE_LIMIT = Object.freeze({ atlases: 16, bytes: 128 * 1024 * 1024 });
/** An evicted atlas may still be bound by commands of the frame being encoded; it is destroyed after that work. */
const RETIRE_DELAY_MS = 1_000;
const atlasBytes = (atlas: GlyphAtlasPlan) => atlas.width * atlas.height * 4;

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
      // Map order is the use order: move the hit to the end.
      deviceAtlases.delete(key);
      deviceAtlases.set(key, cached);
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
    this.evict(device, deviceAtlases);
    return atlas;
  }

  /** Drops the least recently used atlases beyond the limits; the newest one always stays. */
  private evict(device: GPUDevice, deviceAtlases: Map<string, GlyphAtlasTexture>): void {
    let bytes = 0;
    for (const atlas of deviceAtlases.values()) bytes += atlasBytes(atlas);
    for (const [key, atlas] of deviceAtlases) {
      if (deviceAtlases.size <= 1 || (deviceAtlases.size <= GLYPH_ATLAS_CACHE_LIMIT.atlases && bytes <= GLYPH_ATLAS_CACHE_LIMIT.bytes)) break;
      deviceAtlases.delete(key);
      bytes -= atlasBytes(atlas);
      setTimeout(() => {
        const destroy = () => atlas.texture.destroy();
        void device.queue.onSubmittedWorkDone().then(destroy, destroy);
      }, RETIRE_DELAY_MS);
    }
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

export function releaseGlyphAtlasesForDevice(device: GPUDevice | null): void {
  if (device) runtime.releaseDevice(device);
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: GlyphAtlasHotData) => { data.runtime = runtime; });
}
