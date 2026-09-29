import { describe, expect, it } from 'vitest';
import { createSculpturePreset } from '../../src/services/flock/presets/flockSculpturePresets';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { resolveFlockStep } from '../../src/services/flock/compiler/flockParamEvaluation';
import { FLOCK_PARTICLE_STRIDE } from '../../src/services/flock/compiler/flockProgramTypes';
import { prepareCpuStepParams, type CpuFieldOp } from '../../src/engine/flock/cpu/flockCpuStepParams';
import { accumulateFieldForces } from '../../src/engine/flock/cpu/flockCpuForces';

function fixture() {
  const result = compileFlockDefinition(createSculpturePreset('terracotta'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const params = prepareCpuStepParams(resolveFlockStep(result.program, 600, { keyframesByProperty: new Map() }));
  const fields = params.fields.filter(field => field.kind === 10);
  const force = (selected: CpuFieldOp[], position: number[]) => {
    const state = new Float32Array(FLOCK_PARTICLE_STRIDE);
    state.set(position);
    const acceleration = new Float64Array(3);
    accumulateFieldForces({ ...params, fields: selected }, state, 0, new Uint8Array(), acceleration);
    return [...acceleration];
  };
  return { fields, force };
}

describe('overlapping sculpture flows', () => {
  it('adds independent fields in their overlap instead of triggering separate crests', () => {
    const { fields, force } = fixture();
    expect(fields).toHaveLength(7);
    const a = force([fields[1]], [0, 20, 12]);
    const b = force([fields[2]], [0, 20, 12]);
    expect(Math.hypot(...a)).toBeGreaterThan(0);
    expect(Math.hypot(...b)).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
    const combined = force([fields[1], fields[2]], [0, 20, 12]);
    combined.forEach((value, axis) => expect(value).toBeCloseTo(a[axis] + b[axis], 10));
  });

  it('fades local fields smoothly to zero and keeps radius zero global', () => {
    const { fields, force } = fixture();
    const local = fields[1];
    const center = local.v1;
    expect(Math.hypot(...force([local], center))).toBeGreaterThan(0);
    expect(force([local], [center[0] + local.f[4], center[1], center[2]])).toEqual([0, 0, 0]);
    const edge = force([local], [center[0] + local.f[4] - 0.001, center[1], center[2]]);
    expect(Math.hypot(...edge)).toBeLessThan(0.00001);
    const global = { ...local, f: local.f.slice() };
    global.f[4] = 0;
    expect(Math.hypot(...force([global], [1000, 2000, 3000]))).toBeGreaterThan(0);
  });
});
