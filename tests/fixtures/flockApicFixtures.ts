import { FLOCK_AFFINE_STRIDE, FLOCK_PARTICLE_STRIDE, type FlockFluidSpec } from '../../src/services/flock/compiler/flockProgramTypes';

/** An analytical affine field, including rotation, shear and a grid-facet sample. */
export function affineFieldFixture(cellSize = 1) {
  const spec: FlockFluidSpec = { nodeId: 'fluid', sourceNodeId: 'simulation', origin: [-6, -5, -4], dims: [12, 12, 12], cellSize, iterations: 0 };
  // Pressure is disabled only in this fixture to measure transfer in isolation.
  const matrix = [0.5, -1, 0.25, 1, 0.25, -0.5, -0.25, 0.5, -0.75];
  const points: number[][] = [];
  for (let z = 3; z <= 5; z++) for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) points.push([x + 0.25, y + 0.75, z + 0.25]);
  points.push([4, 4.5, 4.5]);
  const state = new Float32Array(points.length * FLOCK_PARTICLE_STRIDE);
  const affine = new Float32Array(points.length * FLOCK_AFFINE_STRIDE);
  points.forEach((grid, index) => {
    const position = grid.map((v, axis) => spec.origin[axis] + v * cellSize);
    const velocity = [0, 1, 2].map(axis => (axis + 1) * 0.5 + position.reduce((sum, v, k) => sum + matrix[axis * 3 + k] * v, 0));
    state.set([...position, 1, ...velocity, 0, 1, 0, 0, 0, 0, 1, 0, 0], index * FLOCK_PARTICLE_STRIDE);
    affine.set(matrix, index * FLOCK_AFFINE_STRIDE);
  });
  return { spec, state, affine, count: points.length, matrix };
}
