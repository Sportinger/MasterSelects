import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ read: vi.fn(), close: vi.fn() }));
vi.mock('../../src/services/planarTracking/surfaceFrameReader', async original => ({
  ...await original<object>(), openSurfaceFrames: async () => ({ read: mock.read, close: mock.close,
    frames: Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, duration: 1 / 30 })) }),
}));
import { SourceTemporalRuntime, sourceTemporalWindow } from '../../src/effects/time/SourceTemporalRuntime';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import type { NativeTemporalRequest } from '../../src/effects/time/NativeTemporalRuntime';

function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  mock.read.mockImplementation(async time => ({ time, duration: 1 / 30, pixels: { width: 2, height: 1, data: new Uint8ClampedArray(8) } }));
  const writes = vi.fn();
  const device = { limits: { maxTextureDimension2D: 8192 }, queue: { writeTexture: writes },
    createTexture: () => ({ createView: () => ({}), destroy() {} }) } as unknown as GPUDevice;
  const request = { key: 'clip', effectId: 'effect', media: { id: 'media', url: 'blob:media', width: 2, height: 1 },
    source: { mediaId: 'media', localTime: 10, duration: 30, inPoint: 0, outPoint: 30, speed: 1, speedKeyframes: [] },
    horizon: 4, samples: 64, nearest: true, encoder: {} } as NativeTemporalRequest;
  return { runtime: new SourceTemporalRuntime(device), request, writes };
}
async function prepare(runtime: SourceTemporalRuntime, request: NativeTemporalRequest) {
  const finish = collectTemporalPreparations(); runtime.resolve(request); await Promise.all(finish());
  return runtime.resolve(request);
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('reuses historical PTS during playback instead of decoding the whole window each output frame', async () => {
  const { runtime, request } = setup();
  await prepare(runtime, request);
  const initial = mock.read.mock.calls.length;
  for (let i = 1; i <= 30; i++) await prepare(runtime, { ...request, source: { ...request.source, localTime: 10 + i / 30 } });
  expect(initial).toBe(63);
  expect(mock.read.mock.calls.length - initial).toBeLessThanOrEqual(16);
  runtime.destroy();
});

it('produces identical window metadata after direct seek and sequential playback', async () => {
  const first = setup();
  await prepare(first.runtime, first.request);
  const target = { ...first.request, source: { ...first.request.source, localTime: 11 } };
  await prepare(first.runtime, target);
  const sequential = sourceTemporalWindow(target);
  const second = setup();
  await prepare(second.runtime, target);
  expect(sourceTemporalWindow(target)).toEqual(sequential);
  const uploadedTimes = mock.read.mock.calls.slice(-63).map(call => call[0]);
  expect(uploadedTimes).toEqual([...new Set(sequential.map(sample => Math.floor(sample.time * 30 + 1e-5) / 30))].toSorted((a, b) => a - b));
  first.runtime.destroy(); second.runtime.destroy();
});

it('preserves source selection in small/full modes and reverse clips', () => {
  const { request, runtime } = setup();
  const reverse = { ...request, source: { ...request.source, speed: -1 } };
  expect(sourceTemporalWindow(reverse)[0].time).toBeLessThan(sourceTemporalWindow(reverse).at(-1)!.time);
  expect(sourceTemporalWindow({ ...request, maxEdge: 160 } as NativeTemporalRequest)).toEqual(sourceTemporalWindow(request));
  runtime.destroy();
});
