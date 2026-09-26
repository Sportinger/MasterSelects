import { describe, expect, it } from 'vitest';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import { FLOCK_PARTICLE_STRIDE, P_POS, type FlockProgram } from '../../src/services/flock/compiler/flockProgramTypes';
import { FlockCpuSolver } from '../../src/engine/flock/cpu/flockCpuSolver';
import { curlNoise3, flockGridDims, flockGridRest } from '../../src/engine/flock/shared/flockMath';
import type { FlockParamValue } from '../../src/types/flock';

const context = { keyframesByProperty: indexFlockKeyframes([]) };

function buildCanvas(behaviors: Array<[string, Record<string, FlockParamValue>]>, gridJitter = 0.6): FlockProgram {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 64, shape: 'grid', size: [80, 40, 0], initialSpeed: 0, gridJitter });
  const sim = b.add('flock.simulation', { stepRate: '60', minSpeed: 0, maxSpeed: 200, maxAcceleration: 1000 });
  const points = b.add('flock.render-points');
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', sim, 'spawn').connect(sim, 'particles', points, 'particles').connect(points, 'scene', output, 'scene');
  if (behaviors.length > 0) {
    const compose = b.add('flock.compose');
    for (const [operator, params] of behaviors) b.connect(b.add(operator, params), 'behavior', compose, 'behavior');
    b.connect(compose, 'behavior', sim, 'behavior');
  }
  const result = compileFlockDefinition(b.build('pigment-canvas'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

function position(solver: FlockCpuSolver, index: number): number[] {
  const base = index * FLOCK_PARTICLE_STRIDE + P_POS;
  return [solver.state[base], solver.state[base + 1], solver.state[base + 2]];
}

describe('flock pigment canvas', () => {
  it('lays grid emitters out row-major with the emitter aspect', () => {
    expect(flockGridDims(64, [80, 40, 0])).toEqual([11, 6]);
    const solver = new FlockCpuSolver(buildCanvas([], 0));
    solver.advanceTo(1, context);
    const [cols, rows] = flockGridDims(64, [80, 40, 0]);
    const first = position(solver, 0);
    expect(first[0]).toBeCloseTo((0.5 / cols - 0.5) * 80, 4);
    expect(first[1]).toBeCloseTo((0.5 - 0.5 / rows) * 40, 4);
    expect(first[2]).toBe(0);
    expect(position(solver, 1)[0]).toBeGreaterThan(position(solver, 0)[0]);
    expect(position(solver, cols)[1]).toBeLessThan(position(solver, 0)[1]);
  });

  it('jitters grid cells stably within the cell to break moire', () => {
    const solver = new FlockCpuSolver(buildCanvas([], 0.6));
    solver.advanceTo(1, context);
    const [cols, rows] = flockGridDims(64, [80, 40, 0]);
    for (const index of [0, 5, 23]) {
      const [x, y] = flockGridRest(64, [80, 40, 0], 1, 0.6, index, index);
      const [px, py] = position(solver, index);
      expect(px).toBeCloseTo(x, 4);
      expect(py).toBeCloseTo(y, 4);
      const col = index % cols;
      expect(Math.abs(x - ((col + 0.5) / cols - 0.5) * 80)).toBeLessThanOrEqual(0.3 * 80 / cols + 1e-9);
    }
    expect(rows).toBe(6);
  });

  it('builds a divergence-free curl flow on its difference stencil', () => {
    // The curl uses central differences with step 0.25; the same stencil's divergence cancels exactly.
    const h = 0.25;
    for (const [x, y, z] of [[0.3, 1.7, -2.2], [4.1, 0.2, 0.9], [-1.4, -3.3, 2.6]]) {
      const divergence = (curlNoise3(x + h, y, z)[0] - curlNoise3(x - h, y, z)[0]
        + curlNoise3(x, y + h, z)[1] - curlNoise3(x, y - h, z)[1]
        + curlNoise3(x, y, z + h)[2] - curlNoise3(x, y, z - h)[2]) / (2 * h);
      expect(Math.abs(divergence)).toBeLessThan(1e-9);
      expect(Math.hypot(...curlNoise3(x, y, z))).toBeGreaterThan(0);
    }
  });

  it('pulls displaced particles back to their grid cell', () => {
    const drift = (behaviors: Array<[string, Record<string, FlockParamValue>]>) => {
      const solver = new FlockCpuSolver(buildCanvas(behaviors));
      solver.advanceTo(1, context);
      const home = position(solver, 20);
      solver.advanceTo(240, context);
      const now = position(solver, 20);
      return Math.hypot(now[0] - home[0], now[1] - home[1], now[2] - home[2]);
    };
    const curl: [string, Record<string, FlockParamValue>] = ['flock.curl-flow', { strength: 60, frequency: 0.05, evolution: 0.3 }];
    const free = drift([curl]);
    const held = drift([curl, ['flock.home', { stiffness: 4 }], ['flock.drag', { amount: 2 }]]);
    expect(free).toBeGreaterThan(5);
    expect(held).toBeLessThan(free / 2);
  });
});
