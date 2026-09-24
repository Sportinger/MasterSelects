import { describe, expect, it } from 'vitest';
import { buildCanvasMaskVertices, buildMaskEdgeSegments, buildProjectedMaskPath } from '../../src/components/preview/maskOverlay/maskOverlayProjectionPlans';
import { prepareMaskPointTransform, inverseTransformMaskPoint } from '../../src/utils/maskTransform';
import type { ClipMask, MaskVertex } from '../../src/types/masks';

describe('dense mask geometry', () => {
  it('prepares rotated paths in linear work rather than scanning all vertices per point', () => {
    let reads = 0;
    const vertices = Array.from({ length: 600 }, (_, i) => ({ id: String(i),
      get x() { reads++; return .5 + .4 * Math.cos(i / 600 * Math.PI * 2); },
      y: .5 + .4 * Math.sin(i / 600 * Math.PI * 2), handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 },
    }));
    const mask = { vertices, position: { x: .1, y: -.1 }, rotation: 37, closed: true, visible: true } as ClipMask;
    const size = { width: 1920, height: 1080 }, identity = (p: { x: number; y: number }) => p;
    expect(buildCanvasMaskVertices(mask, identity, size)).toHaveLength(600);
    expect(buildMaskEdgeSegments(mask, identity, size)).toHaveLength(600);
    expect(buildProjectedMaskPath(mask, identity, size)).toContain('Z');
    expect(reads).toBeLessThan(600 * 40);
  });
  it('preserves rotated coordinates and refreshes after geometry edits', () => {
    const mask = { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] as MaskVertex[], position: { x: .1, y: -.2 }, rotation: 37 };
    const size = { width: 1920, height: 1080 }, point = { x: .2, y: .7 };
    const transform = prepareMaskPointTransform(mask, size), actual = transform(point);
    const restored = inverseTransformMaskPoint(mask, actual, size);
    expect(restored.x).toBeCloseTo(point.x, 12); expect(restored.y).toBeCloseTo(point.y, 12);
    mask.vertices[0].x = -.5;
    expect(prepareMaskPointTransform(mask, size)(point)).not.toEqual(actual);
  });
  it('does not read the contour for an unrotated mask', () => {
    const mask = { get vertices(): MaskVertex[] { throw new Error('Unnecessary contour scan'); }, position: { x: .2, y: .3 }, rotation: 0 };
    expect(prepareMaskPointTransform(mask, { width: 1920, height: 1080 })({ x: .1, y: .2 })).toEqual({ x: .1 + .2, y: .5 });
  });
});
