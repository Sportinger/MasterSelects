import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeTemporalRequest } from '../../src/effects/time/NativeTemporalRuntime';
const mocks = vi.hoisted(() => ({ read: vi.fn(), close: vi.fn(), open: vi.fn(), accumulate: vi.fn(), encode: vi.fn() }));
vi.mock('../../src/services/planarTracking/surfaceFrameReader', async importOriginal => ({
  ...await importOriginal<object>(), openSurfaceFrames: mocks.open,
}));
vi.mock('../../src/effects/ImageGraphPassRuntime', () => ({ ImageGraphPassRuntime: class { encode = mocks.encode; dispose() {} } }));
vi.mock('../../src/effects/time/TemporalDemandReadback', () => ({ TemporalDemandReadback: class {
  encode() { return async () => [0, 32, 63]; }
} }));
vi.mock('../../src/effects/time/StreamedTemporalCompositor', () => ({ StreamedTemporalCompositor: class { accumulate = mocks.accumulate; } }));
import { NativeTemporalRuntime } from '../../src/effects/time/NativeTemporalRuntime';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';

function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  mocks.read.mockImplementation(async (time: number) => ({ time, duration: 1 / 64,
    pixels: { width: 2, height: 1, data: new Uint8ClampedArray(8) } }));
  mocks.open.mockResolvedValue({ read: mocks.read, close: mocks.close,
    frames: Array.from({ length: 129 }, (_, i) => ({ time: i / 64, duration: 1 / 64 })) });
  mocks.accumulate.mockResolvedValue(undefined);
  const device = { limits: { maxTextureDimension2D: 8192 }, createTexture: vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() })),
    queue: { writeTexture: vi.fn() } } as unknown as GPUDevice;
  const request: NativeTemporalRequest = { key: 'owner', effectId: 'effect', media: { id: 'video', type: 'video', width: 2, height: 1, url: 'blob:source' } as NativeTemporalRequest['media'],
    source: { mediaId: 'video', localTime: 1, duration: 2, inPoint: 0, outPoint: 2, speed: 1, speedKeyframes: [] },
    horizon: 1, samples: 64, nearest: false, demandPlan: { key: 'demand', values: [], resourceInputs: ['map'] } as unknown as NativeTemporalRequest['demandPlan'],
    externalResources: new Map(), encoder: {} as GPUCommandEncoder, inputView: {} as GPUTextureView, sampler: {} as GPUSampler, timelineTime: 1 };
  return { runtime: new NativeTemporalRuntime(device), request };
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('native temporal streaming', () => {
  it('changes only pixel resolution for small preview, preserving the same source requests', async () => {
    const { runtime, request } = setup();
    mocks.read.mockImplementation(async (time: number) => ({ time, duration: 1 / 64,
      pixels: { width: 160, height: 90, data: new Uint8ClampedArray(160 * 90 * 4) } }));
    const preview = { ...request, media: { ...request.media, width: 1920, height: 1080 }, maxEdge: 160 };
    const finish = collectTemporalPreparations(); runtime.resolve(preview); await Promise.all(finish());
    expect(mocks.read.mock.calls.map(call => call[0])).toEqual([0, 31 / 64, 1]);
    expect(mocks.open.mock.calls[0][3]).toBe(160);
    expect(runtime.resolve(preview)?.atlas).toBeDefined();
    expect(mocks.accumulate.mock.calls.every(call => call[5] === 64)).toBe(true);
    runtime.destroy();
  });
  it('abandons an obsolete paused seek after its current decode instead of completing the old window', async () => {
    const { runtime, request } = setup();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.read.mockImplementationOnce((time: number) => new Promise(resolve => {
      release = () => resolve({ time, duration: 1 / 64, pixels: { width: 2, height: 1, data: new Uint8ClampedArray(8) } });
      entered();
    }));
    const first = collectTemporalPreparations(); runtime.resolve(request); const oldPending = first();
    await started;
    const changed = { ...request, source: { ...request.source, localTime: 1.5 }, timelineTime: 1.5 };
    runtime.resolve(changed);
    release(); await Promise.all(oldPending);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.accumulate).not.toHaveBeenCalled();
    const next = collectTemporalPreparations(); runtime.resolve(changed); await Promise.all(next());
    expect(runtime.resolve(changed)?.atlas).toBeDefined();
    expect(mocks.accumulate).toHaveBeenCalledTimes(3);
    runtime.destroy();
  });
  it('decodes only demanded indices in source order, retaining all 64 temporal positions', async () => {
    const { runtime, request } = setup();
    const finish = collectTemporalPreparations();
    expect(runtime.resolve(request)).toBeUndefined();
    await Promise.all(finish());
    expect(mocks.read.mock.calls.map(call => call[0])).toEqual([0, 31 / 64, 1]);
    expect(mocks.accumulate.mock.calls.map(call => [call[4], call[5], call[7]])).toEqual([[63, 64, false], [32, 64, false], [0, 64, false]]);
    const ready = runtime.resolve(request);
    expect(ready?.atlas).toBeDefined();
    expect(runtime.resolve(request)).toBe(ready);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    runtime.destroy();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('holds the completed image during a new seek while keeping export behind the preparation barrier', async () => {
    const { runtime, request } = setup();
    const first = collectTemporalPreparations(); runtime.resolve(request); await Promise.all(first());
    const ready = runtime.resolve(request);
    const next = collectTemporalPreparations();
    const changed = { ...request, source: { ...request.source, localTime: 1.25 }, timelineTime: 1.25, encoder: {} as GPUCommandEncoder };
    expect(runtime.resolve(changed)).toBe(ready);
    const pending = next(); expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(runtime.resolve(changed)?.atlas.identity).not.toBe(ready?.atlas.identity);
    runtime.destroy();
  });
});
