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

  it('uses the configured visual target fps for stats and drop detection', () => {
    const stats = new PerformanceStats();
    stats.setTargetFps(30);
    stats.recordRafGap(33);
    stats.resetPerSecondCounters();

    const snapshot = stats.getStats(false);
    expect(snapshot.targetFps).toBe(30);
    expect(snapshot.fps).toBe(30);
    expect(snapshot.drops.lastSecond).toBe(0);
  });

  it('does not report stale per-second drops while idle', () => {
    const stats = new PerformanceStats();
    stats.recordRafGap(100);
    stats.resetPerSecondCounters();

    const activeSnapshot = stats.getStats(false);
    expect(activeSnapshot.drops.lastSecond).toBeGreaterThan(0);

    const idleSnapshot = stats.getStats(true);
    expect(idleSnapshot.drops.count).toBeGreaterThan(0);
    expect(idleSnapshot.drops.lastSecond).toBe(0);
    expect(idleSnapshot.drops.reason).toBe('none');
  });
});
