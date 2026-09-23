import { describe, expect, it } from 'vitest';
import { residentTemporalLayout, residentTemporalMetadata } from '../../src/effects/time/residentTemporalLayout';
import { hybridTemporalWindow } from '../../src/effects/time/hybridTemporalWindow';

describe('resident temporal video history', () => {
  it('packs 1920 small source frames past the array-layer limit without resizing them', () => {
    const layout = residentTemporalLayout(160, 90, 1920, 1920, 640 * 1024 * 1024, 1024, 8192, 256);
    expect(layout.capacity).toBeGreaterThanOrEqual(1920);
    expect(layout.layers).toBeLessThanOrEqual(256);
    expect(layout.columns * 160).toBeLessThanOrEqual(8192);
    expect(layout.rows * 90).toBeLessThanOrEqual(8192);
    expect(layout.bytes).toBeLessThanOrEqual(640 * 1024 * 1024);
  });
  it('rejects an oversized Full HD window rather than silently dropping samples', () => {
    expect(() => residentTemporalLayout(1920, 1080, 1920, 1920, 640 * 1024 * 1024, 0, 16384, 256))
      .toThrow(/1920 distinct source frames/);
  });
  it('counts partly filled pages inside the selected budget', () => {
    for (const wanted of [1, 7, 257, 511, 1920]) {
      const budget = (wanted + 16) * 160 * 90 * 4 + 2048;
      const layout = residentTemporalLayout(160, 90, wanted, wanted, budget, 2048, 8192, 256);
      expect(layout.capacity).toBeGreaterThanOrEqual(wanted);
      expect(layout.bytes).toBeLessThanOrEqual(budget);
    }
  });
  it('shares source PTS across a dense scan grid and retains source interpolation', () => {
    const window = hybridTemporalWindow({ source: { localTime: 4, duration: 5, inPoint: 0, outPoint: 5, speed: 1, speedKeyframes: [] },
      horizon: 4, timeFactor: 1, samples: 1920, nearest: false },
    Array.from({ length: 126 }, (_, i) => ({ time: i / 25, duration: 1 / 25 })));
    expect(window.samples).toHaveLength(1920);
    expect(window.times.length).toBeLessThanOrEqual(102);
    const slots = new Map(window.times.map((time, i) => [time, i * 2]));
    const data = residentTemporalMetadata(window.metadata, window.times, slots, 2, 2);
    expect(data[1]).toBe(-1); expect(data[2]).toBe(-1);
    for (let i = 1; i < window.samples.length; i++) {
      expect(data[i * 4]).toBe(window.metadata[i * 4]);
      expect(data[i * 4 + 3]).toBe(window.metadata[i * 4 + 3]);
      expect(data[i * 4 + 1]).toBe(slots.get(window.times[window.metadata[i * 4 + 1] - 1]));
    }
    const header = window.metadata.length - 4;
    expect(data[header + 2]).toBe(4);
    expect([...data.slice(data.length - 4)]).toEqual([2, 2, 0, 0]);
    expect(() => residentTemporalMetadata(window.metadata, window.times, new Map(), 1, 1)).toThrow(/missing source frame/);
  });
});
