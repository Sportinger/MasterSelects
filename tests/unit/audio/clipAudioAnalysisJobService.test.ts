import { describe, expect, it } from 'vitest';
import {
  ClipAudioAnalysisJobCancelledError,
  ClipAudioAnalysisJobService,
  isClipAudioAnalysisJobCancelledError,
} from '../../../src/services/audio/ClipAudioAnalysisJobService';

function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ClipAudioAnalysisJobService', () => {
  it('queues jobs behind the configured concurrency limit', async () => {
    const service = new ClipAudioAnalysisJobService({ maxConcurrent: 1 });
    const first = defer<string>();
    const started: string[] = [];

    const firstRun = service.run({ clipId: 'clip-a', kind: 'spectrogram-tiles' }, async ({ clipId }) => {
      started.push(clipId);
      return first.promise;
    });
    const secondRun = service.run({ clipId: 'clip-b', kind: 'loudness-envelope' }, async ({ clipId }) => {
      started.push(clipId);
      return 'second';
    });

    await Promise.resolve();
    expect(started).toEqual(['clip-a']);
    expect(service.getSnapshot().map((job) => job.status)).toEqual(['running', 'queued']);

    first.resolve('first');
    await expect(firstRun).resolves.toBe('first');
    await expect(secondRun).resolves.toBe('second');
    expect(started).toEqual(['clip-a', 'clip-b']);
    expect(service.getSnapshot()).toEqual([]);
  });

  it('cancels queued jobs and rejects with a typed cancellation error', async () => {
    const service = new ClipAudioAnalysisJobService({ maxConcurrent: 1 });
    const first = defer<string>();

    void service.run({ clipId: 'clip-a', kind: 'spectrogram-tiles' }, async () => first.promise);
    const queued = service.run({ clipId: 'clip-b', kind: 'loudness-envelope' }, async () => 'never');

    expect(service.cancelClip('clip-b')).toBe(1);
    await expect(queued).rejects.toBeInstanceOf(ClipAudioAnalysisJobCancelledError);
    await queued.catch((error) => {
      expect(isClipAudioAnalysisJobCancelledError(error)).toBe(true);
    });

    first.resolve('first');
  });

  it('cancels only jobs of the requested kind', async () => {
    const service = new ClipAudioAnalysisJobService({ maxConcurrent: 1 });
    const running = defer<string>();
    const waveformRun = service.run(
      { clipId: 'clip-waveform', kind: 'waveform-pyramid' },
      async () => running.promise,
    );
    const loudnessRun = service.run(
      { clipId: 'clip-loudness', kind: 'loudness-envelope' },
      async () => 'loudness',
    );

    expect(service.cancelKind('waveform-pyramid')).toBe(1);
    running.resolve('ignored');

    await expect(waveformRun).rejects.toBeInstanceOf(ClipAudioAnalysisJobCancelledError);
    await expect(loudnessRun).resolves.toBe('loudness');
  });
});
