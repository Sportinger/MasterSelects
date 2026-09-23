import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { TimeMapMediaRuntime } from '../../src/effects/time/TimeMapMediaRuntime';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';

const mocks = vi.hoisted(() => ({ acquire: vi.fn(), upload: vi.fn(), destroy: vi.fn() }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: { acquire: mocks.acquire } }));
vi.mock('../../src/engine/texture/TemporalFrameUploader', () => ({ TemporalFrameUploader: class {
  upload = mocks.upload; destroy = mocks.destroy;
} }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
function setup(fail = false) {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  const release = vi.fn(), surface = { time: 1.25 };
  const request = vi.fn(async ({ onFrame }) => { if (fail) throw new Error('decode failed'); onFrame(surface); });
  mocks.acquire.mockReturnValue({ ready: Promise.resolve({ width: 1920, height: 1080 }), request, release });
  const textures: Array<{ destroy: ReturnType<typeof vi.fn>; createView: () => GPUTextureView }> = [];
  const createTexture = vi.fn((_descriptor: GPUTextureDescriptor) => { const texture = { destroy: vi.fn(), createView: () => ({} as GPUTextureView) }; textures.push(texture); return texture; });
  const runtime = new TimeMapMediaRuntime({ createTexture } as unknown as GPUDevice);
  const media = { id: 'map', url: 'blob:map', type: 'video' } as MediaFile;
  const resolve = (matrix?: number[]) => runtime.resolve('owner', 'effect', media, 1.27, {} as GPUCommandEncoder, matrix);
  return { runtime, resolve, release, request, surface, textures, createTexture };
}
describe('video time map shared frame access', () => {
  it('uploads borrowed frames directly, bounds resolution, and keys transformed results', async () => {
    const s = setup(), matrix = [1, 0, .1, 0, 1, 0, 0, 0, 1];
    const finish = collectTemporalPreparations();
    expect(s.resolve(matrix)).toBeUndefined();
    await Promise.all(finish());
    expect(s.createTexture.mock.calls[0][0]).toMatchObject({ size: [640, 360], usage: 7 });
    expect(mocks.upload).toHaveBeenCalledWith(s.surface, s.textures[0], 0, matrix);
    expect(s.resolve(matrix)?.identity).toContain('map:1.25:');
    expect(s.request).toHaveBeenCalledOnce();
    const next = collectTemporalPreparations();
    expect(s.resolve()).toBeUndefined();
    await Promise.all(next());
    expect(s.textures[0].destroy).toHaveBeenCalledOnce();
    s.runtime.destroy();
    expect(s.release).toHaveBeenCalledOnce();
    expect(s.textures[1].destroy).toHaveBeenCalledOnce();
  });
  it('rejects preparation and releases failed allocations instead of returning a stale map', async () => {
    const s = setup(true), finish = collectTemporalPreparations();
    s.resolve();
    await expect(Promise.all(finish())).rejects.toThrow('decode failed');
    expect(s.textures[0].destroy).toHaveBeenCalledOnce();
    expect(() => s.resolve()).toThrow('decode failed');
    s.runtime.destroy();
  });
});

