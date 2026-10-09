import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextureManager } from '../../src/engine/texture/TextureManager';
import { markDynamicCanvasUpdated } from '../../src/services/canvasVersion';
import { planeTextureSourceRevision } from '../../src/engine/native3d/sceneRenderer/planeTextureSources';

describe('TextureManager dynamic canvas sizing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reuses a paused solid in main and target previews, but uploads changed colors and sizes', () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    const device = { createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      queue: { copyExternalImageToTexture: vi.fn() } } as unknown as GPUDevice;
    const manager = new TextureManager(device), canvas = document.createElement('canvas');
    markDynamicCanvasUpdated(canvas, 'solid');
    const first = manager.createCanvasTexture(canvas), revision = planeTextureSourceRevision(canvas);
    manager.createCanvasSourceTexture(canvas); manager.getSourceSizedCanvasTextureView(canvas);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    markDynamicCanvasUpdated(canvas, 'solid');
    expect(planeTextureSourceRevision(canvas)).not.toBe(revision);
    expect(manager.createCanvasTexture(canvas)).toBe(first);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    canvas.width += 1;
    expect(manager.createCanvasTexture(canvas)).not.toBe(first);
    expect(first!.destroy).toHaveBeenCalledOnce();
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(3);
    canvas.dataset.masterselectsDynamic = 'true';
    expect(planeTextureSourceRevision(canvas)).toBeNull();
    manager.createCanvasTexture(canvas); manager.createCanvasTexture(canvas);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(5);
  });

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
