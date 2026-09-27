import { describe, expect, it } from 'vitest';
import { FlockCpuPressure } from '../../src/engine/flock/cpu/flockCpuPressure';
import { pressureCases, pressureFixture, pressureResidual } from '../fixtures/flockPressureFixtures';

describe('MGPCG pressure projection', () => {
  for (const definition of pressureCases) it(`removes volumetric flux error: ${definition.name}`, () => {
    const { counts, divergence } = pressureFixture(definition);
    const solver = new FlockCpuPressure(definition.dims), pressure = new Float64Array(counts.length);
    solver.solve(counts, divergence, pressure, 32);
    expect(pressureResidual(definition.dims, counts, divergence, pressure).relative).toBeLessThan(1.1e-5);
    expect(solver.iterations).toBeLessThan(32);
    expect([...pressure].every(Number.isFinite)).toBe(true);
    const first = pressure.slice();
    // A different occupancy followed by the original solve must not reuse stale coarse topology.
    solver.solve(new Uint32Array(counts.length), divergence, pressure, 32);
    expect([...pressure].every(value => value === 0)).toBe(true);
    solver.solve(counts, divergence, pressure, 32);
    expect(pressure).toEqual(first);
  });
  it('keeps the requested iteration cap', () => {
    const definition = pressureCases[1], { counts, divergence } = pressureFixture(definition);
    const solver = new FlockCpuPressure(definition.dims);
    solver.solve(counts, divergence, new Float64Array(counts.length), 1);
    expect(solver.iterations).toBe(1);
    expect(solver.relativeResidual).toBeLessThan(1);
  });
});
