import { describe, expect, it } from 'vitest';
import { computeRulerTicks } from '../../src/components/preview/previewRulerTicks';

describe('preview ruler ticks', () => {
  it('labels composition pixels from the canvas origin at a readable spacing', () => {
    // 1920 px composition shown 960 CSS px wide, starting 100 px into the ruler.
    const ticks = computeRulerTicks(100, 0.5, 1200);
    const majors = ticks.filter((tick) => tick.major);
    expect(majors[0]).toEqual({ offset: 0, value: -200, major: true });
    expect(majors.find((tick) => tick.value === 0)?.offset).toBe(100);
    expect(majors.find((tick) => tick.value === 1000)?.offset).toBe(600);
    for (let index = 1; index < majors.length; index += 1) {
      expect(majors[index].offset - majors[index - 1].offset).toBeGreaterThanOrEqual(64);
    }
  });

  it('switches to single-pixel majors when zoomed far in', () => {
    const ticks = computeRulerTicks(-5000, 80, 400);
    expect(ticks.every((tick) => tick.major)).toBe(true);
    expect(ticks.map((tick) => tick.value).slice(0, 3)).toEqual([63, 64, 65]);
  });

  it('places minor ticks between majors and keeps the tick count bounded', () => {
    const ticks = computeRulerTicks(0, 1, 1000);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.value).slice(0, 3)).toEqual([0, 100, 200]);
    expect(ticks.filter((tick) => !tick.major).length).toBeGreaterThan(0);
    expect(computeRulerTicks(0, 0.0001, 100000).length).toBeLessThanOrEqual(1200);
  });

  it('returns nothing for an unusable scale', () => {
    expect(computeRulerTicks(0, 0, 500)).toEqual([]);
    expect(computeRulerTicks(Number.NaN, 1, 500)).toEqual([]);
  });
});
