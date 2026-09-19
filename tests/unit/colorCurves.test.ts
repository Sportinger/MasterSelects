import { describe, expect, it } from 'vitest';

import {
  compileRuntimeColorGrade,
  createDefaultColorCorrectionState,
  getActiveColorVersion,
  setColorNodeParamValue,
} from '../../src/types/colorCorrection';
import {
  areRuntimeColorCurvesNeutral,
  createNeutralColorCurve,
  getRuntimeColorCurves,
  sampleColorCurve,
  serializeColorCurvePoints,
} from '../../src/types/colorCurves';

describe('color curves', () => {
  it('samples the neutral diagonal without changing values', () => {
    const samples = sampleColorCurve(createNeutralColorCurve('y'));

    expect(samples).toHaveLength(16);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples[8]).toBeCloseTo(8 / 15, 4);
    expect(areRuntimeColorCurvesNeutral(getRuntimeColorCurves({}))).toBe(true);
  });

  it('compiles a curve-only node into the runtime grade', () => {
    const initial = createDefaultColorCorrectionState();
    const version = getActiveColorVersion(initial)!;
    const primaryNode = version.nodes.find(node => node.type === 'primary')!;
    const bowedCurve = serializeColorCurvePoints([
      { id: 'black', x: 0, y: 0 },
      { id: 'middle', x: 0.5, y: 0.72 },
      { id: 'white', x: 1, y: 1 },
    ]);
    const updated = setColorNodeParamValue(
      initial,
      version.id,
      primaryNode.id,
      'curveY',
      bowedCurve,
    );

    const grade = compileRuntimeColorGrade(updated);

    expect(grade?.nodeIds).toEqual([primaryNode.id]);
    expect(grade?.curvesByNode).toHaveLength(1);
    expect(grade?.curvesByNode?.[0].y[8]).toBeGreaterThan(8 / 15);
    expect(areRuntimeColorCurvesNeutral(grade!.curvesByNode![0])).toBe(false);
  });
});
