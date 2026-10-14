import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFrameRequest } from '../../src/services/mediaRuntime/sourceFrames/SourceFrameService';

const shared = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: shared }));
import { sampleScanVideoWithTimes } from '../../src/services/photogrammetry/videoFrameSampler';

const file = new File(['hevc'], 'portrait.mp4', { type: 'video/mp4', lastModified: 1000 });
const options = { frameCount: 2, maxResolution: 1600, startTime: 0.2, endTime: 0.8 };
let release: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn>;
let ready: Promise<unknown>;
let rotation: number;
let borrowed: boolean;
const canvases: HTMLCanvasElement[] = [];
let context: { save: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>; rotate: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };

beforeEach(() => {
  canvases.length = 0;
  rotation = 90;
  borrowed = false;
  release = vi.fn();
  ready = Promise.resolve({ frames: [{ time: 0, duration: 0.5 }, { time: 0.5, duration: 0.5 }] });
  request = vi.fn(async ({ times, onFrame }: SourceFrameRequest) => {
    borrowed = true;
    try {
      onFrame({ frame: { close: () => { throw new Error('Borrowed frame must not be closed'); } } as VideoFrame,
        time: times[0] < 0.5 ? 0 : 0.5, duration: 0.5, rotation,
        width: rotation % 180 ? 2160 : 3840, height: rotation % 180 ? 3840 : 2160 });
    } finally { borrowed = false; }
  });
  shared.acquire.mockImplementation(() => ({ ready, request, release }));
  context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    drawImage: vi.fn(() => { expect(borrowed).toBe(true); }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this);
    return context as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
    expect(borrowed).toBe(false);
    callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(1);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(0);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(0);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('scan decoder fallback', () => {
  it('preserves portrait 4K dimensions and awaits frame persistence before progress', async () => {
    const sequence: string[] = [];
    await sampleScanVideoWithTimes(file, { ...options, maxResolution: null,
      onFrame: async frame => { await Promise.resolve(); sequence.push(frame.file.name); },
      onProgress: current => { sequence.push(`progress-${current}`); },
    });
    expect([canvases.at(-1)!.width, canvases.at(-1)!.height]).toEqual([2160, 3840]);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), -1920, -1080, 3840, 2160);
    expect(sequence).toEqual(['portrait-frame-001.jpg', 'progress-1', 'portrait-frame-002.jpg', 'progress-2']);
  });

  it('stops extraction and releases the decoder when saving a frame fails', async () => {
    await expect(sampleScanVideoWithTimes(file, { ...options, maxResolution: null,
      onFrame: async () => { throw new Error('Disk full'); },
    })).rejects.toThrow('Disk full');
    expect(request).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('preserves native source dimensions and streams native frames too', async () => {
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(2160);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(3840);
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(function (this: HTMLMediaElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    });
    context.drawImage.mockImplementation(() => {});
    const onFrame = vi.fn();
    await sampleScanVideoWithTimes(file, { ...options, maxResolution: null, onFrame });
    expect([canvases.at(-1)!.width, canvases.at(-1)!.height]).toEqual([2160, 3840]);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(shared.acquire).not.toHaveBeenCalled();
  });

  it.each([0, 90, 180, 270])('extracts browser-unavailable video with %i degree orientation', async (angle) => {
    rotation = angle;
    const progress = vi.fn();
    const frames = await sampleScanVideoWithTimes(file, { ...options, onProgress: progress });
    expect(shared.acquire).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([call]) => call.times)).toEqual([[0.23], [0.77]]);
    expect(frames.map(frame => frame.sourceTime)).toEqual([0, 0.5]);
    expect(frames.map(frame => frame.file.name)).toEqual(['portrait-frame-001.jpg', 'portrait-frame-002.jpg']);
    expect(frames[0].file.type).toBe('image/jpeg');
    expect([canvases.at(-1)!.width, canvases.at(-1)!.height]).toEqual(angle % 180 ? [900, 1600] : [1600, 900]);
    expect(context.rotate).toHaveBeenCalledWith(angle * Math.PI / 180);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), -800, -450, 1600, 900);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('also falls back when the native player reports a decode error', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'error', { configurable: true, value: { code: 4 } });
    });
    await expect(sampleScanVideoWithTimes(file, options)).resolves.toHaveLength(2);
  });

  it('keeps working native video on its original extraction path', async () => {
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1080);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(function (this: HTMLMediaElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    });
    context.drawImage.mockImplementation(() => {});
    await expect(sampleScanVideoWithTimes(file, options)).resolves.toHaveLength(2);
    expect(shared.acquire).not.toHaveBeenCalled();
    expect([canvases.at(-1)!.width, canvases.at(-1)!.height]).toEqual([900, 1600]);
  });

  it('releases the lease and surfaces decoder initialization failure', async () => {
    ready = Promise.reject(new Error('No decodable video track'));
    await expect(sampleScanVideoWithTimes(file, options)).rejects.toThrow('No decodable video track');
    expect(release).toHaveBeenCalledOnce();
  });

  it('cancels while the source decoder is still opening', async () => {
    const controller = new AbortController();
    ready = new Promise(() => {});
    shared.acquire.mockImplementation(() => {
      queueMicrotask(() => controller.abort());
      return { ready, request, release };
    });
    await expect(sampleScanVideoWithTimes(file, { ...options, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('stops between frames and releases the decoder on cancellation', async () => {
    const controller = new AbortController();
    await expect(sampleScanVideoWithTimes(file, { ...options, signal: controller.signal,
      onProgress: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases the decoder when JPEG encoding fails', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
    await expect(sampleScanVideoWithTimes(file, options)).rejects.toThrow('could not encode');
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not allocate resources for an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(sampleScanVideoWithTimes(file, { ...options, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(shared.acquire).not.toHaveBeenCalled();
  });
});
