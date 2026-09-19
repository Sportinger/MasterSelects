import { describe, expect, it } from 'vitest';
import { buildAdaptiveQuadtree, marchingSquares } from '../../src/effects/geometry/geometryAlgorithms';

describe('geometry foundations', () => {
  it('subdivides high-variance image regions', () => {
    const cells = buildAdaptiveQuadtree({
      width: 2,
      height: 2,
      values: new Float32Array([0, 1, 1, 0]),
    }, 0.01, 2);
    expect(cells).toHaveLength(4);
    expect(cells.every((cell) => cell.depth === 1)).toBe(true);
  });

  it('extracts marching-squares contour segments', () => {
    const segments = marchingSquares({
      width: 2,
      height: 2,
      values: new Float32Array([1, 0, 0, 0]),
    }, 0.5);
    expect(segments).toEqual([{ from: [0, 0.5], to: [0.5, 0] }]);
  });
});
