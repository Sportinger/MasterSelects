import { describe, expect, it } from 'vitest';
import { listBuiltInWeavePresets } from '../../src/services/operators/geometry/weavePresets';
import { instantiateEffectPreset } from '../../src/services/nodeGraph/effectPresetLibrary';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { evaluateGeometryProgram, type CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import type { Effect } from '../../src/types/effects';

const jellyfish = () => instantiateEffectPreset(listBuiltInWeavePresets().find(p => p.id === 'builtin:weave:jellyfish-reference')!);
const sample = (effect: Effect, time: number) => evaluateGeometryProgram(compileGeometryGraph(
  effect.operatorGraph!, geometryParameterReader(effect.params), undefined, { simulationTime: time }));
const maxDifference = (a: CurveSet, b: CurveSet) => a.positions.reduce((max, value, i) => Math.max(max, Math.abs(value - b.positions[i])), 0);

/** Follow the same material points, rather than a screen-space silhouette that hides circulation. */
function radialRatio(rest: CurveSet, moved: CurveSet, select: (z: number) => boolean): number {
  let before = 0, after = 0;
  for (let i = 0; i < rest.positions.length; i += 3) if (select(rest.positions[i + 2])) {
    before += Math.hypot(rest.positions[i], rest.positions[i + 1]);
    after += Math.hypot(moved.positions[i], moved.positions[i + 1]);
  }
  return after / before;
}

describe('jellyfish yarn circulation and swimming pulse', () => {
  it('animates finite closed yarns and repeats the complete default motion after twenty source seconds', () => {
    const effect = jellyfish(), start = sample(effect, 0);
    for (const time of [-1, 0.37, 1.25, 8.1, 20]) {
      const curves = sample(effect, time);
      expect([...curves.positions].every(Number.isFinite)).toBe(true);
      expect(curves.counts).toEqual(start.counts);
      for (let row = 0; row < curves.counts.length; row++) {
        const first = curves.starts[row] * 3, last = (curves.starts[row] + curves.counts[row] - 1) * 3;
        expect(curves.positions.slice(first, first + 3)).toEqual(curves.positions.slice(last, last + 3));
      }
    }
    expect(maxDifference(start, sample(effect, 0.37))).toBeGreaterThan(0.1);
    expect(maxDifference(start, sample(effect, 20))).toBeLessThan(0.00001);
    const later = sample(effect, 8.1);
    sample(effect, 0.2);
    expect(maxDifference(later, sample(effect, 8.1))).toBe(0);
  });

  it('circulates material through a stationary front while the pulse is off, with reversible direction', () => {
    const effect = jellyfish();
    effect.params['pulse-strength_value'] = 0;
    effect.params['return-motion_value'] = 0;
    const forward = sample(effect, 4), reversedTime = sample(effect, -4);
    expect(maxDifference(sample(effect, 0), forward)).toBeGreaterThan(0.5);
    // The knitted region remains on +Z; it is not a rigid rotation of the sculpture.
    const head = (curves: CurveSet) => {
      let min = Infinity, max = -Infinity;
      for (let i = 2; i < curves.positions.length; i += 3) {
        min = Math.min(min, curves.positions[i]); max = Math.max(max, curves.positions[i]);
      }
      return [min, max];
    };
    const [min, max] = head(forward);
    expect(min).toBeLessThan(-1); expect(max).toBeGreaterThan(1);
    effect.params.circulation_value = -0.05;
    expect(maxDifference(sample(effect, 4), reversedTime)).toBeLessThan(0.00001);
  });

  it('carries the localized head pulse to the tail at full strength', () => {
    const effect = jellyfish();
    effect.params.circulation_value = 0;
    effect.params.irregularity_value = 0;
    effect.params['pulse-strength_value'] = 0;
    const rest = sample(effect, 0);
    expect(maxDifference(rest, sample(effect, 7))).toBe(0);
    effect.params['pulse-strength_value'] = 0.4;
    const contracted = sample(effect, 1.25), trailing = sample(effect, 3.25);
    const headRatio = radialRatio(rest, contracted, z => z > 1.15);
    const tailRatio = radialRatio(rest, contracted, z => z < -1.15);
    expect(headRatio).toBeLessThan(0.7);
    expect(headRatio).toBeGreaterThan(0.59);
    expect(tailRatio).toBeGreaterThan(0.95);
    const tailPeak = radialRatio(rest, trailing, z => z < -1.15);
    expect(tailPeak).toBeLessThan(0.7);
    expect(Math.abs(tailPeak - headRatio)).toBeLessThan(0.08);
    const frontPoint = rest.positions.findIndex((value, index) => index % 3 === 2 && value > 1.15);
    expect(contracted.positions[frontPoint] - rest.positions[frontPoint]).toBeGreaterThan(0.005);
    // Even at the head, longitudinal movement remains local and very small.
    for (let i = 2; i < rest.positions.length; i += 3) {
      expect(Math.abs(contracted.positions[i] - rest.positions[i])).toBeLessThan(0.05);
    }
    expect(maxDifference(sample(effect, 0), sample(effect, 2.5))).toBeLessThan(0.00001);
  });

  it('animates the loose-loop noise even with circulation and pulse stopped, and can freeze it', () => {
    const effect = jellyfish();
    effect.params.circulation_value = 0;
    effect.params['pulse-strength_value'] = 0;
    const start = sample(effect, 0), moved = sample(effect, 4);
    let tailMotion = 0, headMotion = 0;
    for (let i = 0; i < start.positions.length; i += 3) {
      const displacement = Math.hypot(...[0, 1, 2].map(axis => moved.positions[i + axis] - start.positions[i + axis]));
      if (start.positions[i + 2] < 0) tailMotion = Math.max(tailMotion, displacement);
      if (start.positions[i + 2] > 1.1) headMotion = Math.max(headMotion, displacement);
    }
    expect(tailMotion).toBeGreaterThan(0.03);
    expect(headMotion).toBeLessThan(tailMotion * 0.3);
    expect(maxDifference(start, sample(effect, 20))).toBeLessThan(0.00001);
    effect.params['return-motion_value'] = 0;
    expect(maxDifference(sample(effect, 0), sample(effect, 4))).toBe(0);
  });

  it('narrows the resting returns without shortening the body or changing the knitted head', () => {
    const effect = jellyfish();
    effect.params.circulation_value = 0;
    effect.params.irregularity_value = 0;
    effect.params['pulse-strength_value'] = 0;
    effect.params['tail-inset_value'] = 0;
    const round = sample(effect, 0);
    effect.params['tail-inset_value'] = 0.45;
    const inset = sample(effect, 0);
    expect(radialRatio(round, inset, z => z < -0.9)).toBeCloseTo(0.775, 5);
    expect(radialRatio(round, inset, z => z > 1.1)).toBe(1);
    // Inset peaks at the shoulders; the back cap stays fuller, avoiding a pointed tail.
    expect(radialRatio(round, inset, z => z > 0.35 && z < 0.5)).toBeLessThan(0.6);
    expect(radialRatio(round, inset, z => z > 0.9 && z < 1)).toBeLessThan(0.98);
    for (let i = 2; i < round.positions.length; i += 3) expect(inset.positions[i]).toBe(round.positions[i]);
    effect.params['tail-inset_value'] = 0.85;
    expect(radialRatio(round, sample(effect, 0), z => z < -0.9)).toBeCloseTo(0.575, 5);
    effect.params['tail-inset_value'] = 0;
    expect(maxDifference(round, sample(effect, 0))).toBe(0);
  });

  it('preserves the moving head exactly while shaping the tail underneath noise and swimming', () => {
    const effect = jellyfish();
    for (const time of [0, 1.25, 4.7]) {
      effect.params['tail-inset_value'] = 0;
      const round = sample(effect, time);
      effect.params['tail-inset_value'] = 0.45;
      const inset = sample(effect, time);
      let headPoints = 0;
      for (let i = 0; i < round.positions.length; i += 3) if (round.positions[i + 2] > 1.18) {
        headPoints++;
        expect(inset.positions.slice(i, i + 3)).toEqual(round.positions.slice(i, i + 3));
      }
      expect(headPoints).toBeGreaterThan(100);
      expect(radialRatio(round, inset, z => z < -0.9)).toBeLessThan(0.9);
    }
  });

  it('keeps both motions continuous across a trimmed or moved host clip', () => {
    const effect = jellyfish();
    const original = { id: 'original', effects: [effect], startTime: 0, inPoint: 0, outPoint: 20, duration: 20 };
    const trimmed = { ...original, id: 'trimmed', startTime: 100, inPoint: 4, duration: 16 };
    const before = buildStrandsLayerSources(original, 5, [])[0].source.strands.program;
    const after = buildStrandsLayerSources(trimmed, 1, [])[0].source.strands.program;
    expect(maxDifference(evaluateGeometryProgram(before), evaluateGeometryProgram(after))).toBe(0);
  });
});
