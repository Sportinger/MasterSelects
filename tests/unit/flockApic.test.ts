import { describe, expect, it } from 'vitest';
import { FlockCpuFluid } from '../../src/engine/flock/cpu/flockCpuFluid';
import { affineFieldFixture } from '../fixtures/flockApicFixtures';

describe('APIC affine transfer', () => {
  it.each([0.5, 1, 2])('preserves an analytical affine field at cell size %s, including grid facets', cellSize => {
    const { spec, state, affine, count } = affineFieldFixture(cellSize);
    const fluid = new FlockCpuFluid(spec, count);
    fluid.affine.set(affine);
    const expected = state.slice();
    for (let repeat = 0; repeat < 8; repeat++) fluid.step(state, count, 1, 0);
    for (let i = 0; i < state.length; i++) expect(state[i]).toBeCloseTo(expected[i], 5);
    for (let i = 0; i < affine.length; i++) expect(fluid.affine[i]).toBeCloseTo(affine[i], 5);
  });

  it('preserves tangential constant velocity at a truncated wall without inventing shear', () => {
    const { spec } = affineFieldFixture();
    const state = new Float32Array([0, -4.99, 0, 1, 2, 0, 3, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
    const fluid = new FlockCpuFluid(spec, 1);
    fluid.step(state, 1, 1, 0);
    expect(Array.from(state.slice(4, 7))).toEqual([2, 0, 3]);
    for (const value of fluid.affine) expect(value).toBeCloseTo(0, 5);
  });

  it('discards affine history for respawns', () => {
    const { spec, state, count } = affineFieldFixture();
    for (let i = 0; i < count; i++) state[i * 16 + 3] = 0;
    const clean = new FlockCpuFluid(spec, count), recycled = new FlockCpuFluid(spec, count);
    recycled.affine.fill(999);
    const reference = state.slice();
    clean.step(reference, count, 1, 1 / 60); recycled.step(state, count, 1, 1 / 60);
    expect(state).toEqual(reference);
    expect(recycled.affine).toEqual(clean.affine);
  });

  it('uses Affine Strength zero as PIC regardless of stored gradients', () => {
    const { spec, state, count, affine } = affineFieldFixture();
    const clean = new FlockCpuFluid(spec, count), apic = new FlockCpuFluid(spec, count);
    apic.affine.set(affine);
    const reference = state.slice();
    clean.step(reference, count, 1, 0); apic.step(state, count, 0, 0);
    expect(state).toEqual(reference);
    expect(apic.affine).toEqual(clean.affine);
  });
});
