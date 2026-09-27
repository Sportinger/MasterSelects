import type { FlockRenderAssets } from './FlockRenderAssets';
import type { FlockMeshData } from './flockMeshes';

/** Device-local resources populated from transferred host assets, with no stores or DOM. */
export class FlockGpuAssetRegistry implements FlockRenderAssets {
  private readonly pigments = new Map<string, GPUTexture>();
  private readonly models = new Map<string, { mesh: FlockMeshData; revision: number }>();
  private readonly fallback: GPUTexture;
  private readonly sampler: GPUSampler;
  private revision = 0;
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
    this.fallback = device.createTexture({ size: [1, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'flock-asset-fallback' });
    device.queue.writeTexture({ texture: this.fallback }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  /** Caller retains bitmap ownership and closes it after this synchronous upload. */
  setPigment(assetId: string, bitmap: ImageBitmap): void {
    const texture = this.device.createTexture({ size: [bitmap.width, bitmap.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: `flock-asset-${assetId}` });
    try { this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]); }
    catch (error) { texture.destroy(); throw error; }
    const old = this.pigments.get(assetId);
    this.pigments.set(assetId, texture);
    if (old) this.retire(old);
  }

  setModel(assetId: string, mesh: FlockMeshData): void {
    this.models.set(assetId, { mesh, revision: ++this.revision });
  }

  model(assetId: string): { mesh?: FlockMeshData; revision?: number } {
    return this.models.get(assetId) ?? {};
  }

  pigment(assetId: string): { view: GPUTextureView; sampler: GPUSampler } {
    return { view: (this.pigments.get(assetId) ?? this.fallback).createView(), sampler: this.sampler };
  }

  remove(assetId: string): void {
    const texture = this.pigments.get(assetId);
    this.pigments.delete(assetId); this.models.delete(assetId);
    if (texture) this.retire(texture);
  }

  private retire(texture: GPUTexture): void {
    void this.device.queue.onSubmittedWorkDone().then(() => texture.destroy(), () => texture.destroy());
  }

  dispose(): void {
    for (const texture of this.pigments.values()) this.retire(texture);
    this.pigments.clear(); this.models.clear(); this.retire(this.fallback);
  }
}
