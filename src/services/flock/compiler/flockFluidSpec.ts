import type { FlockVec3 } from '../../../types/flock';
import type { FlockFluidSpec, FlockOpSpec } from './flockProgramTypes';

/** Grid limits keep the pressure solve interactive and buffers bounded. */
export const FLOCK_FLUID_MAX_AXIS = 256;
export const FLOCK_FLUID_MAX_CELLS = 2_097_152;
export const FLOCK_FLUID_MIN_CELL = 0.5;

/**
 * Fixed MAC grid for the APIC Fluid node. Domain and resolution are
 * topology: changing them rebuilds the grid and resimulates from the start.
 */
export function buildFlockFluidSpec(op: FlockOpSpec): FlockFluidSpec {
  const center = op.params.vectors.center?.base ?? [0, 0, -60];
  const size = op.params.vectors.size?.base ?? [360, 210, 150];
  let cellSize = Math.max(FLOCK_FLUID_MIN_CELL, op.params.numbers.cellSize?.base ?? 6);
  const extent: FlockVec3 = [Math.max(1, size[0]), Math.max(1, size[1]), Math.max(1, size[2])];
  const dimsFor = (cell: number): FlockVec3 => [
    Math.min(FLOCK_FLUID_MAX_AXIS, Math.max(2, Math.ceil(extent[0] / cell))),
    Math.min(FLOCK_FLUID_MAX_AXIS, Math.max(2, Math.ceil(extent[1] / cell))),
    Math.min(FLOCK_FLUID_MAX_AXIS, Math.max(2, Math.ceil(extent[2] / cell))),
  ];
  let dims = dimsFor(cellSize);
  while (dims[0] * dims[1] * dims[2] > FLOCK_FLUID_MAX_CELLS) {
    cellSize *= 1.25;
    dims = dimsFor(cellSize);
  }
  // The grid covers whole cells; keep it centered on the requested domain.
  const covered: FlockVec3 = [dims[0] * cellSize, dims[1] * cellSize, dims[2] * cellSize];
  return {
    nodeId: op.nodeId,
    sourceNodeId: op.sourceNodeId,
    origin: [center[0] - covered[0] / 2, center[1] - covered[1] / 2, center[2] - covered[2] / 2],
    cellSize,
    dims,
    iterations: Math.max(1, Math.min(200, Math.round(op.params.integers.iterations ?? 12))),
  };
}
