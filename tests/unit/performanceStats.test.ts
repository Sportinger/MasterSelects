import { describe, expect, it } from 'vitest';
import { PerformanceStats } from '../../src/engine/stats/PerformanceStats';

describe('PerformanceStats', () => {
  it('reports cadence fps from raf gap instead of inflated render counts', () => {
    const stats = new PerformanceStats();

    for (let i = 0; i < 12; i++) {
      stats.recordRafGap(8.33);
    }

    const snapshot = stats.getStats(false);
    expect(snapshot.fps).toBe(120);
  });

  it('reports zero fps while idle', () => {
    const stats = new PerformanceStats();
    stats.recordRafGap(8.33);

    const snapshot = stats.getStats(true);
    expect(snapshot.fps).toBe(0);
  });
});
