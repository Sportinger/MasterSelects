import { afterEach, expect, it, vi } from 'vitest';
import { seekVideo } from '../../src/engine/export/VideoSeeker';

afterEach(() => vi.useRealTimers());

it('waits for a decoded frame when a seek outlasts its initial event budget', async () => {
  vi.useFakeTimers();
  const video = document.createElement('video');
  video.src = 'blob:export-seek-test';
  let seeking = false;
  let readyState = 4;
  let currentTime = 0;
  Object.defineProperties(video, {
    duration: { value: 100 },
    seeking: { get: () => seeking },
    readyState: { get: () => readyState },
    currentTime: {
      get: () => currentTime,
      set: (time: number) => { currentTime = time; seeking = true; readyState = 1; },
    },
  });
  let completed = false;
  const seek = seekVideo(video, 89.2).then(() => { completed = true; });

  await vi.advanceTimersByTimeAsync(2_000);
  expect(completed).toBe(false);
  seeking = false;
  readyState = 4;
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(200);
  await seek;
  expect(completed).toBe(true);
  expect(video.currentTime).toBe(89.2);
  expect(video.readyState).toBe(4);
});
