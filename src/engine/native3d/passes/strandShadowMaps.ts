import { STRAND_SHADOW_MAP_SIZE } from './strandShadowLight';

const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
const OPACITY_FORMAT: GPUTextureFormat = 'rgba16float';
/** Layers with shadow maps kept across frames, least recently used first. */
const MAP_LIMIT = 6;

/** `occluders`: nearest opaque mesh seen from a scene light, when meshes cast onto the strands. */
export interface StrandShadowTargets { depth: GPUTextureView; opacity: GPUTextureView; occluders?: GPUTextureView }
interface ShadowEntry { depth: GPUTexture; opacity: GPUTexture; occluders?: GPUTexture; views: StrandShadowTargets }

/**
 * Light depth and deep opacity textures per strand layer, plus 1 × 1 stand-ins bound while a map is
 * itself the render target or a layer has no shadow.
 */
export class StrandShadowMaps {
  private readonly maps = new Map<string, ShadowEntry>();
  private fallback: StrandShadowTargets | null = null;
  private fallbackTextures: GPUTexture[] = [];
  private sampler: GPUSampler | null = null;

  static readonly depthFormat = DEPTH_FORMAT;
  static readonly opacityFormat = OPACITY_FORMAT;

  shadowSampler(device: GPUDevice): GPUSampler {
    return this.sampler ??= device.createSampler({ label: 'native-strands-shadow', magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  }

  empty(device: GPUDevice): StrandShadowTargets {
    if (!this.fallback) {
      const texture = (format: GPUTextureFormat) => device.createTexture({ label: `native-strands-shadow-empty-${format}`,
        size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
      this.fallbackTextures = [texture(DEPTH_FORMAT), texture(OPACITY_FORMAT)];
      this.fallback = { depth: this.fallbackTextures[0].createView(), opacity: this.fallbackTextures[1].createView() };
    }
    return this.fallback;
  }

  targets(device: GPUDevice, layerId: string): StrandShadowTargets {
    return this.entry(device, layerId).views;
  }

  /** Mesh occluder depth of a layer's shadowing light; created when meshes first cast onto it. */
  occluders(device: GPUDevice, layerId: string): GPUTextureView {
    const entry = this.entry(device, layerId);
    entry.occluders ??= device.createTexture({ label: `native-strands-shadow-occluders-${layerId}`,
      size: [STRAND_SHADOW_MAP_SIZE, STRAND_SHADOW_MAP_SIZE], format: DEPTH_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    return entry.occluders.createView();
  }

  private entry(device: GPUDevice, layerId: string): ShadowEntry {
    let entry = this.maps.get(layerId);
    if (entry) this.maps.delete(layerId);
    else {
      const texture = (format: GPUTextureFormat) => device.createTexture({ label: `native-strands-shadow-${format}-${layerId}`,
        size: [STRAND_SHADOW_MAP_SIZE, STRAND_SHADOW_MAP_SIZE], format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
      const depth = texture(DEPTH_FORMAT), opacity = texture(OPACITY_FORMAT);
      entry = { depth, opacity, views: { depth: depth.createView(), opacity: opacity.createView() } };
    }
    this.maps.set(layerId, entry);
    while (this.maps.size > MAP_LIMIT) {
      const [oldest, retired] = this.maps.entries().next().value!;
      this.maps.delete(oldest);
      retired.depth.destroy(); retired.opacity.destroy(); retired.occluders?.destroy();
    }
    return entry;
  }

  dispose(): void {
    for (const entry of this.maps.values()) { entry.depth.destroy(); entry.opacity.destroy(); entry.occluders?.destroy(); }
    this.maps.clear();
    for (const texture of this.fallbackTextures) texture.destroy();
    this.fallbackTextures = [];
    this.fallback = null;
    this.sampler = null;
  }
}
