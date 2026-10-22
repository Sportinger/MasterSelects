import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/effects/_shared/glyphAtlasRaster', () => ({
  // A charset starting with "big" stands for a 4096² atlas, "huge" for 8192².
  rasterizeGlyphAtlas: (options: { charset: string }) => {
    const size = options.charset.startsWith('huge') ? 8192 : options.charset.startsWith('big') ? 4096 : 64;
    return { plan: { glyphs: [...options.charset], columns: 1, rows: 1, cellSize: 16, width: size, height: size }, canvas: {} };
  },
}));

import { getGlyphAtlas, GLYPH_ATLAS_CACHE_LIMIT, releaseGlyphAtlasesForDevice } from '../../src/effects/_shared/glyphAtlas';
import type { GlyphAtlasOptions } from '../../src/effects/_shared/glyphAtlasPlan';

function fakeDevice() {
  const textures: Array<{ label: string; destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createTexture: vi.fn(({ label }: { label: string }) => {
      const texture = { label, destroy: vi.fn(), createView: () => ({ label }) };
      textures.push(texture);
      return texture;
    }),
    queue: { copyExternalImageToTexture: vi.fn(), onSubmittedWorkDone: vi.fn(async () => undefined) },
  };
  return { device: device as unknown as GPUDevice, textures, created: device.createTexture };
}
const options = (charset: string): GlyphAtlasOptions => ({ fontFamily: 'monospace', charset, cellSize: 16 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('glyph atlas cache', () => {
  it('keeps a bounded number of atlases per device and destroys the least recently used after the GPU is done', async () => {
    const { device, textures, created } = fakeDevice();
    const limit = GLYPH_ATLAS_CACHE_LIMIT.atlases;
    // A Custom Ramp typed one key at a time.
    for (let index = 0; index < limit + 4; index += 1) getGlyphAtlas(device, options(`ramp-${index}`));
    getGlyphAtlas(device, options('ramp-5'));
    expect(created).toHaveBeenCalledTimes(limit + 4);
    // Evicted textures are not destroyed while the frame being encoded may still bind them.
    expect(textures.filter(texture => texture.destroy.mock.calls.length)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(textures.slice(0, 4).every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(textures.slice(4).some(texture => texture.destroy.mock.calls.length)).toBe(false);
    // A recent atlas is a hit; the evicted oldest one is built again.
    getGlyphAtlas(device, options(`ramp-${limit + 3}`));
    expect(created).toHaveBeenCalledTimes(limit + 4);
    getGlyphAtlas(device, options('ramp-0'));
    expect(created).toHaveBeenCalledTimes(limit + 5);
    releaseGlyphAtlasesForDevice(device);
  });

  it('also bounds the memory of large atlases, but always keeps the newest one', async () => {
    const { device, textures } = fakeDevice();
    // 4096² × 4 bytes = 64 MB each: the byte budget allows two.
    for (const ramp of ['big-a', 'big-b', 'big-c']) getGlyphAtlas(device, options(ramp));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(textures.map(texture => texture.destroy.mock.calls.length)).toEqual([1, 0, 0]);
    const huge = fakeDevice();
    getGlyphAtlas(huge.device, options('huge'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(huge.textures[0].destroy).not.toHaveBeenCalled();
    releaseGlyphAtlasesForDevice(device);
    releaseGlyphAtlasesForDevice(huge.device);
  });
});
