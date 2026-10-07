import { describe, expect, it } from 'vitest';
import { instantiateEffectPreset } from '../../src/services/nodeGraph/effectPresetLibrary';
import { listBuiltInWeavePresets } from '../../src/services/operators/geometry/weavePresets';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { evaluateFieldColumn } from '../../src/services/operators/geometry/curveFieldColumns';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { Effect } from '../../src/types/effects';

const jellyfish = () => instantiateEffectPreset(listBuiltInWeavePresets().find(p => p.id === 'builtin:weave:jellyfish-reference')!);
const program = (effect: Effect, time: number) => compileGeometryGraph(effect.operatorGraph!, geometryParameterReader(effect.params), undefined, { simulationTime: time });
function isolated() {
  const effect = jellyfish();
  Object.assign(effect.params, { 'curl-strength_value': 0, irregularity_value: 0, 'return-motion_value': 0, 'soft-head_value': 0, 'soft-tail_value': 0 });
  return effect;
}
function field(effect: Effect, time: number, positions: number[][]) {
  const stage = program(effect, time).stages.find(s => s.nodeId === 'handmade');
  if (stage?.kind !== 'set-position' || !stage.offset) throw new Error('Missing soft motion field');
  const values = evaluateFieldColumn(stage.offset, { positions: new Float32Array(positions.flat()),
    starts: Uint32Array.from(positions.map((_, i) => i)), counts: new Uint32Array(positions.length).fill(1) });
  return positions.map((_, i) => values(i) as number[]);
}

describe('soft jellyfish head and individual yarn motion', () => {
  it('retains finite closed courses, transport bounds and save/reload fidelity with both curls enabled', () => {
    const effect = jellyfish(), restored = migratePersistedEffectOperatorGraph(JSON.parse(JSON.stringify(effect)));
    for (const time of [0, .25, 3, 20]) {
      const compiled = program(effect, time);
      expect(isGeometryProgram(JSON.parse(JSON.stringify(compiled)))).toBe(true);
      const curves = evaluateGeometryProgram(compiled);
      expect([...curves.positions].every(Number.isFinite)).toBe(true);
      curves.counts.forEach((count, strand) => {
        const start = curves.starts[strand] * 3, end = (curves.starts[strand] + count - 1) * 3;
        expect(curves.positions.slice(start, start + 3)).toEqual(curves.positions.slice(end, end + 3));
      });
      expect(evaluateGeometryProgram(program(restored, time)).positions).toEqual(curves.positions);
    }
  });

  it('gently animates the head as one surface, independent of yarn index, and leaves the tail alone', () => {
    const effect = isolated(); effect.params['soft-head_value'] = .035;
    const probes = [[.1, .2, 1.2], [.1, .2, 1.2], [.1, .2, -.8]];
    const first = field(effect, 0, probes), later = field(effect, 2, probes);
    expect(first[0]).toEqual(first[1]);
    expect(first[2]).toEqual([0, 0, 0]);
    expect(Math.hypot(...later[0].map((v, i) => v - first[0][i]))).toBeGreaterThan(.001);
    expect(Math.max(...first[0].map(Math.abs), ...later[0].map(Math.abs))).toBeLessThan(.036);
  });

  it('gives individual rear yarns different soft patterns without disturbing the knit', () => {
    const effect = isolated(); effect.params['soft-tail_value'] = .075;
    const probes = [[.25, .1, -.8], [.25, .1, -.8], [.25, .1, 1.2]];
    const first = field(effect, 0, probes);
    expect(Math.hypot(...first[0].map((v, i) => v - first[1][i]))).toBeGreaterThan(.005);
    expect(first[2]).toEqual([0, 0, 0]);
    expect(field(effect, 2, probes)).not.toEqual(first);
    effect.params['soft-speed_value'] = 0;
    expect(field(effect, 2, probes)).toEqual(first);
    // Nearby points of the same yarn bend smoothly; no per-point random seed.
    const a = field(effect, 0, [[.25, .1, -.82]])[0];
    const b = field(effect, 0, [[.25, .1, -.8]])[0];
    const c = field(effect, 0, [[.25, .1, -.78]])[0];
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(a[axis] - 2 * b[axis] + c[axis])).toBeLessThan(.003);
  });
  it('keeps the rear join smooth during long opposite flows instead of compressing noise there', () => {
    const effect = isolated();
    Object.assign(effect.params, { 'soft-tail_value': .2, 'return-motion_value': .4 });
    const count = 121, positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = -.3 + i * .005;
      positions.set([x, .1, -1.1 + x * x * .5], i * 3);
    }
    const curves = { positions, starts: Uint32Array.of(0), counts: Uint32Array.of(count) };
    for (const time of [0, 10, 20, 60, 180, 600]) {
      const stage = program(effect, time).stages.find(s => s.nodeId === 'handmade');
      if (stage?.kind !== 'set-position' || !stage.offset) throw new Error('Missing soft motion');
      const sample = evaluateFieldColumn(stage.offset, curves);
      let maximumBend = 0;
      for (let i = 1; i < count - 1; i++) {
        const a = sample(i - 1) as number[], b = sample(i) as number[], c = sample(i + 1) as number[];
        for (let axis = 0; axis < 3; axis++) maximumBend = Math.max(maximumBend, Math.abs(a[axis] - 2 * b[axis] + c[axis]));
      }
      expect(maximumBend, `rear seam at ${time}s`).toBeLessThan(.002);
    }
  });

  it('extends the free returns by 50 percent while keeping the animated head and transverse motion', () => {
    const effect = jellyfish(), anchor = .55 * Number(effect.params['body-length_value']);
    for (const time of [0, 1.25, 17]) {
      effect.params['return-length_value'] = 1;
      const before = evaluateGeometryProgram(program(effect, time));
      effect.params['return-length_value'] = 1.5;
      const after = evaluateGeometryProgram(program(effect, time));
      let head = 0, tail = 0;
      for (let i = 0; i < before.positions.length; i += 3) {
        expect(after.positions[i]).toBe(before.positions[i]);
        expect(after.positions[i + 1]).toBe(before.positions[i + 1]);
        const z = before.positions[i + 2];
        if (z >= anchor) {
          expect(after.positions[i + 2]).toBe(z); head++;
        } else if (z < 0) {
          expect((anchor - after.positions[i + 2]) / (anchor - z)).toBeCloseTo(1.5, 5); tail++;
        }
      }
      expect(head).toBeGreaterThan(100); expect(tail).toBeGreaterThan(100);
    }
  });

});
