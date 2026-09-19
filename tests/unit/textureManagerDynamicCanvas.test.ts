import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextureManager } from '../../src/engine/texture/TextureManager';

describe('TextureManager dynamic canvas sizing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('recreates a cached live canvas texture after an orientation size change', () => {
    vi.stubGlobal('GPUTextureUsage', {
      TEXTURE_BINDING: 1,
      COPY_DST: 2,
      RENDER_ATTACHMENT: 4,
    });
    const firstTexture = {
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    } as unknown as GPUTexture;
    const secondTexture = {
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    } as unknown as GPUTexture;
    const device = {
      createTexture: vi.fn()
        .mockReturnValueOnce(firstTexture)
        .mockReturnValueOnce(secondTexture),
      queue: {
        copyExternalImageToTexture: vi.fn(),
      },
    } as unknown as GPUDevice;
    const manager = new TextureManager(device);
    const canvas = document.createElement('canvas');
    canvas.dataset.masterselectsDynamic = 'true';
    canvas.width = 1920;
    canvas.height = 1080;

    expect(manager.createCanvasTexture(canvas)).toBe(firstTexture);
    canvas.width = 1080;
    canvas.height = 1920;
    expect(manager.createCanvasTexture(canvas)).toBe(secondTexture);

    expect(firstTexture.destroy).toHaveBeenCalledOnce();
    expect(device.createTexture).toHaveBeenCalledTimes(2);
    expect(device.createTexture).toHaveBeenLastCalledWith(expect.objectContaining({
      size: [1080, 1920],
    }));
  });
});
