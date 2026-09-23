import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrubRamCache } from '../../src/engine/texture/scrubbingCache/scrubRamCache';
import { ScrubTextureCache } from '../../src/engine/texture/scrubbingCache/scrubTextureCache';
import { getMaxScrubRamGB, normalizeScrubRamGB } from '../../src/services/scrubCacheMemory';

const source = {} as ImageBitmap;
function pixelCanvas() {
  const read = vi.fn((_x: number, _y: number, width: number, height: number) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), drawImage: vi.fn(), getImageData: read,
  } as unknown as CanvasRenderingContext2D);
  return read;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('RAM scrub budget', () => {
  it('reserves headroom for other browser memory and handles unknown/capped RAM', () => {
    expect(getMaxScrubRamGB(64)).toBe(4);
    expect(getMaxScrubRamGB(8)).toBe(2);
    expect(getMaxScrubRamGB(2)).toBe(0.5);
    expect(getMaxScrubRamGB(0.5)).toBe(0);
    expect(getMaxScrubRamGB(null)).toBe(1);
    expect(normalizeScrubRamGB(999, 8)).toBe(2);
    expect(normalizeScrubRamGB(NaN, 8)).toBe(0.5);
    expect(normalizeScrubRamGB(-3, 8)).toBe(0);
  });
  it('evicts least recently used pixels before allocating and frees on budget reduction', () => {
    pixelCanvas();
    const cache = new ScrubRamCache();
    cache.setBudget(64); // Four 16-byte frames including conversion headroom.
    for (const key of ['a:0', 'a:1', 'b:2']) cache.capture(key, source, 2, 2);
    cache.get('a:0');
    cache.capture('b:3', source, 2, 2);
    expect(cache.has('a:1')).toBe(false);
    expect(cache.has('a:0')).toBe(true);
    expect(cache.getSnapshot().bytes).toBe(48);
    cache.setBudget(16);
    expect(cache.getSnapshot().bytes).toBe(16);
    cache.setBudget(0);
    expect([...cache.keys()]).toEqual([]);
  });
  it('clears only the requested source and backs off after catchable allocation failures', () => {
    const read = pixelCanvas();
    const cache = new ScrubRamCache();
    cache.setBudget(128);
    cache.capture('a:0', source, 2, 2);
    cache.capture('b:0', source, 2, 2);
    cache.clear('a');
    expect(cache.has('b:0')).toBe(true);
    read.mockImplementationOnce(() => { throw new RangeError('allocation failed'); });
    cache.capture('b:1', source, 2, 2);
    expect(cache.getSnapshot()).toMatchObject({ reduced: true, bytes: 0, maxBytes: 12 });
    cache.setBudget(256);
    expect(cache.getSnapshot().maxBytes).toBe(12);
  });
});

function gpu() {
  const textures: Array<{ destroy: ReturnType<typeof vi.fn>; createView: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn(), createView: vi.fn(() => ({})) };
      textures.push(texture);
      return texture;
    }),
    pushErrorScope: vi.fn(), popErrorScope: vi.fn(() => Promise.resolve(null as GPUError | null)),
    queue: { copyExternalImageToTexture: vi.fn(), writeTexture: vi.fn() },
  };
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  return { device, textures, cache: new ScrubTextureCache(device as unknown as GPUDevice) };
}

describe('two-tier scrub cache', () => {
  it('follows decoded frames without another render and cancels on clear', () => {
    const { cache } = gpu();
    cache.setRamBudget(8192);
    let callback!: VideoFrameRequestCallback;
    const listeners = new Map<string, () => void>();
    const video = { src: 'playing', paused: false, seeking: false,
      requestVideoFrameCallback: vi.fn((fn: VideoFrameRequestCallback) => { callback = fn; return 1; }),
      cancelVideoFrameCallback: vi.fn(),
      addEventListener: vi.fn((event: string, handler: () => void) => listeners.set(event, handler)),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    const capture = vi.spyOn(cache, 'cacheFrameAtTime').mockImplementation(() => {});
    cache.cachePlaybackFrame(video);
    cache.cachePlaybackFrame(video);
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    callback(0, { mediaTime: 1.25 } as VideoFrameCallbackMetadata);
    expect(capture).toHaveBeenCalledWith(video, 1.25);
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    Object.assign(video, { paused: true });
    listeners.get('pause')?.();
    Object.assign(video, { paused: false });
    listeners.get('play')?.();
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(3);
    cache.clear();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(2);
    expect(video.removeEventListener).toHaveBeenCalledTimes(2);
  });
  it('fills during playback, skips seeking and limits in-flight conversions', async () => {
    pixelCanvas();
    const { cache } = gpu();
    cache.setRamBudget(8192);
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const convert = vi.fn(() => new Promise<ImageBitmap>((resolve) => { resolveBitmap = resolve; }));
    vi.stubGlobal('createImageBitmap', convert);
    const video = { src: 'playing', videoWidth: 1920, videoHeight: 1080,
      readyState: 4, paused: false, seeking: true, currentTime: 1 } as HTMLVideoElement;
    cache.cachePlaybackFrame(video);
    expect(convert).not.toHaveBeenCalled();
    Object.assign(video, { seeking: false });
    cache.cachePlaybackFrame(video);
    Object.assign(video, { currentTime: 2 });
    cache.cachePlaybackFrame(video);
    expect(convert).toHaveBeenCalledTimes(1);
    const close = vi.fn();
    resolveBitmap({ width: 2, height: 2, close } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(cache.hasFrame('playing', 30)).toBe(true);
    expect(cache.hasFrame('playing', 60)).toBe(false);
    cache.setRamBudget(0);
    cache.cachePlaybackFrame(video);
    expect(convert).toHaveBeenCalledTimes(1);
  });
  it('restores GPU-evicted frames from RAM and keeps their yellow ranges', async () => {
    pixelCanvas();
    const { cache, device } = gpu();
    cache.setRamBudget(8192);
    for (let i = 0; i < 200; i++) {
      cache.addFrameFromSource(source, 'video', i / 30, 2, 2);
      await Promise.resolve(); await Promise.resolve();
    }
    expect(cache.getSnapshot().count).toBeLessThanOrEqual(192);
    expect(cache.getRamSnapshot().count).toBe(200);
    expect(cache.hasFrame('video', 0)).toBe(true);
    expect(cache.getCachedRanges('video')[0].start).toBe(0);
    const before = device.queue.writeTexture.mock.calls.length;
    expect(cache.getCachedFrame('video', 0)).toBe(null);
    await Promise.resolve(); await Promise.resolve();
    expect(cache.getCachedFrame('video', 0)).not.toBe(null);
    expect(device.queue.writeTexture.mock.calls.length).toBe(before + 1);
    cache.clear();
    expect(cache.getRamSnapshot().bytes).toBe(0);
  });
  it('never publishes failed GPU allocations and discards in-flight work after clear', async () => {
    const { cache, device, textures } = gpu();
    device.popErrorScope.mockResolvedValueOnce(null).mockResolvedValueOnce({ message: 'OOM' } as GPUError);
    cache.addFrameFromSource(source, 'video', 0, 2, 2);
    await Promise.resolve(); await Promise.resolve();
    expect(cache.getSnapshot().count).toBe(0);
    expect(textures[0].destroy).toHaveBeenCalledOnce();
    // Fresh owner; a reduced budget intentionally survives clear on the previous owner.
    const other = gpu();
    other.cache.addFrameFromSource(source, 'video', 0, 2, 2);
    other.cache.clear('video');
    await Promise.resolve(); await Promise.resolve();
    expect(other.cache.getSnapshot().count).toBe(0);
    expect(other.textures[0].destroy).toHaveBeenCalledOnce();
  });
});
