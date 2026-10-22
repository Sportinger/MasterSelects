import { glyphAtlasCacheKey, type GlyphAtlasOptions, type GlyphAtlasPlan } from './glyphAtlasPlan';
import { rasterizeGlyphAtlas } from './glyphAtlasRaster';
import { Logger } from '../../services/logger';
export { glyphAtlasCacheKey, planGlyphAtlas } from './glyphAtlasPlan';
export type { GlyphAtlasOptions, GlyphAtlasPlan } from './glyphAtlasPlan';

export interface GlyphAtlasTexture extends GlyphAtlasPlan {
  texture: GPUTexture;
  view: GPUTextureView;
}

/**
 * Atlases kept per device, least recently used evicted first: a Custom Ramp builds one atlas per
 * keystroke, and each costs width × height × 4 bytes of GPU memory. `atlases` is the starting count;
 * a device whose frames use more atlases at once raises its own count (see THRASH_WINDOW_MS).
 */
export const GLYPH_ATLAS_CACHE_LIMIT = Object.freeze({ atlases: 16, maxAtlases: 64, bytes: 128 * 1024 * 1024 });
/** An evicted atlas may still be bound by commands of the frame being encoded; it is destroyed after that work. */
const RETIRE_DELAY_MS = 1_000;
/** An atlas asked for again this soon after its eviction is in use every frame: the cache is thrashing. */
const THRASH_WINDOW_MS = 1_000;
const atlasBytes = (atlas: GlyphAtlasPlan) => atlas.width * atlas.height * 4;
const log = Logger.create('GlyphAtlas');

interface DeviceAtlases {
  atlases: Map<string, GlyphAtlasTexture>;
  /** Count limit of this device: starts at GLYPH_ATLAS_CACHE_LIMIT.atlases, doubles on thrash up to maxAtlases. */
  limit: number;
  /** Recently evicted keys and when (bounded), to notice an atlas rebuilt right after its eviction. */
  evicted: Map<string, number>;
  warnedAtMax: boolean;
}

class GlyphAtlasRuntime {
  private devices = new Map<GPUDevice, DeviceAtlases>();

  get(device: GPUDevice, options: GlyphAtlasOptions): GlyphAtlasTexture {
    let state = this.devices.get(device);
    if (!state) {
      state = { atlases: new Map(), limit: GLYPH_ATLAS_CACHE_LIMIT.atlases, evicted: new Map(), warnedAtMax: false };
      this.devices.set(device, state);
    }
    const deviceAtlases = state.atlases;
    const key = glyphAtlasCacheKey(options);
    const cached = deviceAtlases.get(key);
    if (cached) {
      // Map order is the use order: move the hit to the end.
      deviceAtlases.delete(key);
      deviceAtlases.set(key, cached);
      return cached;
    }
    this.noteThrash(state, key);

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
    this.evict(device, state);
    return atlas;
  }

  /**
   * More glyph looks or ramps on screen than the count limit would rebuild atlases every frame (canvas
   * rasterising and an upload each). The device's count limit doubles instead, up to maxAtlases; past
   * that, or when the byte budget is what evicts, it says once that atlases are being rebuilt.
   */
  private noteThrash(state: DeviceAtlases, key: string): void {
    const evictedAt = state.evicted.get(key);
    if (evictedAt === undefined || Date.now() - evictedAt > THRASH_WINDOW_MS) return;
    const bytes = [...state.atlases.values()].reduce((sum, atlas) => sum + atlasBytes(atlas), 0);
    if (state.limit < GLYPH_ATLAS_CACHE_LIMIT.maxAtlases && bytes <= GLYPH_ATLAS_CACHE_LIMIT.bytes) {
      state.limit = Math.min(GLYPH_ATLAS_CACHE_LIMIT.maxAtlases, state.limit * 2);
      log.warn(`More than ${state.limit / 2} glyph atlases are in use at once; this device now keeps up to ${state.limit}, so they are not rebuilt every frame.`);
    } else if (!state.warnedAtMax) {
      state.warnedAtMax = true;
      log.warn(`Glyph atlases are rebuilt every frame: more than ${state.limit} atlases or ${GLYPH_ATLAS_CACHE_LIMIT.bytes / 1024 / 1024} MB are in use at once. Fewer glyph looks or ramps, or smaller cells, avoid it.`);
    }
  }

  /** Drops the least recently used atlases beyond the limits; the newest one always stays. */
  private evict(device: GPUDevice, state: DeviceAtlases): void {
    const deviceAtlases = state.atlases;
    let bytes = 0;
    for (const atlas of deviceAtlases.values()) bytes += atlasBytes(atlas);
    for (const [key, atlas] of deviceAtlases) {
      if (deviceAtlases.size <= 1 || (deviceAtlases.size <= state.limit && bytes <= GLYPH_ATLAS_CACHE_LIMIT.bytes)) break;
      deviceAtlases.delete(key);
      bytes -= atlasBytes(atlas);
      state.evicted.delete(key);
      state.evicted.set(key, Date.now());
      if (state.evicted.size > GLYPH_ATLAS_CACHE_LIMIT.maxAtlases) state.evicted.delete(state.evicted.keys().next().value!);
      setTimeout(() => {
        const destroy = () => atlas.texture.destroy();
        void device.queue.onSubmittedWorkDone().then(destroy, destroy);
      }, RETIRE_DELAY_MS);
    }
  }

  releaseDevice(device: GPUDevice): void {
    const state = this.devices.get(device);
    if (!state) return;
    for (const atlas of state.atlases.values()) atlas.texture.destroy();
    this.devices.delete(device);
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
