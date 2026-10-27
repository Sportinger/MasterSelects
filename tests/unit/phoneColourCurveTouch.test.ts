import { describe, expect, it } from 'vitest';

import { createCurveTouchMapping, findTouchedCurvePoint } from '../../src/components/panels/color-workspace/colorCurveTouch';

// A finger on the phone colour curve grabs the nearest drawn point; the mapping comes from where the
// CurveEditor drew the points (x 0..1 across, y linear, screen y pointing down).
const points = [
  { id: 'black', x: 0, y: 0 },
  { id: 'mid', x: 0.5, y: 0.5 },
  { id: 'white', x: 1, y: 1 },
];
// Drawn at x 100..300, y 200 (value 0) .. 40 (value 1), listed out of order.
const centres = [{ x: 300, y: 40 }, { x: 100, y: 200 }, { x: 200, y: 120 }];

describe('colour curve touch mapping', () => {
  it('maps screen positions to curve values and back', () => {
    const mapping = createCurveTouchMapping(points, centres)!;
    expect(mapping.toCurve(200, 120)).toEqual({ x: 0.5, y: 0.5 });
    expect(mapping.toCurve(150, 40)).toEqual({ x: 0.25, y: 1 });
    expect(mapping.toScreen({ x: 1, y: 0 })).toEqual({ x: 300, y: 200 });
  });

  it('picks the nearest point within the finger radius and nothing outside it', () => {
    const mapping = createCurveTouchMapping(points, centres)!;
    expect(findTouchedCurvePoint(points, mapping, 210, 130)).toBe('mid');
    expect(findTouchedCurvePoint(points, mapping, 105, 195)).toBe('black');
    expect(findTouchedCurvePoint(points, mapping, 250, 160)).toBeNull();
  });

  it('refuses a drawing that does not match the points', () => {
    expect(createCurveTouchMapping(points, centres.slice(0, 2))).toBeNull();
    expect(createCurveTouchMapping([{ id: 'a', x: 0, y: 0.5 }, { id: 'b', x: 1, y: 0.5 }], [{ x: 0, y: 10 }, { x: 10, y: 10 }])).toBeNull();
  });

  it('maps a flat curve with the graph box (20 px padding top and bottom)', () => {
    const flat = [{ id: 'a', x: 0, y: 0.5 }, { id: 'b', x: 1, y: 0.5 }];
    const mapping = createCurveTouchMapping(flat, [{ x: 0, y: 150 }, { x: 200, y: 150 }], { top: 50, height: 240 })!;
    expect(mapping.toCurve(100, 270).y).toBeCloseTo(0, 6);
    expect(mapping.toCurve(100, 70)).toEqual({ x: 0.5, y: 1 });
  });
});
