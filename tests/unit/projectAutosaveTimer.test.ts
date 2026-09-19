import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProjectAutosaveTimer } from '../../src/services/project/projectAutosaveTimer';

afterEach(() => vi.useRealTimers());
describe('timed project autosave', () => {
  it('waits the selected five minutes and stops when disabled', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const stop = startProjectAutosaveTimer({ intervalMs: 300000, isBusy: () => false, save });
    await vi.advanceTimersByTimeAsync(299999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('defers an already due save while importing and never overlaps saves', async () => {
    vi.useFakeTimers();
    let busy = true;
    let release!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const stop = startProjectAutosaveTimer({ intervalMs: 60000, isBusy: () => busy, save });
    await vi.advanceTimersByTimeAsync(70000);
    expect(save).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    stop();
  });
});
