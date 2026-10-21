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

function stalledSeekVideo(): { video: HTMLVideoElement; finishSeek: () => void } {
  const video = document.createElement('video');
  video.src = 'blob:export-seek-timeout-test';
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
  return { video, finishSeek: () => { seeking = false; readyState = 4; video.dispatchEvent(new Event('seeked')); } };
}

it('reports a timed-out seek that recovered before rendering as an exact frame', async () => {
  vi.useFakeTimers();
  const { video, finishSeek } = stalledSeekVideo();
  const seek = seekVideo(video, 18.133);
  await vi.advanceTimersByTimeAsync(2_000);
  finishSeek();
  await vi.advanceTimersByTimeAsync(200);
  await expect(seek).resolves.toEqual({ targetTime: 18.133, timedOut: true, usedPreviousFrame: false });
});

it('reports and counts an export frame that repeats the previous frame after a seek timeout', async () => {
  vi.useFakeTimers();
  const { exportDiagnostics } = await import('../../src/services/export/exportDiagnostics');
  const { recordExportSeekOutcome } = await import('../../src/engine/export/VideoSeeker');
  const { video } = stalledSeekVideo();
  exportDiagnostics.start({ test: true });
  const seek = seekVideo(video, 18.133);
  await vi.advanceTimersByTimeAsync(10_000);
  const outcome = await seek;
  expect(outcome).toEqual({ targetTime: 18.133, timedOut: true, usedPreviousFrame: true });
  recordExportSeekOutcome(outcome, { id: 'clip-1', name: 'fpv.mp4' }, 18.1);
  recordExportSeekOutcome({ targetTime: 3, timedOut: false, usedPreviousFrame: false }, null, 3);
  const seeks = (exportDiagnostics.snapshot().current as { seeks: Record<string, unknown> }).seeks;
  expect(seeks).toMatchObject({ timeouts: 1, previousFrameFallbacks: 1 });
  expect(seeks.fallbackSamples).toEqual([expect.objectContaining({ clipName: 'fpv.mp4', usedPreviousFrame: true })]);
  exportDiagnostics.finish('success');
  expect((exportDiagnostics.snapshot().last as { seeks: Record<string, unknown> }).seeks).toMatchObject({ previousFrameFallbacks: 1 });
});
