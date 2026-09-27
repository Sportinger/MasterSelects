import type { FlockVec3 } from '../../src/types/flock';

export const pressureCases: { name: string; dims: FlockVec3; occupied: (x: number, y: number, z: number) => boolean }[] = [
  { name: 'closed odd box', dims: [17, 9, 5], occupied: () => true },
  { name: 'large closed box with multi-stage reduction', dims: [65, 33, 33], occupied: () => true },
  { name: 'free surface with thin tendrils', dims: [33, 17, 9], occupied: (x, y, z) => y < 8 || (x % 7 === 0 && z % 3 === 0) },
  { name: 'disconnected pools', dims: [19, 11, 3], occupied: (x, y) => (x < 7 || x > 12) && y < 7 },
  { name: 'one-cell axis', dims: [33, 3, 1], occupied: () => true },
  { name: 'empty grid', dims: [7, 5, 3], occupied: () => false },
  { name: 'single closed cell', dims: [1, 1, 1], occupied: () => true },
];

/** Independent face-flux construction, without using solver matrices/hierarchy. */
export function pressureDivergence(dims: FlockVec3, counts: Uint32Array, pressure: Float64Array): Float64Array {
  const [nx, ny, nz] = dims, divergence = new Float64Array(counts.length);
  const strides = [1, nx, nx * ny];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * (y + ny * z); if (!counts[i]) continue;
    const c = [x, y, z];
    for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) {
      const coordinate = c[axis] + side;
      if (coordinate < 0 || coordinate >= dims[axis]) continue; // solid wall: zero flux
      const j = i + strides[axis] * side;
      divergence[i] += (counts[j] ? pressure[j] : 0) - pressure[i];
    }
  }
  return divergence;
}

export function pressureFixture(definition: typeof pressureCases[number]) {
  const [nx, ny, nz] = definition.dims, count = nx * ny * nz;
  const counts = new Uint32Array(count), expected = new Float64Array(count);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * (y + ny * z);
    counts[i] = definition.occupied(x, y, z) ? 1 : 0;
    expected[i] = counts[i] ? Math.cos((x + 0.5) * Math.PI / nx) + 0.4 * Math.sin(y * 0.7 + z * 0.2) : 0;
  }
  const divergence = pressureDivergence(definition.dims, counts, expected);
  return { counts, expected, divergence };
}

export function pressureResidual(dims: FlockVec3, counts: Uint32Array, divergence: Float64Array, pressure: Float64Array) {
  const recovered = pressureDivergence(dims, counts, pressure);
  let square = 0, initial = 0, max = 0;
  for (let i = 0; i < counts.length; i++) {
    const error = divergence[i] - recovered[i]; square += error * error; initial += divergence[i] ** 2; max = Math.max(max, Math.abs(error));
  }
  return { relative: initial > 0 ? Math.sqrt(square / initial) : Math.sqrt(square), max };
}
