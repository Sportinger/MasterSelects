import { describe, it, expect } from 'vitest';
import { CURVE_LABEL_OPERATOR, readCurveLabels } from '../../src/services/operators/geometry/curveLabels';
import { curveLabelExit } from '../../src/engine/native3d/labels/curveLabelSchedule';
const defaults = Object.fromEntries(CURVE_LABEL_OPERATOR.parameters.map(p => [p.id, p.default]));
const base = () => readCurveLabels(id => defaults[id]);
describe('terminal scan-card exit', () => {
  it('preserves old projects without an exit', () => {
    const old = { ...defaults };
    for (const key of ['outroStart','outroSpread','outroRetract','outroDuration','rollOffset']) delete old[key];
    expect(curveLabelExit(readCurveLabels(id => old[id]), 59, 0).panel).toBe(1);
  });
  it('uses deterministic nonsequential ranks and retracts before removing each card', () => {
    const s = { ...base(), count: 12, outroStart: 57 + 50 / 60, scheduleSeed: 17 };
    const starts = Array.from({ length: 12 }, (_, card) => curveLabelExit(s, 0, card).start);
    expect(new Set(starts).size).toBe(12);
    expect(starts).not.toEqual(starts.toSorted((a,b)=>a-b));
    expect(Math.min(...starts)).toBe(s.outroStart);
    expect(Math.max(...starts)).toBeCloseTo(s.outroStart + s.outroSpread);
    for (let card=0; card<12; card++) {
      const mid = curveLabelExit(s, starts[card]+s.outroRetract/2, card);
      expect(mid.leader).toBeCloseTo(.5); expect(mid.panel).toBe(1);
      expect(curveLabelExit(s, 59, card).panel).toBe(0);
      expect(curveLabelExit(s, 59, card).leader).toBe(0);
      expect(curveLabelExit(s, starts[card]-.01, card).panel).toBe(1);
    }
  });
});
