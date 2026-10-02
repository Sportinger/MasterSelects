import { describe, expect, it } from 'vitest';
import { guidedPerspective } from '../../src/effects/distort/guided-perspective';
import { IDENTITY, invertMatrix, multiplyMatrix, parsePerspectiveGuides, solveGuidedPerspective, transformGuidePoint,
  type Matrix3, type PerspectiveGuide } from '../../src/effects/distort/guided-perspective/guideGeometry';

const vertical: PerspectiveGuide[] = [
  { axis: 'vertical', x1: .3, y1: .1, x2: .2, y2: .9 },
  { axis: 'vertical', x1: .7, y1: .1, x2: .8, y2: .9 },
];
describe('Guided Perspective', () => {
  it.each([1.5, 2 / 3])('aligns two converging vertical guides at aspect %s and fits every source corner', aspect => {
    const { forward, inverse } = solveGuidedPerspective(vertical, aspect);
    for (const g of vertical) {
      const a = transformGuidePoint(forward, g.x1, g.y1), b = transformGuidePoint(forward, g.x2, g.y2);
      expect(a[0]).toBeCloseTo(b[0], 9);
    }
    for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1], [.3, .4]]) {
      const p = transformGuidePoint(forward, x, y);
      expect(p.every(v => v >= -1e-8 && v <= 1 + 1e-8)).toBe(true);
      const original = transformGuidePoint(inverse, ...p);
      expect(original[0]).toBeCloseTo(x, 9); expect(original[1]).toBeCloseTo(y, 9);
    }
  });
  it('rectifies both axes of an independently generated projective grid', () => {
    const camera: Matrix3 = [1, .08, -.03, .1, 1, -.02, .12, -.08, 1];
    const guide = (axis: PerspectiveGuide['axis'], a: number[], b: number[]): PerspectiveGuide => {
      const p = transformGuidePoint(camera, a[0], a[1]), q = transformGuidePoint(camera, b[0], b[1]);
      return { axis, x1: p[0], y1: p[1], x2: q[0], y2: q[1] };
    };
    const guides = [guide('vertical', [.2, .2], [.2, .8]), guide('vertical', [.8, .2], [.8, .8]),
      guide('horizontal', [.2, .2], [.8, .2]), guide('horizontal', [.2, .8], [.8, .8])];
    const { forward } = solveGuidedPerspective(guides, 1.5);
    for (const g of guides) {
      const a = transformGuidePoint(forward, g.x1, g.y1), b = transformGuidePoint(forward, g.x2, g.y2);
      const coord = g.axis === 'vertical' ? 0 : 1;
      expect(a[coord]).toBeCloseTo(b[coord], 8);
    }
  });
  it('keeps an already aligned photo unchanged', () => {
    const aligned = vertical.map((g, i) => ({ ...g, x1: i ? .8 : .2, x2: i ? .8 : .2 }));
    const { forward } = solveGuidedPerspective(aligned, 1.5);
    forward.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
    multiplyMatrix(forward, invertMatrix(forward)).forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
  });
  it('fits eight lines per direction to a common projective grid and tolerates measurement noise', () => {
    const camera: Matrix3 = [1, .08, -.03, .1, 1, -.02, .12, -.08, 1];
    const guides: PerspectiveGuide[] = [];
    for (let i = 0; i < 8; i++) {
      const position = .15 + i * .1;
      for (const axis of ['vertical', 'horizontal'] as const) {
        const a = transformGuidePoint(camera, axis === 'vertical' ? position : .15, axis === 'horizontal' ? position : .15);
        const b = transformGuidePoint(camera, axis === 'vertical' ? position : .85, axis === 'horizontal' ? position : .85);
        guides.push({ axis, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      }
    }
    const { forward } = solveGuidedPerspective(guides, 2 / 3);
    for (const g of guides) {
      const a = transformGuidePoint(forward, g.x1, g.y1), b = transformGuidePoint(forward, g.x2, g.y2);
      const coord = g.axis === 'vertical' ? 0 : 1;
      expect(a[coord]).toBeCloseTo(b[coord], 8);
    }
    const noisy = guides.map((g, i) => ({ ...g, x2: g.x2 + (i % 2 ? .0005 : -.0005) }));
    expect(solveGuidedPerspective(noisy, 2 / 3).inverse.every(Number.isFinite)).toBe(true);
    expect(parsePerspectiveGuides(JSON.stringify(guides))).toHaveLength(16);
    expect(() => solveGuidedPerspective([...guides, guides[0]], 1.5)).toThrow();
  });
  it('rejects incomplete, duplicate, short and unstable guides', () => {
    expect(() => solveGuidedPerspective([], 1.5)).toThrow('at least two');
    expect(() => solveGuidedPerspective([vertical[0], vertical[0]], 1.5)).toThrow('overlap');
    expect(() => solveGuidedPerspective([vertical[0], { ...vertical[1], axis: 'horizontal' }], 1.5)).toThrow('two horizontal');
    expect(() => solveGuidedPerspective(vertical.map(g => ({ ...g, x2: g.x1, y2: g.y1 })), 1.5)).toThrow('too short');
    expect(() => solveGuidedPerspective(vertical, 0)).toThrow('dimensions');
    expect(() => solveGuidedPerspective(vertical.map(g => ({ ...g, x2: 1 - g.x1 })), 1.5)).toThrow();
    expect(parsePerspectiveGuides('invalid')).toEqual([]);
    expect(parsePerspectiveGuides('[{"axis":"vertical","x1":null}]')).toEqual([]);
    expect(parsePerspectiveGuides(JSON.stringify(vertical))).toEqual(vertical);
  });
  it('packs a neutral finite shader transform and bounds corrupted parameters', () => {
    const values = guidedPerspective.packUniforms({}, 1920, 1080)!;
    expect(values.byteLength).toBe(64);
    expect([...values]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0]);
    const corrupted = guidedPerspective.packUniforms({ matrix0: 1e300, matrix1: NaN, scale: Infinity, strength: -10 }, 1, 1)!;
    expect([...corrupted].every(Number.isFinite)).toBe(true);
    expect(corrupted[0]).toBe(10000); expect(corrupted[12]).toBe(1); expect(corrupted[13]).toBe(0);
  });
});
