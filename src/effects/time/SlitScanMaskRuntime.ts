import type { ClipMask } from '../../types/masks';
import { createMaskTextureRasterKey, generateMaskTexture } from '../../utils/maskRenderer';
import { inputHistorySize } from './InputHistoryClock';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';

interface MaskEntry { texture: GPUTexture; view: GPUTextureView; identity: string; encoder: GPUCommandEncoder }

/** Borrows already animated masks in clip coordinates; never reads mutable project state. */
export class SlitScanMaskRuntime {
  private readonly device: GPUDevice;
  private entries = new Map<string, MaskEntry>();
  private empty?: GPUTexture;
  private retiredRevision = 0;
  constructor(device: GPUDevice) { this.device = device; }

  resolve(key: string, maskId: unknown, masks: readonly ClipMask[] | undefined,
    width: number, height: number, encoder: GPUCommandEncoder): ResolvedImageGraphExternalResource {
    if (typeof maskId !== 'string' || !maskId) {
      if (!this.empty) {
        this.empty = this.device.createTexture({ size: [1, 1], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        this.device.queue.writeTexture({ texture: this.empty }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);
      }
      return { view: this.empty.createView(), identity: 'slit-scan:no-protection' };
    }
    const mask = masks?.find(item => item.id === maskId);
    if (!mask) throw new Error('Slit Scan protection mask is unavailable for this source. Select an existing clip mask.');
    const [w, h] = inputHistorySize(width, height);
    const selected = [{ ...mask, mode: 'add' as const }];
    const options = { purpose: 'effect' as const, featherScale: w / width };
    const identity = createMaskTextureRasterKey(selected, w, h, options);
    let entry = this.entries.get(key);
    if (entry?.identity === identity) { entry.encoder = encoder; return entry; }
    // Destroy only textures which cannot be referenced by this unsubmitted encoder.
    // For repeat rendering in one encoder keep the old entry until a later frame.
    if (entry) {
      this.entries.delete(key);
      if (entry.encoder === encoder) this.entries.set(`${key}:retired:${++this.retiredRevision}`, entry);
      else entry.texture.destroy();
    }
    if (this.entries.size >= 16) {
      const oldest = [...this.entries].find(([, item]) => item.encoder !== encoder);
      if (!oldest) throw new Error('Slit Scan mask texture budget exhausted in this frame.');
      oldest[1].texture.destroy(); this.entries.delete(oldest[0]);
    }
    const pixels = generateMaskTexture(selected, w, h, options);
    if (!pixels) return this.resolve(key, '', undefined, width, height, encoder);
    const texture = this.device.createTexture({ label: 'slit-scan-protection', size: [w, h], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture }, pixels.data as Uint8ClampedArray<ArrayBuffer>, { bytesPerRow: w * 4 }, [w, h]);
    entry = { texture, view: texture.createView(), identity, encoder };
    this.entries.set(key, entry);
    return entry;
  }

  destroy() {
    for (const entry of this.entries.values()) entry.texture.destroy();
    this.entries.clear(); this.empty?.destroy(); this.empty = undefined;
  }
}
