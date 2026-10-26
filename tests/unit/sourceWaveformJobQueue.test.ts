import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBackgroundSourceWaveform } from '../../src/services/audio/sourceWaveformJobQueue';

describe('source waveform job queue', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('lets the next source start when one stalls, and the stalled one still delivers', async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    let finishHung!: (value: string) => void;
    const hung = runBackgroundSourceWaveform(() => new Promise<string>(resolve => { finishHung = resolve; }), undefined, { ms: 1000, onStall });
    const next = vi.fn(async () => 'next');
    const queued = runBackgroundSourceWaveform(next, undefined, { ms: 1000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onStall).toHaveBeenCalledOnce();
    await expect(queued).resolves.toBe('next');

    finishHung('late');
    await expect(hung).resolves.toBe('late');
  });

  it('keeps the queue while the work reports progress', async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    let done = false;
    const slow = runBackgroundSourceWaveform(async progress => {
      for (let step = 0; step < 5; step++) {
        await new Promise(resolve => setTimeout(resolve, 800));
        progress();
      }
      done = true;
      return 'slow';
    }, undefined, { ms: 1000, onStall });
    const next = vi.fn(async () => (done ? 'after' : 'too early'));
    const queued = runBackgroundSourceWaveform(next, undefined, { ms: 1000 });

    await vi.advanceTimersByTimeAsync(4000);
    await expect(slow).resolves.toBe('slow');
    await expect(queued).resolves.toBe('after');
    expect(onStall).not.toHaveBeenCalled();
  });
});
