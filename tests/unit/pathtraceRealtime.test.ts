import { describe, expect, it } from 'vitest';
import { ptJitter } from '../../src/engine/native3d/pathtrace/runtime/ptRealtime';
import { PT_MAX_BANDS, PtDispatchBudget } from '../../src/engine/native3d/pathtrace/runtime/ptDispatchBudget';
import { PT_WIDE_EMPTY, ptWideNodeCount } from '../../src/engine/native3d/pathtrace/contracts/ptLayouts';

describe('path tracing realtime helpers', () => {
  it('jitters inside the pixel with a sequence that covers it evenly', () => {
    const offsets = Array.from({ length: 16 }, (_, frame) => ptJitter(frame));
    for (const [x, y] of offsets) {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThan(0.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThan(0.5);
    }
    expect(new Set(offsets.map(([x, y]) => `${x},${y}`)).size).toBe(16);
    // Every quadrant of the pixel gets a quarter of the 16 samples (Halton 2,3 stratification).
    const quadrants = [0, 0, 0, 0];
    for (const [x, y] of offsets) quadrants[(x < 0 ? 0 : 1) + (y < 0 ? 0 : 2)]++;
    expect(quadrants.every(count => count >= 3 && count <= 5)).toBe(true);
    expect(ptJitter(16)).toEqual(ptJitter(0));
  });

  it('splits work into bands that cover every row and stay within the dispatch budget', () => {
    const budget = new PtDispatchBudget();
    for (const [width, rows] of [[960, 540], [1286, 724], [1920, 1080], [7, 3]]) {
      const plan = budget.plan(width, rows, 64, 80, 16);
      expect(plan.samples).toBeGreaterThanOrEqual(1);
      expect(plan.samples).toBeLessThanOrEqual(16);
      expect(plan.bands.length).toBeLessThanOrEqual(PT_MAX_BANDS);
      let next = 0;
      for (const band of plan.bands) {
        expect(band.firstRow).toBe(next);
        expect(band.rows).toBeGreaterThan(0);
        next += band.rows;
      }
      expect(next).toBe(rows);
      // Before any measurement the estimate is conservative: one band never exceeds ~40 ms of guessed work.
      const bandMs = Math.max(...plan.bands.map(band => band.rows)) * width * plan.samples * budget.costNs / 1e6;
      expect(bandMs).toBeLessThanOrEqual(40 + width * plan.samples * 8 * budget.costNs / 1e6);
    }
  });

  it('adds samples up to the frame budget but never past what remains', () => {
    const budget = new PtDispatchBudget();
    expect(budget.plan(100, 100, 3, 1e9, 16).samples).toBe(3);
    expect(budget.plan(100, 100, 64, 1e9, 4).samples).toBe(4);
    // A tiny budget still makes progress: at least one sample.
    expect(budget.plan(4000, 4000, 64, 1, 16).samples).toBe(1);
    // Export renders a fixed batch whatever the timing (deterministic sums).
    expect(budget.plan(1920, 1080, 256, Number.POSITIVE_INFINITY, 4).samples).toBe(4);
  });

  it('packs one traversal node per internal node, one for a single primitive', () => {
    expect(ptWideNodeCount(1)).toBe(1);
    expect(ptWideNodeCount(2)).toBe(1);
    expect(ptWideNodeCount(466944)).toBe(466943);
    expect(PT_WIDE_EMPTY).toBe(0xffffffff);
  });
});
