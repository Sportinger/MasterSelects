export interface NestedCompositionTexturePair {
  pingTexture: GPUTexture;
  pongTexture: GPUTexture;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  inUse: boolean;
}

/** Reuses a nested composition's intermediate ping-pong render targets. */
export class NestedCompositionTexturePool {
  private readonly pools = new Map<string, NestedCompositionTexturePair[]>();
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  acquire(width: number, height: number): NestedCompositionTexturePair {
    const key = `${width}x${height}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }

    const reusable = pool.find((pair) => !pair.inUse);
    if (reusable) {
      reusable.inUse = true;
      return reusable;
    }

    const createTexture = () => this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const pingTexture = createTexture();
    const pongTexture = createTexture();
    const pair = {
      pingTexture,
      pongTexture,
      pingView: pingTexture.createView(),
      pongView: pongTexture.createView(),
      inUse: true,
    };
    pool.push(pair);
    return pair;
  }

  release(pair: NestedCompositionTexturePair): void {
    pair.inUse = false;
  }

  destroy(): void {
    for (const pool of this.pools.values()) {
      for (const pair of pool) {
        pair.pingTexture.destroy();
        pair.pongTexture.destroy();
      }
    }
    this.pools.clear();
  }
}
