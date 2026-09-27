import type { FlockVec3 } from '../../../types/flock';

export interface FlockPressureLevel { dims: FlockVec3; count: number; offset: number }
export const FLOCK_PRESSURE_RELATIVE_TOLERANCE = 1e-5;
export const FLOCK_PRESSURE_ABSOLUTE_TOLERANCE = 1e-6;
export const FLOCK_PRESSURE_COARSE_SWEEPS = 16;

/** Cell-centered aggregates; odd extents and one-cell axes retain all fine cells. */
export function flockPressureLevels(dims: FlockVec3): FlockPressureLevel[] {
  const levels: FlockPressureLevel[] = [];
  let current: FlockVec3 = [...dims], offset = 0;
  for (;;) {
    const count = current[0] * current[1] * current[2];
    levels.push({ dims: current, count, offset });
    if (count <= 64) break;
    offset += count;
    current = current.map(value => Math.ceil(value / 2)) as FlockVec3;
  }
  return levels;
}

export function flockPressureMemory(dims: FlockVec3): { total: number; largestBinding: number } {
  const levels = flockPressureLevels(dims);
  const totalCells = levels.at(-1)!.offset + levels.at(-1)!.count;
  const count = levels[0].count;
  const vectors = (count + 2 + Math.ceil(count / 256)) * 16;
  return { total: totalCells * 32 + vectors + levels.length * 272, largestBinding: Math.max(totalCells * 16, vectors) };
}
