import { ptShaderModule } from '../ptCompute';

/** Edge of one atlas layer; plane and mesh textures are resampled into it (bilinear). */
export const PT_ATLAS_SIZE = 1024;

const BLIT = /* wgsl */`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
@fragment fn fs(in: Out) -> @location(0) vec4f { return textureSampleLevel(source, linearSampler, in.uv, 0.0); }`;

/**
 * Texture atlas of the path tracer: one 1024² layer of an rgba8unorm array per texture source.
 * Layers are assigned per frame by key; a source is resampled again when its version changes
 * (video planes every frame, model textures once). The atlas grows by whole layers.
 */
export class PtTextureAtlas {
  private device: GPUDevice | null = null;
  private texture: GPUTexture | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private placeholder: GPUTexture | null = null;
  private readonly layers = new Map<string, { layer: number; version: string }>();
  private used = new Set<number>();

  private ensure(device: GPUDevice, layers: number): void {
    if (this.device !== device) { this.dispose(); this.device = device; }
    this.sampler ??= device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    if (!this.pipeline) {
      const module = ptShaderModule(device, 'pt-atlas-blit', BLIT);
      this.pipeline = device.createRenderPipeline({ label: 'pt-atlas-blit', layout: 'auto', vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
    }
    const needed = Math.max(1, layers);
    if (this.texture && this.texture.depthOrArrayLayers >= needed) return;
    const capacity = Math.min(device.limits.maxTextureArrayLayers, Math.max(needed, Math.ceil((this.texture?.depthOrArrayLayers ?? 0) * 1.5)));
    const next = device.createTexture({ label: 'pt-texture-atlas', size: [PT_ATLAS_SIZE, PT_ATLAS_SIZE, capacity], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    this.texture?.destroy();
    this.texture = next;
    // Content was lost with the old texture; every source is drawn again.
    this.layers.clear();
  }

  /** Starts a frame for `count` texture sources at most. */
  begin(device: GPUDevice, count: number): void {
    this.ensure(device, count);
    this.used = new Set();
  }

  /**
   * Layer of texture source `key`, resampled from `view` when `version` changed; -1 when the atlas
   * has no room left (the surface then shows its plain color).
   */
  place(encoder: GPUCommandEncoder, key: string, version: string, view: GPUTextureView): number {
    const device = this.device!, texture = this.texture!;
    let entry = this.layers.get(key);
    if (!entry || this.used.has(entry.layer)) {
      let layer = 0;
      const taken = new Set([...this.layers.values()].map(item => item.layer));
      while (layer < texture.depthOrArrayLayers && (taken.has(layer) || this.used.has(layer))) layer++;
      if (layer >= texture.depthOrArrayLayers) {
        // Reuse the least recently placed layer not used this frame.
        const reusable = [...this.layers.entries()].find(([, item]) => !this.used.has(item.layer));
        if (!reusable) return -1;
        this.layers.delete(reusable[0]);
        layer = reusable[1].layer;
      }
      entry = { layer, version: '' };
      this.layers.set(key, entry);
    }
    this.used.add(entry.layer);
    if (entry.version !== version) {
      const pass = encoder.beginRenderPass({ label: `pt-atlas-${key}`, colorAttachments: [{
        view: texture.createView({ dimension: '2d', baseArrayLayer: entry.layer, arrayLayerCount: 1 }),
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pipeline!);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.pipeline!.getBindGroupLayout(0), entries: [
        { binding: 0, resource: view }, { binding: 1, resource: this.sampler! },
      ] }));
      pass.draw(3);
      pass.end();
      entry.version = version;
    }
    return entry.layer;
  }

  view(device: GPUDevice): GPUTextureView {
    if (this.texture) return this.texture.createView({ dimension: '2d-array' });
    this.placeholder ??= device.createTexture({ label: 'pt-texture-atlas-empty', size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
    return this.placeholder.createView({ dimension: '2d-array' });
  }

  get gpuBytes(): number { return this.texture ? PT_ATLAS_SIZE * PT_ATLAS_SIZE * 4 * this.texture.depthOrArrayLayers : 0; }

  dispose(): void {
    this.texture?.destroy(); this.texture = null;
    this.placeholder?.destroy(); this.placeholder = null;
    this.pipeline = null; this.sampler = null; this.device = null;
    this.layers.clear();
  }
}
