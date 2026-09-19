import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bakeDepthVideo, validateDepthBakeRange } from '../../src/services/depthEstimation/bakeDepthVideo';
const env = vi.hoisted(() => ({ reads: [] as number[], encoded: [] as number[], close: vi.fn(), cancel: vi.fn(), infer: vi.fn() }));
vi.mock('../../src/services/depthEstimation/depthRuntime', () => ({ depthRuntime: { prepare: vi.fn(), infer: (...args: unknown[]) => env.infer(...args) } }));
vi.mock('../../src/services/planarTracking/surfaceFrameReader', () => ({ openSurfaceFrames: vi.fn(async () => ({
  frames: [{ time: 0, duration: 10 }], close: env.close,
  read: async (time: number) => { env.reads.push(time); return { pixels: { width: 16, height: 16 }, time }; },
})) }));
vi.mock('mediabunny', () => ({
  canEncodeVideo: async () => true,
  BufferTarget: class { buffer = new ArrayBuffer(16); },
  Mp4OutputFormat: class {},
  Output: class { addVideoTrack() {} async start() {} async finalize() {} cancel = env.cancel; },
  CanvasSource: class { async add(time: number) { env.encoded.push(time); } },
}));
beforeEach(() => {
  env.reads.length = 0; env.encoded.length = 0; env.close.mockClear(); env.cancel.mockReset().mockResolvedValue(undefined);
  env.infer.mockReset().mockResolvedValue({ width: 2, height: 2, values: new Float32Array([0, 1, 2, 3]), milliseconds: 1 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: vi.fn(), drawImage: vi.fn() } as any);
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
});
const options = (signal: AbortSignal) => ({ url: 'blob:source', from: 2, to: 2.1, fps: 30, edge: 280, smoothing: 0.75, invert: false, signal, progress: vi.fn() });
describe('depth video baking', () => {
  it('uses exact source sample times and resets output timestamps to zero', async () => {
    const blob = await bakeDepthVideo(options(new AbortController().signal));
    // Floating point endpoint rounding must not append an extra frame.
    expect(env.reads).toHaveLength(3);
    env.reads.forEach((time, i) => expect(time).toBeCloseTo(2 + i / 30));
    env.encoded.forEach((time, i) => expect(time).toBeCloseTo(i / 30));
    expect(blob.size).toBeGreaterThan(0); expect(env.close).toHaveBeenCalledOnce(); expect(env.cancel).not.toHaveBeenCalled();
  });
  it('cancels decoding and encoding without completing a partial video', async () => {
    const abort = new AbortController();
    env.infer.mockImplementationOnce(async () => { abort.abort(); throw new DOMException('Cancelled', 'AbortError'); });
    await expect(bakeDepthVideo(options(abort.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(env.close).toHaveBeenCalledOnce(); expect(env.encoded).toHaveLength(0);
  });
  it('rejects invalid and unbounded ranges before model work', () => {
    expect(validateDepthBakeRange(0, 120, 30)).toBe(3600);
    for (const [a, b, fps] of [[0, 121, 30], [0, 1, 60], [2, 1, 30], [NaN, 1, 30]]) expect(() => validateDepthBakeRange(a, b, fps)).toThrow();
  });
});
