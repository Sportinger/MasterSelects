import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ cached: vi.fn(), load: vi.fn() }));
vi.mock('../../src/services/proxyFrameCache', () => ({ proxyFrameCache: {
  getNearestCachedFrameEntry: mock.cached, getFrame: mock.load,
} }));
import { exactProxyFrameIndex, readSourceProxyFrames } from '../../src/services/mediaRuntime/sourceFrames/SourceProxyFrames';
const image = { complete: true, naturalWidth: 480, naturalHeight: 270 } as HTMLImageElement;
const stamps = (times: number[]) => times.map(time => ({ time, duration: 1 / 30 }));
afterEach(() => vi.resetAllMocks());

it('inverts normalized JPEG PTS indexing at fractional frame rates', () => {
  const frames = stamps(Array.from({ length: 200 }, (_, i) => 2 + i / 29.97));
  expect(exactProxyFrameIndex(frames, frames[103].time, 29.97)).toBe(103);
  expect(exactProxyFrameIndex(frames, frames[103].time + 0.01, 29.97)).toBeUndefined();
});

it('rejects ambiguous VFR/low-fps proxy bins instead of changing the source frame', () => {
  const frames = stamps([0, 0.01, 0.034, 0.067, 0.1]);
  expect(exactProxyFrameIndex(frames, 0, 30)).toBeUndefined();
  expect(exactProxyFrameIndex(frames, 0.01, 30)).toBeUndefined();
  expect(exactProxyFrameIndex(frames, 0.034, 30)).toBe(1);
  expect(exactProxyFrameIndex(frames, 0.067, 15)).toBeUndefined();
});

it('borrows exact resident JPEGs without starting any image or video decoding', async () => {
  mock.cached.mockReturnValue({ frameIndex: 1, image });
  const onFrame = vi.fn();
  await readSourceProxyFrames({ mediaId: 'media', frames: stamps([0, 1 / 30]), times: [1 / 30], fps: 30,
    rotation: 90, shouldContinue: () => true, onFrame });
  expect(mock.cached).toHaveBeenCalledWith('media', 1, 0);
  expect(mock.load).not.toHaveBeenCalled();
  expect(onFrame.mock.calls[0][0]).toMatchObject({ image, time: 1 / 30, rotation: 90 });
});

it('caps image loads at four and discards callbacks after a superseded seek', async () => {
  const resumes: (() => void)[] = [];
  mock.load.mockImplementation(() => new Promise(resolve => resumes.push(() => resolve(image))));
  let active = true;
  const onFrame = vi.fn(), frames = stamps(Array.from({ length: 20 }, (_, i) => i / 30));
  const read = readSourceProxyFrames({ mediaId: 'media', frames, times: frames.map(frame => frame.time), fps: 30,
    rotation: 0, shouldContinue: () => active, onFrame });
  expect(mock.load).toHaveBeenCalledTimes(4);
  active = false; resumes.forEach(resume => resume()); await read;
  expect(mock.load).toHaveBeenCalledTimes(4); expect(onFrame).not.toHaveBeenCalled();
});
