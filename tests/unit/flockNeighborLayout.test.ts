import { describe, expect, it } from 'vitest';
import { neighborFixture } from '../fixtures/flockNeighborFixtures';
import { flockNeighborLayout } from '../../src/services/flock/compiler/flockNeighborLayout';
import { estimateFlockSessionBuffers } from '../../src/engine/flock/gpu/FlockGpuSession';

describe('flock neighbor-grid allocation', () => {
  it('omits the population-sized boid index for fluid graphs without consumers', () => {
    const plain = neighborFixture('none', 1_548_576), rules = neighborFixture('rules', 1_548_576);
    expect(flockNeighborLayout(plain).bytes).toBe(32);
    expect(plain.estimate.gridBytes).toBe(32);
    expect(rules.estimate.gridBytes).toBe(80 * 1024 * 1024);
    expect(estimateFlockSessionBuffers(rules).total - estimateFlockSessionBuffers(plain).total).toBe(80 * 1024 * 1024 - 32);
  });

  it('keeps storage for zero-weight rules and for links without boid rules', () => {
    for (const kind of ['rules', 'links'] as const) {
      expect(flockNeighborLayout(neighborFixture(kind)).required).toBe(true);
    }
  });

  it('ignores disconnected rules and rebuilds layout on consumer topology changes', () => {
    const plain = neighborFixture('none'), unused = neighborFixture('disconnected');
    expect(flockNeighborLayout(unused).required).toBe(false);
    expect(unused.estimate.gridBytes).toBe(plain.estimate.gridBytes);
    expect(neighborFixture('rules').hashes.topology).not.toBe(plain.hashes.topology);
    expect(neighborFixture('links').hashes.topology).not.toBe(plain.hashes.topology);
  });
});
