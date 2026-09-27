import { describe, expect, it } from 'vitest';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import { FLOCK_PARTICLE_STRIDE, P_POS, P_VEL, type FlockProgram } from '../../src/services/flock/compiler/flockProgramTypes';
import { FlockCpuSolver } from '../../src/engine/flock/cpu/flockCpuSolver';

const context = { keyframesByProperty: indexFlockKeyframes([]) };

function buildDam(fluid: Record<string, unknown> = {}): FlockProgram {
  const b = new FlockGraphBuilder();
  // A block of liquid in the left half of a 40x40x10 box.
  const emitter = b.add('flock.emitter', { count: 1600, shape: 'box', center: [-10, -5, 0], size: [18, 28, 8], initialSpeed: 0 });
  const sim = b.add('flock.simulation', { stepRate: '60', minSpeed: 0, maxSpeed: 400, maxAcceleration: 2000 });
  const flip = b.add('flock.fluid', { center: [0, 0, 0], size: [40, 40, 10], cellSize: 2, iterations: 60, gravity: [0, -200, 0], ...fluid });
  const points = b.add('flock.render-points');
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', sim, 'spawn')
    .connect(flip, 'behavior', sim, 'behavior')
    .connect(sim, 'particles', points, 'particles')
    .connect(points, 'scene', output, 'scene');
  const result = compileFlockDefinition(b.build('dam-break'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

function column(solver: FlockCpuSolver, axis: number, offset = P_POS): number[] {
  const values: number[] = [];
  for (let index = 0; index < solver.capacity; index += 1) values.push(solver.state[index * FLOCK_PARTICLE_STRIDE + offset + axis]);
  return values;
}

describe('APIC fluid', () => {
  it('compiles one MAC grid covering the domain', () => {
    const program = buildDam();
    expect(program.fluid).not.toBeNull();
    expect(program.fluid!.dims).toEqual([20, 20, 5]);
    expect(program.fluid!.origin).toEqual([-20, -20, -5]);
  });

  it('keeps liquid inside the solid domain and lets a dam collapse sideways', () => {
    const solver = new FlockCpuSolver(buildDam());
    solver.advanceTo(1, context);
    const startMaxX = Math.max(...column(solver, 0));
    solver.advanceTo(90, context);
    const xs = column(solver, 0);
    const ys = column(solver, 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-20);
    expect(Math.max(...xs)).toBeLessThanOrEqual(20);
    // Pressure pushes the collapsing column toward the empty right half.
    expect(Math.max(...xs)).toBeGreaterThan(startMaxX + 8);
  });

  it('removes most divergence in the pressure projection', () => {
    const solver = new FlockCpuSolver(buildDam({ iterations: 120 }));
    solver.advanceTo(30, context);
    expect(solver.fluid!.maxDivergence()).toBeLessThan(0.5);
  });

  it('settles instead of exploding', () => {
    const solver = new FlockCpuSolver(buildDam());
    solver.advanceTo(240, context);
    const speeds = column(solver, 1, P_VEL).map((v, i) => Math.hypot(column(solver, 0, P_VEL)[i], v));
    const mean = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;
    expect(Number.isFinite(mean)).toBe(true);
    expect(mean).toBeLessThan(120);
    expect(Array.from(solver.fluid!.affine).every(Number.isFinite)).toBe(true);
  });

  it('restores affine history exactly across checkpoint replay and resets it for a restart', () => {
    const solver = new FlockCpuSolver(buildDam());
    solver.advanceTo(8, context);
    const checkpoint = solver.checkpoint();
    expect(checkpoint.affine!.some(value => Math.abs(value) > 0.01)).toBe(true);
    solver.advanceTo(16, context);
    const expected = solver.checkpoint();
    solver.restore(checkpoint); solver.advanceTo(16, context);
    expect(solver.checkpoint()).toEqual(expected);
    expect(() => solver.restore({ ...checkpoint, affine: null })).toThrow('Incompatible fluid checkpoint');
    solver.reset();
    expect(solver.fluid!.affine.every(value => value === 0)).toBe(true);
    solver.advanceTo(8, context);
    expect(solver.checkpoint()).toEqual(checkpoint);
  });
});
