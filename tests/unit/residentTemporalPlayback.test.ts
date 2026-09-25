import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ jobs: [] as any[], upload: vi.fn(), cancel: vi.fn() }));
vi.mock('../../src/engine/texture/TemporalFrameUploader', () => ({ TemporalFrameUploader: class {
  upload = mock.upload; destroy() {}
} }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: {
  acquire: () => ({ ready: Promise.resolve({ frames: Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, duration: 1 / 30 })) }),
    cancel: mock.cancel, release: vi.fn(), request: (job: any) => new Promise<void>(resolve => mock.jobs.push({ ...job, resolve })),
  }),
} }));
import { ResidentTemporalRuntime } from '../../src/effects/time/ResidentTemporalRuntime';
import { hybridTemporalWindow } from '../../src/effects/time/hybridTemporalWindow';
import { residentTemporalLookahead } from '../../src/effects/time/residentTemporalLookahead';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';

const frames = Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, duration: 1 / 30 }));
const request = { key: 'clip', effectId: 'scan', media: { id: 'video', url: 'blob:video', width: 8, height: 4 },
  source: { mediaId: 'video', localTime: 5, duration: 30, inPoint: 0, outPoint: 30, speed: 1, speedKeyframes: [] },
  samples: 1920, horizon: 1, nearest: true, encoder: {}, currentInput: { view: {}, width: 8, height: 4 },
  reserveFrames: 64, keepPending: true } as SourceTemporalRequest;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, COPY_DST: 4 });
  const device = { limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
    createTexture: () => ({ createView: () => ({}), destroy: vi.fn() }),
    pushErrorScope: vi.fn(), popErrorScope: async () => null,
    queue: { writeTexture: vi.fn(), onSubmittedWorkDone: async () => {} },
  } as unknown as GPUDevice;
  return new ResidentTemporalRuntime(device);
}
async function allocate(runtime: ResidentTemporalRuntime) {
  runtime.resolve(request, 640); await settle();
  runtime.resolve(request, 640); await settle();
}
afterEach(() => { mock.jobs = []; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('warms an exact Time Stack interval and reuses it across advancing outputs without cancelling the decoder', async () => {
  const runtime = setup();
  const stack = { ...request, samples: 20, horizon: 1.9, delays: Array.from({ length: 19 }, (_, i) => (i + 1) * 0.1), reserveFrames: 80 };
  runtime.resolve(stack, 640); await settle(); runtime.resolve(stack, 640); await settle();
  expect(runtime.resolve(stack, 640)).toBeUndefined();
  const job = mock.jobs[0];
  expect(job.times.length).toBeGreaterThan(60); // Intermediate PTS, not just the nineteen taps.
  for (const time of job.times) job.onFrame({ time });
  job.resolve(); await settle();
  const uploads = mock.upload.mock.calls.length;
  for (let frame = 0; frame <= 10; frame++) {
    const next = { ...stack, source: { ...stack.source, localTime: 5 + frame / 30 } };
    expect(runtime.resolve(next, 640)?.atlas).toBeDefined();
  }
  expect(mock.upload).toHaveBeenCalledTimes(uploads);
  expect(mock.cancel).not.toHaveBeenCalled();
  runtime.destroy();
});

it.each([1, -1])('preloads all delayed streams at original PTS, with bounded memory, speed %s', speed => {
  const stack = { ...request, samples: 20, horizon: 3.8, delays: Array.from({ length: 19 }, (_, i) => (i + 1) * 0.2),
    source: { ...request.source, speed } };
  const required = new Set(hybridTemporalWindow(stack, frames).times);
  for (const capacity of [80, 160]) {
    const ahead = residentTemporalLookahead(stack, frames, required, new Map(), capacity);
    expect(new Set([...required, ...ahead]).size).toBeLessThanOrEqual(capacity);
    const next = hybridTemporalWindow({ ...stack, source: { ...stack.source, localTime: 5 + 1 / 30 } }, frames);
    for (const time of next.times) expect(required.has(time) || ahead.includes(time)).toBe(true);
    expect(ahead.every(time => frames.some(frame => frame.time === time))).toBe(true);
  }
});

it('refills a miss with lookahead and presents a complete advancing window before the speculative tail finishes', async () => {
  const runtime = setup(); await allocate(runtime);
  expect(runtime.resolve(request, 640)).toBeUndefined();
  const job = mock.jobs[0];
  const next = { ...request, source: { ...request.source, localTime: 5 + 1 / 30 } };
  const needed = new Set([...hybridTemporalWindow(request, frames).times, ...hybridTemporalWindow(next, frames).times]);
  expect(job.times.length).toBeGreaterThan(needed.size);
  for (const time of needed) { expect(job.times).toContain(time); job.onFrame({ time }); }
  await settle();
  expect(runtime.resolve(next, 640)?.atlas).toBeDefined();
  expect(mock.jobs).toHaveLength(1); // Original request still owns the speculative tail.
  expect(mock.cancel).not.toHaveBeenCalled();
  for (const time of job.times) if (!needed.has(time)) job.onFrame({ time });
  job.resolve(); await settle(); runtime.destroy();
});

it('export waits for every required frame and does not request speculative PTS', async () => {
  const runtime = setup(); await allocate(runtime);
  const finish = collectTemporalPreparations();
  expect(runtime.resolve(request, 640)).toBeUndefined();
  const pending = finish(), job = mock.jobs[0];
  expect(pending).toHaveLength(1);
  expect(new Set(job.times)).toEqual(new Set(hybridTemporalWindow(request, frames).times));
  for (const time of job.times.slice(0, -1)) job.onFrame({ time });
  await settle();
  const finishMissing = collectTemporalPreparations();
  expect(runtime.resolve(request, 640)).toBeUndefined(); finishMissing();
  job.onFrame({ time: job.times.at(-1) }); job.resolve(); await Promise.all(pending);
  const finishReady = collectTemporalPreparations();
  expect(runtime.resolve(request, 640)?.atlas).toBeDefined();
  expect(finishReady()).toEqual([]); runtime.destroy();
});

it('suspends full-quality source loading without discarding the resident allocation', async () => {
  const runtime = setup(); await allocate(runtime); runtime.resolve(request, 640);
  const bytes = runtime.allocatedBytes;
  runtime.suspend(request.key);
  expect(mock.cancel).toHaveBeenCalledOnce(); expect(runtime.allocatedBytes).toBe(bytes);
  mock.jobs[0].resolve(); await settle(); runtime.destroy();
});

it('renders zero delay without waiting for a historical upload that is never requested', async () => {
  const runtime = setup(); await allocate(runtime);
  expect(runtime.resolve({ ...request, horizon: 0 }, 640)?.current).toBeDefined();
  expect(mock.jobs).toEqual([]); runtime.destroy();
});

it.each([1, -1])('preloads the exact new grid PTS for dense and sparse windows at speed %s', speed => {
  for (const samples of [2, 10, 1920]) {
    const input = { ...request, samples, source: { ...request.source, speed } };
    const current = new Set(hybridTemporalWindow(input, frames).times);
    const ahead = residentTemporalLookahead(input, frames, current, new Map(), current.size + 12);
    const future = hybridTemporalWindow({ ...input, source: { ...input.source, localTime: 5 + 1 / 30 } }, frames);
    for (const time of future.times) expect(current.has(time) || ahead.includes(time)).toBe(true);
    expect(ahead.length).toBeLessThanOrEqual(12);
    expect(ahead.every(time => !current.has(time))).toBe(true);
  }
});
