import { describe, expect, it } from 'vitest';
import { guidedPerspective, guidedPerspectiveFillScale, guidedPerspectiveMatrix, guidedPerspectiveScale, guidedPerspectiveWarnings,
  MAX_FILL_SCALE } from '../../src/effects/distort/guided-perspective';
import { resolveEffectPreset } from '../../src/services/effects/effectPresets';
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
    expect([...values]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0]);
    const corrupted = guidedPerspective.packUniforms({ matrix0: 1e300, matrix1: NaN, scale: Infinity, strength: 250 }, 1, 1)!;
    expect([...corrupted].every(Number.isFinite)).toBe(true);
    expect(corrupted[0]).toBe(10000); expect(corrupted[12]).toBe(1);
    // Strength 0 (or below) is the untouched photo.
    expect([...guidedPerspective.packUniforms({ matrix0: 3, matrix7: .4, strength: -10 }, 1, 1)!].slice(0, 12))
      .toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(guidedPerspectiveWarnings({ matrix0: 1e300, scale: Infinity, strength: 250 })).toHaveLength(3);
    expect(guidedPerspectiveWarnings({ scale: 120, strength: 40 })).toEqual([]);
  });
  it('keeps straight lines straight at partial strength by blending the projective matrix', () => {
    const { inverse } = solveGuidedPerspective(vertical, 1.5);
    const values = Object.fromEntries(inverse.map((value, i) => [`matrix${i}`, value * 1.7]));
    for (const strength of [0, 35, 50, 100]) {
      const m = guidedPerspectiveMatrix({ ...values, strength });
      const map = (u: number, v: number): [number, number] => {
        const w = m[6] * u + m[7] * v + m[8];
        return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
      };
      // Three points on one output line land on one source line (zero cross product).
      const [a, b, c] = [map(.1, .2), map(.5, .55), map(.9, .9)];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeCloseTo(0, 12);
      if (strength === 0) expect(map(.3, .7)[0]).toBeCloseTo(.3, 12);
    }
    // Full strength is the stored correction (any overall scale of the matrix maps the same).
    const full = guidedPerspectiveMatrix({ ...values, strength: 100 });
    const p = transformGuidePoint(inverse, .3, .6), q = transformGuidePoint(full as Matrix3, .3, .6);
    expect(q[0]).toBeCloseTo(p[0], 12); expect(q[1]).toBeCloseTo(p[1], 12);
  });
  it('Fill Frame enlarges just enough that the corrected photo covers every frame corner', () => {
    const { inverse } = solveGuidedPerspective(vertical, 16 / 9);
    const values = Object.fromEntries(inverse.map((value, i) => [`matrix${i}`, value]));
    const covers = (m: number[], scale: number, margin: number) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([x, y]) => {
      const u = (x - .5) / scale + .5, v = (y - .5) / scale + .5, w = m[6] * u + m[7] * v + m[8];
      const s = [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
      return w > 0 && s.every(c => c >= margin && c <= 1 - margin);
    });
    for (const strength of [100, 80, 50]) {
      const fill = guidedPerspectiveFillScale({ ...values, strength })!;
      const m = guidedPerspectiveMatrix({ ...values, strength });
      expect(fill).toBeGreaterThan(1);
      expect(covers(m, fill, -1e-9)).toBe(true);
      expect(covers(m, fill * .99, 0)).toBe(false);
    }
    // A weaker correction needs less enlargement; Scale multiplies on top; off keeps Scale alone.
    expect(guidedPerspectiveFillScale({ ...values, strength: 50 })!).toBeLessThan(guidedPerspectiveFillScale(values)!);
    expect(guidedPerspectiveScale({ ...values, fillFrame: true, scale: 120 })).toBeCloseTo(guidedPerspectiveFillScale(values)! * 1.2, 9);
    expect(guidedPerspectiveScale({ ...values, scale: 120 })).toBeCloseTo(1.2, 9);
    expect(guidedPerspective.packUniforms({ ...values, fillFrame: true }, 1920, 1080)![12]).toBeCloseTo(guidedPerspectiveFillScale(values)!, 5);
    // Without guides nothing needs filling; saved effects without the parameter keep the whole photo.
    expect(guidedPerspectiveFillScale({ fillFrame: true })).toBe(1);
    expect(guidedPerspective.packUniforms(values, 1920, 1080)![12]).toBe(1);
    expect(guidedPerspectiveWarnings({ ...values, fillFrame: true })).toEqual([]);
  });
  it('Fill Frame says so and keeps the whole photo when no enlargement up to the limit covers the frame', () => {
    // The photo's footprint misses the frame centre: no enlargement fills it.
    const shifted = { matrix2: .8, fillFrame: true };
    expect(guidedPerspectiveFillScale(shifted)).toBeUndefined();
    expect(guidedPerspectiveScale(shifted)).toBe(1);
    expect(guidedPerspectiveWarnings(shifted)).toEqual([expect.stringContaining(`more than ${MAX_FILL_SCALE}×`)]);
  });
  it('presets change framing and strength but keep the drawn guides and their correction', () => {
    const { inverse } = solveGuidedPerspective(vertical, 16 / 9);
    const drawn = { guides: JSON.stringify(vertical), ...Object.fromEntries(inverse.map((value, i) => [`matrix${i}`, value])) };
    expect(guidedPerspective.presets?.map(preset => preset.name)).toEqual(['Whole Photo', 'Fill Frame', 'Natural Lean', 'Soft Correction']);
    for (const preset of guidedPerspective.presets!) {
      const values = resolveEffectPreset({ type: 'guided-perspective', params: { ...drawn, scale: 140, strength: 30 } }, preset);
      expect(values.guides).toBeUndefined();
      expect(Object.keys(values).some(key => key.startsWith('matrix'))).toBe(false);
      expect(values.scale).toBe(100);
      const result = { ...drawn, scale: 140, strength: 30, ...values };
      expect(guidedPerspectiveWarnings(result)).toEqual([]);
      // Fill presets leave no transparent border on the drawn correction.
      if (result.fillFrame) expect(guidedPerspectiveFillScale(result)).toBeGreaterThan(1);
    }
  });
});
