import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScrubPreloadWindow } from '../../src/engine/texture/scrubbingCache/scrubPreloadWindow';
import { BackgroundPreloadController } from '../../src/engine/texture/scrubbingCache/backgroundPreload';
import type { ScrubTextureCache } from '../../src/engine/texture/scrubbingCache/scrubTextureCache';

const captures = vi.hoisted(() => new Set<number>());
const seek = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/engine/texture/scrubbingCache/backgroundResources', () => ({
  canRetainBackgroundPreloadVideo: () => ({ admitted: true }),
  reportBackgroundPreloadVideo: vi.fn(), releaseBackgroundPreloadVideo: vi.fn(),
}));
vi.mock('../../src/engine/texture/scrubbingCache/backgroundVideoOps', () => ({
  getFiniteDuration: (value: number) => Number.isFinite(value) && value > 0 ? value : undefined,
  seekBackgroundVideo: seek,
  cacheBackgroundVideoFrame: async (_session: unknown, time: number) => { captures.add(Math.round(time * 30)); return true; },
  yieldBackgroundPreload: async () => {},
}));
afterEach(() => { vi.restoreAllMocks(); captures.clear(); seek.mockReset(); seek.mockResolvedValue(true); });

describe('budget-sized idle preload', () => {
  it('extends with RAM, shares capacity across sources, and shifts at boundaries', () => {
    const base = { targetFrame: 0, lastFrame: 3000, ramBytes: 16 * 302, frameBytes: 16, sourceCount: 1, isDragging: false };
    expect(getScrubPreloadWindow(base)).toEqual({ start: 0, end: 299 });
    expect(getScrubPreloadWindow({ ...base, ramBytes: 16 * 602 })).toEqual({ start: 0, end: 599 });
    expect(getScrubPreloadWindow({ ...base, ramBytes: 16 * 604, sourceCount: 2 })).toEqual({ start: 0, end: 299 });
    expect(getScrubPreloadWindow({ ...base, targetFrame: 2999 })).toEqual({ start: 2701, end: 3000 });
    expect(getScrubPreloadWindow({ ...base, lastFrame: 20 })).toEqual({ start: 0, end: 20 });
    expect(getScrubPreloadWindow({ ...base, ramBytes: 0 })).toEqual({ start: 0, end: 36 });
    expect(getScrubPreloadWindow({ ...base, isDragging: true })).toEqual({ start: 0, end: 72 });
  });

  function setup() {
    let ramBytes = 16 * 202;
    vi.spyOn(performance, 'now').mockImplementation(() => ramBytes);
    const background = { load: vi.fn(), pause: vi.fn(), removeAttribute: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(background as unknown as HTMLVideoElement);
    const cache = {
      computeSize: () => ({ width: 2, height: 2 }),
      getRamSnapshot: () => ({ maxBytes: ramBytes }),
      hasFrame: (_src: string, frame: number) => captures.has(frame), clear: vi.fn(),
    };
    const controller = new BackgroundPreloadController(cache as unknown as ScrubTextureCache);
    const video = { src: 'blob:test', videoWidth: 2, videoHeight: 2, duration: 100 } as HTMLVideoElement;
    return { controller, video, cache, background, setBudget: (bytes: number) => { ramBytes = bytes; } };
  }

  it('fills past the 72-frame batch limit without further render callbacks and expands without moving', async () => {
    const { controller, video, setBudget } = setup();
    controller.preloadAroundTime(video, 0);
    expect(controller.getStats().queuedFrames).toBeLessThanOrEqual(72);
    await vi.waitFor(() => expect(captures.size).toBe(200));
    setBudget(16 * 402);
    controller.preloadAroundTime(video, 0);
    await vi.waitFor(() => expect(captures.size).toBe(400));
    expect(controller.getStats().activePreloads).toBe(0);
    controller.clear();
  });

  it('continues beyond failed batches without spinning forever', async () => {
    const { controller, video } = setup();
    seek.mockResolvedValue(false);
    controller.preloadAroundTime(video, 0);
    await vi.waitFor(() => expect(controller.getStats().failedFrames).toBe(200));
    expect(controller.getStats().activePreloads).toBe(0);
    controller.clear();
  });

  it('stops preload decoders on playback while retaining captured frames', async () => {
    const { controller, video, cache, background } = setup();
    controller.preloadAroundTime(video, 0);
    await vi.waitFor(() => expect(captures.size).toBe(200));
    controller.preloadAroundTime(video, 1, { isPlaying: true });
    expect(background.pause).toHaveBeenCalled();
    expect(controller.getStats().activeSessions).toBe(0);
    expect(cache.clear).not.toHaveBeenCalled();
    expect(captures.size).toBe(200);
  });
});
