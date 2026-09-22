import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TemporalClipSource } from '../../src/effects/time/temporalClipSource';
const decoder = vi.hoisted(() => ({ open: vi.fn(), prepare: vi.fn(), close: vi.fn() }));
vi.mock('../../src/effects/time/openPreparedFrameCache', () => ({ openPreparedFrameCache: decoder.open }));
import { PreparedInputHistoryRuntime } from '../../src/effects/time/PreparedInputHistoryRuntime';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';

const source: TemporalClipSource = { mediaId: 'video', localTime: 2, duration: 5,
  inPoint: 10, outPoint: 20, speed: 2, speedKeyframes: [] };
const media = { id: 'video', type: 'video', url: 'blob:video' } as MediaFile;
function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  decoder.prepare.mockImplementation(async (times: number[]) => times.map(time => ({ time, duration: 0.04,
    pixels: { width: 2, height: 1, data: new Uint8ClampedArray(8).fill(time) } })));
  decoder.open.mockResolvedValue({ prepare: decoder.prepare, close: decoder.close });
  const textures: { destroy: ReturnType<typeof vi.fn>; createView: ReturnType<typeof vi.fn> }[] = [];
  const device = { createTexture: vi.fn(() => {
    const texture = { destroy: vi.fn(), createView: vi.fn(() => ({})) }; textures.push(texture); return texture;
  }), queue: { writeTexture: vi.fn() } };
  return { runtime: new PreparedInputHistoryRuntime(device as unknown as GPUDevice), device, textures };
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('prepared source GPU history', () => {
  it('prepares exact source requests before exposing an atlas and reuses a completed seek', async () => {
    const { runtime, device, textures } = setup();
    const finish = collectTemporalPreparations();
    expect(runtime.resolve('owner', 'effect', media, source, 2, 3, 160, {} as GPUCommandEncoder)).toBeUndefined();
    const pending = finish();
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(decoder.prepare.mock.calls[0][0]).toEqual([14, 12, 10]);
    const ready = runtime.resolve('owner', 'effect', media, source, 2, 3, 160, {} as GPUCommandEncoder);
    expect(ready?.atlas.view).toBeDefined();
    expect(decoder.prepare).toHaveBeenCalledTimes(1);
    expect(device.createTexture).toHaveBeenCalledTimes(2);
    const metadata = device.queue.writeTexture.mock.calls[3][1] as Float32Array;
    expect([metadata[0], metadata[4], metadata[8], metadata[256], metadata[258], metadata[259]]).toEqual([0, 1, 2, 3, 1, 2]);
    runtime.destroy();
    expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(decoder.close).toHaveBeenCalledTimes(1);
  });

  it('fails the export preparation promise on decoder error and rejects allocations over budget', async () => {
    const { runtime, device } = setup();
    decoder.prepare.mockRejectedValueOnce(new Error('corrupt source'));
    const finish = collectTemporalPreparations();
    runtime.resolve('owner', 'effect', media, source, 2, 3, 160, {} as GPUCommandEncoder);
    await expect(Promise.all(finish())).rejects.toThrow('corrupt source');
    expect(() => runtime.resolve('owner', 'effect', media, source, 2, 3, 160, {} as GPUCommandEncoder)).toThrow('corrupt source');
    expect(() => runtime.resolve('large', 'effect', media, source, 2, 64, 1920, {} as GPUCommandEncoder)).toThrow(/budget/);
    expect(device.createTexture).not.toHaveBeenCalled();
    runtime.destroy();
  });
});
