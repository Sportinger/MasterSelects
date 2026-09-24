import { describe, expect, it } from 'vitest';
import { maskVertexSizing } from '../../src/components/preview/maskOverlay/maskVertexSizing';

describe('mask vertex display density', () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  it('keeps sparse handles at eight screen pixels while shrinking dense contours', () => {
    expect(maskVertexSizing(points, 1)[0].size).toBeCloseTo(2.2);
    const zoomed = maskVertexSizing(points, .1)[0];
    expect(zoomed.size / .1).toBe(8);
    expect(zoomed.hitRadius / .1).toBeCloseTo(14);
  });
  it('retains visible markers and usable hit areas when zoomed far out', () => {
    const marker = maskVertexSizing(points, 10)[0];
    expect(marker.size / 10).toBe(1.5);
    expect(marker.hitRadius / 10).toBe(3);
  });
  it('ignores duplicate bridge vertices when estimating density', () => {
    expect(maskVertexSizing([points[0], points[0], ...points.slice(1)], 1)[0].size).toBeCloseTo(2.2);
  });
});
