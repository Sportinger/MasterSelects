import { afterEach, describe, expect, it, vi } from 'vitest';
import { BYTE_TEXTURE_CACHE_MAX_ENTRIES, ByteTextureCache } from '../../src/effects/_shared/byteTexture';

describe('ByteTextureCache immutable uploads', () => {
  const previousUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
  afterEach(() => {
    if (previousUsage === undefined) delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    else Object.defineProperty(globalThis, 'GPUTextureUsage', { configurable: true, value: previousUsage });
  });

  function fixture() {
    Object.defineProperty(globalThis, 'GPUTextureUsage', { configurable: true, value: { TEXTURE_BINDING: 1, COPY_DST: 2 } });
    let next = 0;
    const textures: Array<{ id: number; destroy: ReturnType<typeof vi.fn>; createView: ReturnType<typeof vi.fn> }> = [];
    const device = {
      createTexture: vi.fn(() => {
        const texture = { id: ++next, destroy: vi.fn(), createView: vi.fn(() => ({ textureId: next })) };
        textures.push(texture); return texture;
      }),
      queue: { writeTexture: vi.fn() },
    } as unknown as GPUDevice;
    return { cache: new ByteTextureCache(device), device, textures };
  }

  const upload = (version: string, width = 2, height = 1) => ({ version, width, height, data: new Uint8Array(width * height * 4) });

  it('keeps versions and resizes immutable while reusing an identical upload', () => {
    const { cache, device, textures } = fixture();
    const first = cache.getView('scope', upload('one'));
    expect(cache.getView('scope', upload('one'))).toBe(first);
    const second = cache.getView('scope', upload('two'));
    const resized = cache.getView('scope', upload('two', 3, 1));
    expect(second).not.toBe(first); expect(resized).not.toBe(second);
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(3);
    expect(textures.every(texture => !texture.destroy.mock.calls.length)).toBe(true);
    cache.destroy();
    expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('bounds LRU ownership without destroying potentially in-flight evictions', () => {
    const { cache, textures } = fixture();
    const first = cache.getView('scope', upload('v0', 1, 1));
    for (let index = 1; index <= BYTE_TEXTURE_CACHE_MAX_ENTRIES; index += 1) cache.getView('scope', upload(`v${index}`, 1, 1));
    expect((cache as unknown as { entries: Map<string, unknown> }).entries.size).toBe(BYTE_TEXTURE_CACHE_MAX_ENTRIES);
    expect(textures[0].destroy).not.toHaveBeenCalled();
    expect(cache.getView('scope', upload('v0', 1, 1))).not.toBe(first);
  });

  it('rejects invalid dimensions and undersized providers instead of silently clamping', () => {
    const { cache } = fixture();
    expect(() => cache.getView('scope', upload('bad', 0, 1))).toThrow(/dimensions/);
    expect(() => cache.getView('scope', { ...upload('short'), data: new Uint8Array(3) })).toThrow(/needs 8 bytes/);
  });
});
