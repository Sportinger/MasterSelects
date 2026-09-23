import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ read: vi.fn(), batches: vi.fn(), close: vi.fn(), upload: vi.fn(), proxySize: vi.fn() }));
vi.mock('../../src/effects/time/SourceProxyDimensions', () => ({ SourceProxyDimensions: class { resolve = mock.proxySize; destroy() {} } }));
vi.mock('../../src/engine/texture/TemporalFrameUploader', () => ({ TemporalFrameUploader: class { upload = mock.upload; destroy() {} } }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: {
  acquire: () => ({ ready: Promise.resolve({ frames: Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, duration: 1 / 30 })) }),
    cancel: vi.fn(), release: mock.close,
    async request({ times, priority, onFrame, proxyFps }: any) {
      mock.batches(times, priority, proxyFps);
      for (const time of [...times].toSorted((a, b) => a - b)) { await mock.read(time); onFrame(proxyFps ? { time, image: {} } : { time }); }
    },
  }),
} }));
import { SourceTemporalRuntime, sourceTemporalWindow } from '../../src/effects/time/SourceTemporalRuntime';
import { collectTemporalPreparations, getTemporalStatus } from '../../src/effects/time/temporalResourcePreparation';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';

function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  mock.read.mockResolvedValue(undefined);
  const writes = vi.fn();
  const createTexture = vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() }));
  const device = { limits: { maxTextureDimension2D: 8192 }, queue: { writeTexture: writes, copyExternalImageToTexture: vi.fn() },
    createTexture } as unknown as GPUDevice;
  const request = { key: 'clip', effectId: 'effect', media: { id: 'media', url: 'blob:media', width: 2, height: 1 },
    source: { mediaId: 'media', localTime: 10, duration: 30, inPoint: 0, outPoint: 30, speed: 1, speedKeyframes: [] },
    horizon: 4, samples: 64, nearest: true, encoder: {} } as SourceTemporalRequest;
  return { runtime: new SourceTemporalRuntime(device), request, writes, createTexture };
}
async function prepare(runtime: SourceTemporalRuntime, request: SourceTemporalRequest) {
  const finish = collectTemporalPreparations(); runtime.resolve(request); await Promise.all(finish());
  return runtime.resolve(request);
}
afterEach(() => { vi.clearAllMocks(); mock.proxySize.mockReset(); vi.unstubAllGlobals(); });

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

it('continuously replenishes lookahead before the current source window runs out', async () => {
  const { runtime, request } = setup();
  const playing = { ...request, horizon: 3.08, samples: 32, keepPending: true };
  await prepare(runtime, playing);
  await vi.waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(35));
  expect(mock.batches.mock.calls.map(call => [call[0].length, call[1]])).toEqual([[31, 'required'], [4, 'prefetch']]);
  for (let i = 1; i <= 240; i++) {
    const finish = collectTemporalPreparations();
    runtime.resolve({ ...playing, source: { ...playing.source, localTime: 10 + i / 30 } });
    expect(finish(), `required cache miss at playback frame ${i}`).toEqual([]);
    // Let low-priority I/O finish between output frames, never wait for required
    // work here: the regression exhausted four prefetched samples periodically.
    for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  }
  expect(mock.batches.mock.calls.filter(call => call[1] === 'required')).toHaveLength(1);
  expect(mock.batches.mock.calls.filter(call => call[1] === 'prefetch').length).toBeGreaterThan(60);
  runtime.destroy();
});

it('starts lookahead when playback resumes from an already prepared paused frame', async () => {
  const { runtime, request } = setup();
  await prepare(runtime, request);
  expect(mock.batches.mock.calls.map(call => call[1])).toEqual(['required']);
  runtime.resolve({ ...request, keepPending: true });
  await vi.waitFor(() => expect(mock.batches.mock.calls.map(call => call[1])).toEqual(['required', 'prefetch']));
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

it('renders native 4K with a fitting sample count and bounds prefetch by actual capacity', async () => {
  const { runtime, request, createTexture } = setup();
  const full = { ...request, media: { ...request.media, width: 3840, height: 2160 }, samples: 16, keepPending: true };
  await prepare(runtime, full);
  await vi.waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(18));
  expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({ size: [3840, 2160, 18] }));
  expect(mock.batches.mock.calls.map(call => [call[0].length, call[1]])).toEqual([[15, 'required'], [3, 'prefetch']]);
  // A later seek still recycles slots; reducing prefetch must not exhaust the atlas.
  await prepare(runtime, { ...full, source: { ...full.source, localTime: 20 } });
  runtime.destroy();
});

it('rejects oversized native requests before allocation and recovers after choosing Small preview', async () => {
  const { runtime, request, createTexture } = setup();
  const full = { ...request, media: { ...request.media, width: 3840, height: 2160 }, samples: 32 };
  expect(() => runtime.resolve(full)).toThrow(/at most 19 samples or Small preview/);
  expect(createTexture).not.toHaveBeenCalled();
  await prepare(runtime, { ...full, maxEdge: 160 });
  expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({ size: [160, 90, 35] }));
  runtime.destroy();
});

it('reallocates for sample-count changes without leaving the previous GPU cache resident', async () => {
  const { runtime, request, createTexture } = setup();
  await prepare(runtime, { ...request, samples: 8 });
  const oldAtlas = createTexture.mock.results[0].value;
  await prepare(runtime, { ...request, samples: 32 });
  expect(oldAtlas.destroy).toHaveBeenCalledOnce();
  expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({ size: [2, 1, 35] }));
  runtime.destroy();
});

it('uses actual full proxy dimensions for a 4K clip with 64 samples and releases them when Proxy is disabled', async () => {
  const { runtime, request, createTexture } = setup();
  mock.proxySize.mockReturnValue({ width: 1280, height: 720 });
  const proxy = { ...request, useProxy: true,
    media: { ...request.media, width: 3840, height: 2160, proxyStatus: 'ready' as const, proxyFps: 30 } };
  await prepare(runtime, proxy);
  expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({ size: [1280, 720, 67] }));
  expect(mock.batches.mock.calls[0][2]).toBe(30);
  expect(getTemporalStatus(request.effectId)).toContain('Full size · Proxy · 1280 × 720');
  const proxyAtlas = createTexture.mock.results[0].value;
  expect(() => runtime.resolve({ ...proxy, useProxy: false })).toThrow(/640 MiB/);
  expect(proxyAtlas.destroy).toHaveBeenCalledOnce();
  await prepare(runtime, { ...proxy, useProxy: false, samples: 16 });
  expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({ size: [3840, 2160, 18] }));
  expect(mock.batches.mock.calls.at(-1)![2]).toBeUndefined();
  expect(getTemporalStatus(request.effectId)).toContain('Full size · Original · 3840 × 2160');
  runtime.destroy();
});
