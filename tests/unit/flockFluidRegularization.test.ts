import { describe, expect, it } from 'vitest';
import { FlockCpuSeparation } from '../../src/engine/flock/cpu/flockCpuSeparation';
import { FlockCpuFluid } from '../../src/engine/flock/cpu/flockCpuFluid';
import type { FlockFluidSpec } from '../../src/services/flock/compiler/flockProgramTypes';

const spec: FlockFluidSpec = { nodeId: 'fluid', sourceNodeId: 'simulation', origin: [0, 0, 0], dims: [4, 4, 4], cellSize: 1, iterations: 12 };
function particles(positions: number[][]) {
  const state = new Float32Array(positions.length * 16);
  positions.forEach((p, id) => state.set([...p, 1, 0, 0, 0, 10, 1, 0, 0, 0, 0, id, 0, 0], id * 16));
  return state;
}

describe('fluid position regularization', () => {
  it.each([0, 0.02])('separates a pair at distance %s without changing its center or velocity', distance => {
    const state = particles([[2, 2, 2], [2 + distance, 2, 2]]), before = state.slice();
    new FlockCpuSeparation(spec, 2).step(state, 2, 0.5, 0.1, 1 / 60);
    expect(Math.hypot(state[0] - state[16], state[1] - state[17], state[2] - state[18])).toBeGreaterThan(distance);
    for (let axis = 0; axis < 3; axis++) {
      expect(state[axis] + state[16 + axis]).toBeCloseTo(before[axis] + before[16 + axis], 6);
      expect(state[4 + axis]).toBe(0); expect(state[20 + axis]).toBe(0);
    }
  });

  it('bounds corrections in an overfull cell and ignores dead particles', () => {
    const count = 1025, state = particles(Array.from({ length: count }, () => [0.01, 0.01, 0.01]));
    state[3] = -1;
    const dead = state.slice(0, 16);
    new FlockCpuSeparation(spec, count).step(state, count, 1, 0.5, 1 / 60);
    expect(state.slice(0, 16)).toEqual(dead);
    for (let id = 1; id < count; id++) {
      const p = state.slice(id * 16, id * 16 + 3);
      expect(Math.hypot(...Array.from(p, value => value - 0.01))).toBeLessThanOrEqual(0.125001);
      for (const value of p) expect(value).toBeGreaterThanOrEqual(Math.fround(0.01));
    }
  });

  it('keeps disabled separation unchanged', () => {
    const state = particles([[2, 2, 2], [2, 2, 2]]), before = state.slice();
    const solver = new FlockCpuSeparation(spec, 2);
    solver.step(state, 2, 0, 0.1, 1 / 60); solver.step(state, 2, 1, 0, 1 / 60);
    solver.step(state, 2, 1, 0.1, 0);
    expect(state).toEqual(before);
  });

  it('replays jitter from absolute steps without velocity injection', () => {
    const initial = particles([[2, 2, 2], [2.2, 2, 2]]);
    const run = (firstStep: number) => {
      const state = initial.slice(), fluid = new FlockCpuFluid(spec, 2);
      for (let step = firstStep; step < firstStep + 5; step++) fluid.step(state, 2, 1, 1 / 60,
        { separationStrength: 0, separationDistance: 0.1, jitter: 0.002, step });
      return state;
    };
    const a = run(10);
    expect(a).toEqual(run(10)); expect(a).not.toEqual(run(11)); expect(a).not.toEqual(initial);
    for (let id = 0; id < 2; id++) expect(Array.from(a.slice(id * 16 + 4, id * 16 + 7))).toEqual([0, 0, 0]);
  });
});
