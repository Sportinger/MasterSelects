import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrubTextureCache } from '../../src/engine/texture/scrubbingCache/scrubTextureCache';
import { resolveCachedScrubFrameSize } from '../../src/engine/render/compositeSourceSize';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function cacheWithGpu(): ScrubTextureCache {
  const device = {
    createTexture: vi.fn(({ size }: { size: [number, number] }) => ({
      width: size[0], height: size[1], destroy: vi.fn(), createView: vi.fn(() => ({})),
    })),
    pushErrorScope: vi.fn(), popErrorScope: vi.fn(() => Promise.resolve(null)),
    queue: { copyExternalImageToTexture: vi.fn(), writeTexture: vi.fn() },
  };
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  return new ScrubTextureCache(device as unknown as GPUDevice);
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('scrub cache source size', () => {
  it('reports the video size for a downscaled background frame, so a fresh element places it at full scale', async () => {
    const cache = cacheWithGpu();
    const bitmap = { width: 960, height: 540, close: vi.fn() } as unknown as ImageBitmap;
    cache.addBackgroundFrame(bitmap, 'blob:clip', 0, true, { width: 1920, height: 1080 });
    await flush();
    const entry = cache.getCachedFrameEntry('blob:clip', 0);
    expect(entry).toMatchObject({ width: 960, height: 540, sourceWidth: 1920, sourceHeight: 1080 });
    expect(resolveCachedScrubFrameSize({ videoWidth: 0, videoHeight: 0 }, { source: { type: 'video' } } as never, entry))
      .toEqual({ width: 1920, height: 1080 });
  });

  it('keeps a bitmap without a known source size on the texture size, and forgets sizes on clear', async () => {
    const cache = cacheWithGpu();
    cache.addFrameFromSource({ width: 4, height: 2 } as unknown as ImageBitmap, 'blob:other', 0, 4, 2);
    await flush();
    expect(cache.getCachedFrameEntry('blob:other', 0)?.sourceWidth).toBeUndefined();
    cache.addFrameFromSource({ videoWidth: 8, videoHeight: 4 } as unknown as HTMLVideoElement, 'blob:video', 0, 8, 4);
    await flush();
    expect(cache.getCachedFrameEntry('blob:video', 0)).toMatchObject({ sourceWidth: 8, sourceHeight: 4 });
    cache.clear('blob:video');
    cache.addBackgroundFrame({ width: 4, height: 2, close: vi.fn() } as unknown as ImageBitmap, 'blob:video', 0, true);
    await flush();
    expect(cache.getCachedFrameEntry('blob:video', 0)?.sourceWidth).toBeUndefined();
  });
});
