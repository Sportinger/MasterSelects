// Render target pool for gaussian splat per-layer rendering.
// Pools GPU textures by resolution so they can be reused across frames.

import { Logger } from '../../../services/logger';

const log = Logger.create('SplatRenderTargetPool');

interface PoolEntry {
  texture: GPUTexture;
  view: GPUTextureView;
  inUse: boolean;
}

function resolutionKey(width: number, height: number): string {
  return `${width}x${height}`;
}

export class SplatRenderTargetPool {
  private device: GPUDevice;
  private pool: Map<string, PoolEntry[]> = new Map();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Get or create a render target at the given resolution */
  acquire(width: number, height: number): { texture: GPUTexture; view: GPUTextureView } {
    const key = resolutionKey(width, height);
    const entries = this.pool.get(key);

    // Try to find an unused entry at this resolution
    if (entries) {
      for (const entry of entries) {
        if (!entry.inUse) {
          entry.inUse = true;
          return { texture: entry.texture, view: entry.view };
        }
      }
    }

    // No free entry — create a new texture
    const texture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const view = texture.createView();
    const entry: PoolEntry = { texture, view, inUse: true };

    if (!entries) {
      this.pool.set(key, [entry]);
    } else {
      entries.push(entry);
    }

    log.debug('Created render target', { width, height, poolSize: (entries?.length ?? 0) + (entries ? 0 : 1) });

    return { texture, view };
  }

  /** Mark all targets as available for reuse */
  resetFrame(): void {
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        entry.inUse = false;
      }
    }
  }

  /** Destroy all pooled textures */
  dispose(): void {
    let count = 0;
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        entry.texture.destroy();
        count++;
      }
    }
    this.pool.clear();
    log.info('Disposed render target pool', { destroyedCount: count });
  }
}
