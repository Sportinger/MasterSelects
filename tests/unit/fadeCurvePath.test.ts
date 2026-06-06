import { describe, expect, it } from 'vitest';
import { buildFadeCurvePath } from '../../src/components/timeline/utils/fadeCurvePath';

const extractPathNumbers = (path: string): number[] => (
  path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
);

describe('fade curve path builder', () => {
  it('builds the same cubic path shape for linear keyframes used by DOM and canvas', () => {
    const path = buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 1, value: 1, easing: 'linear' },
      ],
      clipDuration: 4,
      width: 80,
      height: 40,
    });

    const curveNumbers = extractPathNumbers(path?.curvePath ?? '');
    expect(curveNumbers).toHaveLength(8);
    expect(curveNumbers).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(40, 6),
      expect.closeTo(20 / 3, 6),
      expect.closeTo(80 / 3, 6),
      expect.closeTo(40 / 3, 6),
      expect.closeTo(40 / 3, 6),
      expect.closeTo(20, 6),
      expect.closeTo(0, 6),
    ]);
    expect(path?.fillPath).toBe(`${path?.curvePath} L 20 40 L 0 40 Z`);
    expect(path?.points).toEqual([
      { x: 0, y: 40 },
      { x: 20, y: 0 },
    ]);
  });

  it('preserves custom bezier handles', () => {
    const path = buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'bezier', handleOut: { x: 0.5, y: 0.25 } },
        { time: 2, value: 1, easing: 'linear', handleIn: { x: -0.5, y: -0.25 } },
      ],
      clipDuration: 4,
      width: 80,
      height: 40,
    });

    expect(path?.curvePath).toContain('C 10 30, 30 10, 40 0');
  });

  it('skips invalid geometry or incomplete keyframes', () => {
    expect(buildFadeCurvePath({
      keyframes: [{ time: 0, value: 0, easing: 'linear' }],
      clipDuration: 4,
      width: 80,
      height: 40,
    })).toBeNull();
    expect(buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 1, value: 1, easing: 'linear' },
      ],
      clipDuration: 0,
      width: 80,
      height: 40,
    })).toBeNull();
  });
});
