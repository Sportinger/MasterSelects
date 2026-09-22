import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ read: vi.fn(), batches: vi.fn(), close: vi.fn(), upload: vi.fn() }));
vi.mock('../../src/engine/texture/TemporalFrameUploader', () => ({ TemporalFrameUploader: class { upload = mock.upload; } }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: {
  acquire: () => ({ ready: Promise.resolve({ frames: Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, duration: 1 / 30 })) }),
    cancel: vi.fn(), release: mock.close,
    async request({ times, priority, onFrame }: any) {
      mock.batches(times, priority);
      for (const time of [...times].toSorted((a, b) => a - b)) { await mock.read(time); onFrame({ time }); }
    },
  }),
} }));
import { SourceTemporalRuntime, sourceTemporalWindow } from '../../src/effects/time/SourceTemporalRuntime';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';

function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  mock.read.mockResolvedValue(undefined);
  const writes = vi.fn();
  const device = { limits: { maxTextureDimension2D: 8192 }, queue: { writeTexture: writes, copyExternalImageToTexture: vi.fn() },
    createTexture: () => ({ createView: () => ({}), destroy() {} }) } as unknown as GPUDevice;
  const request = { key: 'clip', effectId: 'effect', media: { id: 'media', url: 'blob:media', width: 2, height: 1 },
    source: { mediaId: 'media', localTime: 10, duration: 30, inPoint: 0, outPoint: 30, speed: 1, speedKeyframes: [] },
    horizon: 4, samples: 64, nearest: true, encoder: {} } as SourceTemporalRequest;
  return { runtime: new SourceTemporalRuntime(device), request, writes };
}
async function prepare(runtime: SourceTemporalRuntime, request: SourceTemporalRequest) {
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
  expect(mock.batches.mock.calls[0][0]).toHaveLength(63);
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
  expect(sourceTemporalWindow({ ...request, maxEdge: 160 } as SourceTemporalRequest)).toEqual(sourceTemporalWindow(request));
  runtime.destroy();
});

 it('schedules four future samples below required work without blocking the preparation barrier', async () => {
  const { runtime, request } = setup();
  const playing = { ...request, keepPending: true };
  await prepare(runtime, playing);
  await vi.waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(67));
  expect(mock.batches.mock.calls.map(call => [call[0].length, call[1]])).toEqual([[63, 'required'], [4, 'prefetch']]);
  for (let i = 1; i <= 7; i++) await prepare(runtime, { ...playing, source: { ...playing.source, localTime: 10 + i / 30 } });
  expect(mock.batches).toHaveBeenCalledTimes(2);
  runtime.destroy();
});

it('uploads each source PTS once and retains it across repeated renders', async () => {
  const { runtime, request } = setup();
  await prepare(runtime, request);
  const uploads = mock.upload.mock.calls.length;
  await prepare(runtime, request);
  await prepare(runtime, request);
  expect(mock.upload).toHaveBeenCalledTimes(uploads);
  runtime.destroy();
  expect(mock.close).toHaveBeenCalledTimes(1);
});
