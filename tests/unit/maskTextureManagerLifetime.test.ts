import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';

describe('MaskTextureManager frame-scoped lifetime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('evicts inactive nested masks while retaining persistent timeline masks', () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
    const textures = Array.from({ length: 3 }, () => ({
      createView: vi.fn(() => ({} as GPUTextureView)),
      destroy: vi.fn(),
    }));
    const device = {
      createTexture: vi.fn(() => textures.shift()!),
      queue: { writeTexture: vi.fn() },
    } as unknown as GPUDevice;
    const manager = new MaskTextureManager(device);
    const persistentTexture = textures[0];
    const nestedTexture = textures[1];
    const imageData = {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(4 * 4 * 4),
    } as ImageData;

    manager.updateMaskTexture('timeline-mask', imageData);
    manager.updateMaskTexture('nested-mask', imageData);
    manager.markFrameScopedMaskTexture('nested-mask');
    manager.setMaskTextureVersion('nested-mask', 'v1');
    manager.getMaskInfo('nested-mask');

    manager.cleanupPendingFrameScopedTextures();
    expect(nestedTexture.destroy).not.toHaveBeenCalled();

    manager.cleanupPendingFrameScopedTextures();
    expect(nestedTexture.destroy).toHaveBeenCalledOnce();
    expect(persistentTexture.destroy).not.toHaveBeenCalled();
    expect(manager.hasMaskTexture('timeline-mask')).toBe(true);
    expect(manager.hasMaskTexture('nested-mask')).toBe(false);
    expect(manager.hasMaskTextureVersion('nested-mask', 'v1')).toBe(false);

    manager.destroy();
  });
});
