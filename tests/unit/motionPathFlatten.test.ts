import { describe, expect, it } from 'vitest';
import type { MotionPathVertex, PathShapeDefinition } from '../../src/types/motionDesign';
import { flattenMotionPath } from '../../src/services/motionDesign/path/flattenPath';

const zero = { x: 0, y: 0 };

function vertex(
  x: number,
  y: number,
  handleIn = zero,
  handleOut = zero,
): MotionPathVertex {
  return { x, y, handleIn: { ...handleIn }, handleOut: { ...handleOut } };
}

describe('flattenMotionPath', () => {
  it('flattens a straight 100px line with exact endpoints and bounds', () => {
    const result = flattenMotionPath({
      vertices: [vertex(-50, 0), vertex(50, 0)],
      closed: false,
    });

    expect(result).not.toBeNull();
    expect(result?.points).toEqual([{ x: -50, y: 0 }, { x: 50, y: 0 }]);
    expect(result?.cumulativeLengths).toEqual([0, 100]);
    expect(result?.totalLength).toBe(100);
    expect(result?.bounds).toEqual({ minX: -50, minY: 0, maxX: 50, maxY: 0 });
  });

  it('closes a square with a duplicate first point and increasing arc lengths', () => {
    const result = flattenMotionPath({
      vertices: [
        vertex(0, 0),
        vertex(10, 0),
        vertex(10, 10),
        vertex(0, 10),
      ],
      closed: true,
    });

    expect(result?.points.at(-1)).toEqual(result?.points[0]);
    expect(result?.totalLength).toBe(40);
    expect(result?.cumulativeLengths.every((length, index, lengths) => (
      index === 0 || length > lengths[index - 1]
    ))).toBe(true);
  });

  it('approximates a half-circle cubic path within 1.5 percent of analytic length', () => {
    const radius = 100;
    const kappa = 0.5522847498307936;
    const result = flattenMotionPath({
      vertices: [
        vertex(-radius, 0, zero, { x: 0, y: -kappa * radius }),
        vertex(0, -radius, { x: -kappa * radius, y: 0 }, { x: kappa * radius, y: 0 }),
        vertex(radius, 0, { x: 0, y: -kappa * radius }, zero),
      ],
      closed: false,
    });

    expect(result).not.toBeNull();
    expect(Math.abs((result?.totalLength ?? 0) - Math.PI * radius) / (Math.PI * radius))
      .toBeLessThan(0.015);
  });

  it('caps a curly many-segment path while preserving exact endpoints', () => {
    const vertices = Array.from({ length: 128 }, (_, index) => vertex(
      index * 10,
      index % 2 === 0 ? -20 : 20,
      { x: -5, y: index % 2 === 0 ? 80 : -80 },
      { x: 5, y: index % 2 === 0 ? -80 : 80 },
    ));
    const result = flattenMotionPath({ vertices, closed: false }, 0.01);

    expect(result).not.toBeNull();
    expect(result?.points.length).toBeLessThanOrEqual(512);
    expect(result?.points[0]).toEqual({ x: vertices[0].x, y: vertices[0].y });
    expect(result?.points.at(-1)).toEqual({
      x: vertices.at(-1)?.x,
      y: vertices.at(-1)?.y,
    });
  });

  it('returns null for paths without nonzero arc length', () => {
    expect(flattenMotionPath({ vertices: [vertex(0, 0)], closed: false })).toBeNull();
    expect(flattenMotionPath({
      vertices: [vertex(2, 3), vertex(2, 3)],
      closed: false,
    })).toBeNull();
  });

  it('ignores trim and dash fields', () => {
    const base: PathShapeDefinition = {
      vertices: [
        vertex(0, 0, zero, { x: 25, y: 50 }),
        vertex(100, 0, { x: -25, y: 50 }, zero),
      ],
      closed: false,
    };
    const decorated: PathShapeDefinition = {
      ...base,
      trim: { start: 0.2, end: 0.8, offset: 0.1 },
      dash: { length: 12, gap: 4, offset: 3 },
    };

    expect(flattenMotionPath(decorated)).toEqual(flattenMotionPath(base));
  });
});
