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

  it('resumes short still batches after a small gap without adding a whole refresh interval', async () => {
    const wake = vi.fn(), scheduler = new PtPreviewScheduler(wake);
    let finish!: () => void;
    scheduler.request();
    scheduler.submitted(new Promise<void>(resolve => { finish = resolve; }), 0.25);
    vi.advanceTimersByTime(12);
    expect(scheduler.canRender()).toBe(false);
    finish();
    await Promise.resolve();
    vi.advanceTimersByTime(3);
    expect(wake).not.toHaveBeenCalled();
    expect(scheduler.canRender()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(wake).toHaveBeenCalledOnce();
    expect(scheduler.canRender()).toBe(true);
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
    vi.advanceTimersByTime(4);
    expect(scheduler.canRender('a')).toBe(false);
    expect(scheduler.canRender('b')).toBe(true);
    scheduler.releaseTarget('a');
    expect(scheduler.canRender('b')).toBe(true);
    scheduler.dispose();
  });
});

describe('bounded preview work', () => {
  it('covers a costly image from its center without skipping or double sampling pixels', () => {
    const budget = new PtDispatchBudget();
    let cursor = 0, submissions = 0;
    const counts = new Uint8Array(960 * 540);
    do {
      const plan = budget.planPreview(960, 540, 8, 12, 8, cursor);
      expect(plan.samples).toBe(1);
      let pixels = 0;
      for (const band of plan.bands) {
        for (let y = band.firstRow; y < band.firstRow + band.rows; y++) {
          for (let x = band.firstColumn; x < band.firstColumn + band.columns; x++) counts[y * 960 + x]++;
        }
        pixels += band.rows * band.columns;
      }
      if (submissions === 0) {
        expect(counts[270 * 960 + 480]).toBe(1);
        expect(counts[0]).toBe(0);
        expect(counts.at(-1)).toBe(0);
      }
      expect(pixels * plan.samples * budget.costNs / 1e6).toBeLessThanOrEqual(12);
      cursor = plan.nextPixel;
      submissions++;
    } while (cursor !== 0 && submissions < 100);
    expect(cursor).toBe(0);
    expect(submissions).toBeGreaterThan(1);
    expect([...counts].every(count => count === 1)).toBe(true);
  });

  it('keeps an in-progress sample at one even when its remaining pixels become cheap', () => {
    const budget = new PtDispatchBudget();
    const plan = budget.planPreview(960, 540, 256, 12, 8, 960 * 540 - 2);
    expect(plan.samples).toBe(1);
    expect(plan.nextPixel).toBe(0);
    expect(plan.bands.reduce((pixels, band) => pixels + band.columns * band.rows, 0)).toBe(2);
    expect(budget.plan(1920, 1080, 256, Infinity, 4).samples).toBe(4);
  });

  it('covers odd-sized and narrow regions exactly across changing tiny budgets', () => {
    for (const [width, height] of [[137, 71], [1, 9], [9, 1], [63, 65]]) {
      const budget = new PtDispatchBudget(), counts = new Uint8Array(width * height);
      let cursor = 0, submission = 0;
      do {
        const plan = budget.planPreview(width, height, 1, (submission % 2 ? 31 : 7) * 400 / 1e6, 8, cursor);
        for (const band of plan.bands) {
          expect(band.firstColumn + band.columns).toBeLessThanOrEqual(width);
          expect(band.firstRow + band.rows).toBeLessThanOrEqual(height);
          for (let y = band.firstRow; y < band.firstRow + band.rows; y++) {
            for (let x = band.firstColumn; x < band.firstColumn + band.columns; x++) counts[y * width + x]++;
          }
        }
        cursor = plan.nextPixel;
      } while (cursor && ++submission < width * height);
      expect(cursor).toBe(0);
      expect([...counts].every(count => count === 1)).toBe(true);
    }
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
