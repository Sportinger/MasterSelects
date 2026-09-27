import { afterEach, expect, it, vi } from 'vitest';
import { loadFlockPigmentBitmap } from '../../src/engine/flock/gpu/flockPigmentBitmap';

afterEach(() => vi.unstubAllGlobals());
it('preserves image dimensions before closing an oversized decode', async () => {
  const probe = { width: 4096, height: 2048, close() { this.width = 0; this.height = 0; } };
  const bitmap = { width: 2048, height: 1024, close: vi.fn() };
  const create = vi.fn().mockResolvedValueOnce(probe).mockResolvedValueOnce(bitmap);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
  vi.stubGlobal('createImageBitmap', create);
  expect(await loadFlockPigmentBitmap('blob:test')).toBe(bitmap);
  expect(create.mock.calls[1][1]).toEqual({ resizeWidth: 2048, resizeHeight: 1024, resizeQuality: 'high' });
  expect(probe.width).toBe(0);
});
