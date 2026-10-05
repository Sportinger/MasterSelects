import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtPreviewScheduler } from '../../src/engine/native3d/pathtrace/runtime/ptPreviewScheduler';
import { PtDispatchBudget } from '../../src/engine/native3d/pathtrace/runtime/ptDispatchBudget';

describe('path tracing GPU backpressure', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('does not enqueue more work while the GPU is busy, then idles after actual completion', async () => {
    const wake = vi.fn(), scheduler = new PtPreviewScheduler(wake);
    let finish!: () => void;
    expect(scheduler.canRender()).toBe(true);
    scheduler.request();
    scheduler.submitted(new Promise<void>(resolve => { finish = resolve; }), 2);
    expect(scheduler.needsFrame).toBe(true); // Worker reports must retain asynchronous demand.
    vi.advanceTimersByTime(100);
    expect(scheduler.canRender()).toBe(false);
    expect(wake).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
    vi.advanceTimersByTime(199);
    expect(scheduler.canRender()).toBe(false);
    expect(wake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(scheduler.canRender()).toBe(true);
  });

  it('does not truncate a long idle interval to 500 ms', async () => {
    const wake = vi.fn(), scheduler = new PtPreviewScheduler(wake);
    let finish!: () => void;
    scheduler.request();
    scheduler.submitted(new Promise<void>(resolve => { finish = resolve; }), 2);
    vi.advanceTimersByTime(800);
    finish();
    await Promise.resolve();
    vi.advanceTimersByTime(1599);
    expect(wake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(wake).toHaveBeenCalledOnce();
  });

  it('cancels future wakes on raster switch and ignores completion from a disposed device', async () => {
    const wake = vi.fn(), scheduler = new PtPreviewScheduler(wake);
    let finish!: () => void;
    scheduler.request();
    scheduler.submitted(new Promise<void>(resolve => { finish = resolve; }), 2);
    scheduler.cancel();
    expect(scheduler.canRender()).toBe(false); // The submitted work still exists.
    scheduler.cancel();
    finish();
    await Promise.resolve();
    vi.runAllTimers();
    expect(wake).not.toHaveBeenCalled();
    scheduler.submitted(Promise.resolve(), 2);
    scheduler.request();
    scheduler.dispose();
    await Promise.resolve();
    vi.runAllTimers();
    expect(wake).not.toHaveBeenCalled();
    expect(scheduler.canRender()).toBe(true);
  });

  it('lets another composition take its turn instead of starving behind the first target', async () => {
    const scheduler = new PtPreviewScheduler(() => {});
    expect(scheduler.canRender('a')).toBe(true);
    scheduler.submitted(Promise.resolve(), 0);
    expect(scheduler.canRender('b')).toBe(false);
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(scheduler.canRender('a')).toBe(false);
    expect(scheduler.canRender('b')).toBe(true);
    scheduler.releaseTarget('a');
    expect(scheduler.canRender('b')).toBe(true);
    scheduler.dispose();
  });
});

describe('bounded preview work', () => {
  it('covers a costly image over several submissions without skipping or double sampling rows', () => {
    const budget = new PtDispatchBudget();
    let row = 0, submissions = 0;
    const counts = new Uint32Array(540);
    do {
      const plan = budget.planPreview(960, 540, 8, 12, 8, row);
      expect(plan.samples).toBe(1);
      let pixels = 0;
      for (const band of plan.bands) {
        for (let y = band.firstRow; y < band.firstRow + band.rows; y++) counts[y]++;
        pixels += band.rows * 960;
      }
      expect(pixels * plan.samples * budget.costNs / 1e6).toBeLessThanOrEqual(12);
      row = plan.nextRow;
      submissions++;
    } while (row !== 0 && submissions < 100);
    expect(row).toBe(0);
    expect(submissions).toBeGreaterThan(1);
    expect([...counts].every(count => count === 1)).toBe(true);
  });

  it('keeps an in-progress sample at one even when its remaining rows become cheap', () => {
    const budget = new PtDispatchBudget();
    const plan = budget.planPreview(960, 540, 256, 12, 8, 538);
    expect(plan.samples).toBe(1);
    expect(plan.nextRow).toBe(0);
    expect(plan.bands[0].firstRow).toBe(538);
    expect(budget.plan(1920, 1080, 256, Infinity, 4).samples).toBe(4);
  });

  it('reduces realtime resolution to fit the budget but leaves small views unchanged', () => {
    const budget = new PtDispatchBudget();
    for (const [width, height] of [[960, 540], [1920, 1080], [32, 24]]) {
      const size = budget.previewSize(width, height, 12);
      expect(size.width).toBeLessThanOrEqual(width);
      expect(size.height).toBeLessThanOrEqual(height);
      expect(size.width * size.height * budget.costNs / 1e6).toBeLessThanOrEqual(12);
    }
    expect(budget.previewSize(32, 24, 12)).toEqual({ width: 32, height: 24 });
  });
});
